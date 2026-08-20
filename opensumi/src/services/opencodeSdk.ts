/**
 * OpenCode SDK 共享命令封装 — src/services/opencodeSdk.ts
 *
 * 仿官方 packages/app/src/context/server-session.ts:
 *   把 v2 SDK 的高频命令 (session.list / session.create / session.delete) 包成
 *   业务可用的函数, 便于 animbook 内多模块复用.
 *
 * 不依赖 chat vsix — vsix 内部自带等价封装, 这里仅给 animbook 容器内模块 (sessions 等) 使用.
 */

import { getOpencodeClient, isOpencodeReady as _isReady, waitForOpencodeReady } from '../_legacy/commands/sandbox';

export function isChatReady(): boolean {
  return _isReady();
}

export async function waitForChatReady(timeoutMs = 8000): Promise<void> {
  return waitForOpencodeReady(timeoutMs);
}

/** 创建新会话 — v2.session.create */
export async function createSession(title?: string): Promise<string> {
  await waitForChatReady();
  const client = getOpencodeClient() as any;
  const params: any = {};
  if (title) params.id = title;
  const { data, error } = await client.session.create(params);
  if (error) throw error;
  if (!data?.id) throw new Error('session.create 未返回 id');
  return data.id;
}

/** 列出会话 — v2.session.list */
export async function listSessions(): Promise<any[]> {
  await waitForChatReady();
  const client = getOpencodeClient() as any;
  const { data, error } = await client.session.list();
  if (error) throw error;
  return Array.isArray(data) ? data : data?.data || [];
}

/** 删除会话 — v2.session.delete */
export async function deleteSession(sessionID: string): Promise<void> {
  await waitForChatReady();
  const client = getOpencodeClient() as any;
  const { error } = await client.session.delete({ sessionID });
  if (error) throw error;
}

/** 切会话事件 — SessionsView 派发, chat vsix 监听 */
export const SESSION_SELECT_EVENT = 'animbook:ai-select-session';

export function dispatchSelectSession(sessionID: string): void {
  window.dispatchEvent(
    new CustomEvent(SESSION_SELECT_EVENT, { detail: { sessionID } }),
  );
}