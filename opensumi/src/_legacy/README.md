# _legacy/

历史代码，待拆解。**不要新增依赖到此目录**。

## 来源

之前 `opensumi/src/commands/` 目录（platform/sandbox/workspace/shell/fs/terminal），重构过程中整体迁移过来作过渡。

## 拆分目标

| 当前文件 | 目标位置 | 性质 |
|---|---|---|
| `platform.ts` | `services/platform.ts` | 平台工具 |
| `sandbox.ts` | `services/opencode-sdk.ts` | opencode SDK 实例 + window 挂载 |
| `workspace.ts` | `services/workspace.ts` | workspace dir 管理 |
| `shell.ts` | `services/shell.ts` | 短生命周期 PTY shell |
| `fs/api.ts` | `services/fs.ts` | FS API |
| `fs/opensumi.ts` | `commands/file/` (VSCode 风格) | 命令注册 |
| `terminal/OpenCodePtyService.ts` | `services/pty.ts` + `commands/terminal/` | PTY 服务 + 命令 |
| `terminal/index.ts` | 重组成 `commands/terminal/` | 命令入口 |

## 标记

每个文件首行加 `// @deprecated: 迁到 services/ 和 commands/ 后删除`。

## 注意

`extensions/chat/commands/` 是 chat 拓展内部的命令目录（OpenSumi 扩展约定），**不属于本目录**，保持原位。