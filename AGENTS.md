# animbook — AGENTS.md

## 目的

项目级 AI 协作与开发约定。animbook 是 `/Users/weizuxiao/Documents/开源项目` 下的子项目之一，**同时遵守根目录的 [`AGENTS.md`](../AGENTS.md)**（共享规则）和本文件（项目细节）。本文件只写 animbook 特有的事实和约束。

**作者**：魏祖潇 <https://github.com/weizuxiao911>

## 项目定位

- 名称：animbook
- 类型：可交互式阅读器 / 浏览器端 IDE
- 技术栈：CodeBlitz 2.4.6 + OpenSumi 编辑器壳 + React 18 + Webpack 5 + TypeScript 5
- 目标：浏览器内运行一个轻量 IDE，对接本地 opencode 服务做 AI 辅助 + 文件系统 + 终端

## 关键事实（AI 必须知道）

1. **纯前端项目**。后端只有 `opencode serve`（一个独立进程），不是 Node 后端。
2. **opencode 启动目录** = `workspace/`。opencode 的 `/api/path` 返回 `directory` 字段，**这个目录就是工作区根**。不要硬编码 `/workspace`。
3. **CDP 调试入口** = opencode 暴露 `/ai/pty/...` 走 WebSocket。opencode pty 终端已集成（见 `src/commands/terminal/`）。
4. **AI 面板**（右侧）= 内置 React 组件，**不要**用 OpenSumi 框架的 AI 面板。
5. **PDF 阅读器**（双击 `.pdf` 文件触发，编辑器组件）= 内置 React 组件，**不要**用 monaco 文本编辑器打开（PDF 是二进制）。

## 目录结构

```
animbook/
├── src/
│   ├── App.tsx                    # 顶层 React 组件, 启动前 fetch /ai/path
│   ├── index.tsx                   # 入口: installOpencodeClient + installFsApi + 替换 window.confirm
│   ├── commands/
│   │   ├── sandbox.ts              # OpenCode SDK 客户端 (单例)
│   │   ├── fs.ts                   # FS API: 读 / 写 / PTY shell 调用, 暴露 __ANIMBOOK_FS_API__
│   │   └── terminal/               # OpenCode PTY 桥 + OpenSumi 终端模块
│   ├── config/
│   │   ├── runtime.ts              # OverlayFS + 同步钩子 (onDidSaveTextDocument → 写宿主)
│   │   ├── slots.ts                # 主区/侧栏/底部布局, workspaceDir 动态注入
│   │   └── preferences.ts          # CodeBlitz defaultPreferences
│   ├── extensions/
│   │   ├── welcome/                # 欢迎页 (空工作区展示)
│   │   ├── pdf-reader/             # PDF 阅读器 (pdfjs-dist v4)
│   │   ├── actions/                # 顶栏布局切换按钮
│   │   └── assistant/              # 右侧 AI 面板 (opencode SDK 集成)
│   └── styles/
│       ├── overrides.css           # OpenSumi/VSCode 主题覆盖 + 面板背景
│       └── slots.css               # (未启用, 旧版)
├── workspace/                      # opencode serve 的 cwd; 用户文件放这里
├── package.json
├── tsconfig.json
├── webpack.config.js               # 含 /ai → http://127.0.0.1:4096 代理, dev 必需
└── .workspace/                     # 临时目录 (log, dev pids)
```

## 开发命令

```bash
npm install
npm run dev        # 并发启动 opencode (port 4096) + webpack dev (port 8080)
npm run build      # 生产构建
```

dev 时 dev server proxy：`/ai/*` → `http://127.0.0.1:4096/*`，这是 opencode API 入口。

## 架构约束

### 1. PDF 阅读器

- 实现：`src/extensions/pdf-reader/PdfReaderView.tsx`
- 依赖：pdfjs-dist@4.10.38
- 关键路径：
  - 注册：module.ts 用 `@Domain(BrowserEditorContribution)`（**容易漏**，漏了不报错但 resolver 永不触发）
  - 打开：双击 .pdf 触发 `workbenchEditorService.open` → `resolveEditorComponent` → 我们的 resolver 用 `weight: 1000` 抢在 OpenSumi 内置 text resolver 之前
  - 渲染：每页一个 `<div class="ab-pdf-page">` + canvas，transform: scale 缩放，margin: auto 居中
  - 读取：走 `__ANIMBOOK_FS_API__.readBinaryAbsolute` 走 `/ai/api/fs/read/...`（v2 SDK 的 `fs.read` 500 不可用）

### 2. 终端

- 实现：`src/commands/terminal/`
- 把 OpenCode `/pty/*` WebSocket 端点桥接到 OpenSumi 的 `ITerminalServiceClient` 接口
- 关键坑：v2 SDK 的 Pty 接口路径不同（v1 是 `/pty/{id}/connect`，v2 通过 `connectToken` 拿 ticket）

### 3. FS API

- 实现：`src/commands/fs.ts`
- 暴露：`window.__ANANIMBOOK_FS_API__`（注意拼写是 `__ANIMBOOK_FS_API__`）
- 读取路径走 v1 endpoint `/api/fs/read/{name}?directory=...`（v2 SDK `fs.read` 500）

### 4. 右下角 confirm 弹框处理

`src/index.tsx` 启动时替换 `window.confirm`，拦截"异常的行终止符"弹框（OpenSumi 对未知扩展名 PDF 会触发）。

## 已知坑 / 不要踩

1. **不要用 `width: 100%` 给 PdfReaderView 根元素**。OpenSumi 编辑器容器链 (`kt_editor_components` 等) 没声明 width，会用内容宽度撑开导致 PDF 渲染异常。改用 `position: absolute; inset: 0`。
2. **不要在 PdfReaderContribution 上漏 `@Domain(BrowserEditorContribution)`**。OpenSumi 靠 `@Domain` 收集器找 resolver，漏了则永不被调用。
3. **不要在 `cd workspace` 后用 `relative path` 写文件**。opencode cwd 在 workspace，但前端路径是 IDE 相对路径，需要 `toHostPath()` 转绝对。
4. **webpack-dev-server 启动 OOM 频繁**。已经加了 `NODE_OPTIONS="--max-old-space-size=4096"`，重启脚本要带上这个。
5. **不要假设 v2 SDK 接口全可用**。`fs.read` 500、`session.shell` 接口变化，必要时降级到 v1 endpoint 直连。

## 与根 AGENTS.md 的关系

本文件是项目级（ag），根 `AGENTS.md` 是工作区级（ag）。优先级：

1. 用户当前任务明确指令
2. **本文件（animbook 特定规则）**
3. 根 `AGENTS.md`（跨项目共享规则）
4. `README.md`、配置、代码约定

冲突时**本文件优先**（更具体）。
