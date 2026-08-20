/**
 * chat 模块品牌 — extensions/chat/brand.ts
 *
 * 只读取全局配置 (window.__APP_CONFIG__.brand, 由 webapp 容器在启动期注入),
 * 不直接依赖 @/config/brand, 拓展保持自包含.
 * 同时提供 formatBrand 工具处理模板字符串 (greeting / loginHint 用 {nameZh}).
 */

export interface ChatBrand {
  name: string;
  nameZh: string;
  tagline: string;
  greeting: string;
  loginHint: string;
  loginButton: string;
  logoChar: string;
}

const DEFAULT_BRAND: ChatBrand = {
  name: 'animbook',
  nameZh: '魔法书',
  tagline: '可交互式阅读器',
  greeting: '你好，我是 {nameZh}',
  loginHint: '与 {nameZh} 一起，开启智能阅读',
  loginButton: '登录 →',
  logoChar: 'A',
};

export function getBrand(): ChatBrand {
  if (typeof window === 'undefined') return DEFAULT_BRAND;
  const g = (window as any).__APP_CONFIG__?.brand as Partial<ChatBrand> | undefined;
  return g ? { ...DEFAULT_BRAND, ...g } : DEFAULT_BRAND;
}

export function formatBrand(template: string, brand: ChatBrand = getBrand()): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (brand as any)[k] ?? `{${k}}`);
}
