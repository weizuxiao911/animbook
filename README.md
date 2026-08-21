# animbook

浏览器端可交互工作台: 基于 CodeBlitz/OpenSumi 容器 + opencode AI 后端 + registry 拓展分发的三层协作系统.

## 系统角色

| 角色 | 职责 | 端口 | 启动 cwd |
|---|---|---|---|
| **webapp** (codeblitz) | 交互层 / 工作台 / 内置拓展宿主 | `:8090` | `animbook/` |
| **registry** | vsix 业务拓展分发 + `/extensions/*` 反代 | `:13000` (HTTPS 自签) | `animbook/registry/` |
| **opencode** | AI 推理 / 文件系统 (`/api/*`) / PTY 终端 | `:24096` | `animbook/workspace/` |

三者独立进程, 通过 HTTP/WS 协议互联, 不共享运行时.

## 技术栈

- **交互层**: opensumi (codeblitz) 作为容器, 纯前端应用
  - 内置**系统级 opensumi 拓展** (`webapp/src/extensions/`, 7 个)
  - 兼容 **vsix 标准的业务拓展** (`registry/extensions/<name>/`, 独立 npm 包 → `.vsix`)
- **拓展分发**: `registry` 后台服务提供支撑
- **AI 服务**: `opencode` 提供支撑 (单实例, 全局共享)

## 分层思想

> opensumi/codeblitz 是**全局容器**, 负责全局服务接入 + 拓展注册激活.

- **`webapp/src/services/`** — 全局服务接入层 (无 OpenSumi/拓展依赖)
  - 接入 registry (注册激活拓展)、opencode (AI + sandbox + 文件系统 + Agent 服务实例) 等全局服务
  - 挂全局实例 (`window.__APP_FS_API__` / `__APP_OPENCODE__` 等), 供内置拓展 + vsix 动态拓展使用
  - 只提供能力 + 挂全局, 不含 DI/命令/UI
- **`webapp/src/commands/`** — 服务实例注册层 (给拓展接入使用)
  - 把 services 的全局实例注册成 OpenSumi 命令/DI contribution
  - 作为"拓展间通信和使用"的机制: 内置拓展 / vsix 动态拓展通过 commands 的 DI/命令获取服务实例
- **服务实例获取 (已验证)**: vsix 走 codeblitz in-process ext host (主线程), 可访问
  `window.__APP_*__` 全局 / `ctx.commands.executeCommand('webapp.fs.*')` / OpenSumi DI
- **关键规则**: 拓展不直接 import `services/` 的内部函数, 而是通过 commands 暴露的 DI/命令/全局实例使用

## 启动流程

`npm run dev` (在 `animbook/` 根) 并发拉起三个进程:

1. **opencode**: `mkdir -p workspace && cd workspace && opencode serve --cors "*"` → `:24096`
2. **registry**: `cd registry/ && PORT=13000 PUBLIC_HOST=localhost:13000 npm run start` → `:13000`
3. **webapp**: webpack devServer → `:8090`

启动后:
1. webapp 内置拓展立即生效 (`webapp/src/extensions/*` 在 bundle 内)
2. webapp 入口预取 opencode 实际 cwd (`/api/path`), 注入 `__APP_CONFIG__.workspaceDir` 让 explorer 根与 opencode 一致
3. webapp 全局服务同时连接 registry (拉拓展清单 + vsix) 与 opencode (AI/FS/PTY)
4. vsix 拓展启动后通过 `/extensions/<name>/...` 从 registry 拉源码 + 资源

## 目录结构

```
animbook/
├── package.json              # 顶层编排: dev/build + 三进程启动
├── README.md
├── AGENTS.md                 # AI 协作约定 (速查表/约定/命令)
├── webpack.config.js          # webapp 构建
├── tsconfig.json
├── .gitignore                 # /workspace/ /registry/certs/ /dist/ 等
│
├── webapp/                    # codeblitz 前端 (纯 web)
│   ├── src/
│   │   ├── index.tsx          # 入口: 异步预取 opencode cwd 注入 __APP_CONFIG__
│   │   ├── App.tsx            # codeblitz AppRenderer (workspaceDir + key 重挂载)
│   │   ├── config/            # brand / layout / modules / preferences / runtime / slots
│   │   ├── extensions/        # 7 个内置拓展 (见下)
│   │   ├── services/          # opencode-sdk / fs / workspace / platform / registry
│   │   └── styles/overrides.css  # OpenSumi 框架样式深度覆盖
│
├── registry/                  # vsix 分发服务
│   ├── src/                   # build.ts + server.ts (TypeScript 源码直跑)
│   ├── extensions/chat/       # 业务 vsix 版 chat (备用, webapp 内置为主)
│   ├── certs/                 # HTTPS 自签 (不入库)
│   └── vsix/                  # 构建产物
│
└── workspace/                # opencode cwd (gitignore, dev 时自动创建)
```

## webapp 内置拓展 (7 个)

| 目录 | 作用 |
|---|---|
| `actions` | 顶栏布局 toggle (left/bottom/right 折叠) + 主题切换 |
| `welcome` | 启动时 welcome 视图 |
| `chat` | 右栏 AI 面板 (内置主用, 与 `registry/extensions/chat` 独立) |
| `pdf` | PDF 阅读器 (`/api/fs/read` 读字节流) |
| `sessions` | 历史会话管理 (内置 dock) |
| `html` | HTML 预览/编辑 |
| `binary` | 二进制兜底查看器 |

## 路径与代理

| 前缀 | 指向 |
|---|---|
| `/api/*` | opencode `:24096` |
| `/extensions/*` | registry `:13000` |

dev 由 webpack devServer 反代; 生产由部署方 nginx/caddy 同样承接两个 prefix.

## 拓展边界

| 类型 | 位置 | 形态 | 适用 |
|---|---|---|---|
| 内置系统级 | `webapp/src/extensions/<name>/` | 与 codeblitz 同 bundle | PDF 阅读器 / 欢迎页 / 布局切换 / AI 面板 等核心能力 |
| 业务 vsix | `registry/extensions/<name>/` | 独立 npm 包 → `.vsix` | 第三方 AI 面板 / 领域工具 / 业务流 |

业务 vsix 通过 `extension.ts` + `views.tsx` 标准入口暴露, `fetch('/api/*')` 走 opencode, `fetch('/extensions/<name>/...')` 走 registry.

## 开发

```bash
npm install
npm run dev    # → http://localhost:8090
```

### 单进程调试

```bash
npm run dev:opencode     # :24096 (cwd: animbook/workspace/)
npm run dev:registry     # :13000
npm run dev:web          # :8090
```

### 业务拓展开发流

```bash
cd registry/extensions/chat
npm run build              # 产出 out/chat-x.y.z.vsix
```

## License

MIT
