/**
 * OpenCode AI 服务适配器 — services/ai.opencode.ts
 *
 * 实现 IAIService, 把 opencode SDK v2 client 包成标准接口.
 * chat / editor 消费者拿 IAIService, 不知道底下是 opencode.
 *
 * 替换为其他 AI 后端: 新建 services/ai.anthropic.ts implements IAIService,
 * 改 App.tsx 注入那一行即可, 上层零修改.
 */

import { Injectable } from '@opensumi/di';
import { Disposable, IDisposable } from '@opensumi/ide-core-common';
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client';

import {
  IAIService,
  type AIEvent,
  type Message,
  type MessagePart,
  type ModelRef,
  type Session,
} from './ai';

const BASE_URL = '/api';

@Injectable()
export class OpencodeAIService implements IAIService {
  readonly id = 'opencode';
  readonly ready: Promise<void>;

  private client: OpencodeClient;
  private disposables = new Set<() => void>();
  private subscribers = new Set<(e: AIEvent) => void>();
  private sse: EventSource | null = null;
  private readyResolved = false;

  constructor() {
    this.client = createOpencodeClient({
      baseUrl: BASE_URL,
      responseStyle: 'fields',
      throwOnError: false,
    });

    this.ready = this.init();
  }

  private async init(): Promise<void> {
    try {
      const res = await fetch(`${BASE_URL}/path`, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        this.readyResolved = true;
        this.startEventStream();
      } else {
        // 重试 — opencode 可能还在启动
        for (let i = 0; i < 20 && !this.readyResolved; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const retry = await fetch(`${BASE_URL}/path`, { headers: { Accept: 'application/json' } });
          if (retry.ok) {
            this.readyResolved = true;
            this.startEventStream();
            break;
          }
        }
      }
    } catch {
      // 网络错, 让 isReady() 持续 false, 消费者按未就绪处理
    }
  }

  isReady(): boolean {
    return this.readyResolved;
  }

  private startEventStream(): void {
    try {
      this.sse = new EventSource(`${BASE_URL}/event`);
      this.sse.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          const evt = this.translateEvent(data);
          if (evt) this.subscribers.forEach((s) => s(evt));
        } catch { /* ignore parse errors */ }
      };
      this.sse.onerror = () => { /* 浏览器会自动重连 */ };
    } catch {
      // EventSource 不可用, 消费者仍可主动轮询
    }
  }

  private translateEvent(raw: any): AIEvent | null {
    if (!raw?.type) return null;
    const sessionId = raw?.data?.sessionID ?? raw?.data?.sessionId;
    switch (raw.type) {
      case 'session.idle':
        return { type: 'status', status: 'idle', sessionId };
      case 'session.status':
        return { type: 'status', status: raw.data?.status === 'idle' ? 'idle' : 'busy', sessionId };
      case 'session.error':
        return { type: 'error', sessionId, error: raw.data?.error?.message || 'unknown' };
      case 'message.updated':
      case 'message.created': {
        const m = raw.data?.message ?? raw.data;
        return { type: 'message', sessionId, message: this.translateMessage(m) };
      }
      default:
        return null;
    }
  }

  private translateMessage(m: any): Message {
    const parts: MessagePart[] = (m?.parts || []).map((p: any) => ({
      type: p.type || 'text',
      text: p.text || p.content || '',
      url: p.url,
      toolName: p.tool || p.name,
    }));
    return {
      id: m?.id || '',
      sessionId: m?.sessionId || m?.sessionID || '',
      role: m?.role || 'assistant',
      content: parts.filter((p) => p.type === 'text').map((p) => p.text || '').join(''),
      parts,
      createdAt: m?.time?.created || Date.now(),
    };
  }

  async listSessions(): Promise<Session[]> {
    await this.ready;
    const { data } = await (this.client as any).session.list();
    const list: any[] = Array.isArray(data) ? data : (data?.data || []);
    return list
      .filter((s: any) => s?.id)
      .map((s: any) => ({
        id: s.id,
        title: s.title || s.slug || s.id,
        agent: s.agent,
        model: s.model?.providerID && s.model?.modelID
          ? { providerID: s.model.providerID, modelID: s.model.modelID }
          : undefined,
        createdAt: s.time?.created || 0,
      }));
  }

  async createSession(opts?: { title?: string; agent?: string; model?: ModelRef }): Promise<Session> {
    await this.ready;
    const params: any = {};
    if (opts?.title) params.id = opts.title;
    if (opts?.agent) params.agent = opts.agent;
    if (opts?.model) params.model = opts.model;
    const { data, error } = await (this.client as any).session.create(params);
    if (error) throw error;
    if (!data?.id) throw new Error('session.create 未返回 id');
    return {
      id: data.id,
      title: data.title || opts?.title || data.id,
      agent: data.agent || opts?.agent,
      model: opts?.model,
      createdAt: data.time?.created || Date.now(),
    };
  }

  async deleteSession(id: string): Promise<void> {
    await this.ready;
    const { error } = await (this.client as any).session.delete({ sessionID: id });
    if (error) throw error;
  }

  async listMessages(sessionId: string): Promise<Message[]> {
    await this.ready;
    const { data } = await (this.client as any).session.messages({ sessionID: sessionId });
    const list: any[] = Array.isArray(data) ? data : (data?.data || data?.messages || []);
    return list.map((row: any) => {
      const info = row.info || row;
      const parts: MessagePart[] = (row.parts || []).map((p: any) => ({
        type: p.type || 'text',
        text: p.text || p.content || '',
        url: p.url,
        toolName: p.tool || p.name,
      }));
      return {
        id: info.id,
        sessionId,
        role: info.role,
        content: parts.filter((p) => p.type === 'text').map((p) => p.text || '').join(''),
        parts,
        createdAt: info.time?.created || 0,
      };
    });
  }

  async sendMessage(
    sessionId: string,
    content: string | MessagePart[],
    opts?: { agent?: string; model?: ModelRef },
  ): Promise<void> {
    await this.ready;
    const parts: MessagePart[] = typeof content === 'string'
      ? [{ type: 'text', text: content }]
      : content;
    const params: any = { sessionID: sessionId, parts };
    if (opts?.agent) params.agent = opts.agent;
    if (opts?.model) params.model = opts.model;
    const { error } = await (this.client as any).session.prompt(params);
    if (error) throw error;
  }

  async abortMessage(sessionId: string): Promise<void> {
    await this.ready;
    const { error } = await (this.client as any).session.abort({ sessionID: sessionId });
    if (error) throw error;
  }

  subscribe(handler: (e: AIEvent) => void): IDisposable {
    this.subscribers.add(handler);
    return Disposable.create(() => this.subscribers.delete(handler));
  }

  dispose(): void {
    this.subscribers.clear();
    if (this.sse) {
      try { this.sse.close(); } catch { /* ignore */ }
      this.sse = null;
    }
    this.disposables.forEach((d) => { try { d(); } catch { /* ignore */ } });
    this.disposables.clear();
  }
}