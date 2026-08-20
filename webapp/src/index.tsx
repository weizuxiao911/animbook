import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import { installRegistryMetadata } from './services/registry';
import { installOpencodeClient } from './services/opencode-sdk';
import { installFsApi } from './services/fs';
import { APP_BRAND } from './config/brand';
import './styles/overrides.css';

(window as any).React = React;

// webapp 容器全局配置 — 给 vsix 用的"如何连 backend / 走什么环境"等元信息
// vsix 通过 window.__APP_CONFIG__.opencodeUrl 拿到 baseUrl, 自己 import @opencode-ai/sdk 创建 client
// brand 为全局品牌配置, 拓展只读这里, 不直接 import @/config/brand
const config = {
  opencodeUrl: '/api',
  registryUrl: '/extensions',
  deployEnv: 'development',
  workspaceDir: '/workspace',
  theme: 'opensumi-design-dark-theme',
  brand: APP_BRAND,
};
(window as any).__APP_CONFIG__ = config;
console.log('[webapp] __APP_CONFIG__ 挂载:', config);

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found');
}

// OpenSumi 对未知扩展会弹 "异常行终止符" confirm, 静默掉, 由 PDF 组件内自己处理
if (typeof window !== 'undefined') {
  const origConfirm = window.confirm;
  window.confirm = (msg?: string) => {
    if (msg && /异常的行终止符|unusualLineTerminators/i.test(msg)) {
      return false;
    }
    return origConfirm(msg);
  };
}

// 启动期: 先装 opencode client (单一实例) + fs api (浏览器侧访问面),
// 再拉 registry VSIX 元数据 → 填充 window.__APP_REGISTRY_METADATA__.
// codeblitz AppRenderer 读 extensionMetadata 字段, 走 in-process ext host 加载 vsix.
// 时序: 全局就绪后才 render App.
installOpencodeClient();
installFsApi();
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

  const root = ReactDOM.createRoot(container);
  root.render(
    React.createElement(
      ErrorBoundary,
      null,
      React.createElement(App)
    )
  );
});
