/**
 * chat vsix — OpenSumi 兼容 VS Code 扩展 (browserMain)
 *
 * 标准: opensumi sumiContributes.browserMain + browserViews
 *   - sumiContributes.browserMain  → 浏览器侧模块, 主线程加载
 *   - sumiContributes.browserViews.right → 在 right 槽位注册 view 容器
 *   - view 的 id 与模块命名导出同名 (framework 用 module.exports[id] 取组件)
 *
 * 构建约定 (见 build.mjs):
 *   - esbuild → CJS (module.exports), 供 opensumi loadBrowserModule 的
 *     new Function('module','exports','require') 执行
 *   - React 标记 external → 产物 `require("React")`, 由 opensumi 的
 *     require 拦截器注入宿主同一份 react (避免双 React 导致 hooks 崩)
 *
 * 打包: package-vsix.mjs → 标准 .vsix (extension/ 前缀)
 */

import * as React from 'React';

const { useEffect, useState, useCallback, useRef } = React;

export interface ChatBrand {
  name: string;
  nameZh: string;
  tagline: string;
  greeting: string;
}

export interface ChatViewProps {
  /** 可选注入的 opencode client; 缺省读 window.__WEBAPP_OPENCODE__ */
  client?: any;
  brand?: ChatBrand;
}

interface ChatMessage {
  type: 'user' | 'assistant';
  text: string;
  at: number;
}

/**
 * ChatView — 右侧 AI 面板 (React 组件, 渲染在 right 槽位).
 * 数据走 opencode SDK: 会话列表 / 消息 / 新建 / 发送.
 */
export const ChatView: React.FC<ChatViewProps> = ({ client, brand }) => {
  const [sessions, setSessions] = useState<any[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const getClient = useCallback((): any => client ?? (window as any).__WEBAPP_OPENCODE__, [client]);

  const listSessions = useCallback(async () => {
    const c = getClient();
    if (!c?.session?.list) return;
    try {
      const r = await c.session.list();
      const arr = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.data) ? r.data.data : []);
      setSessions(arr);
    } catch (e) {
      console.warn('[chat-vsix] session.list failed:', e);
    }
  }, [getClient]);

  useEffect(() => { listSessions(); }, [listSessions]);

  useEffect(() => {
    if (!currentId) { setMessages([]); return; }
    const c = getClient();
    if (!c?.session?.messages) return;
    c.session.messages({ sessionID: currentId }).then((r: any) => {
      const arr = Array.isArray(r.data) ? r.data : [];
      const out: ChatMessage[] = [];
      for (const m of arr) {
        const text = (m.parts ?? []).map((p: any) => p.text ?? '').join('');
        if (text) out.push({ type: m.info?.role, text, at: m.info?.time?.created ?? Date.now() });
      }
      setMessages(out);
    }).catch(() => setMessages([]));
  }, [currentId, getClient]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function createSession() {
    const c = getClient();
    if (!c?.session?.create) return;
    try {
      const r = await c.session.create();
      const id = r.data?.id;
      if (id) {
        await listSessions();
        setCurrentId(id);
      }
    } catch (e) { console.warn('[chat-vsix] createSession:', e); }
  }

  async function sendMessage() {
    if (!input.trim() || !currentId) return;
    const text = input.trim();
    setInput('');
    setBusy(true);
    setMessages((prev) => [...prev, { type: 'user', text, at: Date.now() }]);
    const c = getClient();
    try {
      if (c?.session?.prompt) {
        await c.session.prompt({ sessionID: currentId, parts: [{ type: 'text', text }] });
        await new Promise((r) => setTimeout(r, 1500));
        const r = await c.session.messages({ sessionID: currentId });
        const arr = Array.isArray(r.data) ? r.data : [];
        const out: ChatMessage[] = [];
        for (const m of arr) {
          const t = (m.parts ?? []).map((p: any) => p.text ?? '').join('');
          if (t) out.push({ type: m.info?.role, text: t, at: m.info?.time?.created ?? Date.now() });
        }
        setMessages(out);
      }
    } catch (e: any) {
      setMessages((prev) => [...prev, { type: 'assistant', text: `[error] ${e?.message || e}`, at: Date.now() }]);
    } finally { setBusy(false); }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1, padding: '4px 6px', background: '#3c3c3c', border: '1px solid #555',
    color: '#e5e7eb', borderRadius: 2, fontSize: 11,
  };
  const btnBase: React.CSSProperties = {
    padding: '4px 12px', color: '#fff', border: 'none', borderRadius: 2, fontSize: 11,
  };
  const btnPrimary: React.CSSProperties = { ...btnBase, background: busy || !input.trim() ? '#555' : '#0e639c', cursor: busy || !input.trim() ? 'not-allowed' : 'pointer' };

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: 'system-ui, sans-serif', color: '#e5e7eb', background: '#1e1e1e' }}>
      <div style={{ width: 160, borderRight: '1px solid #333', background: '#252526', overflow: 'auto' }}>
        <div style={{ padding: 6, fontSize: 10, fontWeight: 600, color: '#888', borderBottom: '1px solid #333' }}>
          {brand?.nameZh || 'Chat'} ({sessions.length})
        </div>
        <button
          onClick={createSession}
          style={{ width: '100%', padding: 5, background: '#0e639c', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 11 }}
        >
          + 新建
        </button>
        {sessions.slice(0, 50).map((s) => (
          <div
            key={s.id}
            onClick={() => setCurrentId(s.id)}
            style={{
              padding: '4px 6px', fontSize: 10, cursor: 'pointer',
              background: currentId === s.id ? '#094771' : 'transparent',
              borderBottom: '1px solid #2a2a2a', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
            title={s.id}
          >
            {s.title || s.slug || s.id.slice(0, 12)}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '5px 8px', borderBottom: '1px solid #333', fontSize: 10, color: '#888' }}>
          {currentId ? `session: ${currentId.slice(0, 24)}...` : (brand?.greeting || 'hi')}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          {messages.length === 0 && !currentId && (
            <div style={{ color: '#666', textAlign: 'center', marginTop: 30, fontSize: 11 }}>
              {brand?.greeting || '新建会话开始'}
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                marginBottom: 4, padding: 5,
                background: m.type === 'user' ? '#094771' : '#2a2d2e',
                borderRadius: 3, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}
            >
              <div style={{ fontSize: 8, color: '#888', marginBottom: 2 }}>
                {m.type === 'user' ? '你' : (brand?.nameZh || 'AI')} · {new Date(m.at).toLocaleTimeString()}
              </div>
              {m.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        <div style={{ display: 'flex', borderTop: '1px solid #333', padding: 5, gap: 5 }}>
          <input
            value={input}
            onChange={(e) => setInput((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder={currentId ? 'Enter 发送' : '先选会话'}
            disabled={!currentId || busy}
            style={inputStyle}
          />
          <button
            onClick={sendMessage}
            disabled={!currentId || busy || !input.trim()}
            style={btnPrimary}
          >
            {busy ? '...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
};

// view id 'chat-panel' → module.exports['chat-panel'], 供 browserViews 取组件
export { ChatView as 'chat-panel' };
