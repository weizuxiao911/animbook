import React, { useState, useEffect } from 'react';
import { SlotLocation } from '@opensumi/ide-core-browser';
import { useInjectable } from '@opensumi/ide-core-browser/lib/react-hooks/injectable-hooks';
import { IMainLayoutService } from '@opensumi/ide-main-layout/lib/common';
import { PreferenceService } from '@opensumi/ide-core-browser/lib/preferences';
import { PreferenceScope } from '@opensumi/ide-core-common/lib/preferences/preference-scope';

const THEME_DARK = 'opensumi-design-dark-theme';
const THEME_LIGHT = 'opensumi-design-light-theme';
const THEME_KEY = 'general.theme';

/**
 * ActionsView — action 槽位 (top 横条右侧)
 *
 * 3 个布局 toggle: 折叠/展开 左侧栏 / 底部栏 / 右侧栏.
 * 全部走 OpenSumi 原生 toggleSlot (不再手动操作 DOM, 验证原生 right 折叠行为).
 * 无登录/账号按钮 (webapp 独立产品, 无登录态).
 *
 * 参考: 早期实验仓 extensions/actions/ActionsView.tsx (登录/账号被砍).
 */

export const ActionsView: React.FC = () => {
  const layoutService = useInjectable<IMainLayoutService>(IMainLayoutService);
  const preferenceService = useInjectable<PreferenceService>(PreferenceService);
  const [leftVisible, setLeftVisible] = useState(false);
  const [bottomVisible, setBottomVisible] = useState(false);
  const [rightVisible, setRightVisible] = useState(true);
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const current = preferenceService.get<string>(THEME_KEY, THEME_DARK);
    setIsDark(current !== THEME_LIGHT);
    const disposable = preferenceService.onPreferenceChanged((e) => {
      if (e.preferenceName === THEME_KEY) {
        setIsDark(e.newValue !== THEME_LIGHT);
      }
    });
    return () => disposable.dispose?.();
  }, [preferenceService]);

  const toggleTheme = () => {
    const next = isDark ? THEME_LIGHT : THEME_DARK;
    void preferenceService.set(THEME_KEY, next, PreferenceScope.User);
  };

  useEffect(() => {
    // 启动时: 确保 right slot 有激活的面板. OpenSumi 布局缓存可能是
    // { currentId: "", size: 438 } (折叠态但容器占宽) → 刷新后右侧空栏.
    // 延迟到容器注册完再激活 AI 面板.
    let disposed = false;
    const activateRight = () => {
      const rightService = layoutService.getTabbarService(SlotLocation.right);
      if (!rightService.currentContainerId.get()) {
        const first = rightService.containersMap.keys().next().value;
        if (first) {
          rightService.updateCurrentContainerId(first);
        }
      }
    };
    // 多试几次 (容器异步注册)
    for (const delay of [100, 300, 800, 2000]) {
      setTimeout(() => { if (!disposed) activateRight(); }, delay);
    }

    const sync = (slot: string, setter: (v: boolean) => void) => () => {
      setter(layoutService.isVisible(slot));
    };
    const slots = [
      { slot: SlotLocation.left, setter: setLeftVisible },
      { slot: SlotLocation.right, setter: setRightVisible },
      { slot: SlotLocation.bottom, setter: setBottomVisible },
    ];
    const disposables: { dispose(): void }[] = [];
    slots.forEach(({ slot, setter }) => {
      const service = layoutService.getTabbarService(slot);
      const syncFn = sync(slot, setter);
      syncFn();
      disposables.push(service.onCurrentChange(syncFn));
      disposables.push(service.onSizeChange(syncFn));
    });
    return () => {
      disposed = true;
      disposables.forEach((d) => d.dispose());
    };
  }, [layoutService]);

  const toggleLeft = () => layoutService.toggleSlot(SlotLocation.left);
  const toggleBottom = () => layoutService.toggleSlot(SlotLocation.bottom);
  const toggleRight = () => layoutService.toggleSlot(SlotLocation.right);

  const iconBtnStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    background: 'transparent',
    border: 'none',
    color: 'var(--editor-foreground, var(--vscode-editor-foreground, #e5e7eb))',
    cursor: 'pointer',
    borderRadius: 6,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const LeftIcon = ({ filled }: { filled: boolean }) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      {filled ? <rect x="3" y="4" width="6" height="16" fill="currentColor" stroke="none" /> : <line x1="9" y1="4" x2="9" y2="20" />}
    </svg>
  );
  const BottomIcon = ({ filled }: { filled: boolean }) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      {filled ? <rect x="3" y="16" width="18" height="4" fill="currentColor" stroke="none" /> : <line x1="3" y1="16" x2="21" y2="16" />}
    </svg>
  );
  const RightIcon = ({ filled }: { filled: boolean }) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      {filled ? <rect x="15" y="4" width="6" height="16" fill="currentColor" stroke="none" /> : <line x1="15" y1="4" x2="15" y2="20" />}
    </svg>
  );
  const SunIcon = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4.5" />
      <line x1="12" y1="19.5" x2="12" y2="22" />
      <line x1="2" y1="12" x2="4.5" y2="12" />
      <line x1="19.5" y1="12" x2="22" y2="12" />
      <line x1="4.9" y1="4.9" x2="6.7" y2="6.7" />
      <line x1="17.3" y1="17.3" x2="19.1" y2="19.1" />
      <line x1="4.9" y1="19.1" x2="6.7" y2="17.3" />
      <line x1="17.3" y1="6.7" x2="19.1" y2="4.9" />
    </svg>
  );
  const MoonIcon = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" />
    </svg>
  );

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%', height: '100%', padding: '0 8px' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        fontSize: 13, fontWeight: 700, letterSpacing: 0.2,
        color: 'var(--editor-foreground, var(--vscode-editor-foreground, #e5e7eb))',
        paddingLeft: 4, userSelect: 'none',
      }}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 6 L12 18 L19 6" />
        </svg>
        webapp
      </span>
      <span style={{ flex: 1 }} />
      <button type="button" title={isDark ? '切换到浅色主题' : '切换到深色主题'} onClick={toggleTheme} style={iconBtnStyle}>
        {isDark ? <SunIcon /> : <MoonIcon />}
      </button>
      <button type="button" title={leftVisible ? '折叠左侧栏' : '展开左侧栏'} onClick={toggleLeft} style={iconBtnStyle}>
        <LeftIcon filled={leftVisible} />
      </button>
      <button type="button" title={bottomVisible ? '折叠底部栏' : '展开底部栏'} onClick={toggleBottom} style={iconBtnStyle}>
        <BottomIcon filled={bottomVisible} />
      </button>
      <button type="button" title={rightVisible ? '折叠右侧栏' : '展开右侧栏'} onClick={toggleRight} style={iconBtnStyle}>
        <RightIcon filled={rightVisible} />
      </button>
    </div>
  );
};
