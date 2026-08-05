import React, { useEffect, useMemo, useRef, useState } from 'react';
import { modelPrefs } from '../../commands/modelPrefs';
import {
  aiConnectProvider,
  aiListProviders,
  type ProviderInfo,
} from '../../commands/api';

interface ModelInfo {
  id: string;
  providerID: string;
  name: string;
  family?: string;
  providerName?: string;
  free?: boolean;
}

interface Props {
  models: ModelInfo[];
  currentModel: string;
  onSelect: (modelID: string) => void;
  onClose: () => void;
  /** 模型列表 / 提供商列表发生变化后通知父组件刷新 */
  onProvidersChanged?: () => void;
}

type View =
  | { kind: 'select' }
  | { kind: 'manage' }
  | { kind: 'providers' }
  | { kind: 'apikey'; provider: ProviderInfo };

/**
 * 模型选择 / 管理 / 连接提供商 弹层
 *
 * 所有视图统一为居中全局模态框 + 半透明遮罩:
 *   1. select     — 模型选择 (按 provider 分组, 底部 "管理模型" 入口)
 *   2. manage     — 管理模型 (每个 provider 一个分组, toggle 模型可见性, 右上 "连接提供商")
 *   3. providers  — 连接提供商 (搜索/选择 catalog 中的 provider)
 *   4. apikey     — 输入 API Key, 调 auth.set 连接
 */
export const ModelPicker: React.FC<Props> = ({
  models, currentModel, onSelect, onClose, onProvidersChanged,
}) => {
  const [view, setView] = useState<View>({ kind: 'select' });
  const [query, setQuery] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [allProviders, setAllProviders] = useState<ProviderInfo[] | null>(null);
  const [, forceTick] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  // 本地隐藏偏好 (modelPrefs 变更后强制重渲染)
  useEffect(() => {
    const handler = () => forceTick((n) => n + 1);
    window.addEventListener('animbook:ai-modelPrefs-changed', handler);
    return () => window.removeEventListener('animbook:ai-modelPrefs-changed', handler);
  }, []);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 切换视图时聚焦合适的输入框
  useEffect(() => {
    const t = setTimeout(() => {
      if (view.kind === 'apikey') keyRef.current?.focus();
      else searchRef.current?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [view.kind]);

  const prefs = modelPrefs.get();

  // ========== 视图: select (模型选择, 按 provider 分组) ==========
  const selectGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = models
      .filter((m) => !prefs.hidden.includes(m.id))
      .filter((m) => {
        if (!q) return true;
        return (
          m.id.toLowerCase().includes(q)
          || (m.name || '').toLowerCase().includes(q)
          || (m.providerID || '').toLowerCase().includes(q)
          || (m.providerName || '').toLowerCase().includes(q)
        );
      })
      .map((m) => ({ ...m, name: prefs.customNames[m.id] || m.name }));
    const map = new Map<string, { label: string; items: ModelInfo[] }>();
    for (const m of visible) {
      const pid = m.providerID || 'other';
      const label = prefs.providerLabels[pid] || m.providerName || pid;
      if (!map.has(pid)) map.set(pid, { label, items: [] });
      map.get(pid)!.items.push(m);
    }
    return Array.from(map.entries()).map(([pid, g]) => ({ pid, ...g }));
  }, [models, query, prefs]);

  // ========== 视图: manage (管理模型, 每个 provider 一个分组) ==========
  const manageGroups = useMemo(() => {
    type M = { id: string; name: string; visible: boolean };
    type G = { pid: string; label: string; items: M[] };
    const byProvider = new Map<string, G>();
    for (const m of models) {
      const pid = m.providerID || 'other';
      if (!byProvider.has(pid)) {
        byProvider.set(pid, {
          pid,
          label: prefs.providerLabels[pid] || m.providerName || pid,
          items: [],
        });
      }
      byProvider.get(pid)!.items.push({
        id: m.id,
        name: prefs.customNames[m.id] || m.name || m.id,
        visible: !prefs.hidden.includes(m.id),
      });
    }
    return Array.from(byProvider.values());
  }, [models, prefs]);

  // ========== 视图: providers (连接提供商, 带搜索) ==========
  const filteredCatalog = useMemo(() => {
    const list = allProviders || [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? list.filter((p) => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      : list;
    return [...filtered].sort((a, b) => Number(!!b.connected) - Number(!!a.connected));
  }, [allProviders, query]);

  const openProviders = async () => {
    setView({ kind: 'providers' });
    setQuery('');
    setError('');
    if (allProviders) return;
    try {
      const list = await aiListProviders();
      setAllProviders(list);
    } catch (e) {
      setError(String((e as any)?.message || e));
    }
  };

  const toggleModel = (id: string) => {
    modelPrefs.toggleHidden(id);
  };

  const submitApiKey = async () => {
    if (view.kind !== 'apikey') return;
    const key = apiKey.trim();
    if (!key) return;
    setConnecting(true);
    setError('');
    try {
      await aiConnectProvider(view.provider.id, key);
      onProvidersChanged?.();
      setAllProviders(null);
      setView({ kind: 'manage' });
      setApiKey('');
    } catch (e) {
      setError(String((e as any)?.message || e));
    } finally {
      setConnecting(false);
    }
  };

  const widthClass =
    view.kind === 'manage' || view.kind === 'providers' || view.kind === 'apikey'
      ? 'tc-ai__modal--wide'
      : 'tc-ai__modal--narrow';

  return (
    <div
      className="tc-ai__modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`tc-ai__modal ${widthClass}`} role="dialog" aria-modal="true">
        {view.kind === 'select' && (
          <>
            <div className="tc-ai__modal-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索模型"
              />
            </div>

            <div className="tc-ai__modal-body">
              {selectGroups.length === 0 && (
                <div className="tc-ai__modal-empty">无匹配模型</div>
              )}
              {selectGroups.map((g) => (
                <div key={g.pid} className="tc-ai__modal-group">
                  <div className="tc-ai__modal-group-title">{g.label}</div>
                  {g.items.map((m) => {
                    const active = currentModel === m.id;
                    return (
                      <button
                        key={`${m.providerID}::${m.id}`}
                        type="button"
                        className={`tc-ai__modal-item${active ? ' is-active' : ''}`}
                        onClick={() => onSelect(m.id)}
                      >
                        <span className="tc-ai__modal-item-name">{m.name || m.id}</span>
                        {m.free && <span className="tc-ai__modal-tag">免费</span>}
                        {active && (
                          <svg className="tc-ai__modal-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <button
              type="button"
              className="tc-ai__modal-foot"
              onClick={() => { setView({ kind: 'manage' }); setQuery(''); }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              <span>管理模型</span>
            </button>
          </>
        )}

        {view.kind === 'manage' && (
          <>
            <div className="tc-ai__modal-header">
              <div className="tc-ai__modal-header-text">
                <div className="tc-ai__modal-title">管理模型</div>
                <div className="tc-ai__modal-subtitle">自定义模型选择器中显示的模型。</div>
              </div>
              <button type="button" className="tc-ai__modal-btn-primary" onClick={openProviders}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                连接提供商
              </button>
            </div>

            <div className="tc-ai__modal-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索模型"
              />
            </div>

            <div className="tc-ai__modal-body">
              {error && <div className="tc-ai__modal-error">{error}</div>}
              {manageGroups.length === 0 && (
                <div className="tc-ai__modal-empty">暂不可用模型，点击右上角连接提供商。</div>
              )}
              {manageGroups.map((g) => (
                <div key={g.pid} className="tc-ai__modal-mgroup">
                  <div className="tc-ai__modal-mgroup-head">
                    <span className="tc-ai__modal-mgroup-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 4h6v6H4z"/>
                        <path d="M14 4h6v6h-6z"/>
                        <path d="M4 14h6v6H4z"/>
                        <path d="M14 14h6v6h-6z"/>
                      </svg>
                    </span>
                    <span className="tc-ai__modal-mgroup-title">{g.label}</span>
                  </div>
                  <div className="tc-ai__modal-mgroup-body">
                    {g.items.map((m) => (
                      <label key={m.id} className="tc-ai__modal-modelrow">
                        <span className="tc-ai__modal-modelrow-name">{m.name}</span>
                        <Switch checked={m.visible} onChange={() => toggleModel(m.id)} />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {view.kind === 'providers' && (
          <>
            <div className="tc-ai__modal-header tc-ai__modal-header--page">
              <button
                type="button"
                className="tc-ai__modal-back"
                onClick={() => setView({ kind: 'manage' })}
                title="返回"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <div className="tc-ai__modal-title">连接提供商</div>
            </div>

            <div className="tc-ai__modal-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索提供商"
              />
            </div>

            <div className="tc-ai__modal-body">
              {error && <div className="tc-ai__modal-error">{error}</div>}
              {!allProviders && <div className="tc-ai__modal-empty">加载提供商列表中…</div>}
              {allProviders && filteredCatalog.length === 0 && (
                <div className="tc-ai__modal-empty">无匹配提供商</div>
              )}
              {allProviders && filteredCatalog.length > 0 && (
                <div className="tc-ai__modal-cat">
                  <div className="tc-ai__modal-cat-title">其他</div>
                  {filteredCatalog.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`tc-ai__modal-catrow${p.connected ? ' is-connected' : ''}`}
                      onClick={() => { setView({ kind: 'apikey', provider: p }); setApiKey(''); setError(''); }}
                    >
                      <span className="tc-ai__modal-caticon" aria-hidden="true">
                        {p.public
                          ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z"/></svg>
                          : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 12a10 10 0 0 1 20 0"/>
                              <path d="M5 12a7 7 0 0 1 14 0"/>
                              <path d="M8 12a4 4 0 0 1 8 0"/>
                              <circle cx="12" cy="12" r="1"/>
                            </svg>}
                      </span>
                      <span className="tc-ai__modal-catname">{p.name} ({p.id})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {view.kind === 'apikey' && (
          <>
            <div className="tc-ai__modal-header tc-ai__modal-header--page">
              <button
                type="button"
                className="tc-ai__modal-back"
                onClick={() => { setView({ kind: 'providers' }); setApiKey(''); setError(''); }}
                title="返回"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <div className="tc-ai__modal-title">
                <span className="tc-ai__modal-title-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z"/></svg>
                </span>
                连接 {view.provider.name} ({view.provider.id})
              </div>
            </div>

            <div className="tc-ai__modal-body tc-ai__modal-body--apikey">
              {error && <div className="tc-ai__modal-error">{error}</div>}
              <p className="tc-ai__modal-apikey-desc">
                输入你的 {view.provider.name} ({view.provider.id}) API 密钥以连接账户，并在 animbook 中使用 {view.provider.name} ({view.provider.id}) 模型。
              </p>
              <label className="tc-ai__modal-apikey-label">
                {view.provider.name} ({view.provider.id}) API 密钥
              </label>
              <input
                ref={keyRef}
                type="password"
                className="tc-ai__modal-apikey-input"
                placeholder="API 密钥"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submitApiKey(); }}
              />
              <div className="tc-ai__modal-apikey-actions">
                <button
                  type="button"
                  className="tc-ai__modal-btn-continue"
                  onClick={submitApiKey}
                  disabled={connecting || !apiKey.trim()}
                >
                  {connecting ? '连接中…' : '继续'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/** iOS 风格 toggle switch */
const Switch: React.FC<{ checked: boolean; onChange: () => void }> = ({ checked, onChange }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`tc-ai__switch${checked ? ' is-on' : ''}`}
      onClick={(e) => { e.preventDefault(); onChange(); }}
    >
      <span className="tc-ai__switch-knob" />
    </button>
  );
};
