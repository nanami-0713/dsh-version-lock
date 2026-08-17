/**
 * @dsh-external/dsh-version-lock — 共享模型（host 与 client 共用）。
 *
 * 配置不进入 DSH settings 白名单体系，而是由 host 半通过本地 HTTP API
 * 持久化到 ~/.dsh/plugins/dsh-version-lock/config.json。这里只放纯数据与
 * 纯函数，不引用任何 DSH 运行时，保证两端都能安全打包。
 */

export const PLUGIN_ID = '@dsh-external/dsh-version-lock'

/** 本地状态查询 API（同源路径，由 host 半注册在 webserver 上）。 */
export const STATE_API_PATH = '/api/dsh-version-lock/state'

/** 本地配置写入 API：POST JSON `{ "mode": "...", "customPath": "..." }`。 */
export const SET_API_PATH = '/api/dsh-version-lock/set'

export const CONFIG_VERSION = 1

/**
 * DSH 启动器版本来源：
 * - auto: 沿用默认行为，优先使用系统/全局最新 DSH，找不到再回退内置版；
 * - bundled: 固定使用桌面壳内置的 DSH（当前预览版），忽略系统更新版；
 * - system: 固定使用系统/全局最新 DSH，找不到时报错；
 * - custom: 使用用户指定的 DSH lib/bin.js 路径。
 */
export type DshSourceMode = 'auto' | 'bundled' | 'system' | 'custom'

export const DSH_SOURCE_MODES: readonly DshSourceMode[] = ['auto', 'bundled', 'system', 'custom']

export interface VersionLockConfig {
  version: number
  mode: DshSourceMode
  /** custom 模式下的 DSH lib/bin.js 绝对路径。 */
  customPath: string
}

export const DEFAULT_CONFIG: VersionLockConfig = Object.freeze({
  version: CONFIG_VERSION,
  mode: 'auto',
  customPath: '',
})

export interface DetectedDshInstall {
  /** DSH lib/bin.js 绝对路径。 */
  path: string
  kind: 'npx' | 'global' | 'bundled' | 'custom' | 'running'
  /** 从相邻 package.json 读取到的版本号；读取失败为 null。 */
  version: string | null
}

export interface VersionLockState {
  platform: string
  /** 是否运行在 DSH Desktop 托管的进程中。 */
  isDesktop: boolean
  /** 当前 Desktop 启动器是否支持版本锁定（读取同一份 config.json）。 */
  launcherSupported: boolean
  /** 当前正在运行的 DSH 版本。 */
  runningVersion: string | null
  /** 桌面壳内置 DSH 版本（仅在 Desktop 下由启动器注入）。 */
  bundledVersion: string | null
  /** 桌面壳内置 DSH lib/bin.js 路径。 */
  bundledPath: string | null
  /** 当前机器上扫描到的 npx/全局 DSH。 */
  systemInstalls: DetectedDshInstall[]
  config: VersionLockConfig
  customPathExists: boolean
  /** 面向 UI 的简短说明。 */
  message: string
  error?: string
}

export interface ApiEnvelope<T> {
  ok: boolean
  state?: T
  error?: string
  code?: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeConfig(input: unknown): VersionLockConfig {
  const root = isRecord(input) ? input : {}
  const mode =
    typeof root.mode === 'string' && (DSH_SOURCE_MODES as readonly string[]).includes(root.mode)
      ? (root.mode as DshSourceMode)
      : DEFAULT_CONFIG.mode
  return {
    version: CONFIG_VERSION,
    mode,
    customPath: typeof root.customPath === 'string' ? root.customPath : DEFAULT_CONFIG.customPath,
  }
}

function normalizeInstall(input: unknown): DetectedDshInstall | null {
  if (!isRecord(input)) return null
  if (typeof input.path !== 'string' || !input.path) return null
  const kind = typeof input.kind === 'string' ? input.kind : 'running'
  const validKinds = ['npx', 'global', 'bundled', 'custom', 'running']
  return {
    path: input.path,
    kind: validKinds.includes(kind) ? (kind as DetectedDshInstall['kind']) : 'running',
    version: typeof input.version === 'string' ? input.version : null,
  }
}

/** 把非法/损坏的状态响应兜底成可渲染的默认状态。 */
export function normalizeState(input: unknown): VersionLockState {
  const root = isRecord(input) ? input : {}
  const config = normalizeConfig(root.config)
  const installs = Array.isArray(root.systemInstalls)
    ? root.systemInstalls.map(normalizeInstall).filter((x): x is DetectedDshInstall => x !== null)
    : []
  return {
    platform: typeof root.platform === 'string' ? root.platform : 'unknown',
    isDesktop: typeof root.isDesktop === 'boolean' ? root.isDesktop : false,
    launcherSupported: typeof root.launcherSupported === 'boolean' ? root.launcherSupported : false,
    runningVersion: typeof root.runningVersion === 'string' ? root.runningVersion : null,
    bundledVersion: typeof root.bundledVersion === 'string' ? root.bundledVersion : null,
    bundledPath: typeof root.bundledPath === 'string' ? root.bundledPath : null,
    systemInstalls: installs,
    config,
    customPathExists: typeof root.customPathExists === 'boolean' ? root.customPathExists : false,
    message: typeof root.message === 'string' ? root.message : '',
    error: typeof root.error === 'string' ? root.error : undefined,
  }
}
