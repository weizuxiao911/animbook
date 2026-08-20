/**
 * OpenCode SDK 客户端封装 — services/opencode-sdk.ts
 *
 * webapp 单一全局入口: baseUrl 走相对路径 `/api`, dev 由 webpack-dev-server
 * 代理 `/api/*` 到 127.0.0.1:24096, 生产由部署方自行配置反向代理.
 * 启动期同步创建 + 挂 window 全局 (__WEBAPP_OPENCODE__), 供内置 UI / vsix 走 SDK.
 *
 * 由用户提供一个运行中的 opencode 实例 (默认 127.0.0.1:24096) 即可使用.
 *
 * 暴露:
 *   - 同步创建 + window.__WEBAPP_OPENCODE__ 全局访问点
 *   - getOpencodeClient() / isOpencodeReady() / waitForOpencodeReady() / disposeOpencodeClient()
 *
 * 错误策略:
 *   - 创建后访问失败: 由调用方决定重试 (本文件不发起任何重试, 不阻塞 UI)
 */

import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client';

const BASE_URL = '/api';

let _client: OpencodeClient | null = null;
let _baseUrl: string | null = null;
let _installHandlersAttached = false;

function build(baseUrl: string): OpencodeClient {
  return createOpencodeClient({
    baseUrl,
    responseStyle: 'fields',
    throwOnError: true,
  });
}

/**
 * 同步获取 SDK 客户端 — 启动期 installOpencodeClient() 已创建, 这里直接返回缓存.
 * 若未启动, 现场构建.
 */
export function getOpencodeClient(): OpencodeClient {
  if (_client && _baseUrl) return _client;
  _baseUrl = BASE_URL;
  _client = build(_baseUrl);
  (window as any).__WEBAPP_OPENCODE__ = _client;
  (window as any).__WEBAPP_OPENCODE_RUNTIME__ = {
    baseUrl: _baseUrl,
    runtimeId: 'webapp-static',
    userId: 'webapp',
    tenantId: 'webapp',
    deployEnv: 'development',
  };
  return _client;
}

export function isOpencodeReady(): boolean {
  return _client !== null;
}

/**
 * 等待 SDK client 就绪 (webapp 启动期同步创建, 实际是同步; 保留 polling 接口形态以兼容上层).
 */
export async function waitForOpencodeReady(timeoutMs = 8000): Promise<void> {
  if (isOpencodeReady()) return;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (isOpencodeReady()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`opencode client not ready within ${timeoutMs}ms`);
}

export function disposeOpencodeClient(): void {
  _client = null;
  _baseUrl = null;
  delete (window as any).__WEBAPP_OPENCODE__;
  delete (window as any).__WEBAPP_OPENCODE_RUNTIME__;
}

/**
 * 安装 SDK 客户端 — 启动期调用一次:
 *   - 同步创建 SDK 实例 (baseUrl = '/api', dev 由 webpack-dev-server 代理到 127.0.0.1:24096)
 *   - 派发 webapp 内统一 ready 事件 (webapp:opencode-ready / webapp:sandbox-ready)
 *   - 暴露 window.__WEBAPP_OPENCODE__
 */
export function installOpencodeClient(): () => void {
  if (_installHandlersAttached) {
    return () => {};
  }
  _installHandlersAttached = true;

  try {
    getOpencodeClient();
  } catch (err) {
    console.error('[opencode] 启动期 SDK 创建失败:', err);
    // 不抛, 让 UI 渲染并显示未就绪提示
  }

  // 派发 ready 事件 (兼容历史监听者: assistant/webview 等)
  window.dispatchEvent(new CustomEvent('webapp:opencode-ready'));
  window.dispatchEvent(new CustomEvent('webapp:sandbox-ready'));

  return () => {
    disposeOpencodeClient();
    _installHandlersAttached = false;
  };
}
