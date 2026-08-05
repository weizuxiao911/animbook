import type { IAppRendererProps } from '@codeblitzjs/ide-core';

import { fsList, fsRead, fsWrite, fsDelete, FILE_TYPE_FILE, FILE_TYPE_DIR } from '../commands/fs';

/**
 * 运行时配置 — CodeBlitz runtimeConfig
 *
 * 文件系统: OverlayFS (IndexedDB 可写 + DynamicRequest 只读)
 *   - writable: IndexedDB     本地可写层 (浏览器 IndexedDB, 用户编辑保存)
 *   - readable: DynamicRequest 远程只读层 (从 opencode 宿主机拉取, 通过 sandbox/fs 走 SDK+PTY)
 *   - OverlayFS 合并:         读文件先查本地 (修改过的), 没有则从宿主机拉
 *
 * 读写同步钩子 (编辑器事件 → 宿主机):
 *   - onDidSaveTextDocument  → 保存时同步写 (fsWrite)
 *   - onDidCreateFiles       → 创建文件/目录 (fsWrite)
 *   - onDidDeleteFiles       → 删除 (fsDelete)
 *   - onDidChangeTextDocument: 实时变更不即时同步 (防抖由保存触发)
 *
 * 工作区根目录由 sandbox/fs.getWorkspaceDir() 在启动期从 GET /ai/path 拿 directory 字段,
 * 不再硬编码 /workspace.
 */

/** DynamicRequest readDirectory 回调 — 列宿主机目录 */
async function sandboxReadDirectory(path: string): Promise<Array<[string, number]>> {
  const entries = await fsList(path);
  return entries.map((e) => [e.name, e.type === FILE_TYPE_DIR ? FILE_TYPE_DIR : FILE_TYPE_FILE]);
}

/** DynamicRequest readFile 回调 — 读宿主机文件 (utf-8 bytes) */
async function sandboxReadFile(path: string): Promise<Uint8Array> {
  const text = await fsRead(path);
  return new TextEncoder().encode(text || '');
}

/** 保存/创建/删除 → 同步宿主机 */
function syncToSandbox(
  op: 'write' | 'create' | 'delete',
  filepath: string,
  content?: string,
): void {
  void (async () => {
    try {
      if (op === 'write' && typeof content === 'string') {
        await fsWrite(filepath, content);
      } else if (op === 'create') {
        await fsWrite(filepath, content || '');
      } else if (op === 'delete') {
        await fsDelete(filepath);
      }
    } catch (err) {
      console.warn('[runtime] sync to sandbox failed:', op, filepath, err);
    }
  })();
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
    onDidChangeTextDocument: (_args) => {
      // 实时变更不即时同步 (防抖由保存触发)
    },
    onDidCreateFiles: (files) => {
      (files || []).forEach((f) => syncToSandbox('create', f));
    },
    onDidDeleteFiles: (files) => {
      (files || []).forEach((f) => syncToSandbox('delete', f));
    },
  },
} as any;
