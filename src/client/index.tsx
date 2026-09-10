/**
 * @dsh-external/dsh-version-lock — client half。
 *
 * 在设置弹窗「通用」页注册一个配置行（settings.general.item）：
 *   - 模式选择：跟随系统 / 固定内置预览版 / 自定义路径
 *   - 自定义路径输入
 *   - 当前运行版本、内置版本、系统 DSH 列表的只读检测信息
 *
 * 所有配置都通过 host 半提供的同源 HTTP API 读写；浏览器不直接触碰文件系统。
 */
import { useEffect, useState } from 'react'
import { defineStore } from '@deepseek-ai/dsh-client-store'
// 仅用于把 settings.general.item 的 SlotMap 声明合并加载进来
import type { SettingsGeneralItemOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import {
  DSH_SOURCE_MODES,
  PLUGIN_ID,
  SET_API_PATH,
  STATE_API_PATH,
  normalizeState,
  type DshSourceMode,
  type VersionLockState,
} from '../shared'

const CSS = `
.dvl-root{display:flex;flex-direction:column;gap:10px;width:100%;padding:4px 0}
.dvl-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dvl-title{display:flex;flex-direction:column;gap:2px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dvl-title small{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary)}
.dvl-desc{margin:0;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.dvl-mode{display:flex;gap:8px;flex-wrap:wrap}
.dvl-mode-btn{font:inherit;font-size:12px;line-height:18px;padding:6px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);cursor:pointer}
.dvl-mode-btn:hover{background:var(--dsw-alias-button-floating-hover)}
.dvl-mode-btn.active{background:var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-button-primary-fill));color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.dvl-custom{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dvl-input{font:inherit;font-size:12px;line-height:20px;padding:5px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-input-fill,var(--dsw-alias-bg-mask-2));color:var(--dsw-alias-label-primary);min-width:280px;flex:1}
.dvl-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-state-success-primary))}
.dvl-btn{font:inherit;font-size:12px;line-height:18px;padding:5px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);cursor:pointer}
.dvl-btn:hover{background:var(--dsw-alias-button-floating-hover)}
.dvl-btn.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.dvl-btn.primary:hover{background:var(--dsw-alias-button-primary-hover)}
.dvl-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dvl-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}
.dvl-dot.on{background:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-primary))}
.dvl-dot.warn{background:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-primary))}
.dvl-muted{color:var(--dsw-alias-label-tertiary)}
.dvl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px 16px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dvl-grid b{font-weight:600;color:var(--dsw-alias-label-primary)}
.dvl-error{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border-radius:10px;border:1px solid var(--dsw-alias-state-error-secondary);background:var(--dsw-alias-state-error-tertiary);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5}
.dvl-list{margin:0;padding-left:16px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
`

interface VersionLockRowInjected {
  save: (mode: DshSourceMode, customPath?: string) => Promise<void>
  refresh: () => Promise<void>
}

function createRowStore() {
  return defineStore({
    init: () => ({ state: normalizeState(undefined) }),
    actions: {
      sync: (draft, state: VersionLockState) => {
        draft.state = state
      },
    },
  })
}

type VersionLockRowProps = ComposedProps<
  'settings.general.item',
  string,
  never,
  ReturnType<typeof createRowStore>,
  VersionLockRowInjected
>

interface ApiResponse {
  ok?: boolean
  state?: unknown
  error?: string
  code?: string
}

async function callApi(path: string, init?: RequestInit): Promise<{ state?: VersionLockState; error?: string }> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
  })
  let payload: ApiResponse = {}
  try {
    payload = (await response.json()) as ApiResponse
  } catch {
    payload = {}
  }
  if (!response.ok || payload.ok !== true) {
    return {
      state: payload.state === undefined ? undefined : normalizeState(payload.state),
      error: payload.error ?? `请求失败（HTTP ${response.status}）`,
    }
  }
  return { state: normalizeState(payload.state) }
}

function modeLabel(mode: DshSourceMode): string {
  switch (mode) {
    case 'bundled':
      return '固定内置预览版'
    case 'system':
      return '固定系统最新版'
    case 'custom':
      return '自定义路径'
    case 'auto':
    default:
      return '跟随系统（默认）'
  }
}

function modeHint(mode: DshSourceMode): string {
  switch (mode) {
    case 'bundled':
      return '桌面启动器永远使用内置 DSH，官方更新不会顶掉它。'
    case 'system':
      return '桌面启动器永远使用系统/全局最新 DSH。'
    case 'custom':
      return '桌面启动器使用你指定的 DSH lib/bin.js 路径。'
    case 'auto':
    default:
      return '沿用默认行为：优先系统最新版，没有则回退内置版。'
  }
}

function statusClass(state: VersionLockState): 'on' | 'warn' | '' {
  if (state.error) return 'warn'
  if (state.config.mode === 'custom' && state.config.customPath && !state.customPathExists) return 'warn'
  if (state.config.mode === 'system' && state.systemInstalls.length === 0) return 'warn'
  if (state.config.mode === 'bundled') return 'on'
  return ''
}

function VersionLockRow(props: VersionLockRowProps): JSX.Element {
  const state = props.useStore((snapshot) => snapshot.state)
  const [draftPath, setDraftPath] = useState(state.config.customPath)

  useEffect(() => {
    setDraftPath(state.config.customPath)
  }, [state.config.customPath])

  // 只在设置行挂载（用户在设置页）时轮询状态，避免常驻请求。
  useEffect(() => {
    void props.refresh()
    const timer = window.setInterval(() => {
      void props.refresh()
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [props.refresh])

  const selectMode = (mode: DshSourceMode): void => {
    void props.save(mode)
  }

  const saveCustomPath = (): void => {
    if (state.config.mode === 'custom') void props.save('custom', draftPath)
  }

  const currentMode = state.config.mode
  const cls = statusClass(state)
  const systemText =
    state.systemInstalls.length === 0
      ? '未检测到 npx/全局 DSH'
      : state.systemInstalls.map((item) => `${item.version ?? '未知版本'}（${item.kind}）`).join('、')

  return (
    <div className="dvl-root">
      <div className="dvl-head">
        <div className="dvl-title">
          DSH 版本锁定
          <small>Pin the DSH version used by Desktop</small>
        </div>
        <span className={`dvl-dot ${cls}`} aria-hidden="true" />
      </div>

      <p className="dvl-desc">
        选择 DSH Desktop 下次启动时使用哪个 DSH 核心。锁定为内置预览版后，即使官方发布了破坏兼容性的更新，也不会影响你当前可用的版本。
      </p>

      <div className="dvl-mode" role="radiogroup" aria-label="DSH 版本来源">
        {DSH_SOURCE_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={currentMode === mode}
            className={`dvl-mode-btn${currentMode === mode ? ' active' : ''}`}
            onClick={() => selectMode(mode)}
          >
            {modeLabel(mode)}
          </button>
        ))}
      </div>

      {currentMode === 'custom' && (
        <div className="dvl-custom">
          <input
            className="dvl-input"
            type="text"
            spellCheck={false}
            placeholder="/absolute/path/to/dsh/lib/bin.js"
            value={draftPath}
            onChange={(event) => setDraftPath(event.target.value)}
            onBlur={saveCustomPath}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveCustomPath()
            }}
          />
          <button type="button" className="dvl-btn primary" onClick={saveCustomPath}>
            保存路径
          </button>
        </div>
      )}

      <div className="dvl-meta">
        <span>{modeHint(currentMode)}</span>
      </div>
      {state.message && <div className="dvl-meta"><span className="dvl-muted">{state.message}</span></div>}

      <div className="dvl-grid">
        <div>
          <b>当前运行版本</b>
          <div>{state.runningVersion ?? '未知'}</div>
        </div>
        <div>
          <b>运行环境</b>
          <div>{state.isDesktop ? `DSH Desktop · ${state.platform}` : `Web / CLI · ${state.platform}`}</div>
        </div>
        <div>
          <b>桌面内置版本</b>
          <div>{state.bundledVersion ?? '仅在 Desktop 下可见'}</div>
        </div>
        <div>
          <b>系统 DSH</b>
          <div>{systemText}</div>
        </div>
      </div>

      {state.isDesktop && !state.launcherSupported && (
        <div className="dvl-error">
          <span>
            当前 DSH Desktop 启动器尚未支持版本锁定，请更新到包含版本锁定支持的 DSH Desktop，否则此配置不会影响启动。
          </span>
        </div>
      )}

      {!state.isDesktop && (
        <p className="dvl-desc">
          <span className="dvl-muted">
            当前是网页/CLI 模式：此配置会被保存，但只影响 DSH Desktop 下次启动时的 DSH 选择。
          </span>
        </p>
      )}

      {state.error && (
        <div className="dvl-error">
          <span>{state.error}</span>
          <button
            type="button"
            className="dvl-btn"
            onClick={() => {
              void props.refresh()
            }}
          >
            刷新状态
          </button>
        </div>
      )}
    </div>
  )
}

export const inject = ['slots']

/**
 * 0.1.2 起 dsh-client-runtime 包已移除，ctx 由 shell 直接注入。
 * 按本插件实际用到的最小面声明（slots.inject/register + effect）。
 */
interface ClientContext {
  slots: {
    inject(name: string, factory: () => unknown): void
    register(options: Record<string, unknown>, component: unknown): unknown
  }
  effect(fn: () => () => void, key: string): void
}

export function apply(ctx: ClientContext): void {
  const store = createRowStore()
  let boundActions: { sync: (state: VersionLockState) => void } | null = null
  let currentState: VersionLockState = normalizeState(undefined)

  const publish = (next: VersionLockState): void => {
    currentState = next
    boundActions?.sync(next)
  }

  const refresh = async (): Promise<void> => {
    try {
      const result = await callApi(STATE_API_PATH)
      if (result.state) publish(result.state)
      else if (result.error) publish({ ...currentState, error: result.error })
    } catch (error) {
      publish({ ...currentState, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const save = async (mode: DshSourceMode, customPath?: string): Promise<void> => {
    const body: Record<string, unknown> = { mode }
    if (typeof customPath === 'string') body.customPath = customPath
    try {
      const result = await callApi(SET_API_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (result.state) publish(result.state)
      else if (result.error) publish({ ...currentState, error: result.error })
    } catch (error) {
      publish({ ...currentState, error: error instanceof Error ? error.message : String(error) })
    }
  }

  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register(
      {
        name: 'settings.general.item',
        id: 'version-lock',
        order: 70,
        store,
        inject: (actions) => {
          boundActions = actions
          actions.sync(currentState)
          return { save, refresh }
        },
      },
      VersionLockRow,
    ),
  )

  ctx.effect(() => {
    const style = document.createElement('style')
    style.id = 'dsh-version-lock-styles'
    style.setAttribute('data-plugin', PLUGIN_ID)
    style.textContent = CSS
    document.head.appendChild(style)

    return () => {
      style.remove()
    }
  }, `${PLUGIN_ID}: styles`)
}
