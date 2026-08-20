/**
 * PTY 服务 — services/pty.ts
 *
 * OpenSumi 终端接入 opencode /pty: 把 node pty 层替换为 opencode PTY.
 * 实现 ITerminalServiceClient, 由 commands/terminal 挂到 DI.
 *
 * 流程:
 *   - create2(id, cols, rows, launchConfig) → opencode pty.create → 返回 pty 包装
 *   - WebSocket 连 /api/pty/{id}/connect → onData 回调终端
 *   - onMessage(id, json) → WebSocket 发送 input (含 resize 指令)
 *   - disposeById → pty.remove
 *
 * cwd 从 services/workspace 的 getWorkspaceDirSync() 拿 (启动期已从 /api/path 拉到).
 */

import { Injectable, Autowired, INJECTOR_TOKEN, Injector } from '@opensumi/di';
import { Emitter } from '@opensumi/ide-core-common';
import {
  ITerminalServiceClient,
  ITerminalService,
  ITerminalController,
  type IShellLaunchConfig,
} from '@opensumi/ide-terminal-next/lib/common';

import { getWorkspaceDirSync } from './workspace';
import { getDefaultShell, getCodePlatformKey, getOperatingSystem, isWindows, basename } from './platform';

interface PtyEntry {
  ptyID: string;
  ws: WebSocket;
  closed: boolean;
  name: string;
  pid: number;
}

@Injectable()
export class OpenCodePtyService implements ITerminalServiceClient {
  @Autowired(INJECTOR_TOKEN)
  private injector: Injector;

  static instance: OpenCodePtyService | null = null;

  constructor() {
    OpenCodePtyService.instance = this;
    this.startResizeWatcher();
  }

  /**
   * 修复窗口 resize 后 xterm 卡死.
   */
  private startResizeWatcher(): void {
    let timer: number | undefined;
    const check = () => {
      try {
        const controller: any = this.injector.get(ITerminalController);
        const client: any = controller?.activeClient;
        const raw: any = client?.xterm?.raw;
        const el: any = raw?.element;
        if (!raw || !el) return;
        const cw = el.clientWidth || el.getBoundingClientRect().width;
        const ch = el.clientHeight || el.getBoundingClientRect().height;
        if (cw <= 60 || ch <= 10) return;
        const canvas: any = [...(el.querySelectorAll('canvas') || [])].find(
          (c: any) => !c.className || !String(c.className).includes('decoration'),
        );
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const cellW = canvas.width / (raw.cols * dpr);
        const cellH = canvas.height / (raw.rows * dpr);
        if (!cellW || !cellH || cellW <= 0.5 || cellH <= 0.5) return;
        const cols = Math.max(2, Math.floor(cw / cellW));
        const rows = Math.max(1, Math.floor(ch / cellH));
        if (cols !== raw.cols || rows !== raw.rows) {
          client?._layout?.();
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('resize', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, 200);
    });
    window.setInterval(check, 1000);
  }

  private get terminalService(): any {
    try {
      return this.injector.get(ITerminalService);
    } catch {
      return null;
    }
  }

  private entries = new Map<string, PtyEntry>();
  private dataEmitters = new Map<string, Emitter<string>>();
  private exitEmitters = new Map<string, Emitter<{ code?: number; signal?: number }>>();

  private get client(): any {
    return (window as any).__APP_OPENCODE__ || null;
  }

  private get cwd(): string {
    return getWorkspaceDirSync() || '/';
  }

  /** wsUrl: 同源 /api/pty/... (webpack dev 代理到 opencode, 生产由反向代理承接) */
  private wsUrl(ptyID: string, directory: string): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return (
      `${proto}//${window.location.host}/api/pty/${ptyID}/connect`
      + `?directory=${encodeURIComponent(directory)}`
    );
  }

  async create2(id: string, cols: number, rows: number, launchConfig: IShellLaunchConfig): Promise<any> {
    const client = this.client;
    if (!client) throw new Error('opencode client not ready');
    const cwd = this.cwd;

    const exec = (launchConfig as any).executable || (launchConfig as any).shellPath || '';
    const isDefaultSh = !exec
      || exec === '/bin/sh' || exec === 'sh'
      || exec === '/bin/bash' || exec === 'bash'
      || exec === '/bin/zsh' || exec === 'zsh'
      || exec === 'powershell.exe' || exec === 'pwsh' || exec === 'cmd.exe';
    const fallbackShell = getDefaultShell();
    const shellPath = isDefaultSh ? fallbackShell : exec;
    const rawArgs: any[] = Array.isArray((launchConfig as any).args)
      ? (launchConfig as any).args
      : [];
    // 默认 shell 用交互模式 (有提示符); 用户显式 shell 尊重其 args
    const args: string[] = isDefaultSh
      ? isWindows() ? [] : ['-i']
      : rawArgs.length > 0 ? rawArgs.map(String) : (isWindows() ? [] : ['-i']);

    const { data: pty, error: createErr } = await client.pty.create({
      command: shellPath,
      args,
      cwd,
      directory: cwd,
      title: (launchConfig as any).name || 'Terminal',
      env: { ...((launchConfig as any).env || {}), TERM: 'xterm-256color' },
      size: { cols, rows },
    });
    if (createErr) throw createErr;
    const ptyID = pty?.id;
    if (!ptyID) throw new Error('pty.create 未返回 id');

    const ws = new WebSocket(this.wsUrl(ptyID, cwd));
    let receivedAny = false;

    const entry: PtyEntry = { ptyID, ws, closed: false, name: shellPath, pid: pty?.pid || 0 };
    this.entries.set(id, entry);

    ws.onopen = () => {
      // 500ms 内未收到任何输出则补发 '\r' 触发提示符
      setTimeout(() => {
        try { if (!receivedAny) ws.send('\r'); } catch { /* ignore */ }
      }, 500);
    };
    ws.onmessage = (e) => {
      const data: any = e.data;
      const push = (t: string) => {
        receivedAny = true;
        const trimmed = t.replace(/^\u0000+/, '');
        if (trimmed.startsWith('{"cursor"') || trimmed.startsWith('{"type":"cursor"')) return;
        // 延迟派发, 等 onData handler 注册好
        setTimeout(() => {
          const ts = this.terminalService;
          if (ts?.onMessage) {
            ts.onMessage(id, trimmed);
          } else {
            this.dataEmitters.get(id)?.fire(trimmed);
          }
        }, 300);
      };
      if (typeof data === 'string') {
        push(data);
      } else if (data instanceof ArrayBuffer) {
        push(new TextDecoder().decode(data));
      } else if (data instanceof Blob) {
        data.text().then(push).catch(() => { /* ignore */ });
      }
    };
    ws.onclose = () => {
      entry.closed = true;
      this.terminalService?.closeClient?.(id, 0);
      this.exitEmitters.get(id)?.fire({ code: 0 });
    };
    ws.onerror = () => { /* onclose 兜底 */ };

    return {
      name: shellPath,
      pid: pty?.pid || 0,
      onData: (handler: (data: string) => void) => {
        if (!this.dataEmitters.has(id)) this.dataEmitters.set(id, new Emitter<string>());
        const disp = this.dataEmitters.get(id)!.event(handler);
        return { dispose: () => disp.dispose() };
      },
      onExit: (handler: (code: number, signal?: number) => void) => {
        if (!this.exitEmitters.has(id)) {
          this.exitEmitters.set(id, new Emitter<{ code?: number; signal?: number }>());
        }
        const disp = this.exitEmitters.get(id)!.event((ev) => handler(ev.code ?? 0, ev.signal));
        return { dispose: () => disp.dispose() };
      },
      sendData: (message: string) => {
        this.onMessage(id, JSON.stringify({ data: message }));
      },
    };
  }

  onMessage(id: string, msg: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.closed) return;
    try {
      const json = JSON.parse(msg);
      if (json.method === 'resize') {
        const { cols, rows } = json.params || {};
        if (cols && rows && this.client) {
          this.client.pty.update({
            ptyID: entry.ptyID,
            directory: this.cwd,
            size: { cols, rows },
          }).catch(() => { /* ignore */ });
        }
        return;
      }
      if (json.data != null) {
        entry.ws.send(String(json.data));
      }
    } catch {
      entry.ws.send(msg);
    }
  }

  resize(id: string, rows: number, cols: number): void {
    const entry = this.entries.get(id);
    if (!entry || !this.client) return;
    this.client.pty.update({
      ptyID: entry.ptyID,
      directory: this.cwd,
      size: { rows, cols },
    }).catch(() => { /* ignore */ });
  }

  disposeById(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (!entry.closed) {
      try { entry.ws.close(); } catch { /* ignore */ }
    }
    if (this.client) {
      this.client.pty.remove({ ptyID: entry.ptyID, directory: this.cwd }).catch(() => { /* ignore */ });
    }
    this.entries.delete(id);
    this.dataEmitters.delete(id);
    this.exitEmitters.delete(id);
  }

  dispose(): void {
    for (const id of Array.from(this.entries.keys())) {
      this.disposeById(id);
    }
  }

  getProcessId(id: string): number {
    return this.entries.get(id)?.pid || 0;
  }

  getShellName(id: string): string {
    return this.entries.get(id)?.name || 'sh';
  }

  async getCwd(_id: string): Promise<string | undefined> {
    return this.cwd;
  }

  clientMessage(id: string, data: string): void {
    this.dataEmitters.get(id)?.fire(data);
  }

  closeClient(sessionId: string, data?: any, signal?: number): void {
    this.exitEmitters.get(sessionId)?.fire({ code: typeof data === 'number' ? data : 0, signal });
  }

  processChange(_clientId: string, _processName: string): void { /* noop */ }
  setConnectionClientId(_clientId: string): void { /* noop */ }
  ensureTerminal(_terminalIdArr: string[]): Promise<boolean> { return Promise.resolve(true); }

  async $resolveWindowsShellPath(): Promise<string | undefined> { return 'powershell.exe'; }
  async $resolveUnixShellPath(): Promise<string | undefined> { return '/bin/sh'; }
  async $resolveShellPath(paths: string[]): Promise<string | undefined> { return paths[0] || getDefaultShell(); }
  async detectAvailableProfiles(): Promise<any[]> {
    const shell = getDefaultShell();
    return [{ path: shell, name: basename(shell), isDefault: true }];
  }
  async getDefaultSystemShell(): Promise<string> { return getDefaultShell(); }
  getOS(): any { return getOperatingSystem(); }
  async getCodePlatformKey(): Promise<'osx' | 'windows' | 'linux'> { return getCodePlatformKey(); }
}
