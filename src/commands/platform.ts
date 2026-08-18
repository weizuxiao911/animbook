/**
 * 平台判断工具 — src/commands/platform.ts
 *
 * 本项目是本地部署模型 (浏览器与 opencode 同机), 浏览器 UA 判断的
 * 就是真正执行 pty/文件读写的宿主系统, 语义一致.
 *
 * 优先级: navigator.userAgentData.platform (UA-CH) → navigator.userAgent 正则.
 * 结果缓存, 只检测一次.
 */

export type Platform = 'mac' | 'windows' | 'linux' | 'unknown';

let _cached: Platform | null = null;

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown';
  try {
    const uaData: any = (navigator as any).userAgentData;
    const p: string = typeof uaData?.platform === 'string' ? uaData.platform : '';
    if (p) {
      if (/win/i.test(p)) return 'windows';
      if (/mac/i.test(p)) return 'mac';
      if (/linux/i.test(p)) return 'linux';
    }
  } catch { /* ignore */ }
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac|iPhone|iPad|iPod/.test(ua)) return 'mac';
  if (/Linux|X11/.test(ua)) return 'linux';
  return 'unknown';
}

export function getPlatform(): Platform {
  if (!_cached) _cached = detectPlatform();
  return _cached;
}

export const isWindows = (): boolean => getPlatform() === 'windows';
export const isMac = (): boolean => getPlatform() === 'mac';

/** OpenSumi/CodeBlitz getCodePlatformKey 用: 'osx' | 'windows' | 'linux' */
export function getCodePlatformKey(): 'osx' | 'windows' | 'linux' {
  switch (getPlatform()) {
    case 'windows': return 'windows';
    case 'mac': return 'osx';
    case 'linux': return 'linux';
    default: return 'linux';
  }
}

/** @opensumi/ide-utils OperatingSystem: Windows=1, Macintosh=2, Linux=3 */
export function getOperatingSystem(): 1 | 2 | 3 {
  switch (getPlatform()) {
    case 'windows': return 1;
    case 'mac': return 2;
    default: return 3;
  }
}

/**
 * 默认交互 shell.
 * 优先级: window.__ANIMBOOK_SHELL__ (宿主注入) → 平台默认
 * (macOS zsh, Linux bash, Windows powershell.exe)
 */
export function getDefaultShell(): string {
  const envShell = typeof window !== 'undefined'
    ? (window as any).__ANIMBOOK_SHELL__
    : '';
  if (envShell) return envShell;
  switch (getPlatform()) {
    case 'windows': return 'powershell.exe';
    case 'mac': return '/bin/zsh';
    default: return '/bin/bash';
  }
}

/**
 * shell 单参数转义.
 * Unix:  单引号包裹, 内嵌单引号 '\''
 * Win:   PowerShell 单引号包裹, 内嵌单引号翻倍 ''
 */
export function shellQuote(s: string): string {
  if (isWindows()) return `'${s.replace(/'/g, "''")}'`;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * 工作区根 + IDE 相对路径 → 宿主机绝对路径.
 * Windows 用反斜杠分隔 (兼容正斜杠输入), 其余用正斜杠.
 */
export function joinHostPath(root: string, rel: string): string {
  if (!rel) return root;
  const base = root.replace(/[\\/]+$/, '');
  const cleanRel = rel.replace(/^[/\\]+/, '');
  if (isWindows()) {
    return `${base}\\${cleanRel.replace(/[\\/]+/g, '\\')}`;
  }
  return `${base}/${cleanRel}`;
}

/** 取路径最后一个分隔符之后的文件名 (兼容 / 与 \) */
export function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/** 取路径目录部分 (兼容 / 与 \) */
export function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx > 0 ? p.slice(0, idx) : (isWindows() ? p.slice(0, idx) : '/');
}

/** 去除末尾所有 / 与 \，平台无关 */
export function trimTrailingSep(p: string): string {
  return p.replace(/[\\/]+$/, '');
}

/**
 * 把路径中的 / 与 \ 统一为目标分隔符.
 * target 缺省：Windows → \，其余 → /.
 * 不解析 . / ..，只做字符替换.
 */
export function normalizeSep(p: string, target?: '/' | '\\'): string {
  const sep = target ?? (isWindows() ? '\\' : '/');
  return p.replace(/[\\/]+/g, sep);
}
