/**
 * FS 高级 API — opensumi/src/commands/fs/api.ts
 *
 * IDE 相对路径 ↔ 宿主机绝对路径的语义层. 上层 (chat / pdf / editor) 只调这些.
 *
 * 通道分布:
 *   - list  : v2.fs.list (HTTP, 不创建 PTY)
 *   - read  : v1 HTTP 直连 /api/fs/read/{name}?directory=... (二进制安全 + progress)
 *   - write : PTY shell (base64 管道 / [IO.File]::WriteAllBytes)
 *   - delete: PTY shell (rm -rf / Remove-Item)
 *   - mkdir : PTY shell
 *   - find  : PTY shell
 *
 * shell 平台感知走 shell.ts (Windows → PowerShell, 其余 → /bin/sh).
 */

import { getOpencodeClient } from '../sandbox';
import { toHostPath } from '../workspace';
import { runShell, bytesToBase64 } from '../shell';
import { isWindows, shellQuote, basename, dirname } from '../platform';

/** 沙箱文件类型: 0 未知 / 1 文件 / 2 目录 (BrowserFS FileType) */
export const FILE_TYPE_FILE = 1;
export const FILE_TYPE_DIR = 2;

export interface FsEntry {
  name: string;
  type: 0 | 1 | 2;
}

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
  const url = `/api/fs/read/${encodeURIComponent(name)}?directory=${encodeURIComponent(dir)}`;
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