/**
 * 常量 + helpers — extensions/chat/webview/helpers.ts
 * UI 不变, 仅搬迁位置 (类型/常量/纯函数, 无 hooks).
 */

import { extractAssistantTodos } from './parts/TodoCard';

export interface Row {
  id: string;
  role: 'user' | 'assistant';
  parts: any[];
  error?: any;
}

export const HIDDEN_AGENTS = new Set(['compaction', 'title', 'summary']);

export const AGENT_ICONS: Record<string, string> = {
  build: '🔨',
  plan: '🗺',
  general: '✨',
  explore: '🔭',
};

export const AGENT_DESC: Record<string, string> = {
  build: '执行任务 · 文件操作 · 命令执行',
  plan: '规划方案 · 任务拆解 (只读工具)',
  general: '通用问答 · 多步任务并行执行',
  explore: '信息检索 · 上下文探索',
};

export const CLIENT_COMMANDS: Array<{ cmd: string; desc: string; hint?: string }> = [
  { cmd: 'model',    desc: '切换模型', hint: '打开模型选择' },
  { cmd: 'connect',  desc: '模型管理', hint: '搜索服务商 · 输入 API Key 连接' },
  { cmd: 'compact',  desc: '压缩当前会话上下文', hint: 'AI summary, 释放 tokens' },
  { cmd: 'clear',    desc: '清空当前会话消息', hint: '保留会话 ID' },
  { cmd: 'copy',     desc: '复制会话全文到剪贴板', hint: 'markdown 格式' },
  { cmd: 'share',    desc: '生成并复制可分享链接', hint: '公开只读 URL' },
  { cmd: 'unshare',  desc: '取消当前会话分享链接', hint: '' },
  { cmd: 'export',   desc: '导出会话为 .md 文件', hint: '下载到本地' },
  { cmd: 'help',     desc: '快捷键与命令面板帮助', hint: '' },
];

export function findCurrentTodos(parts: any[]): Array<{ content: string; status: string; priority?: string }> {
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

export function extractText(parts: any[] | undefined): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p: any) => p?.type === 'text' && !p?.synthetic && !p?.ignored)
    .map((p: any) => p.text || '')
    .join('');
}

export function formatDuration(start?: number, end?: number): string {
  if (!start || !end) return '';
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 100) / 10;
  return `${sec}秒`;
}

const questionStore = new Map<string, { requestID: string; questions: any[] }>();
const questionSubscribers = new Set<() => void>();

export function notifyQuestionChange() { questionSubscribers.forEach((fn) => fn()); }

export function getQuestionStore(): Map<string, { requestID: string; questions: any[] }> {
  return questionStore;
}

export function subscribeQuestionChange(fn: () => void): () => void {
  questionSubscribers.add(fn);
  return () => { questionSubscribers.delete(fn); };
}