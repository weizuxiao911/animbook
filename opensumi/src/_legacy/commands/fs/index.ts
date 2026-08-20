/**
 * FS 模块入口 — opensumi/src/commands/fs/index.ts
 *
 * 1) installFsApi — 挂 window.__ANIMBOOK_FS_API__ (供非 OpenSumi 模块: Chat/PDF 等).
 * 2) barrel — 统一 re-export 给上层 import 用, 路径不变 (`./commands/fs`).
 */

import { getOpencodeClient } from '../sandbox';
import { getWorkspaceDir, getWorkspaceDirSync, toHostPath } from '../workspace';
import { runShell } from '../shell';
import {
  fsList,
  fsRead,
  fsReadBinary,
  fsReadBinaryAbsolute,
  fsWrite,
  fsDelete,
  fsMkdir,
  fsFind,
} from './api';

export * from './api';
export * from '../workspace';
export { FS_CMD, FsCommandsContribution, FsServiceBridgeContribution, FsCommandsModule } from './opensumi';

/**
 * installFsApi — 挂 window.__ANIMBOOK_FS_API__.
 * 在 index.tsx 创建 SDK 之后, App 渲染之前调用.
 */
export function installFsApi(): void {
  (window as any).__ANIMBOOK_FS_API__ = {
    isReady: () => !!getOpencodeClient() && !!getWorkspaceDirSync(),
    getWorkspaceDir,
    getWorkspaceDirSync,
    toHostPath,
    list: fsList,
    read: fsRead,
    readBinary: (p: string, opts?: { onProgress?: (l: number, t: number) => void; signal?: AbortSignal }) =>
      fsReadBinary(p, opts),
    readBinaryAbsolute: (p: string, opts?: { onProgress?: (l: number, t: number) => void; signal?: AbortSignal }) =>
      fsReadBinaryAbsolute(p, opts),
    write: fsWrite,
    delete: fsDelete,
    mkdir: fsMkdir,
    find: fsFind,
    runShell,
  };
  window.dispatchEvent(new CustomEvent('animbook:fs-api-ready'));
}