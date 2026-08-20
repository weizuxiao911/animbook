import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useInjectable } from '@opensumi/ide-core-browser/lib/react-hooks/injectable-hooks';
import { SlotLocation } from '@opensumi/ide-core-browser';
import { IMainLayoutService } from '@opensumi/ide-main-layout/lib/common';

import {
  aiListAgents,
  aiListSkills,
  aiListCommands,
  aiSwitchAgent,
  aiGetTodos,
  aiCompactSession,
  aiShareSession,
  aiUnshareSession,
  aiClearMessages,
  aiReplyQuestion,
  aiRejectQuestion,
  aiListModels,
  aiListProviders,
  getAiClient,
} from '@/extensions/chat/commands/api';
import { modelPrefs } from '@/extensions/chat/commands/modelPrefs';
import { PartRenderer } from './parts/PartRenderer';
import { type TodoItem } from './parts/TodoCard';
import { ModelPicker } from './parts/ModelPicker';
import { QuestionModal } from './parts/QuestionModal';

import {
  Row, HIDDEN_AGENTS, AGENT_ICONS, AGENT_DESC, CLIENT_COMMANDS,
  findCurrentTodos, extractText, formatDuration,
  getQuestionStore, subscribeQuestionChange,
} from './helpers';
import { CHAT_BRAND } from '../brand';
import { styles } from './styles';
import { TodosDock } from './components/TodosDock';
import { LoginGate } from './components/LoginGate';
import { WelcomeScreen } from './components/WelcomeScreen';
import { MessageRow } from './components/MessageRow';

function loadClientCmds() {
  return CLIENT_COMMANDS.map((c) => ({ cmd: c.cmd, name: c.desc, hint: c.hint || '', source: 'client-cmd' as const }));
}

export const Chat: React.FC = () => {
  const layoutService = useInjectable<IMainLayoutService>(IMainLayoutService);
  const [loggedIn] = useState<boolean>(true);
  useEffect(() => {}, []);

  // 挂载后设置 right 面板默认宽度 498 (getTabbarHandler 需在 tabbar 渲染后, 带重试)
  useEffect(() => {
    let tries = 0;
    const apply = () => {
      const handler = layoutService.getTabbarHandler('chat-panel');
      if (handler) {
        // setSize 内部会 +barSize (tabbar 宽度), 这里减掉让实际宽度 = 498
        const bar = layoutService.getTabbarService(SlotLocation.right)?.getBarSize?.() ?? 0;
        handler.setSize(498 - bar);
        return true;
      }
      return false;
    };
    if (apply()) return;
    const timer = setInterval(() => {
      tries += 1;
      if (apply() || tries > 20) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [sessionID, setSessionID] = useState<string>('');
  const sessionIDRef = useRef(sessionID);
  sessionIDRef.current = sessionID;
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
  const [currentProvider, setCurrentProvider] = useState<string>('');
  const [currentTitle, setCurrentTitle] = useState<string>('');
  const [showSessions, setShowSessions] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [showModels, setShowModels] = useState(false);
  /** ModelPicker 初始视图: select=模型选择, providers=模型管理(/connect) */
  const [modelPickerView, setModelPickerView] = useState<'select' | 'providers'>('select');
  const [showCommands, setShowCommands] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [skills, setSkills] = useState<Array<{ name: string; description?: string; location?: string }>>([]);
  const [commands, setCommands] = useState<Array<{ name: string; description?: string; source?: string; template?: string; subtask?: boolean }>>([]);
  const [, setQuestionRev] = useState(0);
  const [activeQuestion, setActiveQuestion] = useState<{ requestID: string; questions: any[] } | null>(null);
  useEffect(() => {
    const sub = () => setQuestionRev((n) => n + 1);
    const unsub = subscribeQuestionChange(sub);
    return unsub;
  }, []);
  const [attachments, setAttachments] = useState<Array<{ name: string; path: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modelQuery, setModelQuery] = useState('');
  const [mentionQuery, setMentionQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 5000);
  }, []);
  const setApiError = useCallback((e: any, ctx?: string) => {
    const tag = e?.data?._tag || e?.name || '';
    const msg = String(e?.data?.message || e?.message || e);
    const isServerError =
      tag === 'UnknownError' ||
      tag === 'ServerError' ||
      tag === 'ServiceUnavailableError' ||
      msg.includes('Unexpected server error') ||
      msg.toLowerCase().includes('not available') ||
      (typeof e?.status === 'number' && e.status >= 500) ||
      (e?.data?.service && typeof e.data.service === 'string');
    const text = ctx ? `${ctx}: ${msg}` : msg;
    if (isServerError) showNotice(text + ' (服务端异常, 可重试或新建会话)');
    else setError(text);
  }, [showNotice]);
  const [ready, setReady] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);

  // chat 只需要 opencode 实例 — 取全局 __WEBAPP_OPENCODE__, 不依赖 sandbox/fs/login.
  // 未创建时同步 ensure 一个 (getAiClient 内部 getOpencodeClient 会挂全局).
  const client = (window as any).__WEBAPP_OPENCODE__;
  const isReady = () => {
    if (!client) {
      try { getAiClient(); } catch { /* 暂不可用, 交给轮询 */ }
    }
    return !!(window as any).__WEBAPP_OPENCODE__;
  };
  useEffect(() => {
    const check = () => setReady(isReady());
    check();
    const id = window.setInterval(check, 1500);
    return () => window.clearInterval(id);
  }, []);

  // --- 配置加载 (agents/models/providers/skills/commands) ---
  const loadConfig = useCallback(async () => {
    if (!ready || !loggedIn) return;
    try {
      const list = await aiListAgents();
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
    } catch (e) { console.warn('[ai] load agents failed', e); return; }
    try {
      const m = await aiListModels();
      setModels(m || []);
      if (m?.length) {
        // 只在 currentModel 未设置 OR 不在 models 列表时才 fallback,
        // 避免覆盖 session sync (applySessionToUI) 写入的真实 model
        setCurrentModel((cur) => {
          if (cur && m.find((x: any) => x.id === cur)) return cur;
          const prefs = modelPrefs.get();
          // 优先按 default + defaultProvider 精确定位 (同名模型跨 provider)
          if (prefs.default) {
            const def = m.find((x: any) => x.id === prefs.default && x.providerID === prefs.defaultProvider);
            if (def) return def.id;
            const anyProvider = m.find((x: any) => x.id === prefs.default);
            if (anyProvider) return anyProvider.id;
          }
          return m[0].id;
        });
        // 同步推导 currentProvider: 优先用 currentProvider 对应 model,
        // 否则回退到 default/defaultProvider 对应 model
        setCurrentProvider((curP) => {
          if (curP && m.find((x: any) => x.providerID === curP)) return curP;
          const prefs = modelPrefs.get();
          if (prefs.defaultProvider) {
            const def = m.find((x: any) => x.id === prefs.default && x.providerID === prefs.defaultProvider);
            if (def) return def.providerID;
          }
          const target = prefs.default ? m.find((x: any) => x.id === prefs.default) : m[0];
          return target?.providerID || curP;
        });
      }
    } catch (e) { console.warn('[ai] load models failed', e); }
    try { setProviders(await aiListProviders() || []); } catch (e) { console.warn('[ai] load providers failed', e); }
    try { setSkills(await aiListSkills() || []); } catch (e) { console.warn('[ai] load skills failed', e); }
    try { setCommands(await aiListCommands() || []); } catch (e) { console.warn('[ai] load commands failed', e); }
  }, [ready, loggedIn, currentAgent]);
  useEffect(() => {
    if (!ready || !loggedIn) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wrap = async () => { if (!cancelled) await loadConfig(); };
    void wrap();
    const onSandboxReady = () => { if (timer) clearTimeout(timer); void wrap(); };
    window.addEventListener('webapp:sandbox-ready', onSandboxReady);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('webapp:sandbox-ready', onSandboxReady);
    };
  }, [ready, loggedIn, loadConfig]);
  useEffect(() => {
    const onReveal = () => setTimeout(() => taRef.current?.focus(), 120);
    const onPrefs = () => setModelsRefresh((n) => n + 1);
    const onSelectSession = (e: Event) => {
      const id = (e as CustomEvent<{ sessionID?: string }>).detail?.sessionID;
      if (typeof id === 'string' && id) {
        setSessionID(id);
        setSessions((prev) => prev.slice());
        setTimeout(() => taRef.current?.focus(), 120);
      }
    };
    window.addEventListener('webapp:ai-reveal', onReveal);
    window.addEventListener('webapp:ai-modelPrefs-changed', onPrefs);
    window.addEventListener('webapp:ai-select-session', onSelectSession);
    return () => {
      window.removeEventListener('webapp:ai-reveal', onReveal);
      window.removeEventListener('webapp:ai-modelPrefs-changed', onPrefs);
      window.removeEventListener('webapp:ai-select-session', onSelectSession);
    };
  }, []);

  useEffect(() => {
    if (showModels) setTimeout(() => modelSearchRef.current?.focus(), 30);
  }, [showModels]);
  useEffect(() => {
    if (!showAgents && !showModels && !showSessions) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.chat__mpop')
        || t.closest('.chat__modal')
        || t.closest('.chat__agent-pop')
        || t.closest('.chat__menu')
        || t.closest('[data-ai-pop="agents"]')
        || t.closest('[data-ai-pop="models"]')
        || t.closest('[data-ai-pop="sessions"]')) return;
      setShowAgents(false);
      setShowModels(false);
      setShowSessions(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showAgents, showModels, showSessions]);

  const loadSessions = useCallback(async () => {
    if (!client) return;
    try {
      const list = await client.session.list();
      setSessions(Array.isArray(list?.data) ? list.data : (list?.data?.data || []));
    } catch { /* ignore */ }
  }, [client]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const refreshTodos = useCallback(async (sid: string) => {
    try {
      const list = await aiGetTodos(sid);
      setTodos((list || []).map((t: any) => ({
        content: String(t?.content || ''),
        status: t?.status === 'completed' || t?.status === 'in_progress' || t?.status === 'pending' || t?.status === 'cancelled' ? t.status : 'pending',
        priority: typeof t?.priority === 'string' ? t.priority : undefined,
      })).filter((t: TodoItem) => t.content.trim().length > 0));
    } catch { /* keep current */ }
  }, []);

  const loadMessages = useCallback(async (sid?: string) => {
    const target = sid || sessionIDRef.current;
    if (!target) { setRows([]); return; }
    if (!client) return;
    try {
      const res = await client.session.messages({ sessionID: target });
      const list = (res?.data?.data || res?.data?.messages || res?.data || []);
      const rs: Row[] = (Array.isArray(list) ? list : []).map((m: any) => ({
        id: m.info?.id || m.id,
        role: m.info?.role || m.role,
        parts: m.parts || m.info?.parts || [],
      }));
      setRows(rs);
      void refreshTodos(target);
    } catch (e) { setApiError(e); }
  }, [client, refreshTodos, setApiError]);

  useEffect(() => {
    if (sessionID) loadMessages(sessionID);
    else setRows([]);
  }, [sessionID, loadMessages]);

  // sessionID 持久化到 sessionStorage (前端状态, 不向 server 查"最近会话")
  const SESSION_KEY = 'animbook.chat.sessionID';
  useEffect(() => {
    if (!ready || !client) return;
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved && saved !== sessionID) setSessionID(saved);
  }, [ready, client, sessionID]);
  useEffect(() => {
    if (sessionID) sessionStorage.setItem(SESSION_KEY, sessionID);
  }, [sessionID]);
  const skipAutoLoad = { current: true };  // 兼容别名 (保留给清空全部会话用)

  useEffect(() => {
    if (!busy || !sessionID) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stopped) return;
      try { await loadMessages(sessionID); } catch { /* ignore */ }
      if (!stopped) timer = setTimeout(tick, 500);
    };
    timer = setTimeout(tick, 500);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [busy, sessionID, loadMessages]);

  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    // 等 DOM 把消息 render 完, 再滚到底; React render 是异步的, 用 rAF + setTimeout
    // 双保险, 否则大消息列表 (1100+ 条) 时 scrollHeight 还没长好
    const scrollToBottom = () => { el.scrollTop = el.scrollHeight; };
    requestAnimationFrame(() => {
      requestAnimationFrame(scrollToBottom);
      setTimeout(scrollToBottom, 0);
      setTimeout(scrollToBottom, 100);
    });
  }, [rows, busy]);

  // 从 opencode session 同步 agent/model/title 到本地 UI state
  const applySessionToUI = useCallback((session: any) => {
    console.log('[applySessionToUI]', { model: session?.model, title: session?.title });
    if (!session) return;
    if (session.agent) setCurrentAgent(session.agent);
    if (session.model?.id) setCurrentModel(session.model.id);
    if (session.model?.providerID) setCurrentProvider(session.model.providerID);
    setCurrentTitle(session.title || '');
  }, []);

  // 当前 session 变更 → fetch 一次 session.get 拉最新 agent/model
  useEffect(() => {
    if (!client || !sessionID) return;
    (async () => {
      try {
        const r = await client.session.get({ sessionID });
        applySessionToUI(r?.data);
      } catch { /* ignore */ }
    })();
  }, [client, sessionID, applySessionToUI]);

  const onNewSession = useCallback(async () => {
    if (!ready || !client) return;
    try {
      const res = await client.session.create({});
      const sid = res?.data?.id;
      if (sid) { setSessionID(sid); setRows([]); setShowSessions(false); }
    } catch (e) { setApiError(e); }
  }, [ready, client, setApiError]);

  const selectedModel = useMemo(() => {
    if (!currentModel) return null;
    // 同名 model 可能跨多个 provider (如 MiniMax-M3 在 3 家), 优先按 id+providerID 精确定位
    if (currentProvider) {
      const m = models.find((x: any) => x.id === currentModel && x.providerID === currentProvider);
      if (m) return m;
    }
    return models.find((m: any) => m.id === currentModel) || null;
  }, [models, currentModel, currentProvider]);
  const currentAgentInfo = useMemo(
    () => agents.find((a: any) => (a.id || a.name) === currentAgent),
    [agents, currentAgent]
  );
  const currentModelLabel = useMemo(() => {
    if (!selectedModel) return '';
    const name = selectedModel.name || selectedModel.id || '';
    const provider = providers.find((p: any) => p.id === selectedModel.providerID)?.name
      || selectedModel.providerName
      || selectedModel.providerID;
    return provider ? `${name} · ${provider}` : name;
  }, [selectedModel, providers]);

  const onSend = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !client) return;
    setInput('');
    setError('');
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
        const res = await client.session.create({});
        sid = res?.data?.id;
        if (sid) setSessionID(sid);
      }
      // 始终按 currentModel + currentProvider 拼 model: 优先用 models 列表里
      // (providerID, modelID) 复合 key 匹配, 找不到时回退到当前 modelID
      const model = currentModel
        ? (() => {
            const m = models.find((x: any) =>
              x.id === currentModel &&
              (!currentProvider || x.providerID === currentProvider)
            );
            return m
              ? { providerID: m.providerID, modelID: m.id }
              : { modelID: currentModel, ...(currentProvider ? { providerID: currentProvider } : {}) };
          })()
        : undefined;
      await client.session.prompt({
        sessionID: sid,
        agent: currentAgent,
        parts: [{ type: 'text', text: fullText }],
        ...(model ? { model } : {}),
      });
      setBusy(true);
    } catch (e) {
      setRows((prev) => prev.filter((r) => r.id !== localId));
      setInput(text);
      setApiError(e);
    }
  }, [input, busy, sessionID, currentAgent, currentModel, models, attachments, client, setApiError]);

  const onAbort = useCallback(async (sid?: string) => {
    const target = sid || sessionID;
    if (!target || !client) return;
    try { await client.session.abort({ sessionID: target }); setBusy(false); }
    catch (e) { console.warn('[ai] abort:', e); setBusy(false); }
  }, [sessionID, client]);

  const onSwitchSession = useCallback((sid: string) => {
    setSessionID(sid);
    setShowSessions(false);
    setRows([]);
  }, []);

  const onDeleteSession = useCallback(async (sid: string) => {
    if (!client) return;
    try {
      await client.session.delete({ sessionID: sid });
      setSessions((prev) => prev.filter((s) => s.id !== sid));
      if (sid === sessionID) { setSessionID(''); setRows([]); }
    } catch (e) { setApiError(e); }
  }, [client, sessionID, setApiError]);

  const onSwitchAgent = useCallback(async (agent: string) => {
    setCurrentAgent(agent);
    setShowAgents(false);
    if (sessionID) {
      try { await aiSwitchAgent(sessionID, agent); } catch (e) { setApiError(e); }
    }
  }, [sessionID, setApiError]);

  const commandList = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ cmd: string; name: string; hint?: string; template?: string; subtask?: boolean; source: 'client-cmd' | 'command' | 'skill' }> = [];
    for (const c of loadClientCmds()) {
      if (seen.has(c.cmd)) continue;
      seen.add(c.cmd);
      list.push({ cmd: c.cmd, name: c.name, hint: c.hint, source: 'client-cmd' });
    }
    for (const c of commands) {
      if (!c.name || seen.has(c.name)) continue;
      seen.add(c.name);
      list.push({ cmd: c.name, name: c.description || '', hint: '', template: c.template, subtask: c.subtask, source: 'command' });
    }
    for (const s of skills) {
      if (!s.name || seen.has(s.name)) continue;
      seen.add(s.name);
      list.push({ cmd: s.name, name: s.description || '', hint: '', source: 'skill' });
    }
    return list;
  }, [skills, commands]);

  const visibleAgents = useMemo(
    () => agents.filter((a: any) => {
      const id = a.id || a.name;
      const mode = a.mode || a.data?.mode;
      return id && !HIDDEN_AGENTS.has(id) && (mode === 'primary' || mode === 'all');
    }),
    [agents]
  );

  const filteredCommands = useMemo(() => {
    const q = input.match(/(?:^|\s)\/(\S*)$/)?.[1] || '';
    if (!q) return commandList;
    const qLower = q.toLowerCase();
    return commandList.filter((c) => c.cmd.toLowerCase().startsWith(qLower) || c.name.toLowerCase().includes(qLower));
  }, [commandList, input]);

  const mentionList = useMemo(() => {
    const q = input.match(/(?:^|\s)[@#](\S*)$/)?.[1] || '';
    const items: Array<{ id: string; name: string; type: 'agent' | 'file' | 'symbol'; hint?: string }> = [
      ...visibleAgents.map((a) => ({ id: a.id || a.name, name: a.name || a.id, type: 'agent' as const, hint: AGENT_DESC[a.id || a.name] })),
    ];
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  }, [visibleAgents, input]);

  const [cmdIndex, setCmdIndex] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  useEffect(() => { setCmdIndex(0); }, [filteredCommands.length, input]);
  useEffect(() => { setMentionIndex(0); }, [mentionList.length, input]);

  const runClientCmd = useCallback(async (cmd: string) => {
    if (!sessionID) { setError('当前没有选中会话'); return; }
    try {
      switch (cmd) {
        case 'model': {
          // TUI /models 同款: 唤起模型选择
          setModelPickerView('select');
          setShowModels(true);
          setShowAgents(false);
          setShowCommands(false);
          break;
        }
        case 'connect': {
          // TUI /connect 同款: 唤起模型管理 (服务商列表)
          setModelPickerView('providers');
          setShowModels(true);
          setShowAgents(false);
          setShowCommands(false);
          break;
        }
        case 'compact': {
          try {
            await aiCompactSession(sessionID);
            showNotice('已发起压缩, 完成后会刷新消息');
            await loadMessages(sessionID);
          } catch {
            showNotice('服务端暂未支持压缩 (session.compact 在 opencode 1.18.18 尚未上线)');
          }
          break;
        }
        case 'clear': {
          const n = await aiClearMessages(sessionID);
          showNotice(`已清空 ${n} 条消息`);
          setRows([]);
          break;
        }
        case 'copy': {
          const res = await client?.session.messages({ sessionID });
          const list = res?.data?.data || res?.data?.messages || res?.data || [];
          const md = (Array.isArray(list) ? list : []).map((m: any) => {
            const info = m.info || m;
            const text = (m.parts || info.parts || []).filter((p: any) => p.type === 'text' && !p.synthetic).map((p: any) => p.text).join('');
            return `**${info.role}**:\n\n${text}\n`;
          }).join('\n---\n\n');
          await navigator.clipboard.writeText(md || '(空会话)');
          showNotice('已复制到剪贴板');
          break;
        }
        case 'share': {
          const url = await aiShareSession(sessionID);
          if (url) await navigator.clipboard.writeText(url);
          showNotice(url ? '分享链接已复制' : '分享失败');
          break;
        }
        case 'unshare': {
          await aiUnshareSession(sessionID);
          showNotice('已取消分享');
          break;
        }
        case 'export': {
          const res = await client?.session.messages({ sessionID });
          const list = res?.data?.data || res?.data?.messages || res?.data || [];
          const md = `# Session ${sessionID}\}\n\n` + (Array.isArray(list) ? list : []).map((m: any) => {
            const info = m.info || m;
            const text = (m.parts || info.parts || []).filter((p: any) => p.type === 'text' && !p.synthetic).map((p: any) => p.text).join('');
            return `## ${info.role}\}\n\n${text}\}\n`;
          }).join('\n---\n\n');
          const blob = new Blob([md], { type: 'text/markdown' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `session-${sessionID.slice(0, 8)}.md`;
          a.click();
          URL.revokeObjectURL(a.href);
          break;
        }
        case 'help': {
          showNotice([
            '快捷键:',
            '  ↑↓  Enter — 选择 / 弹层项',
            '  Esc  Tab — 关闭弹层 / 补全',
            '  Enter — 发送消息',
            '  Shift+Enter — 换行',
            '  / — 命令 · @ — agent/文件引用',
          ].join('\n'));
          break;
        }
        default: setError(`未知客户端命令: /${cmd}`);
      }
    } catch (e) { setError(`/${cmd} 失败: ${String((e as any)?.message || e)}`); }
  }, [sessionID, client, loadMessages, showNotice, setShowModels, setShowAgents, setShowCommands, setModelPickerView]);

  const applyCommand = useCallback(async (c: { cmd: string; name: string; hint?: string; template?: string; subtask?: boolean; source: 'client-cmd' | 'command' | 'skill' }) => {
    const m = input.match(/(?:^|\s)\/(\S+)(?:\s+(.*))?$/);
    const args = (m && m[2]) ? m[2].trim() : '';
    setShowCommands(false);
    setInput('');

    if (c.source === 'client-cmd') { await runClientCmd(c.cmd); return; }

    if (c.template) {
      const promptText = c.template.replace(/\$ARGUMENTS/g, args || '(no arguments provided)');
      try {
        let sid = sessionID;
        if (!sid) {
          const res = await client.session.create({});
          sid = res?.data?.id;
          if (sid) setSessionID(sid);
        }
        const model = currentModel
          ? (() => {
              const m = models.find((x: any) => x.id === currentModel);
              return m ? { providerID: m.providerID, modelID: m.id } : { modelID: currentModel };
            })()
          : undefined;
        await client.session.prompt({
          sessionID: sid,
          agent: currentAgent,
          parts: [{ type: 'text', text: promptText }],
          ...(model ? { model } : {}),
        });
        setBusy(true);
      } catch (e) { setApiError(e); }
      return;
    }

    setInput(`/${c.cmd} `);
    setTimeout(() => taRef.current?.focus(), 0);
  }, [input, sessionID, currentAgent, currentModel, models, client, runClientCmd, setApiError]);

  const applyMention = useCallback((m: { id: string; name: string; type: string }) => {
    const trigger = input.match(/[@#]\S*$/)?.[0]?.[0] || '@';
    const replaced = input.replace(/[@#]\S*$/, `${trigger}${m.name} `);
    setInput(replaced);
    setShowMentions(false);
    setTimeout(() => taRef.current?.focus(), 0);
  }, [input]);

  const onReplyQuestion = useCallback(async (sid: string, rid: string, answers: string[][]) => {
    await aiReplyQuestion(sid, rid, answers);
    if (sid) { try { await loadMessages(sid); } catch { /* ignore */ } }
  }, [loadMessages]);

  const onIgnoreQuestion = useCallback(async (rid: string) => {
    try {
      await aiRejectQuestion(sessionID, rid);
      if (sessionID) { try { await loadMessages(sessionID); } catch { /* ignore */ } }
    } catch (e) { console.warn('[ai] reject question:', e); }
  }, [sessionID, loadMessages]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showCommands && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCmdIndex((i) => (i + 1) % filteredCommands.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCmdIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault(); applyCommand(filteredCommands[cmdIndex]); return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && e.shiftKey)) {
        e.preventDefault(); applyCommand(filteredCommands[cmdIndex]); return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setShowCommands(false); return; }
    }
    if (showMentions && mentionList.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((i) => (i + 1) % mentionList.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex((i) => (i - 1 + mentionList.length) % mentionList.length); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault(); applyMention(mentionList[mentionIndex]); return;
      }
      if (e.key === 'Tab') { e.preventDefault(); applyMention(mentionList[mentionIndex]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setShowMentions(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault(); onSend();
    }
  }, [onSend, showCommands, showMentions, filteredCommands, mentionList, cmdIndex, mentionIndex, applyCommand, applyMention]);

  const onUploadFile = useCallback(async (files: FileList | null) => {
    if (!files || !files.length) return;
    const fsApi = (window as any).__WEBAPP_FS_API__;
    if (!fsApi?.write) { setError('沙箱文件系统未就绪'); return; }
    const added: Array<{ name: string; path: string }> = [];
    for (const f of Array.from(files)) {
      try {
        const text = await f.text();
        const safe = f.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
        const path = `/${safe}`;
        await fsApi.write(path, text);
        added.push({ name: f.name, path });
      } catch (e) { setError(`上传 ${f.name} 失败: ${String((e as any)?.message || e)}`); }
    }
    if (added.length) setAttachments((prev) => [...prev, ...added]);
  }, []);

  const onInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    const m = val.match(/(?:^|\s)([\/@#])(\S*)$/);
    if (m) {
      const [, trigger, q] = m;
      if (trigger === '/') {
        setShowCommands(true); setShowMentions(false); setShowModels(false); setShowAgents(false);
      } else if (trigger === '@' || trigger === '#') {
        setShowMentions(true); setMentionQuery(q || ''); setShowCommands(false); setShowModels(false); setShowAgents(false);
      }
    } else { setShowCommands(false); setShowMentions(false); }
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
  }, []);

  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    const prefs = modelPrefs.get();
    let list = models
      .filter((m: any) => !prefs.hidden.includes(m.id))
      .filter((m: any) => {
        if (!q) return true;
        const mid = m.id || '';
        const pid = m.providerID || '';
        const name = m.name || '';
        return `${pid}/${mid} ${name}`.toLowerCase().includes(q);
      });
    list = list.map((m: any) => ({ ...m, name: prefs.customNames[m.id] || m.name }));
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

  const activeTodos = useMemo(() => {
    if (todos.length > 0) return todos;
    const lastAssistant = [...rows].reverse().find((r) => r.role === 'assistant');
    if (!lastAssistant) return [];
    return findCurrentTodos(lastAssistant.parts || []);
  }, [todos, rows]);

  return (
    <div className="chat">
      <style>{styles}</style>

      <header className="chat__topbar">
        <div className="chat__brand">
          <span className="chat__logo">{CHAT_BRAND.logoChar}</span>
          <span className="chat__brand-name">{
            (() => {
              if (!sessionID) return '新会话';
              if (currentTitle) return currentTitle;
              const cur = sessions.find((s: any) => s.id === sessionID);
              return cur?.title || cur?.slug || '';
            })()
          }</span>
        </div>
        {ready && (
          <div className="chat__top-actions">
            <button
              data-ai-pop="sessions"
              className="chat__icon-btn"
              title="历史会话"
              onClick={() => { setShowSessions((v) => !v); if (!showSessions) loadSessions(); }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </button>
            <button className="chat__icon-btn" title="新会话" onClick={onNewSession}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
        )}
      </header>

      {ready && showSessions && (
        <div className="chat__menu">
          <div className="chat__menu-head">
            <span>历史会话</span>
            <div className="chat__menu-head-actions">
              {sessions.length > 0 && (
                <button
                  className="chat__menu-clear"
                  title="清空全部会话"
                  onClick={async () => {
                    if (!confirm('确定删除全部会话？此操作不可恢复。')) return;
                    try {
                      const res = await client.session.list();
                      const list = Array.isArray(res?.data) ? res.data : (res?.data?.data || []);
                      let n = 0;
                      for (const s of list) {
                        try { await client.session.delete({ sessionID: s.id }); n++; } catch { /* skip */ }
                      }
                      skipAutoLoad.current = true;
                      setSessions([]);
                      setSessionID('');
                      setRows([]);
                      setError('');
                      setTimeout(() => { skipAutoLoad.current = false; }, 1000);
                    } catch (e) { setApiError(e); }
                  }}
                >清空</button>
              )}
              <button onClick={() => setShowSessions(false)}>×</button>
            </div>
          </div>
          <div className="chat__menu-body">
            {sessions.length === 0 && <div className="chat__menu-empty">暂无历史会话</div>}
            {sessions.map((s: any) => (
              <div
                key={s.id}
                className={`chat__menu-item ${s.id === sessionID ? 'active' : ''}`}
                onClick={() => onSwitchSession(s.id)}
              >
                <div className="chat__menu-item-main">
                  <div className="chat__menu-title">{s.title || `会话 ${(s.id || '').slice(0, 8)}`}</div>
                  <div className="chat__menu-meta">
                    {s.time?.created ? new Date(s.time.created).toLocaleString() : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="chat__menu-del"
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

      <div className="chat__messages" ref={scrollRef}>
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
        <div className="chat__error">
          <span className="chat__error-text">{error}</span>
          <button onClick={() => { setError(''); if (sessionID) loadMessages(sessionID); }}>重试</button>
        </div>
      )}

      {notice && (
        <div className="chat__notice">
          <span className="chat__notice-text">{notice}</span>
          <button onClick={() => setNotice('')}>×</button>
        </div>
      )}

      {ready && (
        <div className="chat__composer">
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
            <div className="chat__cmd-pop">
              <div className="chat__cmd-list">
                {filteredCommands.map((c, i) => (
                  <button
                    key={c.cmd}
                    type="button"
                    className={`chat__cmd-item${i === cmdIndex ? ' active' : ''}`}
                    onMouseEnter={() => setCmdIndex(i)}
                    onClick={() => applyCommand(c)}
                  >
                    <span className="chat__cmd-cmd">/{c.cmd}</span>
                    <span className="chat__cmd-name">{c.name}</span>
                    {c.hint && <span className="chat__cmd-hint">{c.hint}</span>}
                  </button>
                ))}
                {filteredCommands.length === 0 && (
                  <div className="chat__cmd-empty">无匹配命令</div>
                )}
              </div>
            </div>
          )}

          {showMentions && (
            <div className="chat__cmd-pop">
              <div className="chat__cmd-list">
                {mentionList.length === 0 && (
                  <div className="chat__cmd-empty">无匹配项</div>
                )}
                {mentionList.map((m, i) => {
                  const trigger = input.match(/[@#]\S*$/)?.[0]?.[0] || '@';
                  return (
                  <button
                    key={`${m.type}-${m.id}`}
                    type="button"
                    className={`chat__cmd-item${i === mentionIndex ? ' active' : ''}`}
                    onMouseEnter={() => setMentionIndex(i)}
                    onClick={() => applyMention(m)}
                  >
                    <span className="chat__cmd-cmd">{trigger}{m.name}</span>
                    <span className="chat__cmd-name">{m.hint || m.type}</span>
                  </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="chat__input-wrap">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { void onUploadFile(e.target.files); e.target.value = ''; }}
            />
            {attachments.length > 0 && (
              <div className="chat__attach">
                {attachments.map((a, i) => (
                  <span key={i} className="chat__attach-chip">
                    <span className="chat__attach-name">{a.name}</span>
                    <button
                      type="button"
                      className="chat__attach-x"
                      onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    >×</button>
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
            <div className="chat__input-bar">
              <button type="button" className="chat__bar-btn chat__bar-plus" title="上传附件" onClick={() => fileInputRef.current?.click()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>

              <div className="chat__select">
                <button
                  data-ai-pop="agents"
                  type="button"
                  className="chat__bar-btn chat__bar-text"
                  onClick={() => { setShowAgents((v) => !v); setShowModels(false); }}
                >
                  <span>{currentAgentInfo?.name || currentAgent}</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {showAgents && (
                  <div className="chat__agent-pop">
                    <div className="chat__agent-pop-head">
                      <span className="chat__agent-pop-title">选择 Mode</span>
                      <button type="button" className="chat__agent-pop-close" onClick={() => setShowAgents(false)}>✕</button>
                    </div>
                    {visibleAgents.map((a: any) => {
                      const id = a.id || a.name;
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`chat__agent-item${id === currentAgent ? ' is-active' : ''}`}
                          onClick={() => onSwitchAgent(id)}
                        >
                          <span className="chat__agent-icon">{AGENT_ICONS[id] || '✨'}</span>
                          <span className="chat__agent-body">
                            <span className="chat__agent-name">{a.name || id}</span>
                            <span className="chat__agent-desc">{a.description || AGENT_DESC[id] || ''}</span>
                          </span>
                          {id === currentAgent && (
                            <span className="chat__agent-check">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="chat__select">
                <button
                  data-ai-pop="models"
                  type="button"
                  className="chat__bar-btn chat__bar-text"
                  onClick={() => { setModelPickerView('select'); setShowModels((v) => !v); setShowAgents(false); }}
                >
                  <svg className="chat__spark" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z"/>
                  </svg>
                  <span>{currentModelLabel}</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {showModels && (
                  <ModelPicker
                    models={models}
                    currentModel={currentModel}
                    currentProvider={currentProvider}
                    initialView={modelPickerView}
                    onSelect={(id, providerID) => {
                      setCurrentModel(id);
                      setCurrentProvider(providerID);
                      modelPrefs.setDefault(id, providerID);
                      setShowModels(false);
                    }}
                    onClose={() => setShowModels(false)}
                    onProvidersChanged={async () => {
                      try {
                        const m = await aiListModels();
                        setModels(m || []);
                        const ps = await aiListProviders();
                        setProviders(ps as any);
                      } catch (e) { console.warn('[ai] refresh after connect failed', e); }
                    }}
                  />
                )}
              </div>

              <div className="chat__bar-spacer" />

              {busy ? (
                <button type="button" className="chat__send chat__send--stop" onClick={() => onAbort()} title="停止">
                  <span className="chat__stop-square" />
                </button>
              ) : (
                <button
                  type="button"
                  className="chat__send"
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