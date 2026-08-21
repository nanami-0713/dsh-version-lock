# DSH Version Lock

> [!IMPORTANT]
> **置顶：版本防线必须是「启动前」逻辑，不能只是插件。**
> 本插件决定的是「DSH Desktop 下次启动用哪个核心」；但终端里裸跑 `npx @deepseek-ai/dsh web` 不经过任何插件——npx 在启动**之前**就解析 latest 并替换版本。一旦新版本是「直接崩溃 / 宿主级破坏」的版本，agent 起不来，连修复它的工具都没有，完全无法回头补救；若是数据格式级变更（历史上出现过 SQLite 结构不兼容），降级也救不回已写入的数据。所以终端侧需要一层等价的「钉壳」——而它只能住在 shell 里：插件是 DSH 启动后才加载的，选版本的决策发生在启动前。

## 终端侧的「钉壳」（建议配合本插件一起用）

两行配置，让 `dsh` 命令永远启动「验收通过」的版本：

```bash
# ~/.zshrc
dsh() { npx -y "@deepseek-ai/dsh@$(cat ~/.dsh/pinned-version 2>/dev/null || echo 0.1.1-rc.1)" "$@"; }
alias dsh-upgrade='npx -y @deepseek-ai/dsh@latest'
```

```bash
# ~/.dsh/pinned-version —— 当前钉住的版本号（一行纯文本）
0.1.1-rc.1
```

| 命令 | 启动版本 | 交互拦截 | 改动 pin |
|---|---|---|---|
| `dsh web`（日常） | 钉住的版本（npx 缓存命中） | 无 | 否 |
| `dsh-upgrade web`（想尝新） | latest 试跑 | 无（`-y`） | **否** |
| `npx @deepseek-ai/dsh web`（官方原味） | latest | 有（Y/N） | 否 |
| 新版本验收通过后改写 pin | —— | —— | ✅ 唯一变更点 |

要点：**pin 只在「新版本跑起来、插件体检通过」之后才移动**，永远指向最后一个已知可用的版本。追新失败时 `dsh web` 一键回到安全版本——修插件的 agent 永远不会困在着火的房子里。npm registry 保留全部已发布版本，`npx -y @deepseek-ai/dsh@<旧版本> web` 随时可精确回退。

> 分工：shell 函数管「终端 npx 拉哪个版本」，本插件管「Desktop 壳下次启动选哪个核心」；两者都只是「选择器」，不侵入 DSH 本体。想恢复官方原生行为：删掉 zshrc 里的函数块和 pin 文件即可。

---

在 DSH 设置「通用」里增加“DSH 版本锁定”配置行，让 DSH Desktop 启动器可以固定使用当前内置预览版，避免官方破坏性更新后把可用的 DSH 顶掉。

## 功能

- 四种版本来源：
  - `跟随系统（默认）`：优先 npx/全局最新 DSH，找不到再回退内置版
  - `固定内置预览版`：桌面启动器永远使用 App 内置的 DSH
  - `固定系统最新版`：桌面启动器永远使用 npx/全局最新 DSH
  - `自定义路径`：使用你指定的 `lib/bin.js`
- 展示当前运行版本、桌面内置版本、检测到的 npx/全局 DSH。
- 配置保存到 `~/.dsh/plugins/dsh-version-lock/config.json`。
- Web / CLI 模式下也可打开设置页查看和保存配置，但实际只影响 DSH Desktop 下次启动。

## 工作原理

```
设置页 UI (settings.general.item)
        │  同源 HTTP API
        ▼
Host 插件 ──写入──► ~/.dsh/plugins/dsh-version-lock/config.json
        │
        ▼
DSH Desktop 启动器（需要包含版本锁定支持的桌面壳）读取该配置，
决定启动 bundled / system / custom DSH。
```

> 注意：插件本身不能改变“当前已经启动的 DSH 进程”。要让锁定真正作用于桌面启动，DSH Desktop 必须使用带版本锁定支持的启动器版本（本仓库 `dsh-desktop` 的 `src/main/backend.js` 已实现）。

## 构建

```bash
npm install
npm run build:all
npm pack
```

## 安装到 DSH

```bash
dsh plugin --profile web install ./dsh-external-dsh-version-lock-0.1.0.tgz
# 或使用 DSH 插件管理界面安装
```

## 平台

- macOS / Windows：均支持（含 npx/全局 DSH 扫描）。
- Web / DSH Desktop：UI 均可用；Desktop 下启用“固定内置预览版”后才会影响启动器选择。
