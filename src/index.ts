/**
 * @dsh-external/dsh-version-lock — host half。
 *
 * 负责：
 *   1. 把“版本锁定”配置持久化到 $DSH_HOME/plugins/dsh-version-lock/config.json；
 *   2. 扫描当前机器上的 npx/全局 DSH 安装，识别当前运行版本与桌面壳内置版本；
 *   3. 在 webserver 上注册同源 API，供设置页「通用」里的版本锁定行读写配置。
 *
 * 这个插件本身不直接决定桌面壳启动哪个 DSH：真正的选择逻辑在 DSH Desktop
 * 的启动器里读取同一份 config.json。网页版只保存配置并展示检测信息。
 *
 * 安全边界：
 *   - 只接受 POST application/json，且 Host 头必须是回环地址；
 *   - customPath 只是给桌面启动器读取的路径字符串，不会在这里执行；
 *   - 配置写入使用临时文件 + rename，避免半截文件被启动器读到。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import {
  DSH_SOURCE_MODES,
  DEFAULT_CONFIG,
  PLUGIN_ID,
  SET_API_PATH,
  STATE_API_PATH,
  normalizeConfig,
  type ApiEnvelope,
  type DetectedDshInstall,
  type DshSourceMode,
  type VersionLockConfig,
  type VersionLockState,
} from './shared.js'

export const name = PLUGIN_ID
export const inject = ['webServer']

/** POST body 上限：配置只有 mode + customPath，8KB 足够。 */
const MAX_BODY_BYTES = 8 * 1024

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function pluginDataDir(): string {
  return join(dshHome(), 'plugins', 'dsh-version-lock')
}

function configPath(): string {
  return join(pluginDataDir(), 'config.json')
}

async function loadConfig(): Promise<VersionLockConfig> {
  try {
    const raw = await readFile(configPath(), 'utf8')
    return normalizeConfig(JSON.parse(raw) as unknown)
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

async function saveConfig(config: VersionLockConfig): Promise<void> {
  const file = configPath()
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

/** 从 DSH lib/bin.js 相邻的 package.json 读版本号。 */
function readDshVersion(binPath: string): string | null {
  try {
    const pkgPath = join(dirname(binPath), '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

function detectRunningDsh(): DetectedDshInstall | null {
  const entry = process.argv[1]
  if (!entry || !isFile(entry)) return null
  return { path: entry, kind: 'running', version: readDshVersion(entry) }
}

function findOnPath(command: string): string | undefined {
  const pathEnv = process.env.PATH || ''
  const extensions = process.platform === 'win32' && !command.includes('.')
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase())
    : ['']
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    for (const ext of extensions) {
      const candidate = join(dir, command + ext.toLowerCase())
      if (isFile(candidate)) return candidate
      const candidateUpper = join(dir, command + ext.toUpperCase())
      if (candidateUpper !== candidate && isFile(candidateUpper)) return candidateUpper
    }
  }
  return undefined
}

/** 全局 npm 根目录候选；Windows 与 macOS/Linux 的布局不同。 */
function globalNodeModulesCandidates(nodeBin?: string): string[] {
  const candidates: string[] = []
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    if (appData) candidates.push(join(appData, 'npm', 'node_modules'))
    const prefix = process.env.NPM_CONFIG_PREFIX
    if (prefix) candidates.push(join(prefix, 'node_modules'))
  } else {
    if (nodeBin) candidates.push(join(dirname(nodeBin), 'lib', 'node_modules'))
    candidates.push(join(homedir(), '.npm-global', 'lib', 'node_modules'))
    candidates.push(join(homedir(), '.local', 'lib', 'node_modules'))
  }
  return candidates
}

function scanSystemInstalls(): DetectedDshInstall[] {
  const result: DetectedDshInstall[] = []
  const npxRoot = join(homedir(), '.npm', '_npx')
  if (existsSync(npxRoot)) {
    try {
      for (const entry of readdirSync(npxRoot)) {
        const bin = join(npxRoot, entry, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
        if (isFile(bin)) result.push({ path: bin, kind: 'npx', version: readDshVersion(bin) })
      }
    } catch {
      // npx 缓存目录不可读时忽略，不影响主流程
    }
  }
  const nodeBin = findOnPath('node')
  for (const root of globalNodeModulesCandidates(nodeBin)) {
    const bin = join(root, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (isFile(bin) && !result.some((item) => item.path === bin)) {
      result.push({ path: bin, kind: 'global', version: readDshVersion(bin) })
    }
  }
  return result
}

function bundledInfo(): { path: string; version: string | null } | null {
  const p = process.env.DSH_DESKTOP_BUNDLED_PATH
  const v = process.env.DSH_DESKTOP_BUNDLED_VERSION
  if (p && isFile(p)) return { path: p, version: v || null }
  return null
}

function modeMessage(config: VersionLockConfig, customPathExists: boolean): string {
  switch (config.mode) {
    case 'bundled':
      return '桌面启动器固定使用内置 DSH（当前预览版），官方更新不会顶掉它。'
    case 'system':
      return '桌面启动器固定使用系统/全局最新 DSH；找不到系统版时会启动失败。'
    case 'custom':
      return config.customPath
        ? customPathExists
          ? `桌面启动器使用自定义 DSH：${config.customPath}`
          : `自定义路径不存在：${config.customPath}`
        : '请填写自定义 DSH 的 lib/bin.js 路径。'
    case 'auto':
    default:
      return '桌面启动器沿用默认行为：优先系统/全局最新 DSH，没有则回退内置版。'
  }
}

async function buildState(): Promise<VersionLockState> {
  const config = await loadConfig()
  const running = detectRunningDsh()
  const bundled = bundledInfo()
  const systemInstalls = scanSystemInstalls()
  const resolvedCustomPath = config.customPath
    ? isAbsolute(config.customPath)
      ? config.customPath
      : join(homedir(), config.customPath)
    : ''
  const customPathExists = config.mode === 'custom' && resolvedCustomPath ? isFile(resolvedCustomPath) : false
  const state: VersionLockState = {
    platform: process.platform,
    isDesktop: !!process.env.DSH_DESKTOP,
    launcherSupported: process.env.DSH_DESKTOP_VERSION_LOCK === '1',
    runningVersion: running?.version ?? null,
    bundledVersion: bundled?.version ?? null,
    bundledPath: bundled?.path ?? null,
    systemInstalls,
    config,
    customPathExists,
    message: modeMessage(config, customPathExists),
  }
  return state
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function sendError(res: ServerResponse, status: number, code: string, message: string, state?: VersionLockState): void {
  const envelope: ApiEnvelope<VersionLockState> = { ok: false, error: message, code, state }
  sendJson(res, status, envelope)
}

function readBodyBuffer(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体超过大小上限'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export function isLoopbackRequest(req: IncomingMessage): boolean {
  const host = String(req.headers.host ?? '').toLowerCase()
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return false
  const remote = req.socket.remoteAddress
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
}

export function isJsonRequest(req: IncomingMessage): boolean {
  return /^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))
}

async function handleState(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(req)) {
    sendError(res, 403, 'FORBIDDEN', '只允许本机回环地址访问')
    return
  }
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET')
    sendError(res, 405, 'METHOD_NOT_ALLOWED', '只允许 GET')
    return
  }
  const state = await buildState()
  sendJson(res, 200, { ok: true, state } satisfies ApiEnvelope<VersionLockState>)
}

async function handleSet(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(req)) {
    sendError(res, 403, 'FORBIDDEN', '只允许本机回环地址访问')
    return
  }
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    sendError(res, 405, 'METHOD_NOT_ALLOWED', '只允许 POST')
    return
  }
  if (!isJsonRequest(req)) {
    sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', '请求体必须是 application/json')
    return
  }

  let parsed: unknown
  try {
    const body = await readBodyBuffer(req, MAX_BODY_BYTES)
    parsed = JSON.parse(body.toString('utf8'))
  } catch (error) {
    sendError(res, 400, 'INVALID_JSON', error instanceof Error ? error.message : '请求体不是合法 JSON')
    return
  }

  const root = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>
  const mode = root.mode
  const customPath = root.customPath
  if (typeof mode !== 'string' || !(DSH_SOURCE_MODES as readonly string[]).includes(mode)) {
    sendError(res, 400, 'INVALID_ARGUMENT', 'mode 必须是 auto/bundled/system/custom 之一')
    return
  }
  if (typeof customPath !== 'undefined' && typeof customPath !== 'string') {
    sendError(res, 400, 'INVALID_ARGUMENT', 'customPath 必须是字符串')
    return
  }

  const config = await loadConfig()
  config.mode = mode as DshSourceMode
  if (typeof customPath === 'string') config.customPath = customPath.trim()
  if (config.mode === 'custom' && !config.customPath) {
    sendError(res, 400, 'INVALID_ARGUMENT', 'custom 模式必须填写自定义 DSH 路径')
    return
  }

  try {
    await saveConfig(config)
  } catch (error) {
    sendError(res, 500, 'SAVE_FAILED', error instanceof Error ? error.message : String(error))
    return
  }
  const state = await buildState()
  sendJson(res, 200, { ok: true, state } satisfies ApiEnvelope<VersionLockState>)
}

export function apply(ctx: Context): void {
  ctx.inject(['webServer'], (httpCtx) => {
    const web: WebServer = httpCtx.webServer
    httpCtx.effect(() => {
      const disposeState = web.register({
        kind: 'exact',
        path: STATE_API_PATH,
        handler: (req, res) => handleState(req, res),
      })
      const disposeSet = web.register({
        kind: 'exact',
        path: SET_API_PATH,
        handler: (req, res) => handleSet(req, res),
      })
      ctx.logger?.info?.(`[${PLUGIN_ID}] API ready: ${STATE_API_PATH} / ${SET_API_PATH}`)

      return () => {
        disposeState()
        disposeSet()
      }
    }, `${PLUGIN_ID}: http api`)
  })
}
