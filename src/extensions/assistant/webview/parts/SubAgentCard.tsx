import React from 'react';

const STATUS_LABEL: Record<string, string> = {
  pending: '排队中',
  running: '运行中',
  completed: '已完成',
  error: '出错',
  cancelled: '已取消',
};

export const SubAgentCard: React.FC<{ part: any }> = ({ part }) => {
  const status: string = part?.state?.status || 'pending';
  const input = part?.state?.input || {};
  const meta = part?.state?.metadata || {};
  const subId: string = meta.sessionId || meta.sessionID || '';
  const agentName: string = input.agent_name || input.name || input.subagent || input.agent || '子 Agent';
  const description: string = input.description || input.prompt || '';
  const output = part?.state?.output;
  const outputText = typeof output === 'string' ? output : output ? JSON.stringify(output) : '';

  return (
    <div className={`tc-sub is-${status}`}>
      <div className="tc-sub__head">
        <span className={`tc-sub__dot is-${status}`} />
        <span className="tc-sub__name">{agentName}</span>
        <span className="tc-sub__status">{STATUS_LABEL[status] || status}</span>
        {subId && <span className="tc-sub__id">{String(subId).slice(0, 8)}</span>}
      </div>
      {description && (
        <div className="tc-sub__prompt">{String(description).slice(0, 240)}</div>
      )}
      {status === 'completed' && outputText && (
        <details className="tc-sub__out">
          <summary>查看结果</summary>
          <pre>{outputText.slice(0, 2000)}</pre>
        </details>
      )}
    </div>
  );
};
