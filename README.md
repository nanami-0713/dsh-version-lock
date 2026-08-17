# DSH Version Lock

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
