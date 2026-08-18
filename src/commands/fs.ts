/**
 * 文件系统沙箱桥 — src/commands/fs.ts
 *
 * animbook 浏览器侧 ↔ opencode 宿主机文件系统 的唯一通道.
 * 所有读写都通过连接到 opencode 实例的 SDK + PTY shell 完成:
 *
 *   - list  : v2.fs.list (HTTP, 不创建 PTY)
 *   - read  : v2.fs.read (HTTP, 返回 Blob/文本, 不创建 PTY)
 *   - write : PTY 执行 shell (Unix: base64 管道; Windows: [IO.File]::WriteAllBytes)
 *   - delete: PTY 执行 shell (rm -rf / Remove-Item)
 *   - find  : v2.fs.find (HTTP)
 *   - mkdir : PTY 执行 shell (mkdir -p / New-Item)
 *
 * shell 平台感知: Windows → powershell.exe, 其余 → /bin/sh (见 platform.ts).
 *
 * 工作区根目录通过 GET {baseUrl}/path 拿 directory 字段动态获取 (不再硬编码 /workspace).
 * IDE 侧路径都是相对于 workspaceDir 的, 映射到宿主机绝对路径后再交给 opencode.
 *
 * 暴露两种用法:
 *   1) window.__ANIMBOOK_FS_API__  — 便捷对象 (供非 OpenSumi 模块, 如 Chat)
 *   2) FsCommandsModule            — OpenSumi CommandContribution (animbook.fs.* 命令)
 */

import { Injectable, Autowired } from '@opensumi/di';
import { Domain, CommandContribution, CommandRegistry, FileChangeType } from '@opensumi/ide-core-common';
import { BrowserModule, ClientAppContribution } from '@opensumi/ide-core-browser';
import { IFileServiceClient } from '@opensumi/ide-file-service';
import { WORKSPACE_ROOT } from '@codeblitzjs/ide-core';

import { getOpencodeClient } from './sandbox';
import { isWindows, shellQuote, joinHostPath, basename, dirname } from './platform';

/** 沙箱文件类型: 0 未知 / 1 文件 / 2 目录 (BrowserFS FileType) */
export const FILE_TYPE_FILE = 1;
export const FILE_TYPE_DIR = 2;

export interface FsEntry {
  name: string;
  type: 0 | 1 | 2;
}

const SHELL_TIMEOUT_MS = 30000;

let _workspaceDir: string | null = null;
let _workspaceDirPromise: Promise<string> | null = null;

/**
 * 获取工作区根目录 (宿主机绝对路径).
 *
 * 调 GET {baseUrl}/path 取 directory 字段; 结果缓存.
 * 失败时抛错, 由调用方决定重试/降级.
 */
export async function getWorkspaceDir(): Promise<string> {
  if (_workspaceDir) return _workspaceDir;
  if (_workspaceDirPromise) return _workspaceDirPromise;
  _workspaceDirPromise = (async () => {
    const res = await fetch('/ai/path', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`GET /ai/path failed: HTTP ${res.status}`);
    const json = await res.json();
    const dir: string = json?.directory;
    if (!dir || typeof dir !== 'string') {
      throw new Error('GET /ai/path 未返回 directory 字段');
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

/** IDE 相对路径 → 宿主机绝对路径.  '/foo/bar.txt' → '{workspace}/foo/bar.txt' (Windows 反斜杠分隔) */
export async function toHostPath(idePath: string): Promise<string> {
  const root = await getWorkspaceDir();
  return joinHostPath(root, idePath);
}

/** shell 可执行命令包装: Windows → PowerShell 非交互执行, 其余 → /bin/sh -c */
function shellCommand(cmd: string): { command: string; args: string[] } {
  if (isWindows()) {
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', cmd] };
  }
  return { command: '/bin/sh', args: ['-c', cmd] };
}

function bytesToBase64(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

interface PtyInfo {
  id: string;
}

/**
 * runShell — 通过 PTY + WebSocket 执行命令, 收集 stdout 后返回.
 *
 * 平台感知: Windows → powershell.exe -NoProfile -NonInteractive -Command,
 * 其余 → /bin/sh -c. 流程:
 *   1. pty.create({ command, args, cwd: workspaceDir, directory: workspaceDir })
 *   2. WebSocket /pty/{id}/connect?directory=...
 *   3. 轮询 pty.get 直到 status==='exited'
 *   4. pty.remove 清理
 */
export async function runShell(command: string): Promise<string> {
  const client = getOpencodeClient() as any;
  if (!client) throw new Error('opencode client not ready');

  const cwd = await getWorkspaceDir();
  const { command: shellPath, args } = shellCommand(command);

  const { data: pty, error: createErr } = await client.pty.create({
    command: shellPath,
    args,
    cwd,
    directory: cwd,
  });
  if (createErr) throw createErr;
  const ptyID = (pty as PtyInfo)?.id;
  if (!ptyID) throw new Error('pty.create 未返回 id');

  // baseUrl 相对路径 → 同源 ws://
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl =
    `${proto}//${window.location.host}/ai/pty/${ptyID}/connect` +
    `?directory=${encodeURIComponent(cwd)}`;

  return new Promise<string>((resolve) => {
    let ws: WebSocket | null = null;
    const chunks: string[] = [];
    let settled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      try { ws?.close(); } catch { /* ignore */ }
      try { client.pty.remove({ ptyID, directory: cwd }).catch(() => { /* ignore */ }); }
      catch { /* ignore */ }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      const out = chunks.join('');
      cleanup();
      resolve(out);
    };

    try {
      ws = new WebSocket(wsUrl);
    } catch {
      finish();
      return;
    }

    ws.onopen = () => {
      pollTimer = setInterval(async () => {
        try {
          const g = await client.pty.get({ ptyID, directory: cwd });
          if (g?.data?.status === 'exited') {
            setTimeout(finish, 400);
          }
        } catch { /* ignore */ }
      }, 400);
    };

    ws.onmessage = (e) => {
      const push = (t: string) => {
        // 过滤 PTY 协议控制消息
        const trimmed = t.replace(/^\u0000+/, '');
        if (
          trimmed.startsWith('{"cursor"')
          || trimmed.startsWith('{"type":"cursor"')
          || trimmed.startsWith('{"type":"resize"')
        ) return;
        chunks.push(trimmed);
      };
      const data: any = e.data;
      if (typeof data === 'string') {
        push(data);
      } else if (data instanceof Blob) {
        data.text().then(push).catch(() => { /* ignore */ });
      } else if (data instanceof ArrayBuffer) {
        push(new TextDecoder().decode(data));
      }
    };

    ws.onerror = () => { /* 由轮询兜底 */ };
    ws.onclose = () => finish();

    timeoutTimer = setTimeout(finish, SHELL_TIMEOUT_MS);
  });
}

// ============ 高层 FS API ============

/** 列目录 (IDE 相对路径), 返回 {name,type}[] (BrowserFS 约定) */
export async function fsList(idePath: string): Promise<FsEntry[]> {
  const client = getOpencodeClient() as any;
  if (!client) return [];
  try {
    const hostPath = await toHostPath(idePath);
    const { data, error } = await client.v2.fs.list({
      location: { directory: hostPath },
      path: hostPath,
    });
    if (error) throw error;
    const entries: any[] = Array.isArray(data) ? data : (data?.data || []);
    return entries
      .map((e) => {
        const fullPath: string = e?.path || e?.name || '';
        const name = basename(fullPath);
        const type: 0 | 1 | 2 = e?.type === 'directory' ? FILE_TYPE_DIR : FILE_TYPE_FILE;
        return { name, type } as FsEntry;
      })
      .filter((e) => e.name && e.name !== '.' && e.name !== '..');
  } catch (err) {
    console.warn('[fs] list failed:', idePath, err);
    return [];
  }
}

/** 读文件 (IDE 相对路径), 返回 utf-8 字符串 */
export async function fsRead(idePath: string): Promise<string> {
  // v2 SDK fs.read 返回空对象 (500/空响应均不可用), 直接走 v1 HTTP 直连
  // (fsReadBinaryAbsolute: GET /api/fs/read/{name}?directory=...), PDF 同款通道.
  try {
    const hostPath = await toHostPath(idePath);
    const bytes = await fsReadBinaryAbsolute(hostPath);
    return new TextDecoder().decode(bytes);
  } catch (err) {
    console.warn('[fs] read failed:', idePath, err);
    return '';
  }
}

/** 读任意宿主机绝对路径为二进制 (Uint8Array). 供 PDF/图片组件使用.
 *  走 opencode v1 直连 /api/fs/read/{name}?directory=...
 *  (v2 SDK 的 read 端点当前 500, PTY base64 路径对 90MB PDF 也容易超时, 直连最稳)
 *  支持 progress (bytesLoaded / bytesTotal) + signal 中断 */
export async function fsReadBinaryAbsolute(
  hostPath: string,
  opts: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const dir = dirname(hostPath);
  const name = basename(hostPath);
  const url = `/ai/api/fs/read/${encodeURIComponent(name)}?directory=${encodeURIComponent(dir)}`;
  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok) throw new Error(`fs.read HTTP ${res.status}: ${res.statusText}`);
  const total = Number(res.headers.get('content-length') || 0);
  if (!res.body) {
    const buf = await res.arrayBuffer();
    opts.onProgress?.(buf.byteLength, buf.byteLength);
    return new Uint8Array(buf);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      opts.onProgress?.(loaded, total || loaded);
    }
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  opts.onProgress?.(loaded, total || loaded);
  return out;
}

/** 读文件为二进制 (Uint8Array). 用于 PDF/图片等. 走 v1 直连 /api/fs/read/* */
export async function fsReadBinary(
  idePath: string,
  opts: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const hostPath = await toHostPath(idePath);
  return fsReadBinaryAbsolute(hostPath, opts);
}

/** 写文件 (覆盖). 二进制安全 (base64 通道). */
export async function fsWrite(idePath: string, content: string | Uint8Array): Promise<boolean> {
  try {
    const hostPath = await toHostPath(idePath);
    const b64 = bytesToBase64(content);
    const dir = dirname(hostPath);
    // 确保父目录存在再写入
    const cmd = isWindows()
      ? `New-Item -ItemType Directory -Force -Path ${shellQuote(dir)}; `
        + `[IO.File]::WriteAllBytes(${shellQuote(hostPath)}, [Convert]::FromBase64String(${shellQuote(b64)}))`
      : `mkdir -p ${shellQuote(dir)} `
        + `&& printf %s ${shellQuote(b64)} | base64 -d > ${shellQuote(hostPath)}`;
    await runShell(cmd);
    return true;
  } catch (err) {
    console.warn('[fs] write failed:', idePath, err);
    return false;
  }
}

/** 删除文件/目录 (递归). */
export async function fsDelete(idePath: string): Promise<boolean> {
  try {
    const hostPath = await toHostPath(idePath);
    const cmd = isWindows()
      ? `Remove-Item -Recurse -Force ${shellQuote(hostPath)}`
      : `rm -rf ${shellQuote(hostPath)}`;
    await runShell(cmd);
    return true;
  } catch (err) {
    console.warn('[fs] delete failed:', idePath, err);
    return false;
  }
}

/** mkdir -p (若同名文件存在先删除, 兼容历史错同步; 分号避免目录时短路) */
export async function fsMkdir(idePath: string): Promise<boolean> {
  try {
    const hostPath = await toHostPath(idePath);
    const cmd = isWindows()
      ? `Remove-Item -Force -ErrorAction SilentlyContinue ${shellQuote(hostPath)}; `
        + `New-Item -ItemType Directory -Force -Path ${shellQuote(hostPath)}`
      : `rm -f ${shellQuote(hostPath)}; mkdir -p ${shellQuote(hostPath)}`;
    await runShell(cmd);
    return true;
  } catch (err) {
    console.warn('[fs] mkdir failed:', idePath, err);
    return false;
  }
}

/** find 文件名 */
export async function fsFind(idePath: string, pattern = '*'): Promise<string[]> {
  try {
    const hostPath = await toHostPath(idePath);
    const cmd = isWindows()
      ? `Get-ChildItem -Path ${shellQuote(hostPath)} -Recurse -Depth 3 `
        + `-Filter ${shellQuote(pattern)} | ForEach-Object { $_.FullName }`
      : `find ${shellQuote(hostPath)} -maxdepth 4 -name ${shellQuote(pattern)}`;
    const out = await runShell(cmd);
    const prefix = hostPath.replace(/[\\/]+$/, '');
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        if (l.startsWith(prefix)) {
          return l.slice(prefix.length).replace(/^[\\/]+/, '');
        }
        return basename(l);
      });
  } catch (err) {
    console.warn('[fs] find failed:', idePath, err);
    return [];
  }
}

/**
 * installFsApi — 挂 window.__ANIMBOOK_FS_API__.
 * 在 index.tsx 创建 SDK 之后, App 渲染之前调用.
 */
export function installFsApi(): void {
  (window as any).__ANIMBOOK_FS_API__ = {
    isReady: () => !!getOpencodeClient() && !!_workspaceDir,
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

// ============ OpenSumi Commands ============

export const FS_CMD = {
  LIST: 'animbook.fs.list',
  READ: 'animbook.fs.read',
  WRITE: 'animbook.fs.write',
  DELETE: 'animbook.fs.delete',
  MKDIR: 'animbook.fs.mkdir',
  FIND: 'animbook.fs.find',
} as const;

/**
 * FsServiceBridgeContribution — 把 OpenSumi file service 暴露给 runtime 钩子
 *
 * runtime.ts 的 onDidCreateFiles 需要查询 FileStat 区分目录/文件,
 * 静态配置拿不到 injector, 这里在 onDidStart 挂到 window 供其使用.
 */
@Injectable()
@Domain(ClientAppContribution)
export class FsServiceBridgeContribution implements ClientAppContribution {
  @Autowired(IFileServiceClient)
  private readonly fileService!: IFileServiceClient;

  onDidStart(): void {
    (window as any).__ANIMBOOK_FILE_SERVICE__ = this.fileService;
  }
}

@Injectable()
@Domain(CommandContribution)
export class FsCommandsContribution implements CommandContribution {
  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand({ id: FS_CMD.LIST }, { execute: (p: string) => fsList(p) });
    commands.registerCommand({ id: FS_CMD.READ }, { execute: (p: string) => fsRead(p) });
    commands.registerCommand(
      { id: FS_CMD.WRITE },
      { execute: (p: string, c: string | Uint8Array) => fsWrite(p, c) },
    );
    commands.registerCommand({ id: FS_CMD.DELETE }, { execute: (p: string) => fsDelete(p) });
    commands.registerCommand({ id: FS_CMD.MKDIR }, { execute: (p: string) => fsMkdir(p) });
    commands.registerCommand(
      { id: FS_CMD.FIND },
      { execute: (p: string, pat = '*') => fsFind(p, pat) },
    );
  }
}

@Injectable()
export class FsCommandsModule extends BrowserModule {
  providers = [FsCommandsContribution, FsServiceBridgeContribution];
  contributionProvider = [CommandContribution, ClientAppContribution];
}
