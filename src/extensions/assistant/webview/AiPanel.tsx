import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useInjectable } from '@opensumi/ide-core-browser/lib/react-hooks/injectable-hooks';

import {
  getAiClient,
  isAiReady,
  aiCreateSession,
  aiListSessions,
  aiListMessages,
  aiSendMessage,
  aiAbort,
  aiDeleteSession,
  aiDeleteAllSessions,
  aiListAgents,
  aiSwitchAgent,
  aiGetTodos,
  aiReplyQuestion,
  aiRejectQuestion,
  aiListModels,
  aiListProviders,
} from '../commands/api';
import { PartRenderer } from './parts/PartRenderer';
import { extractAssistantTodos, type TodoItem } from './parts/TodoCard';
import { ModelPicker } from './parts/ModelPicker';
import { QuestionModal } from './parts/QuestionModal';
import { modelPrefs } from '../commands/modelPrefs';

interface Row {
  id: string;
  role: 'user' | 'assistant';
  parts: any[];
  error?: any;
}

const HIDDEN_AGENTS = new Set(['compaction', 'title', 'summary']);

const AGENT_ICONS: Record<string, string> = {
  build: '🔨',
  plan: '🗺',
  general: '✨',
  explore: '🔭',
};

const AGENT_DESC: Record<string, string> = {
  build: '执行任务 · 文件操作 · 命令执行',
  plan: '规划方案 · 任务拆解 (只读工具)',
  general: '通用问答 · 多步任务并行执行',
  explore: '信息检索 · 上下文探索',
};

function findCurrentTodos(parts: any[]): Array<{ content: string; status: string; priority?: string }> {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p?.type === 'tool' && String(p.tool || '').toLowerCase() === 'todowrite') {
      const todos = extractAssistantTodos(p?.state?.output)
        .concat(extractAssistantTodos(p?.state?.input));
      if (todos.length) return todos;
    }
  }
  return [];
}

function extractText(parts: any[] | undefined): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p) => p?.type === 'text' && !p?.synthetic && !p?.ignored)
    .map((p) => p.text || '')
    .join('');
}

function formatDuration(start?: number, end?: number): string {
  if (!start || !end) return '';
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 100) / 10;
  return `${sec}秒`;
}

/** question part ID -> { requestID, questions } (模块级, 供 AiPanel SSE 写入 + MessageRow 读取) */
const questionStore = new Map<string, { requestID: string; questions: any[] }>();
/** 触发 MessageRow 重渲染以读取新写入的 questionStore */
const questionSubscribers = new Set<() => void>();
function notifyQuestionChange() { questionSubscribers.forEach((fn) => fn()); }

export const AiPanel: React.FC = () => {
  // animbook 无登录模块, 直接标记为已登录 (历史保留的兼容代码, 不影响功能)
  const [loggedIn] = useState<boolean>(true)
  useEffect(() => {
    // 登录态变化监听: animbook 独立产品无登录, 保留空实现
  }, [])
  const [sessionID, setSessionID] = useState<string>('');
  const [sessions, setSessions] = useState<any[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [agents, setAgents] = useState<any[]>([]);
  const [currentAgent, setCurrentAgent] = useState<string>('build');
  const [models, setModels] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [, setModelsRefresh] = useState(0);
  const [currentModel, setCurrentModel] = useState<string>('');
  const [showSessions, setShowSessions] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  /** question part ID -> { requestID, questions } 来自 question.v2.asked 事件 */
  const [, setQuestionRev] = useState(0);
  const [activeQuestion, setActiveQuestion] = useState<{ requestID: string; questions: any[] } | null>(null);
  useEffect(() => {
    const sub = () => setQuestionRev((n) => n + 1);
    questionSubscribers.add(sub);
    return () => { questionSubscribers.delete(sub); };
  }, []);
  const [attachments, setAttachments] = useState<Array<{ name: string; path: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modelQuery, setModelQuery] = useState('');
  const [mentionQuery, setMentionQuery] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState<boolean>(() => isAiReady());
  const sessionIDRef = useRef(sessionID);
  sessionIDRef.current = sessionID;
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);

  // ready 状态
  useEffect(() => {
    const check = () => setReady(isAiReady());
    check();
    window.addEventListener('animbook:opencode-ready', check);
    window.addEventListener('animbook:fs-ready', check);
    const id = window.setInterval(check, 1500);
    return () => {
      window.removeEventListener('animbook:opencode-ready', check);
      window.removeEventListener('animbook:fs-ready', check);
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!ready || !loggedIn) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = async () => {
      try {
        const list = await aiListAgents();
        if (cancelled) return;
        setAgents(list || []);
        if (list?.length) {
          const first = list.find((a: any) => {
            const id = a.id || a.name;
            const mode = a.mode || a.data?.mode;
            return id && !HIDDEN_AGENTS.has(id) && (mode === 'primary' || mode === 'all');
          }) || list[0];
          if (!list.find((a: any) => (a.id || a.name) === currentAgent)) {
            setCurrentAgent(first.id || first.name);
          }
        }
      } catch (e) {
        console.warn('[ai] load agents failed', e);
        if (!cancelled) timer = setTimeout(attempt, 2000);
        return;
      }
      try {
        const m = await aiListModels();
        if (cancelled) return;
        setModels(m || []);
        if (m?.length) {
          const prefs = modelPrefs.get();
          const def = prefs.default && m.find((x: any) => x.id === prefs.default);
          if (def) {
            setCurrentModel(def.id);
          } else if (!m.find((x: any) => x.id === currentModel)) {
            setCurrentModel(m[0].id);
          }
        }
      } catch (e) {
        console.warn('[ai] load models failed', e);
        if (!cancelled) timer = setTimeout(attempt, 2000);
        return;
      }
      try {
        const ps = await aiListProviders();
        if (!cancelled) setProviders(ps || []);
      } catch (e) { console.warn('[ai] load providers failed', e); }
    };
    void attempt();
    // 沙箱加载完成事件 (opencode 探活通过) → 立即重新拉取 agent/model
    const onSandboxReady = () => {
      if (timer) clearTimeout(timer);
      void attempt();
    };
    window.addEventListener('animbook:sandbox-ready', onSandboxReady);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('animbook:sandbox-ready', onSandboxReady);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, loggedIn]);

  useEffect(() => {
    const onReveal = () => setTimeout(() => taRef.current?.focus(), 120);
    window.addEventListener('animbook:ai-reveal', onReveal);
    const onPrefs = () => setModelsRefresh((n) => n + 1);
    window.addEventListener('animbook:ai-modelPrefs-changed', onPrefs);
    const onSelectSession = (e: Event) => {
      const id = (e as CustomEvent<{ sessionID?: string }>).detail?.sessionID;
      if (typeof id === 'string' && id) {
        setSessionID(id);
        // 触发会话列表刷新 + 消息列表刷新依赖的副作用键
        setSessions((prev) => prev.slice());
        setTimeout(() => taRef.current?.focus(), 120);
      }
    };
    window.addEventListener('animbook:ai-select-session', onSelectSession);
    return () => {
      window.removeEventListener('animbook:ai-reveal', onReveal);
      window.removeEventListener('animbook:ai-modelPrefs-changed', onPrefs);
      window.removeEventListener('animbook:ai-select-session', onSelectSession);
    };
  }, []);

  // 打开模型选择时自动聚焦搜索框
  useEffect(() => {
    if (showModels) setTimeout(() => modelSearchRef.current?.focus(), 30);
  }, [showModels]);

  // 点外部关闭弹层
  useEffect(() => {
    if (!showAgents && !showModels && !showSessions) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.tc-ai__mpop')
        || t.closest('.tc-ai__modal')
        || t.closest('.tc-ai__agent-pop')
        || t.closest('.tc-ai__menu')
        || t.closest('[data-ai-pop="agents"]')
        || t.closest('[data-ai-pop="models"]')
        || t.closest('[data-ai-pop="sessions"]')) {
        return;
      }
      setShowAgents(false);
      setShowModels(false);
      setShowSessions(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showAgents, showModels, showSessions]);

  const loadSessions = useCallback(async () => {
    try {
      const list = await aiListSessions();
      setSessions(list || []);
    } catch (e) { setError(String((e as any)?.message || e)); }
  }, []);

  // todos: 官方协议 — GET /session/{sessionID}/todo 拉取 + SSE todo.updated 实时更新
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const refreshTodos = useCallback(async (sid: string) => {
    try {
      const list = await aiGetTodos(sid);
      setTodos(list.map((t: any) => ({
        content: String(t?.content || ''),
        status: t?.status === 'completed' || t?.status === 'in_progress' || t?.status === 'pending' || t?.status === 'cancelled' ? t.status : 'pending',
        priority: typeof t?.priority === 'string' ? t.priority : undefined,
      })).filter((t: TodoItem) => t.content.trim().length > 0));
    } catch { /* 拉取失败保持现状 */ }
  }, []);

  const loadMessages = useCallback(async (sid?: string) => {
    const target = sid || sessionIDRef.current;
    if (!target) { setRows([]); return; }
    try {
      const msgs = await aiListMessages(target);
      const rs: Row[] = (msgs || []).map((m: any) => {
        const info = m.info || m;
        return {
          id: info?.id || m.id,
          role: info?.role || m.role,
          parts: m.parts || info?.parts || [],
        };
      });
      setRows(rs);
      // 会话切换/刷新时同步官方 todo 列表
      void refreshTodos(target);
    } catch (e) { setError(String((e as any)?.message || e)); }
  }, [refreshTodos]);

  useEffect(() => {
    if (sessionID) loadMessages(sessionID); else setRows([]);
  }, [sessionID, loadMessages]);

  // 启动后默认显示最近一次会话
  const skipAutoLoad = useRef(false);
  useEffect(() => {
    if (!ready || sessionID || skipAutoLoad.current) return;
    (async () => {
      try {
        const list = await aiListSessions();
        setSessions(list || []);
        const last = (list || [])[0];
        if (last?.id) {
          setSessionID(last.id);
        }
      } catch { /* ignore */ }
    })();
  }, [ready, sessionID]);

  // 打字机效果: busy 时每 500ms 轮询拉取完整消息, 覆盖渲染 (文本逐渐增长)
  useEffect(() => {
    if (!busy || !sessionID) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        await loadMessages(sessionID);
      } catch { /* ignore */ }
      if (!stopped) timer = setTimeout(tick, 500);
    };
    let timer = setTimeout(tick, 500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [busy, sessionID, loadMessages]);

  // SSE
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let stream: any = null;
    (async () => {
      while (!cancelled) {
        try {
          const result = await getAiClient()!.global.event();
          stream = result.stream;
          for await (const ev of stream) {
            if (cancelled) break;
            handleEvent(ev?.payload ?? ev);
          }
        } catch { /* reconnect */ }
        if (cancelled) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
    })();

    function handleEvent(ev: any) {
      const type = ev.type;
      const props = ev.properties || {};
      const cur = sessionIDRef.current;
      const evSid = props.sessionID || props.info?.sessionID || props.part?.sessionID;
      if (evSid && cur && evSid !== cur) return;
      switch (type) {
        case 'message.part.delta': {
          // 打字机核心: 逐字 append 到对应 text part
          const { messageID, partID, field, delta } = props;
          if (field !== 'text' || typeof delta !== 'string') return;
          setRows((prev) => prev.map((r) => {
            if (r.id !== messageID || !r.parts) return r;
            return {
              ...r,
              parts: r.parts.map((p: any) =>
                p.id === partID && p.type === 'text'
                  ? { ...p, text: (p.text || '') + delta }
                  : p
              ),
            };
          }));
          break;
        }
        case 'message.part.updated': {
          // part 状态变化 (tool 完成等) — 若 part 是 text 且非流式, 直接同步; 流式中的 text 由 delta 驱动
          const part = props.part;
          const messageID = props.messageID || props.part?.messageID || props.part?.message_id;
          if (!part || !messageID) {
            if (cur) loadMessages(cur);
            break;
          }
          setRows((prev) => {
            const idx = prev.findIndex((r) => r.id === messageID);
            if (idx === -1) {
              // 新消息: 插入 assistant 空壳 (让 delta 能命中)
              return [...prev, { id: messageID, role: part.role === 'user' ? 'user' : 'assistant', parts: [part] }];
            }
            const row = prev[idx];
            const pIdx = row.parts?.findIndex((p: any) => p.id === part.id);
            if (pIdx === -1) {
              // 新 part 追加 (非 text 直接完整加入)
              const parts = [...(row.parts || []), part];
              return [...prev.slice(0, idx), { ...row, parts }, ...prev.slice(idx + 1)];
            }
            if (part.type === 'text') {
              // text part: 保留 delta 已累积的 text, 只更新其他字段
              const parts = row.parts.map((p: any, i: number) =>
                i === pIdx ? { ...p, ...part, text: p.text || part.text } : p
              );
              return [...prev.slice(0, idx), { ...row, parts }, ...prev.slice(idx + 1)];
            }
            const parts = row.parts.map((p: any, i: number) => (i === pIdx ? part : p));
            return [...prev.slice(0, idx), { ...row, parts }, ...prev.slice(idx + 1)];
          });
          break;
        }
        case 'message.updated': {
          // 全量消息更新 — 事件里的 info 通常不含 parts, 只更新元数据;
          // 消息不存在则插空壳等轮询/delta 填充, 已有消息保留本地累积
          const info = props.info;
          const messageID = props.messageID || info?.id;
          if (!info || !messageID) {
            if (cur) loadMessages(cur);
            break;
          }
          const newParts = info.parts || props.parts || [];
          setRows((prev) => {
            const idx = prev.findIndex((r) => r.id === messageID);
            if (idx === -1) {
              // 新消息: 若有完整 parts 直接插入, 否则空壳 (由 delta/轮询填充)
              return [...prev, { id: messageID, role: info.role, parts: newParts }];
            }
            // 已有: 仅当服务端带 parts 才合并更新, 否则不动 (保护本地流式累积)
            if (!newParts.length) return prev;
            const row = prev[idx];
            const merged = newParts.map((p: any) => {
              if (p.type !== 'text') return p;
              const local = row.parts?.find((lp: any) => lp.id === p.id);
              return local ? { ...p, text: local.text || p.text } : p;
            });
            return [...prev.slice(0, idx), { ...row, parts: merged }, ...prev.slice(idx + 1)];
          });
          break;
        }
        case 'message.removed':
        case 'message.part.removed':
          if (cur) loadMessages(cur);
          break;
        case 'session.status': {
          const stype = typeof props.status === 'string' ? props.status : props.status?.type;
          setBusy(stype !== 'idle');
          break;
        }
        case 'session.idle':
          setBusy(false);
          break;
        case 'todo.updated': {
          // 官方 todo 协议: props.todos / props.data.todos 实时更新
          const list = props.todos || props.data?.todos;
          if (Array.isArray(list)) {
            setTodos(list.map((t: any) => ({
              content: String(t?.content || ''),
              status: t?.status === 'completed' || t?.status === 'in_progress' || t?.status === 'pending' || t?.status === 'cancelled' ? t.status : 'pending',
              priority: typeof t?.priority === 'string' ? t.priority : undefined,
            })).filter((t: TodoItem) => t.content.trim().length > 0));
          } else if (cur) {
            refreshTodos(cur);
          }
          break;
        }
        case 'session.error':
          setBusy(false);
          setError(props.error?.data?.message || props.error?.message || '会话出错');
          break;
        case 'question.asked':
        case 'question.v2.asked': {
          // 事件带 id (que_xxx) + questions — 真正的问题数据源
          const rid = props.id || props.requestID;
          const partID = props.part?.id;
          if (rid && Array.isArray(props.questions) && props.questions.length > 0) {
            setActiveQuestion({ requestID: rid, questions: props.questions });
            if (partID) {
              questionStore.set(partID, { requestID: rid, questions: props.questions });
              notifyQuestionChange();
            }
          }
          break;
        }
        case 'question.replied':
        case 'question.v2.replied':
        case 'question.rejected':
        case 'question.v2.rejected':
        case 'session.aborted':
          questionStore.clear();
          setActiveQuestion(null);
          notifyQuestionChange();
          break;
        default: break;
      }
    }

    return () => {
      cancelled = true;
      stream?.return?.(undefined);
    };
  }, [loadMessages, ready]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [rows, busy]);

  const onNewSession = useCallback(async () => {
    if (!ready) return;
    try {
      const sid = await aiCreateSession();
      setSessionID(sid);
      setRows([]);
      setShowSessions(false);
    } catch (e) { setError(String((e as any)?.message || e)); }
  }, [ready]);

  const selectedModel = useMemo(() => {
    if (!currentModel) return null;
    return models.find((m: any) => m.id === currentModel) || null;
  }, [models, currentModel]);

  const currentModelLabel = useMemo(() => {
    if (!selectedModel) return '';
    return selectedModel.name || selectedModel.id || '';
  }, [selectedModel]);

  const onSend = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError('');
    // 附件路径附到消息尾部, 让 AI 感知已上传文件
    const attachNote = attachments.length
      ? '\n\n[已上传文件]\n' + attachments.map((a) => `- ${a.path}`).join('\n')
      : '';
    const fullText = text + attachNote;
    const localId = `local-${Date.now()}`;
    setRows((prev) => [...prev, { id: localId, role: 'user', parts: [{ type: 'text', text: fullText }] }]);
    setAttachments([]);
    try {
      let sid = sessionID;
      if (!sid) {
        sid = await aiCreateSession();
        setSessionID(sid);
      }
      const model = selectedModel
        ? { providerID: selectedModel.providerID, modelID: selectedModel.id }
        : undefined;
      await aiSendMessage(sid, fullText);
      setBusy(true);
    } catch (e) {
      setRows((prev) => prev.filter((r) => r.id !== localId));
      setInput(text);
      setError(String((e as any)?.message || e));
    }
  }, [input, busy, sessionID, currentAgent, selectedModel, attachments]);

  const onAbort = useCallback(async (sid?: string) => {
    const target = sid || sessionID;
    if (!target) return;
    try {
      await aiAbort(target);
      setBusy(false);
    } catch (e) {
      // abort 是用户主动操作, 服务端报错(已无活动请求等)属正常, 不弹错误
      console.warn('[ai] abort:', e);
      setBusy(false);
    }
  }, [sessionID]);

  const onSwitchSession = useCallback((sid: string) => {
    setSessionID(sid);
    setShowSessions(false);
    setRows([]);
  }, []);

  const onDeleteSession = useCallback(async (sid: string) => {
    try {
      await aiDeleteSession(sid);
      setSessions((prev) => prev.filter((s) => s.id !== sid));
      if (sid === sessionID) {
        setSessionID('');
        setRows([]);
      }
    } catch (e) { setError(String((e as any)?.message || e)); }
  }, [sessionID]);

  const onSwitchAgent = useCallback(async (agent: string) => {
    setCurrentAgent(agent);
    setShowAgents(false);
    if (sessionID) {
      try { await aiSwitchAgent(sessionID, agent); } catch (e) { setError(String((e as any)?.message || e)); }
    }
  }, [sessionID]);

  const onReplyQuestion = useCallback(async (sid: string, rid: string, answers: string[][]) => {
    await aiReplyQuestion(sid, rid, answers);
    // 刷新消息流, 让 question part 状态更新 (显示已答折叠卡片)
    if (sid) { try { await loadMessages(sid); } catch { /* ignore */ } }
  }, [loadMessages]);

  const onIgnoreQuestion = useCallback(async (rid: string) => {
    try {
      await aiRejectQuestion(sessionID, rid);
      // 刷新消息流, 让 question part 状态更新 (显示已忽略)
      if (sessionID) { try { await loadMessages(sessionID); } catch { /* ignore */ } }
    } catch (e) {
      // 取消是用户主动操作, 失败不弹错误 (AI 可能已自行处理)
      console.warn('[ai] reject question:', e);
    }
  }, [sessionID]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  }, [onSend]);

  const onUploadFile = useCallback(async (files: FileList | null) => {
    if (!files || !files.length) return;
    const fsApi = (window as any).__ANIMBOOK_FS_API__;
    if (!fsApi?.write) { setError('沙箱文件系统未就绪'); return; }
    const added: Array<{ name: string; path: string }> = [];
    for (const f of Array.from(files)) {
      try {
        const text = await f.text();
        const safe = f.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
        // IDE 相对路径: 文件名直接放根目录, 由 fsApi 映射到宿主机 workspaceDir
        const path = `/${safe}`;
        await fsApi.write(path, text);
        added.push({ name: f.name, path });
      } catch (e) {
        setError(`上传 ${f.name} 失败: ${String((e as any)?.message || e)}`);
      }
    }
    if (added.length) setAttachments((prev) => [...prev, ...added]);
  }, []);

  const onInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    // 检测末尾的 / 或 @ 触发命令/上下文弹层
    const m = val.match(/(?:^|\s)([\/@#])(\S*)$/);
    if (m) {
      const [, trigger, q] = m;
      if (trigger === '/') {
        setShowCommands(true);
        setShowMentions(false);
        setShowModels(false);
        setShowAgents(false);
      } else if (trigger === '@' || trigger === '#') {
        setShowMentions(true);
        setMentionQuery(q || '');
        setShowCommands(false);
        setShowModels(false);
        setShowAgents(false);
      }
    } else {
      setShowCommands(false);
      setShowMentions(false);
    }
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
  }, []);

  const currentAgentInfo = useMemo(
    () => agents.find((a: any) => (a.id || a.name) === currentAgent),
    [agents, currentAgent]
  );

  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    const prefs = modelPrefs.get();
    // 1. 隐藏 + 搜索
    let list = models
      .filter((m: any) => !prefs.hidden.includes(m.id))
      .filter((m: any) => {
        if (!q) return true;
        const mid = m.id || '';
        const pid = m.providerID || '';
        const name = m.name || '';
        return `${pid}/${mid} ${name}`.toLowerCase().includes(q);
      });
    // 2. 自定义名称
    list = list.map((m: any) => ({ ...m, name: prefs.customNames[m.id] || m.name }));
    // 3. 自定义顺序
    if (prefs.order.length > 0) {
      const idx = new Map(prefs.order.map((id, i) => [id, i] as [string, number]));
      list = [...list].sort((a, b) => {
        const ai = idx.has(a.id) ? idx.get(a.id)! : 1e9;
        const bi = idx.has(b.id) ? idx.get(b.id)! : 1e9;
        return ai - bi;
      });
    }
    return list;
  }, [models, modelQuery, models]);

  const modelGroups = useMemo(() => {
    const prefs = modelPrefs.get();
    const g: Record<string, any[]> = {};
    for (const m of filteredModels) {
      const p = m.providerID || 'other';
      // 自定义分组优先: 如果该模型被分配到了某个 group, 用 group 标签
      let groupKey = p;
      for (const [gid, ids] of Object.entries(prefs.groups)) {
        if (ids.includes(m.id)) {
          groupKey = gid;
          break;
        }
      }
      const label = prefs.groupLabels[groupKey] || prefs.providerLabels[groupKey] || groupKey;
      (g[label] = g[label] || []).push(m);
    }
    return g;
  }, [filteredModels, models]);

  const visibleAgents = useMemo(
    () => agents.filter((a: any) => {
      const id = a.id || a.name;
      const mode = a.mode || a.data?.mode;
      return id && !HIDDEN_AGENTS.has(id) && (mode === 'primary' || mode === 'all');
    }),
    [agents]
  );

  const activeTodos = useMemo(() => {
    if (todos.length > 0) return todos;
    // 兜底: 官方 todo API 未返回时, 从最近 assistant 消息的 todowrite tool state 解析
    const lastAssistant = [...rows].reverse().find((r) => r.role === 'assistant');
    if (!lastAssistant) return [];
    return findCurrentTodos(lastAssistant.parts || []);
  }, [todos, rows]);

  // 命令列表 (与 OpenCode 一致)
  const commandList = useMemo(() => [
    { cmd: 'init', name: 'guided AGENTS.md setup', hint: '' },
    { cmd: 'review', name: 'review changes', hint: '[commit|branch|pr], defaults to uncommitted' },
    { cmd: 'customize-opencode', name: 'Use ONLY when the user is editing or creating opencode\'s own configuration: opencode.json, ...', hint: '' },
    { cmd: 'baoyu-url-to-markdown', name: 'Fetch any URL and convert to markdown using baoyu-fetch CLI (Chrome CDP with site-spec...', hint: '' },
    { cmd: 'baoyu-translate', name: 'This skill should be used when the user asks to "translate", "翻 译", "精翻", "translate article", "translat...', hint: '' },
    { cmd: 'baoyu-diagram', name: 'Create professional, dark-themed SVG diagrams of any type — architecture diagrams, flowcharts, se...', hint: '' },
    { cmd: 'baoyu-article-illustrator', name: 'Analyzes article structure, identifies positions requiring visual aids, generates illustrations wit...', hint: '' },
    { cmd: 'baoyu-markdown-to-html', name: 'Converts Markdown to styled HTML with WeChat-compatible themes. Supports code highli...', hint: '' },
    { cmd: 'baoyu-format-markdown', name: 'Formats plain text or markdown files with frontmatter, titles, summaries, headings, bold, list...', hint: '' },
    { cmd: 'baoyu-image-gen', name: 'AI image generation with OpenAI GPT Image 2, Azure OpenAI, Google, OpenRouter, DashScope, zhipu...', hint: '' },
  ], []);

  const filteredCommands = useMemo(() => {
    const q = input.match(/(?:^|\s)\/(\S*)$/)?.[1] || '';
    if (!q) return commandList;
    return commandList.filter((c) => c.cmd.startsWith(q.toLowerCase()) || c.name.toLowerCase().includes(q.toLowerCase()));
  }, [commandList, input]);

  // 文件/上下文引用候选 (从工作区 + agents)
  const mentionList = useMemo(() => {
    const q = input.match(/(?:^|\s)[@#](\S*)$/)?.[1] || '';
    const items: Array<{ id: string; name: string; type: 'agent' | 'file' | 'symbol'; hint?: string }> = [
      ...visibleAgents.map((a) => ({ id: a.id || a.name, name: a.name || a.id, type: 'agent' as const, hint: AGENT_DESC[a.id || a.name] })),
    ];
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  }, [visibleAgents, input]);

  return (
    <div className="tc-ai">
      <style>{styles}</style>

      <header className="tc-ai__topbar">
        <div className="tc-ai__brand">
          <span className="tc-ai__logo">A</span>
          <span className="tc-ai__brand-name">animbook</span>
        </div>
        {ready && (
          <div className="tc-ai__top-actions">
            <button
              data-ai-pop="sessions"
              className="tc-ai__icon-btn"
              title="历史会话"
              onClick={() => { setShowSessions((v) => !v); if (!showSessions) loadSessions(); }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </button>
            <button className="tc-ai__icon-btn" title="新会话" onClick={onNewSession}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
        )}
      </header>

      {ready && showSessions && (
        <div className="tc-ai__menu">
          <div className="tc-ai__menu-head">
            <span>历史会话</span>
            <div className="tc-ai__menu-head-actions">
              {sessions.length > 0 && (
                <button
                  className="tc-ai__menu-clear"
                  title="清空全部会话"
                  onClick={async () => {
                    if (!confirm('确定删除全部会话？此操作不可恢复。')) return;
                    try {
                      const n = await aiDeleteAllSessions();
                      skipAutoLoad.current = true;
                      setSessions([]);
                      setSessionID('');
                      setRows([]);
                      setError('');
                      // 稍后重置标记, 下次新会话仍可自动加载
                      setTimeout(() => { skipAutoLoad.current = false; }, 1000);
                    } catch (e) { setError(String((e as any)?.message || e)); }
                  }}
                >
                  清空
                </button>
              )}
              <button onClick={() => setShowSessions(false)}>×</button>
            </div>
          </div>
          <div className="tc-ai__menu-body">
            {sessions.length === 0 && <div className="tc-ai__menu-empty">暂无历史会话</div>}
            {sessions.map((s: any) => (
              <div
                key={s.id}
                className={`tc-ai__menu-item ${s.id === sessionID ? 'active' : ''}`}
                onClick={() => onSwitchSession(s.id)}
              >
                <div className="tc-ai__menu-item-main">
                  <div className="tc-ai__menu-title">{s.title || `会话 ${(s.id || '').slice(0, 8)}`}</div>
                  <div className="tc-ai__menu-meta">
                    {s.time?.created ? new Date(s.time.created).toLocaleString() : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="tc-ai__menu-del"
                  title="删除会话"
                  onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id); }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTodos.length > 0 && (
        <TodosDock todos={activeTodos} />
      )}

      <div className="tc-ai__messages" ref={scrollRef}>
        {!ready ? (
          <LoginGate />
        ) : rows.length === 0 ? (
          <WelcomeScreen
            agents={agents}
            currentAgent={currentAgent}
            onPick={(q) => { setInput(q); setTimeout(() => taRef.current?.focus(), 0); }}
            onSelectAgent={onSwitchAgent}
          />
        ) : (
          rows.map((r) => (
            <MessageRow
              key={r.id}
              row={r}
              streaming={busy && r.role === 'assistant' && r.id === rows[rows.length - 1]?.id}
              sessionID={sessionID}
              onReplyQuestion={onReplyQuestion}
            />
          ))
        )}
      </div>

      {error && (
        <div className="tc-ai__error">
          <span className="tc-ai__error-text">{error}</span>
          <button onClick={() => { setError(''); if (sessionID) loadMessages(sessionID); }}>重试</button>
        </div>
      )}

      {ready && (
        <div className="tc-ai__composer">
          {activeQuestion && (
            <QuestionModal
              questions={activeQuestion.questions}
              requestID={activeQuestion.requestID}
              sessionID={sessionID}
              onReply={onReplyQuestion}
              onCancel={(rid) => onIgnoreQuestion(rid)}
              onDismiss={() => setActiveQuestion(null)}
            />
          )}
          {showCommands && (
            <div className="tc-ai__cmd-pop">
              <div className="tc-ai__cmd-list">
                {filteredCommands.map((c) => (
                  <button
                    key={c.cmd}
                    type="button"
                    className="tc-ai__cmd-item"
                    onClick={() => {
                      // 把触发字符替换为 /<cmd>
                      const replaced = input.replace(/(?:^|\s)\/\S*$/, `/${c.cmd} `);
                      setInput(replaced);
                      setShowCommands(false);
                      setTimeout(() => taRef.current?.focus(), 0);
                    }}
                  >
                    <span className="tc-ai__cmd-cmd">/{c.cmd}</span>
                    <span className="tc-ai__cmd-name">{c.name}</span>
                    {c.hint && <span className="tc-ai__cmd-hint">{c.hint}</span>}
                  </button>
                ))}
                {filteredCommands.length === 0 && (
                  <div className="tc-ai__cmd-empty">无匹配命令</div>
                )}
              </div>
            </div>
          )}

          {showMentions && (
            <div className="tc-ai__cmd-pop">
              <div className="tc-ai__cmd-list">
                {mentionList.length === 0 && (
                  <div className="tc-ai__cmd-empty">无匹配项</div>
                )}
                {mentionList.map((m) => {
                  const trigger = input.match(/[@#]\S*$/)?.[0]?.[0] || '@';
                  return (
                  <button
                    key={`${m.type}-${m.id}`}
                    type="button"
                    className="tc-ai__cmd-item"
                    onClick={() => {
                      const replaced = input.replace(/[@#]\S*$/, `${trigger}${m.name} `);
                      setInput(replaced);
                      setShowMentions(false);
                      setTimeout(() => taRef.current?.focus(), 0);
                    }}
                  >
                    <span className="tc-ai__cmd-cmd">{trigger}{m.name}</span>
                    <span className="tc-ai__cmd-name">{m.hint || m.type}</span>
                  </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="tc-ai__input-wrap">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { void onUploadFile(e.target.files); e.target.value = ''; }}
            />
            {attachments.length > 0 && (
              <div className="tc-ai__attach">
                {attachments.map((a, i) => (
                  <span key={i} className="tc-ai__attach-chip">
                    <span className="tc-ai__attach-name">{a.name}</span>
                    <button
                      type="button"
                      className="tc-ai__attach-x"
                      onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={taRef}
              value={input}
              onChange={onInput}
              onKeyDown={onKeyDown}
              placeholder="Ask anything, / for commands, @ for context..."
              rows={1}
            />
            <div className="tc-ai__input-bar">
              <button type="button" className="tc-ai__bar-btn tc-ai__bar-plus" title="上传附件" onClick={() => fileInputRef.current?.click()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>

              <div className="tc-ai__select">
                <button
                  data-ai-pop="agents"
                  type="button"
                  className="tc-ai__bar-btn tc-ai__bar-text"
                  onClick={() => { setShowAgents((v) => !v); setShowModels(false); }}
                >
                  <span>{currentAgentInfo?.name || currentAgent}</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {showAgents && (
                  <div className="tc-ai__agent-pop">
                    <div className="tc-ai__agent-pop-head">
                      <span className="tc-ai__agent-pop-title">选择 Agent</span>
                      <button
                        type="button"
                        className="tc-ai__agent-pop-close"
                        onClick={() => setShowAgents(false)}
                      >
                        ✕
                      </button>
                    </div>
                    {visibleAgents.map((a: any) => {
                      const id = a.id || a.name;
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`tc-ai__agent-item${id === currentAgent ? ' active' : ''}`}
                          onClick={() => onSwitchAgent(id)}
                        >
                          <span className="tc-ai__agent-icon">{AGENT_ICONS[id] || '✨'}</span>
                          <span className="tc-ai__agent-body">
                            <span className="tc-ai__agent-name">{a.name || id}</span>
                            <span className="tc-ai__agent-desc">{a.description || AGENT_DESC[id] || ''}</span>
                          </span>
                          {id === currentAgent && (
                            <span className="tc-ai__agent-check">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="tc-ai__select">
                <button
                  data-ai-pop="models"
                  type="button"
                  className="tc-ai__bar-btn tc-ai__bar-text"
                  onClick={() => { setShowModels((v) => !v); setShowAgents(false); }}
                >
                  <svg className="tc-ai__spark" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z"/>
                  </svg>
                  <span>{currentModelLabel}</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {showModels && (
                  <ModelPicker
                    models={models}
                    currentModel={currentModel}
                    onSelect={(id) => {
                      setCurrentModel(id);
                      modelPrefs.setDefault(id);
                      setShowModels(false);
                    }}
                    onClose={() => setShowModels(false)}
                    onProvidersChanged={() => {
                      // 提供商连接成功: 重新拉取 models + providers
                      void (async () => {
                        try {
                          const m = await aiListModels();
                          setModels(m || []);
                          const ps = await aiListProviders();
                          setProviders(ps as any);
                        } catch (e) { console.warn('[ai] refresh after connect failed', e); }
                      })();
                    }}
                  />
                )}
              </div>

              <div className="tc-ai__bar-spacer" />

              {busy ? (
                <button type="button" className="tc-ai__send tc-ai__send--stop" onClick={() => onAbort()} title="停止">
                  <span className="tc-ai__stop-square" />
                </button>
              ) : (
                <button
                  type="button"
                  className="tc-ai__send"
                  onClick={onSend}
                  disabled={!input.trim()}
                  title="发送 (Enter)"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const TodosDock: React.FC<{ todos: Array<{ content: string; status: string; priority?: string }> }> = ({ todos }) => {
  const [collapsed, setCollapsed] = useState(false);
  const completed = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;
  return (
    <div className={`tc-ai__todos-dock${collapsed ? ' is-collapsed' : ''}`}>
      <div className="tc-ai__todos-head" onClick={() => setCollapsed((v) => !v)}>
        <span className="tc-ai__todos-title">
          已完成 {completed} 个任务（共 {total} 个）
        </span>
        <span className="tc-ai__todos-caret">{collapsed ? '▾' : '▴'}</span>
      </div>
      {!collapsed && (
        <ul className="tc-ai__todos-list">
          {todos.map((t, i) => (
            <li key={i} className={`tc-ai__todo-item is-${t.status}`}>
              <span className="tc-ai__todo-check" aria-hidden="true">
                {t.status === 'completed' ? '●' : t.status === 'in_progress' ? '◐' : '○'}
              </span>
              <span className="tc-ai__todo-content">{t.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const LoginGate: React.FC = () => (
  <div className="tc-ai__gate">
    <div className="tc-ai__gate-logo"><span>T</span></div>
    <h2 className="tc-ai__gate-title">
      与 <span className="tc-ai__gate-brand">animbook</span> 一起，开启智能阅读
    </h2>
    <ul className="tc-ai__gate-features">
      <li>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>集成丰富上下文，回答更准确</span>
      </li>
      <li>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        <span>开放智能体生态，满足多样任务需求</span>
      </li>
      <li>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <span>理解需求、调动工具、端到端完成真实任务</span>
      </li>
    </ul>
    <button
      type="button"
      className="tc-ai__gate-btn"
      onClick={() => window.dispatchEvent(new CustomEvent('animbook:login-show'))}
    >
      登录 →
    </button>
  </div>
);

const WelcomeScreen: React.FC<{
  agents: any[];
  currentAgent: string;
  onPick: (q: string) => void;
  onSelectAgent: (a: string) => void;
}> = ({ agents, currentAgent, onPick, onSelectAgent }) => {
  const suggestions = [
    { icon: '🚀', title: '帮我完成一个任务', desc: '告诉我目标，拆解并执行' },
    { icon: '🔍', title: '调研一个话题', desc: '检索资料并总结结论' },
    { icon: '✍️', title: '撰写一份文档', desc: '方案 / 报告 / 邮件 / 文案' },
    { icon: '💡', title: '出个主意', desc: '头脑风暴与创意发散' },
  ];
  const featured = agents
    .filter((a: any) => {
      const id = a.id || a.name;
      const mode = a.mode || a.data?.mode;
      return id && !HIDDEN_AGENTS.has(id) && (mode === 'primary' || mode === 'all');
    })
    .slice(0, 4);
  return (
    <div className="tc-ai__welcome">
      <div className="tc-ai__welcome-logo">A</div>
      <h1 className="tc-ai__welcome-title">你好，我是 animbook</h1>
      <p className="tc-ai__welcome-sub">可交互式阅读器</p>

      <div className="tc-ai__welcome-suggest">
        {suggestions.map((s, i) => (
          <button key={i} className="tc-ai__suggest" onClick={() => onPick(s.title)}>
            <span className="tc-ai__suggest-icon">{s.icon}</span>
            <span className="tc-ai__suggest-body">
              <span className="tc-ai__suggest-title">{s.title}</span>
              <span className="tc-ai__suggest-desc">{s.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

const MessageRow: React.FC<{
  row: Row;
  streaming: boolean;
  sessionID: string;
  onReplyQuestion: (sid: string, rid: string, answers: string[][]) => Promise<void>;
}> = ({ row, streaming, sessionID, onReplyQuestion }) => {
  const [hover, setHover] = useState(false);
  if (row.role === 'user') {
    const text = extractText(row.parts);
    const copy = () => navigator.clipboard?.writeText(text);
    return (
      <div
        className="tc-ai__msg is-user"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div className="tc-ai__msg-user-col">
          <div className="tc-ai__msg-bubble is-user">{text}</div>
          <div className={`tc-ai__msg-meta is-user${hover ? ' is-visible' : ''}`}>
            <button className="tc-ai__msg-copy" onClick={copy} title="复制">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const stepFinish = row.parts?.find((p: any) => p?.type === 'step-finish');
  const modelID = stepFinish?.modelID
    || row.parts?.find((p: any) => p?.type === 'text' && p?.modelID)?.modelID
    || '';
  const start = stepFinish?.time?.start;
  const end = stepFinish?.time?.end;
  const duration = formatDuration(start, end);
  const textParts = row.parts?.filter((p: any) => p?.type === 'text') || [];
  const fullText = textParts.map((p: any) => p.text).join('\n');
  const copy = () => navigator.clipboard?.writeText(fullText);

  return (
    <div
      className="tc-ai__msg is-assistant"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="tc-ai__msg-body">
        {(row.parts || []).map((part: any, i: number) => {
          const questionMeta = part?.type === 'tool' && part?.tool === 'question'
            ? questionStore.get(part.id) : null;
          return (
            <PartRenderer
              key={part.id || i}
              part={part}
              streaming={streaming}
              sessionID={sessionID}
              onReply={onReplyQuestion}
              preferredQuestionRequestID={questionMeta?.requestID}
            />
          );
        })}
        <div className={`tc-ai__msg-meta is-assistant${hover ? ' is-visible' : ''}`}>
          <button className="tc-ai__msg-copy" onClick={copy} title="复制">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          {modelID && <span className="tc-ai__msg-model">{modelID}</span>}
          {duration && <>
            <span className="tc-ai__msg-sep">·</span>
            <span className="tc-ai__msg-duration">{duration}</span>
          </>}
        </div>
      </div>
    </div>
  );
};

const styles = `
.tc-ai {
  /* ========== 主题色板: 优先使用 IDE/VSCode 主题变量, 暗色兜底 ========== */
  --ai-bg: var(--editor-background, #181818);
  /* 弹层/浮起表面: 不允许透明, 用 editorWidget-background (VSCode 标准弹层色) */
  --ai-bg-elev: var(--editorWidget-background, var(--sideBar-background, var(--editor-background, #1c1c22)));
  --ai-bg-input: color-mix(in srgb, var(--ai-fg, #e5e7eb) 5%, var(--ai-bg-elev));
  --ai-fg: var(--editor-foreground, #e5e7eb);
  --ai-fg-muted: var(--descriptionForeground, #9ca3af);
  --ai-border: var(--panel-border, var(--editorWidget-border, rgba(255,255,255,0.08)));
  --ai-divider: var(--editor-lineHighlightBorder, rgba(255,255,255,0.06));
  --ai-hover: var(--list-hoverBackground, rgba(255,255,255,0.06));
  --ai-active: var(--list-activeSelectionBackground, rgba(99,102,241,0.18));
  --ai-accent: var(--button-background, #6366f1);
  --ai-accent-fg: var(--button-foreground, #ffffff);
  --ai-accent-soft: var(--list-activeSelectionBackground, rgba(99,102,241,0.18));
  --ai-danger: var(--errorForeground, #fca5a5);
  --ai-danger-bg: var(--inputValidation-errorBackground, rgba(239,68,68,0.18));
  --ai-danger-border: var(--inputValidation-errorBorder, rgba(239,68,68,0.4));
  --ai-success: var(--terminal-ansiGreen, #4ade80);
  --ai-success-bg: color-mix(in srgb, var(--ai-success) 22%, var(--ai-bg-elev));
  --ai-warning: var(--editorWarning-foreground, #facc15);
  --ai-shadow: 0 16px 40px rgba(0,0,0,0.5);
  --ai-radius: 10px;

  display: flex; flex-direction: column; height: 100%;
  background: var(--ai-bg);
  color: var(--ai-fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  overflow: hidden;
}

/* Topbar */
.tc-ai__topbar {
  height: 36px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid var(--ai-divider);
  flex-shrink: 0;
}
.tc-ai__brand { display: flex; align-items: center; gap: 8px; }
.tc-ai__logo {
  width: 22px; height: 22px; border-radius: 6px;
  background: linear-gradient(135deg, var(--ai-accent), var(--ai-accent));
  color: var(--ai-accent-fg); font-weight: 700; font-size: 13px;
  display: flex; align-items: center; justify-content: center;
}
.tc-ai__brand-name { font-weight: 600; font-size: 13px; }
.tc-ai__top-actions { display: flex; align-items: center; gap: 2px; }
.tc-ai__icon-btn {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px;
  color: var(--ai-fg-muted);
  cursor: pointer;
}
.tc-ai__icon-btn:hover { background: var(--ai-hover); color: var(--ai-fg); }

/* Menus / popovers */
.tc-ai__menu {
  position: absolute; top: 38px; right: 8px; z-index: 50;
  width: 260px; max-height: 360px;
  background: var(--ai-bg-elev);
  border: 1px solid var(--ai-border);
  border-radius: 10px; box-shadow: var(--ai-shadow);
  display: flex; flex-direction: column; overflow: hidden;
}
.tc-ai__menu-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; font-size: 12px; color: var(--ai-fg-muted);
  background: var(--ai-bg-elev);
  border-bottom: 1px solid var(--ai-divider);
}
.tc-ai__menu-head-actions { display: flex; align-items: center; gap: 6px; }
.tc-ai__menu-clear {
  background: transparent; border: none;
  color: var(--ai-danger); font-size: 12px; cursor: pointer; padding: 2px 6px;
  border-radius: 4px;
}
.tc-ai__menu-clear:hover { background: var(--ai-danger-bg); }
.tc-ai__menu-head button {
  background: transparent; border: none; color: var(--ai-fg-muted);
  font-size: 13px; cursor: pointer; line-height: 1;
}
.tc-ai__menu-body {
  overflow-y: auto; padding: 4px;
  background: var(--ai-bg-elev);
}
.tc-ai__menu-empty { padding: 20px; text-align: center; color: var(--ai-fg-muted); font-size: 12px; }
.tc-ai__menu-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 6px; cursor: pointer;
  background: transparent;
}
.tc-ai__menu-item:hover { background: var(--ai-hover); }
.tc-ai__menu-item.active { background: var(--ai-active); }
.tc-ai__menu-item-main { flex: 1; min-width: 0; }
.tc-ai__menu-title { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tc-ai__menu-meta { font-size: 10.5px; color: var(--ai-fg-muted); margin-top: 2px; }
.tc-ai__menu-del {
  flex-shrink: 0;
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 5px;
  color: var(--ai-fg-muted); cursor: pointer; padding: 0;
  opacity: 0;
}
.tc-ai__menu-item:hover .tc-ai__menu-del { opacity: 1; }
.tc-ai__menu-del:hover { background: var(--ai-danger-bg); color: var(--ai-danger); }

/* Todos bar */
/* Todos dock (above composer, OpenCode style) */
.tc-ai__todos-dock {
  margin: 8px 8px 0;
  padding: 0;
  background: var(--ai-input-bg);
  border: 1px solid var(--ai-divider);
  border-radius: 10px;
  flex-shrink: 0;
  overflow: hidden;
}
.tc-ai__todos-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
}
.tc-ai__todos-title {
  font-size: 12px; color: var(--ai-fg-muted);
}
.tc-ai__todos-caret {
  font-size: 10px; color: var(--ai-fg-muted);
}
.tc-ai__todos-list {
  list-style: none; margin: 0; padding: 0 12px 8px 32px;
}
.tc-ai__todo-item {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 4px 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ai-fg);
}
.tc-ai__todo-item.is-completed {
  color: var(--ai-fg-muted);
  text-decoration: line-through;
  opacity: 0.7;
}
.tc-ai__todo-item.is-in_progress {
  font-weight: 500;
  color: var(--ai-fg);
}
.tc-ai__todo-check {
  flex-shrink: 0;
  margin-left: -22px;
  font-size: 12px;
  color: var(--ai-fg-muted);
  width: 14px;
  text-align: center;
}
.tc-ai__todo-item.is-in_progress .tc-ai__todo-check { color: var(--ai-warning); }
.tc-ai__todo-item.is-completed .tc-ai__todo-check { color: var(--ai-success); }

/* Messages area */
.tc-ai__messages {
  flex: 1; overflow-y: auto;
  padding: 16px 20px;
  display: flex; flex-direction: column;
}
.tc-ai__msg { margin: 6px 0; display: flex; }
.tc-ai__msg.is-user { justify-content: flex-end; }
.tc-ai__msg.is-assistant { justify-content: flex-start; }
.tc-ai__msg-user-col { display: flex; flex-direction: column; align-items: flex-end; max-width: 80%; }
.tc-ai__msg-body {
  max-width: 100%;
  color: var(--ai-fg);
  font-size: 13px; line-height: 1.65;
}
.tc-ai__msg-bubble.is-user {
  display: inline-block;
  background: var(--ai-hover);
  color: var(--ai-fg);
  padding: 7px 12px;
  border-radius: 12px;
  word-wrap: break-word; white-space: pre-wrap;
  font-size: 13px; line-height: 1.5;
  max-width: 100%;
}
.tc-ai__msg-meta {
  display: flex; align-items: center; gap: 6px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--ai-fg-muted);
  opacity: 0; transition: opacity .12s;
}
.tc-ai__msg-meta.is-visible { opacity: 1; }
.tc-ai__msg-meta.is-user { justify-content: flex-end; }
.tc-ai__msg-copy {
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 5px;
  color: var(--ai-fg-muted); cursor: pointer; padding: 0;
}
.tc-ai__msg-copy:hover { background: var(--ai-hover); color: var(--ai-fg); }
.tc-ai__msg-sep { opacity: 0.5; }
.tc-ai__msg-model { font-weight: 500; }

/* Error */
.tc-ai__error {
  margin: 0 12px 8px;
  padding: 8px 12px;
  background: var(--ai-danger-bg);
  border: 1px solid var(--ai-danger-border);
  border-radius: 8px;
  color: var(--ai-danger); font-size: 12px;
  display: flex; align-items: center; gap: 10px;
}
.tc-ai__error button {
  margin-left: auto;
  background: var(--ai-hover); border: none; color: var(--ai-danger);
  padding: 3px 10px; border-radius: 5px; cursor: pointer; font-size: 11px;
}

/* Composer */
.tc-ai__composer {
  padding: 8px 12px 12px;
  flex-shrink: 0;
  position: relative;
}
.tc-ai__input-wrap {
  background: var(--ai-input-bg);
  border: 1px solid var(--ai-border);
  border-radius: 14px;
  padding: 10px 12px 8px;
  transition: border-color .15s, background .15s;
  display: flex; flex-direction: column;
}
.tc-ai__input-wrap:focus-within {
  border-color: var(--ai-border);
  background: var(--ai-hover);
}
.tc-ai__input-wrap textarea {
  width: 100%; resize: none;
  background: transparent; border: none; outline: none;
  color: var(--ai-fg);
  font-family: inherit; font-size: 13px; line-height: 1.55;
  padding: 4px 2px 12px; min-height: 56px; max-height: 220px;
  overflow-y: auto; display: block;
}
.tc-ai__input-wrap textarea::placeholder { color: var(--ai-fg-muted); }

/* Attachment chips */
.tc-ai__attach {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 0 2px 6px;
}
.tc-ai__attach-chip {
  display: inline-flex; align-items: center; gap: 6px;
  max-width: 100%;
  padding: 3px 8px;
  background: var(--ai-hover);
  border: 1px solid var(--ai-border);
  border-radius: 6px;
  font-size: 11.5px;
}
.tc-ai__attach-name {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tc-ai__attach-x {
  background: transparent; border: none; color: var(--ai-fg-muted);
  font-size: 12px; cursor: pointer; line-height: 1; padding: 0;
}
.tc-ai__attach-x:hover { color: var(--ai-fg); }

.tc-ai__input-bar {
  display: flex; align-items: center; gap: 4px;
}
.tc-ai__select { position: relative; }
.tc-ai__bar-spacer { flex: 1; }
.tc-ai__bar-btn {
  display: inline-flex; align-items: center; gap: 5px;
  height: 28px; padding: 0 8px;
  background: transparent; border: none; border-radius: 8px;
  color: var(--ai-fg-muted);
  font-family: inherit; font-size: 13px;
  cursor: pointer; transition: background .12s, color .12s;
}
.tc-ai__bar-btn:hover {
  background: var(--ai-hover);
  color: var(--ai-fg);
}
.tc-ai__bar-plus { width: 28px; padding: 0; justify-content: center; }
.tc-ai__spark { color: var(--ai-accent); }
.tc-ai__send {
  width: 32px; height: 32px; border-radius: 9px;
  border: none; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--button-secondaryBackground, var(--ai-fg)); color: var(--button-secondaryForeground, var(--ai-bg));
  transition: background .15s, opacity .15s;
  flex-shrink: 0;
}
.tc-ai__send:hover:not(:disabled) { background: var(--button-secondaryBackground, var(--ai-fg)); }
.tc-ai__send:disabled {
  opacity: 0.35; cursor: not-allowed;
  background: var(--ai-hover); color: var(--ai-fg-muted);
}
.tc-ai__send--stop {
  background: var(--ai-danger-bg); color: var(--ai-danger);
}
.tc-ai__stop-square {
  width: 9px; height: 9px;
  background: currentColor; border-radius: 2px;
}

/* Model picker — 居中全局模态框 + 遮罩 */
.tc-ai__modal-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: var(--vscode-overlay-background, rgba(0,0,0,0.45));
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  animation: tc-ai-fade .12s ease-out;
}
@keyframes tc-ai-fade { from { opacity: 0; } to { opacity: 1; } }

.tc-ai__modal {
  width: 560px; max-width: 100%;
  max-height: min(calc(100vh - 48px), 720px);
  background: var(--ai-bg-elev);
  border: 1px solid var(--ai-border);
  border-radius: 14px;
  box-shadow: var(--ai-shadow);
  display: flex; flex-direction: column;
  overflow: hidden;
  animation: tc-ai-pop .14s ease-out;
}
.tc-ai__modal--narrow { width: 440px; }
.tc-ai__modal--wide { width: 680px; }
@keyframes tc-ai-pop {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* Header */
.tc-ai__modal-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; padding: 20px 22px 12px;
}
.tc-ai__modal-header--page {
  align-items: center; gap: 10px;
  padding: 18px 22px 8px;
}
.tc-ai__modal-header-text { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.tc-ai__modal-title {
  font-size: 17px; font-weight: 600; color: var(--ai-fg);
  display: inline-flex; align-items: center; gap: 8px;
}
.tc-ai__modal-title-icon { color: var(--ai-accent); display: inline-flex; }
.tc-ai__modal-subtitle {
  font-size: 13px; color: var(--ai-fg-muted);
}
.tc-ai__modal-back {
  width: 30px; height: 30px;
  background: transparent; border: none;
  color: var(--ai-fg-muted);
  cursor: pointer; padding: 0; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 6px;
}
.tc-ai__modal-back:hover { background: var(--ai-hover); color: var(--ai-fg); }
.tc-ai__modal-btn-primary {
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 14px;
  background: var(--ai-hover);
  border: 1px solid var(--ai-border);
  border-radius: 8px;
  color: var(--ai-fg);
  font-family: inherit; font-size: 13px; font-weight: 500;
  cursor: pointer; flex-shrink: 0;
}
.tc-ai__modal-btn-primary:hover { background: var(--ai-hover); }

/* Search */
.tc-ai__modal-search {
  display: flex; align-items: center; gap: 10px;
  margin: 4px 18px 10px;
  padding: 9px 14px;
  background: var(--ai-input-bg);
  border: 1px solid var(--ai-border);
  border-radius: 10px;
  color: var(--ai-fg-muted);
}
.tc-ai__modal-search:focus-within {
  border-color: var(--ai-accent);
  background: var(--ai-accent-soft);
}
.tc-ai__modal-search input {
  flex: 1; background: transparent; border: none; outline: none;
  color: var(--ai-fg);
  font-family: inherit; font-size: 14px;
}
.tc-ai__modal-search input::placeholder { color: var(--ai-fg-muted); }

/* Body */
.tc-ai__modal-body {
  flex: 1; overflow-y: auto;
  padding: 4px 12px 12px;
}
.tc-ai__modal-body--apikey {
  padding: 8px 22px 22px;
}

.tc-ai__modal-error {
  margin: 8px 6px;
  padding: 8px 12px;
  background: var(--ai-danger-bg);
  border: 1px solid var(--ai-danger-border);
  border-radius: 8px;
  color: var(--ai-danger); font-size: 13px;
}

/* select view: 分组模型列表 */
.tc-ai__modal-group { padding: 2px 0; }
.tc-ai__modal-group-title {
  padding: 10px 12px 6px;
  font-size: 12.5px; color: var(--ai-fg-muted);
  user-select: none;
}
.tc-ai__modal-item {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  background: transparent; border: none; border-radius: 8px;
  color: var(--ai-fg);
  font-family: inherit; font-size: 15px;
  cursor: pointer; text-align: left;
}
.tc-ai__modal-item:hover { background: var(--ai-hover); }
.tc-ai__modal-item.is-active {
  background: var(--ai-active);
  color: var(--ai-fg);
}
.tc-ai__modal-item-name { flex: 1; min-width: 0; }
.tc-ai__modal-tag {
  flex-shrink: 0;
  font-size: 10.5px; padding: 2px 7px; border-radius: 4px;
  background: var(--ai-success-bg);
  color: var(--ai-success);
}
.tc-ai__modal-check { flex-shrink: 0; }
.tc-ai__modal-empty {
  padding: 28px 16px; text-align: center;
  color: var(--ai-fg-muted); font-size: 13px;
}

.tc-ai__modal-foot {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 20px;
  background: transparent;
  border: none;
  border-top: 1px solid var(--ai-divider);
  color: var(--ai-fg);
  font-family: inherit; font-size: 15px; font-weight: 600;
  cursor: pointer; text-align: left;
}
.tc-ai__modal-foot:hover { background: var(--ai-input-bg); }

/* manage view: provider 分组 + 模型 toggle */
.tc-ai__modal-mgroup {
  margin: 8px 6px;
  background: var(--ai-input-bg);
  border: 1px solid var(--ai-divider);
  border-radius: 12px;
  overflow: hidden;
}
.tc-ai__modal-mgroup-head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px;
  color: var(--ai-fg);
}
.tc-ai__modal-mgroup-icon {
  width: 24px; height: 24px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
}
.tc-ai__modal-mgroup-title { font-size: 15px; font-weight: 600; }
.tc-ai__modal-mgroup-body {
  padding: 0 8px 8px;
}
.tc-ai__modal-modelrow {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px;
  border-radius: 8px;
  cursor: default;
  font-size: 15px;
  color: var(--ai-fg);
}
.tc-ai__modal-modelrow + .tc-ai__modal-modelrow {
  border-top: 1px solid var(--ai-divider);
}
.tc-ai__modal-modelrow-name { flex: 1; min-width: 0; }

/* iOS 风格 switch */
.tc-ai__switch {
  width: 42px; height: 24px; border-radius: 999px;
  background: var(--vscode-switch-backgroundOff, rgba(120,120,128,0.32));
  border: none; padding: 2px;
  cursor: pointer; flex-shrink: 0;
  display: inline-flex; align-items: center;
  transition: background .15s;
}
.tc-ai__switch-knob {
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--button-secondaryBackground, var(--ai-fg));
  box-shadow: var(--ai-shadow);
  transition: transform .15s;
}
.tc-ai__switch.is-on { background: var(--ai-accent); }
.tc-ai__switch.is-on .tc-ai__switch-knob { transform: translateX(18px); }

/* providers view: catalog 列表 */
.tc-ai__modal-cat { padding: 4px 2px; }
.tc-ai__modal-cat-title {
  padding: 8px 12px;
  font-size: 13px; color: var(--ai-fg-muted);
  font-weight: 500;
}
.tc-ai__modal-catrow {
  width: 100%; display: flex; align-items: center; gap: 12px;
  padding: 11px 14px;
  background: transparent; border: none; border-radius: 8px;
  color: var(--ai-fg);
  font-family: inherit; font-size: 15px;
  cursor: pointer; text-align: left;
}
.tc-ai__modal-catrow:hover { background: var(--ai-hover); }
.tc-ai__modal-catrow.is-connected { opacity: 0.65; }
.tc-ai__modal-caticon {
  width: 24px; height: 24px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--ai-fg-muted);
}
.tc-ai__modal-catname { flex: 1; min-width: 0; }

/* apikey view */
.tc-ai__modal-apikey-desc {
  margin: 4px 0 18px;
  font-size: 14px; line-height: 1.6;
  color: var(--ai-fg-muted);
}
.tc-ai__modal-apikey-label {
  display: block;
  font-size: 14px; font-weight: 600;
  color: var(--ai-fg);
  margin-bottom: 8px;
}
.tc-ai__modal-apikey-input {
  width: 100%;
  padding: 11px 14px;
  background: var(--ai-input-bg);
  border: 1px solid var(--ai-accent);
  border-radius: 10px;
  color: var(--ai-fg);
  font-family: inherit; font-size: 14px;
  outline: none;
  box-sizing: border-box;
}
.tc-ai__modal-apikey-input:focus {
  border-color: var(--ai-accent);
  background: var(--ai-accent-soft);
}
.tc-ai__modal-apikey-actions {
  display: flex; justify-content: flex-start;
  margin-top: 18px;
}
.tc-ai__modal-btn-continue {
  height: 38px; padding: 0 26px;
  background: var(--button-background, #3a3a42);
  border: 1px solid var(--ai-border);
  border-radius: 10px;
  color: var(--ai-accent-fg);
  font-family: inherit; font-size: 14px; font-weight: 600;
  cursor: pointer;
  box-shadow: var(--ai-shadow);
}
.tc-ai__modal-btn-continue:hover:not(:disabled) { filter: brightness(1.12); }
.tc-ai__modal-btn-continue:disabled { opacity: 0.5; cursor: not-allowed; }


/* ========== Agent 选择下拉 (与 ModelPicker 风格统一) ========== */
.tc-ai__agent-pop {
  position: absolute; bottom: calc(100% + 8px); left: 0;
  width: 320px; max-height: 380px; overflow-y: auto;
  background: var(--ai-bg-elev);
  border: 1px solid var(--ai-border);
  border-radius: 12px;
  box-shadow: var(--ai-shadow);
  padding: 6px;
  z-index: 60;
}
.tc-ai__agent-pop-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px 8px;
}
.tc-ai__agent-pop-title { font-size: 12px; font-weight: 600; color: var(--ai-fg); }
.tc-ai__agent-pop-close {
  width: 22px; height: 22px;
  background: transparent; border: none;
  color: var(--ai-fg-muted); font-size: 13px; line-height: 1;
  cursor: pointer; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 5px;
}
.tc-ai__agent-pop-close:hover { background: var(--ai-hover); color: var(--ai-fg); }
.tc-ai__agent-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 9px 10px;
  background: transparent; border: none; border-radius: 8px;
  color: var(--ai-fg); font-family: inherit; text-align: left;
  cursor: pointer;
}
.tc-ai__agent-item:hover { background: var(--ai-hover); }
.tc-ai__agent-item.active { background: var(--ai-active); }
.tc-ai__agent-item.active .tc-ai__agent-name { color: var(--ai-fg); }
.tc-ai__agent-icon {
  width: 28px; height: 28px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 15px;
  background: var(--ai-hover);
  border-radius: 7px;
}
.tc-ai__agent-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.tc-ai__agent-name { font-size: 12.5px; font-weight: 600; }
.tc-ai__agent-desc { font-size: 11px; color: var(--ai-fg-muted); line-height: 1.4; }
.tc-ai__agent-check { flex-shrink: 0; color: var(--ai-accent); display: inline-flex; }

/* ========== Tool call card (OpenCode style) ========== */
.tc-tool {
  margin: 4px 0;
  background: var(--ai-input-bg);
  border: 1px solid var(--ai-divider);
  border-radius: 8px;
  overflow: hidden;
}
.tc-tool__head {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 7px 10px;
  background: transparent; border: none; cursor: pointer;
  color: var(--ai-fg); font-family: inherit; font-size: 12.5px;
  text-align: left;
}
.tc-tool__head:hover { background: var(--ai-input-bg); }
.tc-tool__icon {
  width: 20px; height: 20px; border-radius: 5px;
  background: var(--ai-hover);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; flex-shrink: 0;
}
.tc-tool__name {
  font-weight: 600; font-size: 12px;
  color: var(--ai-fg);
  flex-shrink: 0;
}
.tc-tool__summary {
  flex: 1; min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px; color: var(--ai-fg-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tc-tool__caret { color: var(--ai-fg-muted); font-size: 9px; flex-shrink: 0; }
.tc-tool__body { padding: 0 10px 8px; }
.tc-tool__section pre {
  margin: 0; padding: 6px 8px;
  background: var(--ai-bg); border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; line-height: 1.5;
  overflow-x: auto; white-space: pre-wrap; word-break: break-word;
  max-height: 260px; overflow-y: auto;
}
.tc-tool__section.is-error pre { color: var(--ai-danger); }

/* ========== Question card (OpenCode style) ========== */
.tc-q {
  margin: 4px 0;
  background: var(--ai-input-bg);
  border: 1px solid var(--ai-divider);
  border-radius: 8px;
  overflow: hidden;
}
.tc-q__head {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 10px;
  cursor: pointer;
  user-select: none;
  font-size: 12.5px;
}
.tc-q__head:hover { background: var(--ai-input-bg); }
.tc-q__badge {
  font-size: 11px; color: var(--ai-fg-muted);
  display: inline-flex; align-items: center; justify-content: center;
}
.tc-q__head-title { flex: 1; font-weight: 500; }
.tc-q__caret { color: var(--ai-fg-muted); font-size: 9px; }
.tc-q__summary {
  padding: 2px 10px 8px 26px;
  font-size: 12.5px; color: var(--ai-fg);
  line-height: 1.5;
}
.tc-q__item { padding: 4px 10px 8px; }
.tc-q__q {
  font-size: 13px; line-height: 1.5;
  margin-bottom: 6px;
}
.tc-q__opts { display: flex; flex-direction: column; gap: 4px; }
.tc-q__opt {
  display: flex; align-items: flex-start; gap: 8px;
  width: 100%; padding: 7px 10px;
  background: transparent; border: 1px solid transparent; border-radius: 6px;
  color: var(--ai-fg); font-family: inherit; font-size: 13px;
  cursor: pointer; text-align: left;
}
.tc-q__opt:hover { background: var(--ai-input-bg); }
.tc-q__opt.is-active { background: var(--ai-active); }
.tc-q__opt-mark {
  flex-shrink: 0; font-size: 13px; line-height: 1.4;
  color: var(--ai-fg-muted);
}
.tc-q__opt.is-active .tc-q__opt-mark { color: var(--ai-accent); }
.tc-q__opt-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.tc-q__opt-label { font-size: 13px; }
.tc-q__opt-desc { font-size: 11.5px; color: var(--ai-fg-muted); line-height: 1.4; }
.tc-q__custom {
  width: 100%; resize: none;
  background: transparent; border: none; outline: none;
  color: var(--ai-fg);
  font-family: inherit; font-size: 13px;
  padding: 2px 0;
}
.tc-q__custom::placeholder { color: var(--ai-fg-muted); }
.tc-q__custom-opt { cursor: text; }
.tc-q__foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 0 10px 10px;
}
.tc-q__submit {
  padding: 5px 14px; border-radius: 6px; cursor: pointer;
  background: var(--ai-hover);
  color: var(--ai-fg);
  border: 1px solid var(--ai-border);
  font-size: 12px; font-weight: 500;
}
.tc-q__submit:hover { background: var(--ai-hover); }
.tc-q__submit:disabled { opacity: 0.5; cursor: default; }
.tc-q--waiting {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  color: var(--ai-fg-muted);
  font-size: 12.5px;
}

/* ========== Question modal (dock above composer) ========== */
.tc-ai__qmodal {
  margin-bottom: 8px;
  background: var(--ai-input-bg);
  border: 1px solid var(--ai-border);
  border-radius: 10px;
  overflow: hidden;
  flex-shrink: 0;
}
.tc-ai__qmodal-head {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ai-divider);
}
.tc-ai__qmodal-count { font-size: 12px; font-weight: 500; }
.tc-ai__qmodal-tabs { display: flex; gap: 4px; flex: 1; }
.tc-ai__qmodal-tab {
  padding: 3px 10px;
  background: transparent; border: none; border-radius: 5px;
  color: var(--ai-fg-muted); font-size: 11.5px;
  cursor: pointer;
}
.tc-ai__qmodal-tab:hover { background: var(--ai-hover); color: var(--ai-fg); }
.tc-ai__qmodal-tab.is-active {
  background: var(--ai-active); color: var(--ai-fg);
}
.tc-ai__qmodal-min {
  width: 24px; height: 24px;
  background: transparent; border: none; border-radius: 5px;
  color: var(--ai-fg-muted); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.tc-ai__qmodal-min:hover { background: var(--ai-hover); color: var(--ai-fg); }
.tc-ai__qmodal-body { padding: 10px 12px; }
.tc-ai__qmodal-q { font-size: 13px; line-height: 1.5; }
.tc-ai__qmodal-hint { font-size: 11.5px; color: var(--ai-fg-muted); margin: 4px 0 8px; }
.tc-ai__qmodal-opts { display: flex; flex-direction: column; gap: 4px; }
.tc-ai__qmodal-opt {
  display: flex; align-items: flex-start; gap: 8px;
  width: 100%; padding: 8px 10px;
  background: transparent; border: 1px solid transparent; border-radius: 6px;
  color: var(--ai-fg); font-family: inherit; font-size: 13px;
  cursor: pointer; text-align: left;
}
.tc-ai__qmodal-opt:hover { background: var(--ai-input-bg); }
.tc-ai__qmodal-opt.is-active { background: var(--ai-active); }
.tc-ai__qmodal-opt.is-custom { cursor: text; }
.tc-ai__qmodal-radio {
  width: 15px; height: 15px; border-radius: 50%;
  border: 1.5px solid var(--descriptionForeground);
  flex-shrink: 0; margin-top: 1px;
  display: inline-flex; align-items: center; justify-content: center;
}
.tc-ai__qmodal-opt.is-active .tc-ai__qmodal-radio { border-color: var(--ai-accent); }
.tc-ai__qmodal-radio-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: transparent;
}
.tc-ai__qmodal-opt.is-active .tc-ai__qmodal-radio-dot { background: var(--ai-accent); }
.tc-ai__qmodal-opt-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.tc-ai__qmodal-opt-label { font-size: 13px; }
.tc-ai__qmodal-opt-desc { font-size: 11.5px; color: var(--ai-fg-muted); line-height: 1.4; }
.tc-ai__qmodal-opt textarea {
  width: 100%; resize: none;
  background: transparent; border: none; outline: none;
  color: var(--ai-fg);
  font-family: inherit; font-size: 13px;
  padding: 2px 0;
}
.tc-ai__qmodal-opt textarea::placeholder { color: var(--ai-fg-muted); }
.tc-ai__qmodal-foot {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px;
  padding: 4px 12px 10px;
  border-top: none;
}
.tc-ai__qmodal-btn {
  padding: 4px 10px; border-radius: 5px; cursor: pointer;
  background: transparent; border: none;
  color: var(--ai-fg-muted);
  font-size: 12px; font-weight: 500;
}
.tc-ai__qmodal-btn:hover { background: var(--ai-hover); color: var(--ai-fg); }
.tc-ai__qmodal-btn--primary {
  background: var(--ai-hover);
}
.tc-ai__qmodal-btn--primary:hover { background: var(--ai-hover); }
.tc-ai__qmodal-btn:disabled { opacity: 0.5; cursor: default; }

/* ========== Reasoning (OpenCode style) ========== */
.tc-reason {
  margin: 4px 0;
  background: var(--ai-input-bg);
  border: 1px solid var(--ai-divider);
  border-radius: 8px;
  overflow: hidden;
}
.tc-reason__head {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 7px 10px;
  background: transparent; border: none; cursor: pointer;
  color: var(--ai-fg-muted); font-family: inherit;
  font-size: 12.5px; text-align: left;
}
.tc-reason__head:hover { background: var(--ai-input-bg); color: var(--ai-fg); }
.tc-reason__icon {
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--ai-fg-muted);
}
.tc-reason__caret {
  margin-left: auto;
  color: var(--ai-fg-muted); font-size: 9px;
}
.tc-reason__body {
  padding: 2px 10px 10px 30px;
}
.tc-reason__body pre {
  margin: 0;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--ai-fg-muted);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
}

/* Gate (logged out) */
.tc-ai__gate {
  margin: auto; text-align: left;
  max-width: 340px; padding: 32px 20px;
  display: flex; flex-direction: column; gap: 14px;
  color: var(--ai-fg);
}
.tc-ai__gate-logo {
  width: 64px; height: 64px; border-radius: 16px;
  background: linear-gradient(135deg, var(--ai-accent), var(--ai-accent));
  color: var(--button-foreground, #fff);
  display: flex; align-items: center; justify-content: center;
  font-size: 30px; font-weight: 700;
  box-shadow: 0 8px 24px var(--ai-accent-50, rgba(99,102,241,0.35));
}
.tc-ai__gate-title { margin: 0; font-size: 19px; font-weight: 600; line-height: 1.4; color: var(--ai-fg); }
.tc-ai__gate-brand {
  background: linear-gradient(135deg, var(--ai-accent), var(--ai-accent));
  -webkit-background-clip: text; background-clip: text; color: var(--ai-accent);
}
.tc-ai__gate-features { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.tc-ai__gate-features li { display: flex; align-items: flex-start; gap: 10px; font-size: 12.5px; color: var(--ai-fg); line-height: 1.5; }
.tc-ai__gate-features svg { color: var(--ai-fg); flex-shrink: 0; margin-top: 2px; }
.tc-ai__gate-btn {
  margin-top: 6px; align-self: flex-start;
  padding: 9px 20px;
  background: var(--ai-success);
  color: var(--button-secondaryForeground, var(--ai-bg)); border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  box-shadow: 0 4px 14px rgba(34,197,94,0.25);
}
.tc-ai__gate-btn:hover { filter: brightness(1.08); }

/* Welcome */
.tc-ai__welcome {
  margin: auto;
  text-align: center;
  max-width: 420px; padding: 32px 20px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.tc-ai__welcome-logo {
  width: 60px; height: 60px; border-radius: 16px;
  background: linear-gradient(135deg, var(--ai-accent), var(--ai-accent));
  color: var(--ai-accent-fg); font-size: 28px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 24px var(--ai-accent-50, rgba(99,102,241,0.35));
}
.tc-ai__welcome-title { margin: 6px 0 0; font-size: 17px; font-weight: 600; color: var(--ai-fg); }
.tc-ai__welcome-sub { margin: 0 0 12px; font-size: 12.5px; color: var(--ai-fg-muted); }
.tc-ai__welcome-agents {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%;
  margin-bottom: 12px;
}
.tc-ai__agent-card {
  display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
  padding: 12px;
  background: var(--ai-input-bg);
  border: 1px solid var(--ai-border);
  border-radius: 10px;
  color: var(--ai-fg); font-family: inherit;
  cursor: pointer; text-align: left;
  transition: background .12s, border-color .12s;
}
.tc-ai__agent-card:hover { background: var(--ai-hover); }
.tc-ai__agent-card.is-active {
  background: var(--ai-active);
  border-color: var(--ai-accent);
}
.tc-ai__agent-card-icon { font-size: 16px; }
.tc-ai__agent-card-name { font-size: 13px; font-weight: 600; }
.tc-ai__agent-card-desc { font-size: 10.5px; color: var(--ai-fg-muted); line-height: 1.4; }

.tc-ai__welcome-suggest {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%;
}
.tc-ai__suggest {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px;
  background: var(--ai-input-bg);
  border: 1px solid var(--ai-border);
  border-radius: 10px;
  color: var(--ai-fg); font-family: inherit;
  cursor: pointer; text-align: left;
}
.tc-ai__suggest:hover { background: var(--ai-hover); }
.tc-ai__suggest-icon { font-size: 16px; flex-shrink: 0; }
.tc-ai__suggest-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tc-ai__suggest-title { font-size: 12px; font-weight: 500; }
.tc-ai__suggest-desc { font-size: 10.5px; color: var(--ai-fg-muted); line-height: 1.4; }
`;
