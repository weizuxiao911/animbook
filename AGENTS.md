# AGENTS.md — AI 协作约定

> AI agent 速查表. 修改前先看"关键位置"和"约定/禁忌"再动手.

## 项目速写

`animbook` 是浏览器端可交互工作台, 三层独立进程通过 HTTP/WS 互联:

| 角色 | 职责 | 端口 | 启动 cwd |
|---|---|---|---|
| webapp (codeblitz) | 交互层 / 工作台 / 内置拓展宿主 | `:8090` | `animbook/` (npm run dev 根) |
| registry | vsix 业务拓展分发 + `/extensions/*` 反代 | `:13000` | `animbook/registry/` |
| opencode | AI 推理 / 文件系统 (`/api/*`) / PTY 终端 | `:24096` | `animbook/workspace/` |

`npm run dev` (在 `animbook/` 根) 并发拉起三个进程.

## 关键文件位置

```
animbook/
├── package.json                 # 顶层编排: dev/build + 三进程启动
├── webpack.config.js            # webapp 构建 (与 webapp/ 配合)
├── .gitignore                   # /workspace/ /registry/certs/ /dist/ 等
│
├── webapp/                      # codeblitz 前端 (纯 web)
│   ├── src/
│   │   ├── index.tsx            # 入口: 异步预取 opencode cwd 注入 __APP_CONFIG__
│   │   ├── App.tsx              # codeblitz AppRenderer, workspaceDir + key 重挂载
│   │   ├── config/
│   │   │   ├── brand.ts         # CHAT_CONFIG (App 品牌 + 建议卡片)
│   │   │   ├── layout.tsx       # LayoutComponent (split 布局)
│   │   │   ├── modules.ts       # 内置 builtin modules (含 Chat)
│   │   │   ├── preferences.ts   # 主题/布局默认
│   │   │   ├── runtime.ts       # codeblitz runtimeConfig (FS / OverlayFS)
│   │   │   └── slots.ts         # 各槽位 module 列表
│   │   ├── extensions/          # 内置 7 个拓展 (见下)
│   │   ├── services/
│   │   │   ├── opencode-sdk.ts  # opencode SDK 单例 + 启动派发 ready
│   │   │   ├── fs.ts            # fsList/fsRead/toHostPath (IDE 路径→opencode cwd)
│   │   │   ├── workspace.ts     # getWorkspaceDir() 缓存 opencode cwd
│   │   │   ├── platform.ts      # mac/linux/windows 平台判断
│   │   │   └── registry.ts     # registry metadata 拉取 + kt-ext 静态资源覆盖
│   │   ├── styles/overrides.css # OpenSumi 框架样式深度覆盖 (槽位/凸起/磨砂)
│   │   └── extensions/chat/    # Chat 内置 (右栏 AI 面板, 与 registry/extensions/chat 独立)
│
├── registry/                   # vsix 分发服务
│   ├── src/{build,server}.ts   # 扫描 vsix/ → metadata.json → HTTPS 静态分发
│   ├── extensions/chat/        # 独立 vsix 版 chat (备用, webapp 内置为主)
│   ├── certs/                   # HTTPS 自签 (不入库)
│   └── vsix/                    # 构建产物
│
└── workspace/                  # opencode cwd (gitignore, dev 时自动创建)
```

## 关键命令

```bash
# 根目录 (animbook/)
npm run dev              # 三进程: opencode(workspace/) + registry(registry/) + webapp(/)
npm run dev:opencode     # 单独: cd workspace && opencode serve :24096
npm run dev:registry     # 单独: cd registry && PORT=13000 node build+server
npm run dev:web          # 单独: webpack devServer :8090
npm run build            # 生产构建 webapp
```

## webapp 内置拓展 (7 个)

| 目录 | 作用 |
|---|---|
| `actions` | 顶栏布局 toggle (left/bottom/right 折叠) + 主题切换 |
| `welcome` | 启动时 welcome 视图 |
| `chat` | 右栏 AI 面板 (内置主用, 与 registry/extensions/chat 独立) |
| `pdf` | PDF 阅读器 (`/api/fs/read` 读字节流) |
| `sessions` | 历史会话管理 (内置 dock) |
| `html` | HTML 预览/编辑 |
| `binary` | 二进制兜底查看器 |

## 约定 / 禁忌

- **AGENTS.md 在 webapp/ 内禁止再创建** (用户级 AGENTS.md 已固定在 animbook/AGENTS.md)
- **不要硬编码 workspace 路径**: opencode cwd 从 `getWorkspaceDir()` / `/api/path` 读, 不可写死 `assistant/workspace/`
- **不要自己臆造品牌文案**: 品牌/建议都从 `appConfig.chatConfig` (来自 `@/config/brand.ts` 的 `APP_CHAT_CONFIG`) 读, 写 `<brand>nameZh` 等不要写死
- **斜杠指令集合** (`/model` `/connect` `/compact` `/new` `/session` `/skill` `/agent`) 在 `extensions/chat/webview/helpers.ts` 的 `CLIENT_COMMANDS` 维护, 不要在 webview 任意位置添加 `/file` 等 (之前 `/file` 被 `chatConfig` 化处理)
- **拓展入口**: 内置走 `webapp/src/extensions/<name>/{index,module}.ts` (BrowserModule + ComponentContribution), 业务 vsix 走 `registry/extensions/<name>/`
- **路径转换**: IDE 相对路径 (`/foo`) 通过 `services/fs.ts` 的 `toHostPath` 映射到 opencode cwd, webview 不要直接拼接 host 路径
- **修改样式先看 `webapp/src/styles/overrides.css`**: 框架槽位/容器用 OpenSumi 类名, 修改前先在该文件查是否已覆盖 (否则会被 `!important` 规则反向覆盖)
- **修改 webapp 资源加载**: 静态资源覆盖在 `services/registry.ts` 的 `RegistryStaticResourceContribution`, 改静态资源解析看这里
- **测试用 playwright**: 截图放 `.tmp/`, 临时文件不入库 (`.tmp/` 在 .gitignore)

## 常见修改入口

| 改什么 | 看哪里 |
|---|---|
| Chat 命令 (斜杠) | `webapp/src/extensions/chat/webview/helpers.ts` `CLIENT_COMMANDS` |
| Chat UI / 输入框 / 弹层 | `webapp/src/extensions/chat/webview/{Chat.tsx,components/,hooks/,parts/}` |
| Chat 品牌 / 建议卡片 | `@/config/brand.ts` `APP_CHAT_CONFIG` + 改 `webapp/src/index.tsx` 的 `__APP_CONFIG__.chatConfig` 注入 |
| 全局布局 (左/中/右) | `webapp/src/config/layout.tsx` `LayoutComponent` |
| 槽位注册的拓展 (内置) | `webapp/src/config/modules.ts` `getBuiltinModules()` |
| 槽位注册的拓展 (vsix) | `webapp/src/config/slots.ts` `buildSlots()` |
| opencode cwd / workspace 路径 | `webapp/src/services/workspace.ts` (浏览器端 fetch `/api/path` 缓存) |
| opencode SDK 单例 | `webapp/src/services/opencode-sdk.ts` |
| 框架样式覆盖 (槽位/凸起/磨砂) | `webapp/src/styles/overrides.css` |
| 顶栏布局 toggle 按钮 | `webapp/src/extensions/actions/ActionsView.tsx` |
| 主题变量 / 品牌 (app 级别) | `webapp/src/config/brand.ts` `APP_CHAT_CONFIG.brand` |
| html title / favicon | `webapp/src/index.html` + `webapp/src/assets/` + `webpack.config.js` `HtmlWebpackPlugin.favicon` |
| registry vsix 列表/分发 | `registry/src/{build,server}.ts` + `registry/extensions/<name>/` |
| 启动 cwd / 端口 | `animbook/package.json` `scripts` |

## 验证清单 (改完跑)

```bash
cd animbook
npx tsc --noEmit -p tsconfig.json   # webapp 类型
npx webpack --config webpack.config.js  # webapp 构建 (警告可接受)
# browser 实测: dev 起来后 lsof -iTCP:8090,13000,24096 应都 LISTEN
# AI 路径同步: webapp 入口 /api/path 应返回 directory, workspaceDir 应为该路径
```
