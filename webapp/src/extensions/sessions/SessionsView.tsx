import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useInjectable } from '@opensumi/ide-core-browser/lib/react-hooks/injectable-hooks';
import { SlotLocation } from '@opensumi/ide-core-browser';
import { IMainLayoutService } from '@opensumi/ide-main-layout/lib/common';

import {
  aiCreateSession,
  aiDeleteSession,
  aiListSessions,
  isAiReady,
} from '../chat/commands/api';

/**
 * SessionsView — webapp 入口面板 (左侧第一个活动栏图标)
 *
 * 设计定位 (与 WorkBuddy 完全不同):
 *   webapp = opencode AI 客户端 + 浏览器 IDE. 左侧入口不做"团队/空间分组",
 *   而是 webapp 自身能力的快速跳转 + 真实 AI 会话历史.
 *
 *   - 顶部 brand + 当前工作空间 (cwd)
 *   - 主操作: 新建会话 / AI 助手 / 终端 / 文件 — 直接驱动 IDE 槽位切换
 *   - 历史会话: 从 opencode SDK 真实拉取 (session.list), 一键切换/删除
 *   - 底部: opencode 连接状态 + 工作空间目录
 *
 * 事件/驱动:
 *   - 新建/选择: aiCreateSession() → 派发 webapp:ai-select-session → Chat 监听并切换
 *   - AI/终端/文件: IMainLayoutService.toggleSlot + updateCurrentContainerId
 *
 * 数据源: opencode SDK (单一真实来源), 不维护本地副本.
 */

export interface SessionsViewProps {
  onActivateAi?: () => void;
  onActivateTerminal?: () => void;
  onActivateExplorer?: () => void;
}

export const SessionsView: React.FC<SessionsViewProps> = (props) => {
  const layoutService = useInjectable<IMainLayoutService>(IMainLayoutService);

  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(isAiReady());
  const [error, setError] = useState<string>('');
  const [busyId, setBusyId] = useState<string>('');
  const reqRef = useRef(0);

  const refresh = useCallback(async () => {
    const myReq = ++reqRef.current;
    if (!isAiReady()) {
      setReady(false);
      setSessions([]);
      return;
    }
    setReady(true);
    setLoading(true);
    setError('');
    try {
      const list = await aiListSessions();
      if (myReq !== reqRef.current) return;
      setSessions(Array.isArray(list) ? list : []);
    } catch (e) {
      if (myReq !== reqRef.current) return;
      setError(String((e as any)?.message || e));
      setSessions([]);
    } finally {
      if (myReq === reqRef.current) setLoading(false);
    }
  }, []);

  // 启动后立即拉一次, 后续每隔 30s 轮询 (opencode 写入新会话后能在面板看到)
  useEffect(() => {
    void refresh();
    const t = setInterval(() => { void refresh(); }, 30000);
    const onReady = () => { void refresh(); };
    window.addEventListener('webapp:opencode-ready', onReady);
    const onAiRefresh = () => { void refresh(); };
    window.addEventListener('webapp:ai-sessions-changed', onAiRefresh);
    return () => {
      clearInterval(t);
      window.removeEventListener('webapp:opencode-ready', onReady);
      window.removeEventListener('webapp:ai-sessions-changed', onAiRefresh);
    };
  }, [refresh]);

  const showRight = useCallback((containerId?: string) => {
    layoutService.toggleSlot(SlotLocation.right, true);
    if (containerId) {
      const svc = layoutService.getTabbarService(SlotLocation.right);
      if (svc.containersMap.has(containerId)) {
        svc.updateCurrentContainerId(containerId);
      }
    }
  }, [layoutService]);

  const selectSession = useCallback((sessionID: string) => {
    showRight('chat-panel');
    window.dispatchEvent(
      new CustomEvent('webapp:ai-select-session', { detail: { sessionID } }),
    );
  }, [showRight]);

  const onNewSession = useCallback(async () => {
    if (busyId === '__new__') return;
    setBusyId('__new__');
    try {
      const id = await aiCreateSession();
      window.dispatchEvent(new CustomEvent('webapp:ai-sessions-changed'));
      selectSession(id);
    } catch (e) {
      setError(String((e as any)?.message || e));
    } finally {
      setBusyId('');
    }
  }, [busyId, selectSession]);

  const onDelete = useCallback(async (sessionID: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (busyId) return;
    if (!window.confirm('删除该会话? 此操作不可撤销。')) return;
    setBusyId(sessionID);
    try {
      await aiDeleteSession(sessionID);
      window.dispatchEvent(new CustomEvent('webapp:ai-sessions-changed'));
      await refresh();
    } catch (err) {
      setError(String((err as any)?.message || err));
    } finally {
      setBusyId('');
    }
  }, [busyId, refresh]);

  return (
    <div className="ab-sessions-root" style={rootStyle}>
      {/* primary actions */}
      <div style={{ padding: '12px 8px 4px 8px' }}>
        <button
          type="button"
          style={primaryBtnStyle}
          onClick={onNewSession}
          disabled={!ready || busyId === '__new__'}
          title="新建 AI 会话"
        >
          <PlusIcon />
          <span>{busyId === '__new__' ? '创建中…' : '新建会话'}</span>
        </button>
      </div>

      {/* sessions list */}
      <div style={listHeaderStyle}>
        <span>历史会话</span>
        <span style={countBadgeStyle}>
          {loading ? '…' : sessions.length}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <IconBtn ariaLabel="刷新会话列表" onClick={() => void refresh()} disabled={loading}>
            <RefreshIcon spinning={loading} />
          </IconBtn>
        </span>
      </div>

      <div className="ab-sessions-scroll" style={listScrollStyle}>
        {!ready && (
          <div style={emptyStyle}>
            <Dot color="var(--errorForeground, var(--vscode-errorForeground, #f87171))" />
            <span>opencode 未就绪</span>
          </div>
        )}
        {ready && error && (
          <div style={{ ...emptyStyle, color: 'var(--errorForeground, var(--vscode-errorForeground, #f87171))' }}>
            <span>{error}</span>
          </div>
        )}
        {ready && !error && sessions.length === 0 && !loading && (
          <div style={emptyStyle}>
            <BubbleTinyIcon />
            <span>暂无 AI 会话</span>
            <span style={{ fontSize: 11, opacity: 0.7 }}>点击上方「新建会话」开始</span>
          </div>
        )}
        {sessions.map((s) => {
          const id = s?.id || s?.sessionID;
          if (!id) return null;
          const title = s?.title || '(未命名会话)';
          const updated = formatRelative(s?.time?.updated || s?.time?.created);
          return (
            <SessionRow
              key={id}
              title={title}
              updated={updated}
              agent={s?.agent}
              model={s?.model?.id}
              disabled={!!busyId}
              onClick={() => selectSession(id)}
              onDelete={(e) => void onDelete(id, e)}
            />
          );
        })}
      </div>

      {/* footer */}
      <div style={footerStyle}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Dot color={ready ? 'var(--terminal-ansiGreen, #22c55e)' : 'var(--errorForeground, var(--vscode-errorForeground, #f87171))'} />
          <span style={{ fontSize: 11 }}>
            {ready ? 'opencode 已连接' : 'opencode 未连接'}
          </span>
        </span>
        <span style={{ fontSize: 11, opacity: 0.65 }}>v0.1</span>
      </div>
    </div>
  );
};

/* ===== sub components ===== */

const SessionRow: React.FC<{
  title: string;
  updated: string;
  agent?: string;
  model?: string;
  disabled: boolean;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}> = ({ title, updated, agent, model, disabled, onClick, onDelete }) => {
  const [hover, setHover] = useState(false);
  const [delHover, setDelHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setDelHover(false); }}
      style={{
        ...sessionRowStyle,
        background: hover ? 'var(--list-hoverBackground, rgba(255,255,255,0.04))' : 'transparent',
      }}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        style={{
          ...sessionBtnStyle,
          cursor: disabled ? 'wait' : 'pointer',
        }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
          <span style={sessionTitleStyle} title={title}>{title}</span>
          <span style={sessionMetaStyle}>
            <span>{updated}</span>
            {agent && <><span style={metaDot}>•</span><span>{agent}</span></>}
            {model && <><span style={metaDot}>•</span><span style={{ fontFamily: 'var(--monaco-font, monospace)' }}>{model}</span></>}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label="删除会话"
        onClick={onDelete}
        onMouseEnter={() => setDelHover(true)}
        onMouseLeave={() => setDelHover(false)}
        disabled={disabled}
        style={{
          ...sessionDelBtnStyle,
          opacity: hover ? 1 : 0,
          pointerEvents: hover ? 'auto' : 'none',
          color: delHover
            ? 'var(--errorForeground, var(--vscode-errorForeground, #f87171))'
            : 'var(--descriptionForeground, var(--vscode-descriptionForeground, #9ca3af))',
          background: delHover
            ? 'color-mix(in srgb, var(--vscode-errorForeground, #f87171) 14%, transparent)'
            : 'transparent',
        }}
        title="删除会话"
      >
        <TrashIcon />
      </button>
    </div>
  );
};

const IconBtn: React.FC<{
  ariaLabel: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}> = ({ ariaLabel, onClick, disabled, active, children }) => {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={disabled}
      style={{
        ...iconBtnStyle,
        opacity: disabled ? 0.4 : (hover || active ? 1 : 0.75),
        cursor: disabled ? 'wait' : 'pointer',
        color: hover ? 'var(--icon-foreground, var(--vscode-icon-foreground, #e5e7eb))' : 'var(--descriptionForeground, var(--vscode-descriptionForeground, #9ca3af))',
        background: hover ? 'var(--list-hoverBackground, rgba(255,255,255,0.06))' : 'transparent',
      }}
    >
      {children}
    </button>
  );
};

const Divider: React.FC = () => null;

/* ===== icons (inline SVG, 不依赖外部库) ===== */

const PlusIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const BubbleTinyIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.45 }}>
    <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-4 3V6a1 1 0 0 1 1-1z" />
  </svg>
);
const RefreshIcon: React.FC<{ spinning?: boolean }> = ({ spinning }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={spinning ? spinStyle : undefined}>
    <polyline points="21 12 21 4 13 4" />
    <path d="M3.5 9A9 9 0 0 1 18.4 5.6L21 8" />
    <polyline points="3 12 3 20 11 20" />
    <path d="M20.5 15A9 9 0 0 1 5.6 18.4L3 16" />
  </svg>
);
const TrashIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
    <path d="M19 6l-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const Dot: React.FC<{ color: string }> = ({ color }) => (
  <span
    aria-hidden
    style={{
      width: 7, height: 7, borderRadius: '50%',
      background: color,
      boxShadow: `0 0 6px ${color}`,
      display: 'inline-block',
      flexShrink: 0,
    }}
  />
);

/* ===== utils ===== */

function formatRelative(ts: number | string | undefined): string {
  if (!ts) return '';
  const t = typeof ts === 'number' ? ts : Number(ts);
  if (!Number.isFinite(t)) return '';
  // opencode time 是毫秒 (time.created / time.updated)
  const now = Date.now();
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}天前`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}个月前`;
  return `${Math.floor(mon / 12)}年前`;
}

/* ===== styles ===== */

const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--tc-surface-muted)',
  color: 'var(--tc-panel-fg)',
  fontFamily: 'inherit',
  overflow: 'hidden',
};

const primaryBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  width: '90%',
  minWidth: '90%',
  maxWidth: '90%',
  margin: '0 auto',
  padding: '10px 12px',
  background: 'var(--button-background, var(--vscode-button-background, #2563eb))',
  color: 'var(--button-foreground, var(--vscode-button-foreground, #fff))',
  border: 'none', borderRadius: 6,
  fontSize: 13.5, fontWeight: 500,
  cursor: 'pointer',
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  margin: '6px 12px',
  background: 'var(--tc-border)',
};

const listHeaderStyle: React.CSSProperties = {
  padding: '14px 14px 6px 14px',
  display: 'flex', alignItems: 'center', gap: 6,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: 'var(--descriptionForeground, var(--vscode-descriptionForeground, #9ca3af))',
};

const countBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  padding: '0 6px',
  borderRadius: 999,
  background: 'var(--badge-background, rgba(255,255,255,0.06))',
  color: 'inherit',
  minWidth: 18,
  textAlign: 'center',
};

const iconBtnStyle: React.CSSProperties = {
  width: 22, height: 22,
  display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  borderRadius: 4,
  color: 'inherit',
};

const listScrollStyle: React.CSSProperties = {
  flex: 1, minHeight: 0,
  padding: '4px 8px 8px 8px',
  overflowY: 'auto',
  scrollbarWidth: 'none',
  display: 'flex', flexDirection: 'column', gap: 2,
};

const emptyStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  gap: 6,
  padding: '20px 12px',
  color: 'var(--descriptionForeground, var(--vscode-descriptionForeground, #9ca3af))',
  fontSize: 12,
};

const sessionRowStyle: React.CSSProperties = {
  position: 'relative',
  borderRadius: 6,
  display: 'flex',
  alignItems: 'stretch',
};

const sessionBtnStyle: React.CSSProperties = {
  flex: 1, minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  background: 'transparent',
  border: 'none',
  color: 'var(--tc-panel-fg)',
  padding: '9px 10px 9px 12px',
  textAlign: 'left',
  font: 'inherit',
};

const sessionTitleStyle: React.CSSProperties = {
  fontSize: 13.5,
  fontWeight: 500,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const sessionMetaStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4,
  fontSize: 11,
  color: 'var(--descriptionForeground, var(--vscode-descriptionForeground, #9ca3af))',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
};

const metaDot: React.CSSProperties = { opacity: 0.6 };

const sessionDelBtnStyle: React.CSSProperties = {
  width: 24, alignSelf: 'stretch',
  display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  color: 'var(--descriptionForeground, var(--vscode-descriptionForeground, #9ca3af))',
  transition: 'opacity 120ms',
};

const footerStyle: React.CSSProperties = {
  padding: '10px 14px',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 6,
  color: 'var(--descriptionForeground, var(--vscode-descriptionForeground, #9ca3af))',
};

const spinStyle: React.CSSProperties = {
  animation: 'ab-spin 0.9s linear infinite',
};
