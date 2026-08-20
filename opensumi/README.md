# opensumi

基于 codeblitz 构建的工作台，纯前端 web 应用。opencode + registry 两个外部服务通过 webpack dev proxy（dev）/ 反向代理（prod）接入。

## 启动

工作台代码在 `opensumi/src/`，由 animbook 根的 webpack 构建：

```bash
# 根目录跑 (顶层 package.json 已编排)
npm run dev:web        # 仅 web
npm run dev            # 三进程 (web + opencode + registry)
```

dev 默认 `:8090`，webpack 把 `/api/*` 反代到 opencode `:24096`，`/extensions/*` 反代到 registry `:13000`。

## 目录

```
opensumi/
├── src/
│   ├── App.tsx              # 顶层: 拉工作区 → 拉 vsix metadata → 渲染 AppRenderer
│   ├── index.tsx            # 入口: 实例化 SDK + 挂 FS API + 替换 window.confirm
│   ├── index.html
│   ├── global.d.ts
│   ├── commands/
│   │   ├── fs.ts            # 工作区目录获取 + FS 读写 + PTY shell, 平台感知
│   │   ├── platform.ts      # UA/UA-CH 平台判断 + 路径/shell 适配
│   │   ├── sandbox.ts       # opencode SDK 客户端 (window.__ANIMBOOK_OPENCODE__)
│   │   └── terminal/        # OpenCode PTY ↔ OpenSumi 终端
│   ├── config/
│   │   ├── layout.tsx       # 默认布局
│   │   ├── slots.ts         # 槽位硬编码 (内置 chat-panel 等)
│   │   ├── preferences.ts   # 默认偏好
│   │   └── runtime.ts       # 运行时配置 + OverlayFS 钩子
│   ├── extensions/          # 内置系统级拓展 (与 codeblitz 同 bundle 编译)
│   │   ├── actions/         # 顶栏主题切换按钮
│   │   ├── binary/          # 二进制文件兜底
│   │   ├── chat/            # 右栏 chat 面板 (内置兜底, vsix 可覆盖)
│   │   ├── html/            # HTML 预览 (默认 webview, 可切文本)
│   │   ├── pdf/             # PDF 阅读器 (pdfjs-dist v4)
│   │   ├── sessions/        # 会话列表拓展
│   │   └── welcome/         # 欢迎页 (空工作区)
│   ├── services/
│   │   ├── opencodeSdk.ts   # SDK 单例
│   │   └── registry.ts      # 拉 vsix metadata → 注入 AppRenderer
│   └── styles/
│       └── overrides.css    # OpenSumi 主题覆盖
```

## 槽位（slots）

`config/slots.ts` 硬编码槽位 → 内置组件的 ID：

| 槽位 | modules | 说明 |
|---|---|---|
| top | `actions-default` | 顶栏 logo + 主题切换 |
| left | (空) | 不挂资源管理器, 默认无 sidebar |
| main | `@opensumi/ide-editor` | 编辑器主区 |
| right | `chat-panel` | 内置 chat; vsix 注册同名 viewlet 时覆盖 |
| bottom | `ide-terminal-next`, `ide-output`, `ide-markers` | 终端 + 输出 + 问题 |

## 启动流程

```
App.tsx mount
  ├─ getWorkspaceDir()        → fetch /api/path → opencode cwd
  └─ ExtensionRegistryClient.fetchMetadata()
                              → fetch /extensions/metadata.json → registry
  → AppRenderer 渲染
      ├─ modules: [ChatModule, ActionsModule, WelcomeModule, ...]
      │   (vsix metadata 含 chat-panel viewlet 时, ChatModule 不挂载)
      └─ extensionMetadata (vsix 自动走 contributes.browserViews)
```

## 路径与代理

| 浏览器 fetch | dev (webpack) | prod (反代) |
|---|---|---|
| `/api/path`, `/api/session/*`, `/api/agent`, ... | → opencode `:24096` | → opencode |
| `/extensions/metadata.json`, `/extensions/<name>/...` | → registry `:13000` | → registry |
| `/api/pty/{id}/connect` (WebSocket) | → opencode (proxy ws: true) | → opencode |

## 内置拓展边界

本目录的 `extensions/<name>/` 是**与 codeblitz 同 bundle 编译**的 React 组件，通过 `slots.ts` 显式挂到对应槽位。要新增：

1. `extensions/<name>/` 下放 `module.ts` (BrowserModule + ComponentContribution) + `index.ts` (导出)
2. `App.tsx` 的 `modules: [...]` 数组加入
3. `slots.ts` 槽位 `modules: [...]` 加入组件 ID

vsix 拓展走 `registry/extensions/<name>/` 单独打包，与内置并存不互斥。