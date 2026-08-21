import { WORKSPACE_ROOT, type IAppRendererProps } from '@codeblitzjs/ide-core';

import { fsList, fsRead, fsWrite, fsDelete, fsMkdir, FILE_TYPE_FILE, FILE_TYPE_DIR } from '../services/fs';
import { getWorkspaceDirSync } from '../services/workspace';

/**
 * 运行时配置 — CodeBlitz runtimeConfig
 *
 * 文件系统: OverlayFS (IndexedDB 可写 + DynamicRequest 只读)
 *   - writable: IndexedDB     本地可写层 (浏览器 IndexedDB, 用户编辑保存)
 *   - readable: DynamicRequest 远程只读层 (从 opencode 宿主机拉取, 通过 sandbox/fs 走 SDK+PTY)
 *   - OverlayFS 合并:         读文件先查本地 (修改过的), 没有则从宿主机拉
 *
 * 路径映射 (Explorer 与 opencode cwd 强一致的关键):
 *   - BrowserFS 以 WORKSPACE_ROOT (/workspace) 为挂载根
 *   - DynamicRequest 回调收到的 path 形如 /workspace/foo (带 /workspace 前缀)
 *   - sandboxRel() 去掉该前缀 → IDE 相对路径 /foo → fsList/fsRead → toHostPath 拼 opencode cwd
 *   - 结果: Explorer 的 /workspace 根 == opencode cwd (animbook/workspace), 列表/读取一致
 *
 * 读写同步钩子 (CodeBlitz 事件 → 宿主机):
 *   - onDidSaveTextDocument  → monaco 保存时同步写 (fsWrite)
 *   - onDidChangeFiles       → 任意 file service 写入 (含插件 setContent) 同步写
 *   - onDidCreateFiles       → 创建 (查 FileStat 区分目录/文件: mkdir / 空文件)
 *   - onDidDeleteFiles       → 删除 (fsDelete)
 *   - onDidChangeTextDocument: 实时变更不即时同步 (防抖由保存触发)
 *
 * 强一致 (AI 写文件后 Explorer 自动刷新):
 *   - commands/file FsServiceBridgeContribution 订阅 opencode file.watcher.updated
 *   - 收到后 executeCommand('filetree.refresh.all') → BrowserFS 重列目录 → Explorer 更新
 *
 * 写入链路: 插件/编辑器 → OpenSumi file service (OverlayFS) → 钩子 → 宿主机 (opencode)
 *
 * 工作区根目录由 sandbox/fs.getWorkspaceDir() 在启动期从 GET /api/path 拿 directory 字段,
 * 不再硬编码 /workspace.
 */

/** BrowserFS 路径 → IDE 相对路径 (cwd 相对).
 *  BrowserFS 以 WORKSPACE_ROOT (/workspace) 为根, DynamicRequest 回调收到 /workspace/foo,
 *  去掉 /workspace 前缀得到 IDE 相对路径 /foo, 再交给 fsList/fsRead → toHostPath 映射到
 *  opencode cwd (animbook/workspace). 这一步保证 BrowserFS 根与 opencode cwd 强一致. */
function sandboxRel(path: string): string {
  const p = path.startsWith(WORKSPACE_ROOT) ? path.slice(WORKSPACE_ROOT.length) : path;
  return p || '/';
}

/** DynamicRequest readDirectory 回调 — 列宿主机目录 */
async function sandboxReadDirectory(path: string): Promise<Array<[string, number]>> {
  const entries = await fsList(sandboxRel(path));
  return entries.map((e) => [e.name, e.type === FILE_TYPE_DIR ? FILE_TYPE_DIR : FILE_TYPE_FILE]);
}

/** DynamicRequest readFile 回调 — 读宿主机文件 (utf-8 bytes) */
async function sandboxReadFile(path: string): Promise<Uint8Array> {
  const text = await fsRead(sandboxRel(path));
  return new TextEncoder().encode(text || '');
}

/** 保存/删除 → 同步宿主机 */
function syncToSandbox(op: 'write' | 'delete', filepath: string, content?: string): void {
  void (async () => {
    try {
      if (op === 'write' && typeof content === 'string') {
        await fsWrite(filepath, content);
      } else if (op === 'delete') {
        await fsDelete(filepath);
      }
    } catch (err) {
      console.warn('[runtime] sync to sandbox failed:', op, filepath, err);
    }
  })();
}

/**
 * 相对路径 → OpenSumi file URI (file:///workspace{directory}/xxx)
 * WORKSPACE_ROOT 是 CodeBlitz 框架常量, directory 来自 /api/path (动态).
 */
function relToUri(filepath: string): string {
  const dir = getWorkspaceDirSync() || '';
  return `file://${WORKSPACE_ROOT}${dir}/${filepath}`;
}

/** 查询浏览器侧 (IndexedDB/OverlayFS) 该路径是否为目录 */
async function isDirOnBrowser(filepath: string): Promise<boolean> {
  try {
    const fileService = (window as any).__APP_FILE_SERVICE__;
    if (!fileService) return false;
    const stat = await fileService.getFileStat(relToUri(filepath));
    return !!stat?.isDirectory;
  } catch {
    return false;
  }
}

export const runtimeConfig: IAppRendererProps['runtimeConfig'] = {
  workspace: {
    filesystem: {
      fs: 'OverlayFS',
      options: {
        writable: { fs: 'IndexedDB' },
        readable: {
          fs: 'DynamicRequest',
          options: {
            readDirectory: sandboxReadDirectory,
            readFile: sandboxReadFile,
          },
        },
      },
    },
    onDidSaveTextDocument: ({ filepath, content }) => {
      syncToSandbox('write', filepath, content);
    },
    // 任意 file service 写入 (含插件 setContent 等) 同步宿主机
    onDidChangeFiles: (files) => {
      (files || []).forEach((f) => {
        if (f?.filepath && typeof f.content === 'string') {
          syncToSandbox('write', f.filepath, f.content);
        }
      });
    },
    onDidChangeTextDocument: (_args) => {
      // 实时变更不即时同步 (防抖由保存触发)
    },
    onDidCreateFiles: (files) => {
      (files || []).forEach((f) => {
        void (async () => {
          try {
            if (await isDirOnBrowser(f)) {
              await fsMkdir(f); // 目录 → mkdir
            } else {
              await fsWrite(f, ''); // 文件 → 空文件
            }
          } catch (err) {
            console.warn('[runtime] create sync failed:', f, err);
          }
        })();
      });
    },
    onDidDeleteFiles: (files) => {
      (files || []).forEach((f) => syncToSandbox('delete', f));
    },
  },
} as any;
