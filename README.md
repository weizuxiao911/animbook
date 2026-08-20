# animbook

浏览器端可交互工作台：基于 CodeBlitz/OpenSumi 容器 + opencode AI 后端 + registry 拓展分发的三层协作系统。

## 系统角色

| 角色 | 职责 | 端口 |
|---|---|---|
| **opensumi** (codeblitz) | 交互层 / 工作台 / 内置拓展宿主 | `:8090` |
| **registry** | vsix 业务拓展分发 + `/extensions/*` 反代 | `:13000` (HTTPS 自签) |
| **assistant** (opencode) | AI 推理 / 文件系统 / PTY 终端 | `:24096` |

三者独立进程，通过 HTTP/WS 协议互联，不共享运行时。

## 技术栈

- **交互层**: opensumi (codeblitz) 作为容器，纯前端应用
  - 内置**系统级 opensumi 拓展** (`opensumi/src/extensions/`)
  - 兼容 **vsix 标准的业务拓展** (`registry/extensions/<name>/`，独立 npm 包 → `.vsix`)
- **拓展分发**: `registry` 后台服务提供支撑
- **AI 服务**: `opencode` 提供支撑

## 启动流程

`npm run dev` 并发拉起三个进程：

1. **opencode**: `cd assistant/ && opencode serve --cors "*"` → `:24096`
2. **registry**: `cd registry/ && npm run start` → `:13000`
3. **codeblitz**: webpack devServer → `:8090`

启动后：
1. codeblitz 内置拓展立即生效 (`opensumi/src/extensions/*` 在 bundle 内)
2. codeblitz 全局服务同时连接 registry (拉拓展清单 + vsix) 与 opencode (AI/FS/PTY)
3. vsix 拓展启动后通过 `/extensions/<name>/...` 从 registry 拉源码 + 资源

## 目录结构

```
animbook/
├── package.json              # 顶层编排: dev/build
├── README.md
├── AGENTS.md
│
├── opensumi/                 # 基于 codeblitz 的工作台 (纯 web 前端)
│   ├── src/                  # 工作台源代码 (含内置拓展)
│   ├── webpack.config.js
│   ├── tsconfig.json
│   └── README.md
│
├── registry/                 # 拓展分发服务
│   ├── src/                  # 分发服务源代码
│   ├── extensions/           # 业务拓展源代码, 每个子目录一个
│   ├── vsix/                 # 构建产物
│   ├── certs/                # HTTPS 自签证书
│   └── README.md
│
└── assistant/                # AI 服务 (opencode)
    ├── .opencode/            # opencode 项目级配置
    └── workspace/            # opencode 默认工作区目录 (cwd)
```

## 路径与代理

| 前缀 | 指向 |
|---|---|
| `/api/*` | opencode `:24096` |
| `/extensions/*` | registry `:13000` |

dev 由 webpack devServer 反代；生产由部署方 nginx/caddy 同样承接两个 prefix。

## 拓展边界

| 类型 | 位置 | 形态 | 适用 |
|---|---|---|---|
| 内置系统级 | `opensumi/src/extensions/<name>/` | 与 codeblitz 同 bundle | PDF 阅读器 / 欢迎页 / 布局切换 |
| 业务 vsix | `registry/extensions/<name>/` | 独立 npm 包 → `.vsix` | 第三方 AI 面板 / 领域工具 / 业务流 |

业务 vsix 通过 `extension.ts` + `views.tsx` 标准入口暴露，`fetch('/api/*')` 走 opencode，`fetch('/extensions/<name>/...')` 走 registry。

## 开发

```bash
npm install
npm run dev    # → http://localhost:8090
```

### 单进程调试

```bash
npm run dev:opencode
npm run dev:registry
npm run dev:web
```

### 业务拓展开发流

```bash
cd registry/extensions/chat
npm run build              # 产出 out/chat-x.y.z.vsix
```

## License

MIT