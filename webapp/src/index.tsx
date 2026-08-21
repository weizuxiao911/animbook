import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import { installRegistryMetadata } from './services/registry';
import { installOpencodeClient } from './services/opencode-sdk';
import { getWorkspaceDirSync } from './services/workspace';
import { installFsApi } from './services/fs';
import { APP_CHAT_CONFIG } from './config/brand';
import './styles/overrides.css';

(window as any).React = React;

// webapp 容器全局配置 — 给 vsix 用的"如何连 backend / 走什么环境"等元信息
// vsix 通过 window.__APP_CONFIG__.opencodeUrl 拿到 baseUrl, 自己 import @opencode-ai/sdk 创建 client
// chatConfig 为全局 Chat 配置 (品牌 + 建议卡片), 拓展只读这里, 不直接 import @/config/brand
// workspaceDir: 优先用 opencode 实际 cwd (从 /api/path 拿), 拿不到则用 /workspace (Codeblitz 默认虚拟工作区)
const config: any = {
  opencodeUrl: '/api',
  registryUrl: '/extensions',
  deployEnv: 'development',
  workspaceDir: '/workspace',
  theme: 'opensumi-design-dark-theme',
  chatConfig: APP_CHAT_CONFIG,
};
(window as any).__APP_CONFIG__ = config;
console.log('[webapp] __APP_CONFIG__ 挂载 (workspaceDir=/workspace 临时):', config);

// 启动期: 先装 opencode client (单一实例) + fs api (浏览器侧访问面),
// 再拉 registry VSIX 元数据 → 填充 window.__APP_REGISTRY_METADATA__.
// 同时预取 opencode 实际 cwd (/api/path), 把 workspaceDir 改成真实路径,
// 让 Codeblitz/Explorer 显示的根目录与 opencode cwd 一致 (避免 file://workspace/workspace/ 与 opencode 不对应).
installOpencodeClient();
installFsApi();

(async () => {
  // 预取 opencode cwd (短超时, 拿不到也不卡首屏)
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch('/api/path', { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) {
      const d = await r.json();
      if (d?.directory) {
        config.workspaceDir = d.directory;
        console.log('[webapp] workspaceDir → opencode cwd:', d.directory);
      }
    }
  } catch (e) { /* opencode 还没起或超时, 保持 /workspace */ }

  // 兜底: 同步获取已缓存的 workspaceDir (services/workspace.ts 启动时已 fetch 过)
  const syncDir = getWorkspaceDirSync();
  if (syncDir) {
    config.workspaceDir = syncDir;
    console.log('[webapp] workspaceDir → syncDir:', syncDir);
  }

  void installRegistryMetadata().finally(() => {
    // Error boundary 暴露 App 内部真实错误(避免 React 静默吞掉)
    const ErrorFallback = () => {
      return React.createElement(
        'div',
        {
          style: { padding: 24, color: '#f88', fontFamily: 'monospace', background: '#1e1e1e', height: '100vh', overflow: 'auto' },
          dangerouslySetInnerHTML: { __html: (window as any).__APP_LAST_ERROR__ || 'App 未渲染' },
        },
        null
      );
    };

    class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
      state = { error: null };
      static getDerivedStateFromError(error: Error) { return { error }; }
      componentDidCatch(error: Error, info: any) {
        (window as any).__APP_LAST_ERROR__ = `${error.message}\n\n${error.stack || ''}\n\n${JSON.stringify(info)}`;
        console.error('[webapp] App crashed:', error, info);
      }
      render() {
        if (this.state.error) return React.createElement(ErrorFallback);
        return this.props.children;
      }
    }

    const container = document.getElementById('root');
    if (!container) {
      throw new Error('Root container #root not found');
    }

    const root = ReactDOM.createRoot(container);
    root.render(
      React.createElement(
        ErrorBoundary,
        null,
        React.createElement(App)
      )
    );
  });
})();
