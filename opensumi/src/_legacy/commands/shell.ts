// @deprecated: 迁到 services/ 和 commands/ 后删除


/**
 * 短生命周期 shell 执行 — opensumi/src/commands/shell.ts
 *
 * 通过 opencode PTY + WebSocket 跑一条 shell 命令, 收集 stdout 后返回字符串.
 * 主要供 fs API 的 write/delete/mkdir/find 等"一次性写操作"用.
 *
 * 终端 (OpenCodePtyService.ts) 是长连接 + 流式回调, 不走这里.
 *
 * 平台感知: Windows → powershell.exe -NoProfile -NonInteractive -Command,
 * 其余 → /bin/sh -c.
 */

import { getOpencodeClient } from './sandbox';
import { getWorkspaceDir } from './workspace';
import { isWindows, shellQuote } from './platform';

const SHELL_TIMEOUT_MS = 30000;

interface PtyInfo {
  id: string;
}

/** shell 可执行命令包装: Windows → PowerShell 非交互执行, 其余 → /bin/sh -c */
function shellCommand(cmd: string): { command: string; args: string[] } {
  if (isWindows()) {
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', cmd] };
  }
  return { command: '/bin/sh', args: ['-c', cmd] };
}

/** 字符串/字节 → base64 (分块避免 apply 栈溢出). */
export function bytesToBase64(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * runShell — 通过 PTY + WebSocket 执行命令, 收集 stdout 后返回.
 *
 * 流程:
 *   1. pty.create({ command, args, cwd: workspaceDir, directory: workspaceDir })
 *   2. WebSocket /api/pty/{id}/connect?directory=...
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

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl =
    `${proto}//${window.location.host}/api/pty/${ptyID}/connect` +
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