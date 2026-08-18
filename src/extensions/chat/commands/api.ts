/**
 * ai api 共享底层 — commands/ai
 *
 * 前置: opencode SDK 实例 (commands/opencode) 已创建.
 * 本文件提供 AI 会话/消息的底层封装, 供 AiCommandsContribution + components/ai webview 复用.
 * 全部走 SDK client (v2, @opencode-ai/sdk/v2), 不直连 HTTP.
 *
 * v2 client 参数为平铺结构: SDK 的 buildClientParams 内部把 id/agent/model 等
 * 映射到 body, sessionID 等映射到 path.
 */

import { getOpencodeClient, isOpencodeReady, waitForOpencodeReady } from '../../../commands/sandbox';

export function getAiClient() {
  return getOpencodeClient();
}

export function isAiReady(): boolean {
  return isOpencodeReady();
}

export async function waitForAiReady(timeoutMs = 8000): Promise<void> {
  // 等 SDK client 就绪 (沙箱/SDK 重连期间不立即抛错)
  return waitForOpencodeReady(timeoutMs);
}

export function assertAiReady(): void {
  if (!isAiReady()) {
    throw new Error('opencode client not ready (sandbox 未激活, 登录后会自动激活)');
  }
}

/** 创建新会话 — v2.session.create({ agent?, model?, location? }) */
export async function aiCreateSession(title?: string): Promise<string> {
  await waitForAiReady();
  const client = getAiClient()!;
  const params: any = {};
  if (title) params.id = title;
  const { data, error } = await (client as any).session.create(params);
  if (error) throw error;
  if (!data?.id) throw new Error('session.create 未返回 id');
  return data.id;
}

/** 历史会话列表 — v2.session.list */
export async function aiListSessions(): Promise<any[]> {
  await waitForAiReady();
  const client = getAiClient()!;
  const { data, error } = await (client as any).session.list();
  if (error) throw error;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray((data as any).data)) return (data as any).data;
  return [];
}

/** 会话消息列表 — v2.session.messages({ sessionID }) */
export async function aiListMessages(sessionID: string): Promise<any[]> {
  await waitForAiReady();
  const client = getAiClient()!;
  const { data, error } = await (client as any).session.messages({ sessionID });
  if (error) throw error;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray((data as any).data)) return (data as any).data;
  if (data && Array.isArray((data as any).messages)) return (data as any).messages;
  return [];
}

/** 发送消息 — v2.session.prompt (fire-and-forget, 官方 TUI 同款);
 *  必须传 agent + model ({providerID, modelID}) + variant, 否则服务端 400 */
/** 发送消息 — client.session.prompt (v1 兼容, 官方 TUI + app 统一用此端点);
 *  agent/model/variant 全部可选, 传则服务端按指定 agent/model 处理
 *  textOrParts: 字符串 (纯文本) 或 parts 数组 (官方 file part 等多 part 提交) */
export async function aiSendMessage(
  sessionID: string,
  textOrParts: string | any[],
  agent?: string,
  model?: { providerID: string; modelID: string },
  variant?: string,
): Promise<void> {
  await waitForAiReady();
  const client = getAiClient()!;
  const parts: any[] = typeof textOrParts === 'string'
    ? [{ type: 'text', text: textOrParts }]
    : textOrParts;
  const params: any = { sessionID, parts };
  if (agent) params.agent = agent;
  if (model) params.model = model;
  if (variant) params.variant = variant;
  const { error } = await (client as any).session.prompt(params);
  if (error) throw error;
}

/** 中断当前会话 — v2.session.interrupt({ sessionID }) */
export async function aiAbort(sessionID: string): Promise<void> {
  await waitForAiReady();
  const client = getAiClient()!;
  const { error } = await (client as any).session.abort({ sessionID });
  if (error) throw error;
}

/** 删除会话 — client.session.delete({ sessionID }) */
export async function aiDeleteSession(sessionID: string): Promise<void> {
  await waitForAiReady();
  const client = getAiClient()!;
  const { error } = await (client as any).session.delete({ sessionID });
  if (error) throw error;
}

/** 删除全部会话 — 分页遍历删除, 直到全部删完 */
export async function aiDeleteAllSessions(): Promise<number> {
  await waitForAiReady();
  const client = getAiClient()!;
  let deleted = 0;
  let cursor: string | undefined;
  // 循环翻页 (每次取 100 条), 删除所有会话
  for (;;) {
    const params: any = { limit: 100, order: 'desc' };
    if (cursor) params.cursor = cursor;
    const { data, error } = await (client as any).session.list(params);
    if (error) throw error;
    const list: any[] = Array.isArray(data) ? data : (data?.data || []);
    const next = data?.cursor?.next;
    for (const s of list || []) {
      if (!s?.id) continue;
      await aiDeleteSession(s.id);
      deleted += 1;
    }
    // 没有更多了或本页删空
    if (!next || !list || list.length === 0) break;
    cursor = next;
  }
  return deleted;
}

/** 会话内 agent 列表 — 直接调 /agent?directory=, 拿全量 (内置 + project 自定义),
 *  只返回 mode === 'primary' 的 (v1 endpoint 用 name 字段, 无 hidden 字段). */
export async function aiListAgents(): Promise<any[]> {
  await waitForAiReady();
  // directory 参数: 浏览器侧用当前页面 URL 的 pathname 或 '.', opencode 按 cwd 解析
  const dir = typeof window !== 'undefined' && window.location?.pathname
    ? window.location.pathname
    : '.';
  const url = `/ai/agent?directory=${encodeURIComponent(dir)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /agent failed: HTTP ${res.status}`);
  const list: any[] = await res.json();
  if (!Array.isArray(list)) return [];
  return list
    .filter((a) => a && a.mode === 'primary')
    .map((a) => ({
      id: a.name,
      name: a.name,
      description: a.description,
      mode: a.mode,
      native: a.native,
    }));
}

/** 已加载的 skill 列表 — 直连 /skill (含内置 + 项目 .opencode/skills + 全局 ~/.config/opencode/skills)
 *  按 name / description 给出，供 / 命令弹层动态展示与过滤 */
export interface SkillInfo {
  name: string;
  description?: string;
  location?: string;
}

export async function aiListSkills(): Promise<SkillInfo[]> {
  await waitForAiReady();
  const dir = typeof window !== 'undefined' && window.location?.pathname
    ? window.location.pathname
    : '.';
  const url = `/ai/skill?directory=${encodeURIComponent(dir)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /skill failed: HTTP ${res.status}`);
  const list: any[] = await res.json();
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && s.name)
    .map((s) => ({
      name: String(s.name),
      description: s.description ? String(s.description) : '',
      location: s.location ? String(s.location) : '',
    }));
}

/** 服务端 custom 命令列表 — 直连 /command (内置 init/review 等; project-local .opencode/command/ 下也可放)
 *  与 /skill 一起作为 / 命令弹层的两个来源, 按 name 去重 */
export interface CommandInfo {
  name: string;
  description?: string;
  source?: string;
}

export async function aiListCommands(): Promise<CommandInfo[]> {
  await waitForAiReady();
  const dir = typeof window !== 'undefined' && window.location?.pathname
    ? window.location.pathname
    : '.';
  const url = `/ai/command?directory=${encodeURIComponent(dir)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /command failed: HTTP ${res.status}`);
  const list: any[] = await res.json();
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && c.name)
    .map((c) => ({
      name: String(c.name),
      description: c.description ? String(c.description) : '',
      source: c.source ? String(c.source) : 'command',
      template: typeof c.template === 'string' ? c.template : undefined,
      subtask: c.subtask === true,
    }));
}

/** 切换会话 agent — v2.session.switchAgent({ sessionID, agent }) */
export async function aiSwitchAgent(sessionID: string, agent: string): Promise<void> {
  await waitForAiReady();
  const client = getAiClient()!;
  const { error } = await (client as any).v2.session.switchAgent({ sessionID, agent });
  if (error) throw error;
}

/** 会话 todo 列表 — v2.session.todo (GET /session/{sessionID}/todo), 官方协议 */
export async function aiGetTodos(sessionID: string): Promise<any[]> {
  await waitForAiReady();
  const client = getAiClient()!;
  const { data, error } = await (client as any).v2.session.todo({ sessionID });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/** 压缩会话上下文 — v2.session.compact({ sessionID })
 *  AI 摘要历史消息, 保留关键信息, 减少后续上下文 token 占用 */
export async function aiCompactSession(sessionID: string): Promise<void> {
  await waitForAiReady();
  const client = getAiClient()!;
  const { error } = await (client as any).v2.session.compact({ sessionID });
  if (error) throw error;
}

/** 分享会话 — 生成可分享链接 (官方 TUI 同款) */
export async function aiShareSession(sessionID: string): Promise<string> {
  await waitForAiReady();
  const client = getAiClient()!;
  const { data, error } = await (client as any).v2.session.share({ sessionID });
  if (error) throw error;
  return data?.shareUrl ?? data?.url ?? data?.id ?? '';
}

/** 取消会话分享 */
export async function aiUnshareSession(sessionID: string): Promise<void> {
  await waitForAiReady();
  const client = getAiClient()!;
  const { error } = await (client as any).v2.session.unshare({ sessionID });
  if (error) throw error;
}

/** 删除会话内全部消息 — v2.session.deleteAllMessages? 检查可用性, 暂走 message.delete 逐条
 *  注: 当前 SDK 不一定有单次 deleteAll API; 这里走 v1 message.delete 循环 (降级路径) */
export async function aiClearMessages(sessionID: string): Promise<number> {
  await waitForAiReady();
  const client = getAiClient()!;
  const msgs = await aiListMessages(sessionID);
  let deleted = 0;
  for (const m of msgs) {
    const mid = m?.info?.id || m?.id;
    if (!mid) continue;
    try {
      const { error } = await (client as any).v2.session.deleteMessage?.({ sessionID, messageID: mid })
        ?? await (client as any).session.deleteMessage({ sessionID, messageID: mid });
      if (!error) deleted++;
    } catch { /* 忽略单条失败 */ }
  }
  return deleted;
}

/** 回答 A2UI question — client.question.reply({ requestID, answers }) (v1 路径) */
export async function aiReplyQuestion(
  sessionID: string,
  requestID: string,
  answers: string[][]
): Promise<void> {
  await waitForAiReady();
  const client = getAiClient()!;
  const { error } = await (client as any).question.reply({ requestID, answers });
  if (error) throw error;
}

/** 忽略 A2UI question — client.question.reject({ requestID }) (v1 路径, 告诉 AI 不再问) */
export async function aiRejectQuestion(sessionID: string, requestID: string): Promise<void> {
  await waitForAiReady();
  const client = getAiClient()!;
  const { error } = await (client as any).question.reject({ requestID });
  if (error) throw error;
}

export interface ModelInfo {
  id: string;
  providerID: string;
  name: string;
  family?: string;
  status?: string;
  providerName?: string;
  free?: boolean;
}

/** 模型列表 — 从 /provider 拿, 按规则过滤:
 *  1. connected 的 provider (已配置 key): 显示其 models
 *  2. options.apiKey === 'public' 的 provider: 也显示, 标记 free
 *  其他不显示. status==='active' 的 model 才返回. */
export async function aiListModels(): Promise<ModelInfo[]> {
  await waitForAiReady();
  const res = await fetch('/ai/provider', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /provider failed: HTTP ${res.status}`);
  const json = await res.json();
  const all: any[] = Array.isArray(json?.all) ? json.all : [];
  const connected = new Set(Array.isArray(json?.connected) ? json.connected : []);

  const result: ModelInfo[] = [];
  for (const p of all) {
    const pid: string = p?.id;
    if (!pid) continue;
    const providerName: string = p?.name || pid;
    const apiKey = p?.options?.apiKey;
    const isPublic = apiKey === 'public';
    const isConnected = connected.has(pid);
    // 只显示 connected 或 public 的 provider
    if (!isConnected && !isPublic) continue;
    const models = p?.models || {};
    for (const mid of Object.keys(models)) {
      const m = models[mid];
      if (!m || m.status !== 'active') continue;
      result.push({
        id: m.id || mid,
        providerID: m.providerID || pid,
        name: m.name || mid,
        family: m.family,
        status: m.status,
        providerName,
        free: isPublic,
      });
    }
  }
  return result;
}

export interface ProviderModelInfo {
  id: string;
  name: string;
  family?: string;
  status?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  source?: string;
  disabled?: boolean;
  /** 是否已配置 key (connected) */
  connected?: boolean;
  /** 是否公开免费 key */
  public?: boolean;
  /** catalog 中该 provider 声明的全部模型 */
  models: ProviderModelInfo[];
  /** 后端 options.apiKey === 'public' */
  apiKey?: string;
}

/** 提供商列表 — 从 /provider 拿全量 catalog, 含每个 provider 声明的模型列表 + 连接状态 */
export async function aiListProviders(): Promise<ProviderInfo[]> {
  await waitForAiReady();
  const res = await fetch('/ai/provider', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /provider failed: HTTP ${res.status}`);
  const json = await res.json();
  const all: any[] = Array.isArray(json?.all) ? json.all : (Array.isArray(json) ? json : []);
  const connected = new Set(Array.isArray(json?.connected) ? json.connected : []);
  return all
    .filter((p) => p && p.id)
    .map((p) => {
      const apiKey = p?.options?.apiKey;
      const isPublic = apiKey === 'public';
      const models: ProviderModelInfo[] = Object.entries(p?.models || {})
        .map(([mid, m]: [string, any]) => ({
          id: m?.id || mid,
          name: m?.name || mid,
          family: m?.family,
          status: m?.status,
        }));
      return {
        id: p.id,
        name: p.name || p.id,
        source: p.source,
        disabled: p.disabled,
        connected: connected.has(p.id),
        public: isPublic,
        apiKey,
        models,
      } satisfies ProviderInfo;
    });
}

/** 为 provider 配置 API Key — PUT /auth/{providerID}  body: { type: 'api', key } */
export async function aiConnectProvider(providerID: string, apiKey: string): Promise<void> {
  await waitForAiReady();
  const client = getAiClient()!;
  const { error } = await (client as any).auth.set({
    providerID,
    auth: { type: 'api', key: apiKey },
  });
  if (error) throw error;
}

/** 移除 provider 凭据 — DELETE /auth/{providerID} */
export async function aiDisconnectProvider(providerID: string): Promise<void> {
  await waitForAiReady();
  const client = getAiClient()!;
  const { error } = await (client as any).auth.remove({ providerID });
  if (error) throw error;
}
