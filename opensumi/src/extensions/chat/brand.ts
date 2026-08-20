/**
 * chat 模块品牌 re-export — extensions/chat/brand.ts
 *
 * 项目级配置在 @/config/brand, chat 内部通过此文件读取, 不直连 config/.
 * 同时提供 formatBrand 工具处理模板字符串 (greeting / loginHint 用 {nameZh}).
 */

import { APP_BRAND, type AppBrand } from '@/config/brand';

export const CHAT_BRAND = APP_BRAND;
export type ChatBrand = AppBrand;

export function formatBrand(template: string, brand: AppBrand = APP_BRAND): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (brand as any)[k] ?? `{${k}}`);
}