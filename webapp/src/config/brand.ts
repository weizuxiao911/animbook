/**
 * 项目级品牌配置 — src/config/brand.ts
 *
 * 单一来源. 全应用 (chat/welcome/error 等所有 UI 文案) 都从这里取.
 * 换产品改这一个文件, 所有引用方无需动.
 */

export const APP_BRAND = {
  name: 'webapp',
  nameZh: '魔法书',
  tagline: '可交互式阅读器',
  greeting: '你好，我是 {nameZh}',
  loginHint: '与 {nameZh} 一起，开启智能阅读',
  loginButton: '登录 →',
  logoChar: 'A',
} as const;

export type AppBrand = typeof APP_BRAND;