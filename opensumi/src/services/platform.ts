/**
 * 平台判断工具 — services/platform.ts
 *
 * 本项目是本地部署模型 (浏览器与 AI 后端同机), 浏览器 UA 判断的
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
  if (/Mac/i.test(ua)) return 'mac';
  if (/Linux/i.test(ua)) return 'linux';
  return 'unknown';
}

export function getPlatform(): Platform {
  if (_cached) return _cached;
  _cached = detectPlatform();
  return _cached;
}

export const isWindows = (): boolean => getPlatform() === 'windows';
export const isMac = (): boolean => getPlatform() === 'mac';
export const isLinux = (): boolean => getPlatform() === 'linux';

const WIN_SEP = /[\\/]+/;

export function shellQuote(s: string): string {
  if (isWindows()) return `'${s.replace(/'/g, "''")}'`;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function joinHostPath(root: string, rel: string): string {
  if (!rel) return root;
  if (isWindows()) {
    const r = root.replace(/[\\/]+$/, '');
    const p = rel.replace(/^[\\/]+/, '');
    return `${r}\\${p}`;
  }
  if (rel.startsWith('/')) return rel;
  const r = root.replace(/\/+$/, '');
  const p = rel.replace(/^\/+/, '');
  return p ? `${r}/${p}` : r;
}

export function basename(p: string): string {
  const parts = p.split(WIN_SEP);
  return parts[parts.length - 1] || '';
}

export function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx > 0 ? p.slice(0, idx) : (isWindows() ? p.slice(0, idx) : '/');
}