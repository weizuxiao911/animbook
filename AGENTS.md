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
2. **opencode 启动目录** = `workspace/`（package.json `dev:opencode` 脚本里 `cd workspace`）。opencode 的 `GET /ai/path`（Accept: application/json）返回 `directory` 字段，**这个目录就是工作区根**。旧名 `cwd/` 已废弃。
3. **CDP 调试入口** = opencode 暴露 `/ai/pty/...` 走 WebSocket。opencode pty 终端已集成（见 `src/commands/terminal/`）。
4. **AI 面板**（右侧）= 内置 React 组件，**不要**用 OpenSumi 框架的 AI 面板。
5. **PDF 阅读器**（双击 `.pdf` 文件触发，编辑器组件）= 内置 React 组件，**不要**用 monaco 文本编辑器打开（PDF 是二进制）。
6. **平台感知**。浏览器与 opencode 同机（本地部署模型），`src/commands/platform.ts` 用 `navigator.userAgentData`/UA 判断宿主系统并缓存。所有 shell 命令、路径分隔符都要过它：Windows → `powershell.exe`（`-NoProfile -NonInteractive -Command`）+ `\`，macOS → `/bin/zsh`，Linux → `/bin/bash`。**不要**写死 `/bin/sh`/`rm -rf`/`mkdir -p` 或 `/` 拼接路径。
7. **主题机制**。默认主题 `opensumi-design-dark-theme`（`src/config/preferences.ts` 的 `general.theme`），顶栏太阳/月亮按钮切换浅色（`src/extensions/actions/ActionsView.tsx`）。主题 CSS 变量（`--editor-*`/`--vscode-*`/`--editorWidget-*`）由 CodeBlitz/OpenSumi **按当前主题 JS 动态注入**，不是静态 CSS。`src/styles/overrides.css` 的 `:root` 定义 `--tc-*` 色板（跟随主题做兜底），并在 `.vs`/`.vs-light`/`.codeblitz-light`/`body.design-light` 下把 `--tc-*` 与按钮相关变量强制覆盖为亮色值（白底深字）。

## 目录结构

```
animbook/
├── src/
│   ├── App.tsx                    # 顶层 React 组件, 启动前 fetch /ai/path
│   ├── index.tsx                   # 入口: installOpencodeClient + installFsApi + 替换 window.confirm
│   ├── commands/
│   │   ├── sandbox.ts              # OpenCode SDK 客户端 (单例)
│   │   ├── fs.ts                   # FS API: 读 / 写 / PTY shell 调用, 暴露 __ANIMBOOK_FS_API__
│   │   ├── platform.ts             # 平台判断 (UA/UA-CH) + 默认 shell/转义/路径工具, 全部平台逻辑走这里
│   │   └── terminal/               # OpenCode PTY 桥 + OpenSumi 终端模块
│   ├── config/
│   │   ├── runtime.ts              # OverlayFS + 同步钩子 (onDidSaveTextDocument → 写宿主)
│   │   ├── slots.ts                # 主区/侧栏/底部布局, workspaceDir 动态注入
│   │   ├── layout.tsx              # 默认布局 (默认展开资源管理器)
│   │   └── preferences.ts          # CodeBlitz defaultPreferences
│   ├── extensions/
│   │   ├── welcome/                # 欢迎页 (空工作区展示)
│   │   ├── pdf/                    # PDF 阅读器 (pdfjs-dist v4)
│   │   ├── binary/                 # 二进制文件兜底 (非文本打开)
│   │   ├── html/                   # HTML 预览 (默认 webview, 可切文本编辑)
│   │   ├── actions/                # 顶栏布局切换按钮
│   │   └── assistant/              # 右侧 AI 面板 (opencode SDK 集成)
│   └── styles/
│       ├── overrides.css           # OpenSumi/VSCode 主题覆盖 + 面板背景
│       └── slots.css               # (未启用, 旧版)
├── workspace/                       # opencode serve 的工作区根; 用户文件放这里 (gitignore)
├── package.json
├── tsconfig.json
├── webpack.config.js               # 含 /ai → http://127.0.0.1:24096 代理, dev 必需
└── .workspace/                     # 临时目录 (log, dev pids)
```

## 开发命令

```bash
npm install
npm run dev        # 并发启动 opencode (port 24096) + webpack dev (port 8090)
npm run build      # 生产构建
```

dev 时 dev server proxy：`/ai/*` → `http://127.0.0.1:24096/*`，这是 opencode API 入口。

## 架构约束

### 1. PDF 阅读器

- 实现：`src/extensions/pdf/PdfReaderView.tsx`
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
- 默认 shell 平台感知：macOS `/bin/zsh`、Linux `/bin/bash`、Windows `powershell.exe`（交互模式不加 `-i`）

### 3. FS API

- 实现：`src/commands/fs.ts`
- 暴露：`window.__ANIMBOOK_FS_API__`（注意**不是** `__ANANIMBOOK_FS_API__`）
- 读取路径走 v1 endpoint `/api/fs/read/{name}?directory=...`（v2 SDK `fs.read` 500）
- shell 命令平台感知（`platform.ts`）：Windows 用 PowerShell 原生命令（`New-Item`/`Remove-Item`/`Get-ChildItem`/`[IO.File]::WriteAllBytes`），路径分隔符 `\`

### 4. 平台感知

- 实现：`src/commands/platform.ts`（新增平台逻辑一律加这里，别散落各处）
- 判断优先级：`navigator.userAgentData.platform` → `navigator.userAgent` 正则 → `unknown`（按 Linux 兜底），结果缓存
- 提供：`getPlatform`/`isWindows`/`getDefaultShell`/`shellQuote`/`joinHostPath`/`basename`/`dirname`/`getCodePlatformKey`/`getOperatingSystem`
- 依赖它：`fs.ts`（runShell 与全部文件命令）、`OpenCodePtyService.ts`（默认 shell、getOS、detectAvailableProfiles）
- IDE 相对路径始终是正斜杠（OpenSumi URI 约定），只有**宿主机绝对路径**需要按平台转换

### 5. 右下角 confirm 弹框处理

`src/index.tsx` 启动时替换 `window.confirm`，拦截"异常的行终止符"弹框（OpenSumi 对未知扩展名 PDF 会触发）。

### 6. AI 面板样式与主题可读性（重要）

- **Chat 面板所有样式内联在 `src/extensions/chat/webview/Chat.tsx` 的 `styles` 模板字符串里**，不在 `.css` 文件。新增组件/弹层时：JSX 里用了什么 class，**必须同步在 `styles` 常量中补定义**——漏定义会导致该元素无样式裸渲染（透明背景/黑底黑字），这是已实际踩过的坑（`/` 命令弹窗 `tc-ai__cmd-pop` 曾因无 CSS 定义完全看不清）。
- 颜色一律走主题变量链，**不要硬编码纯黑/纯白**：`--ai-*`（面板内）/ `--tc-*`（overrides.css 定义）/ `--editor-*`、`--vscode-*`、`--editorWidget-*`（主题注入）。浅色主题下 `--editor-*` 等会自动变浅，硬编码色会破坏浅色适配。
- 弹层/浮起表面用 `--ai-bg-elev`（底层是 `--editorWidget-background`），确保不透明、有边框与阴影；`--ai-bg` 跟随面板底色。
- 主题切换（`ActionsView`）后 OpenSumi 会重算主题变量，组件不用自己监听主题——只要全程用变量，切换自动生效。

## 已知坑 / 不要踩

1. **不要用 `width: 100%` 给 PdfReaderView 根元素**。OpenSumi 编辑器容器链 (`kt_editor_components` 等) 没声明 width，会用内容宽度撑开导致 PDF 渲染异常。改用 `position: absolute; inset: 0`。
2. **不要在 PdfReaderContribution 上漏 `@Domain(BrowserEditorContribution)`**。OpenSumi 靠 `@Domain` 收集器找 resolver，漏了则永不被调用。
3. **不要在 `cd cwd` 后用 `relative path` 写文件**。opencode cwd 在 cwd，但前端路径是 IDE 相对路径，需要 `toHostPath()` 转绝对。
4. **webpack-dev-server 启动 OOM 频繁**。webpack.config.js 里没配置内存上限，大改后重启 dev 若 OOM，用 `NODE_OPTIONS="--max-old-space-size=4096"` 手动带上。
5. **不要假设 v2 SDK 接口全可用**。`fs.read` 500、`session.shell` 接口变化，必要时降级到 v1 endpoint 直连。
6. **不要绕开 `platform.ts` 写死 POSIX 命令/路径**。`/bin/sh`、`rm -rf`、`mkdir -p`、`/` 拼接只适合类 Unix，Windows 用户会直接挂；一律用 `isWindows()` 分支或 `joinHostPath`/`shellQuote`。
7. **AI 面板新增 JSX 元素必须同步补 `styles` 常量定义**（见架构约束 6）。漏了 = 无样式裸渲染，弹窗/弹层会黑得看不清。
8. **不要硬编码颜色值**。AI 面板与弹层全部走主题变量；硬编码 `#000`/`#fff` 会破坏明暗主题切换的可读性。

## 与根 AGENTS.md 的关系

本文件是项目级（ag），根 `AGENTS.md` 是工作区级（ag）。优先级：

1. 用户当前任务明确指令
2. **本文件（animbook 特定规则）**
3. 根 `AGENTS.md`（跨项目共享规则）
4. `README.md`、配置、代码约定

冲突时**本文件优先**（更具体）。
