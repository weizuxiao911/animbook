// @deprecated: 迁到 services/ 和 commands/ 后删除


/**
 * 工作区目录管理 — opensumi/src/commands/workspace.ts
 *
 * 工作区根目录从 opencode `GET /api/path` 拿 (workspaceDir 字段), 启动期缓存.
 * IDE 侧路径都是相对于 workspaceDir 的, 映射到宿主机绝对路径后交给 opencode.
 */

import { joinHostPath } from './platform';

let _workspaceDir: string | null = null;
let _workspaceDirPromise: Promise<string> | null = null;

/**
 * 获取工作区根目录 (宿主机绝对路径).
 *
 * 调 GET /api/path 取 directory 字段; 结果缓存.
 * 失败时抛错, 由调用方决定重试/降级.
 */
export async function getWorkspaceDir(): Promise<string> {
  if (_workspaceDir) return _workspaceDir;
  if (_workspaceDirPromise) return _workspaceDirPromise;
  _workspaceDirPromise = (async () => {
    const res = await fetch('/api/path', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`GET /api/path failed: HTTP ${res.status}`);
    const json = await res.json();
    const dir: string = json?.directory;
    if (!dir || typeof dir !== 'string') {
      throw new Error('GET /api/path 未返回 directory 字段');
    }
    _workspaceDir = dir.replace(/\/+$/, '');
    return _workspaceDir;
  })();
  try {
    return await _workspaceDirPromise;
  } catch (e) {
    _workspaceDirPromise = null;
    throw e;
  }
}

/** 同步读缓存 (仅在已 resolve 后可用, 否则返回 null) */
export function getWorkspaceDirSync(): string | null {
  return _workspaceDir;
}

/** IDE 相对路径 → 宿主机绝对路径. '/foo/bar.txt' → '{workspace}/foo/bar.txt' (Windows 反斜杠分隔) */
export async function toHostPath(idePath: string): Promise<string> {
  const root = await getWorkspaceDir();
  return joinHostPath(root, idePath);
}