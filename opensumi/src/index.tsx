import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import { installOpencodeClient } from './_legacy/commands/sandbox';
import { installFsApi } from './_legacy/commands/fs';

(window as any).React = React;

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found');
}

// 启动期同步创建 OpenCode SDK 客户端 (baseUrl = '/ai', dev 由 webpack-dev-server
// 代理到 127.0.0.1:4096). 必须早于 App 渲染.
installOpencodeClient();
// 挂 window.__ANIMBOOK_FS_API__ (Chat 等非 OpenSumi 模块使用).
// 工作区目录在首次 API 调用时按需 fetch /api/path.
installFsApi();
// OpenSumi 对未知扩展会弹 "异常行终止符" confirm, 我们想自己接管 PDF 打开,
// 这里在第一时间把 confirm 替换成 noop, 避免双弹框; 真正的错误处理在 PDF 组件内.
if (typeof window !== 'undefined') {
  const origConfirm = window.confirm;
  window.confirm = (msg?: string) => {
    // eslint-disable-next-line no-console
    if (msg && /异常的行终止符|unusualLineTerminators/i.test(msg)) {
      // PDF 等二进制被 OpenSumi 当 text 打开时会触发; 静默拒绝, 由 PDF resolver 后续兜底
      return false;
    }
    return origConfirm(msg);
  };
}

ReactDOM.createRoot(container).render(<App />);
