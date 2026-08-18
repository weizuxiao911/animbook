import React, { useState, useMemo } from 'react';

function safeStringify(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

const TOOL_ICON: Record<string, string> = {
  bash: '⌘',
  read: '📖',
  write: '✎',
  edit: '✎',
  glob: '🔍',
  grep: '🔍',
  list: '📁',
  webfetch: '🌐',
  task: '🤖',
  subagent: '🤖',
  todowrite: '✓',
  question: '?',
};

function summarize(tool: string, input: any, output: any): string {
  if (tool === 'bash' && input?.command) {
    return String(input.command);
  }
  if (tool === 'read' && input?.filePath) return `read ${input.filePath}`;
  if (tool === 'write' && input?.filePath) return `write ${input.filePath}`;
  if (tool === 'edit' && input?.filePath) return `edit ${input.filePath}`;
  if (tool === 'glob' && input?.pattern) return `glob ${input.pattern}`;
  if (tool === 'grep' && input?.pattern) return `grep ${input.pattern}`;
  if (tool === 'webfetch' && input?.url) return `fetch ${input.url}`;
  if (input?.description) return String(input.description);
  return tool;
}

/** OpenCode 风格工具调用卡片: [Shell] 图标 + 命令 + 展开箭头 + 折叠输出 */
export const ToolView: React.FC<{ part: any }> = ({ part }) => {
  const tool: string = part?.tool || 'tool';
  const status: string = part?.state?.status || 'pending';
  const input = part?.state?.input;
  const output = part?.state?.output;
  const error = part?.state?.error;
  const [open, setOpen] = useState(false);

  const inStr = useMemo(() => safeStringify(input), [input]);
  const outStr = useMemo(() => safeStringify(output), [output]);
  const errStr = useMemo(() => safeStringify(error), [error]);
  const summary = useMemo(() => summarize(tool, input, output), [tool, input, output]);

  const icon = TOOL_ICON[tool] || '⚙';
  const displayName = tool === 'bash' ? 'Shell' : tool;

  return (
    <div className={`tc-tool is-${status}`}>
      <button type="button" className="tc-tool__head" onClick={() => setOpen((v) => !v)}>
        <span className={`tc-tool__icon is-${status}`}>{icon}</span>
        <span className="tc-tool__name">{displayName}</span>
        <span className="tc-tool__summary">{summary}</span>
        <span className="tc-tool__caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="tc-tool__body">
          {outStr && (
            <div className="tc-tool__section">
              <pre>{outStr.slice(0, 4000)}</pre>
            </div>
          )}
          {!outStr && inStr && (
            <div className="tc-tool__section">
              <pre>{inStr.slice(0, 2000)}</pre>
            </div>
          )}
          {errStr && (
            <div className="tc-tool__section is-error">
              <pre>{errStr}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
