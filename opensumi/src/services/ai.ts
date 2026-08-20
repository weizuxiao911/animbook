/**
 * AI 服务接口 — services/ai.ts
 *
 * chat / editor / 任何消费者只 import 这个接口, 不关心是 opencode / anthropic / ollama 哪种.
 * 实现方在 services/ai.opencode.ts (或 .anthropic.ts / .ollama.ts).
 *
 * 用法:
 *   1. 实现方: class XxxAIService implements IAIService + @Injectable()
 *   2. App 启动: injector.addProviders(XxxAIService)
 *   3. 消费者: @Autowired(IAIService) @Optional() private readonly ai?: IAIService
 *      若 ai 为 undefined → "未配置 AI 服务", 消费者自行处理 (占位/禁用/提示).
 *
 * 替换 AI 服务: 只需新增 services/ai.xxx.ts, 改 App.tsx 一行注入.
 * chat / editor / 命令面板代码零修改.
 *
 * 范围: 只放通用 AI 契约 (会话 + 消息 + 事件流).
 * opencode 私有特性 (skills / custom commands / custom providers / todos / share / compact)
 *  留在 opencode 适配器内, 通过更窄的子接口或 vendor extension 暴露, 不进 IAIService.
 */

import type { IDisposable } from '@opensumi/ide-core-common';

export interface Session {
  id: string;
  title: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
  createdAt: number;
}

export interface MessagePart {
  type: 'text' | 'image' | 'file' | 'tool';
  text?: string;
  url?: string;
  toolName?: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  parts?: MessagePart[];
  createdAt: number;
}

export interface ModelRef {
  providerID: string;
  modelID: string;
  variant?: string;
}

export type AIEvent =
  | { type: 'message'; sessionId: string; message: Message }
  | { type: 'session'; sessionId: string }
  | { type: 'status'; status: 'idle' | 'busy'; sessionId?: string }
  | { type: 'error'; sessionId?: string; error: string };

export interface IAIService {
  readonly id: string;
  readonly ready: Promise<void>;
  isReady(): boolean;

  listSessions(): Promise<Session[]>;
  createSession(opts?: { title?: string; agent?: string; model?: ModelRef }): Promise<Session>;
  deleteSession(id: string): Promise<void>;

  listMessages(sessionId: string): Promise<Message[]>;
  sendMessage(sessionId: string, content: string | MessagePart[], opts?: { agent?: string; model?: ModelRef }): Promise<void>;
  abortMessage(sessionId: string): Promise<void>;

  subscribe(handler: (e: AIEvent) => void): IDisposable;

  dispose(): void;
}

export const IAIService = Symbol('IAIService');