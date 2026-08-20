import React from 'react';
import { PartRenderer } from '../parts/PartRenderer';
import { getQuestionStore, extractText, formatDuration, type Row } from '../helpers';

export const MessageRow: React.FC<{
  row: Row;
  streaming: boolean;
  done?: boolean;
  sessionID: string;
  onReplyQuestion: (sid: string, rid: string, answers: string[][]) => Promise<void>;
}> = ({ row, streaming, done, sessionID, onReplyQuestion }) => {
  if (row.role === 'user') {
    const text = extractText(row.parts);
    const copy = () => navigator.clipboard?.writeText(text);
    return (
      <div className="chat__msg is-user">
        <div className="chat__msg-user-col">
          <div className="chat__msg-bubble is-user">{text}</div>
          <div className="chat__msg-meta is-user">
            <button className="chat__msg-copy" onClick={copy} title="复制">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const stepFinish = row.parts?.find((p: any) => p?.type === 'step-finish');
  const modelID = stepFinish?.modelID
    || row.parts?.find((p: any) => p?.type === 'text' && p?.modelID)?.modelID
    || '';
  // 耗时: 优先 step-finish time, 回退到消息 info.time (created→completed)
  const start = stepFinish?.time?.start ?? row.time?.created;
  const end = stepFinish?.time?.end ?? row.time?.completed;
  const duration = formatDuration(start, end);
  const tokens = stepFinish?.tokens?.total;
  const cost = stepFinish?.cost;
  const textParts = row.parts?.filter((p: any) => p?.type === 'text') || [];
  const fullText = textParts.map((p: any) => p.text).join('\n');
  const copy = () => navigator.clipboard?.writeText(fullText);

  return (
    <div className="chat__msg is-assistant">
      <div className="chat__msg-body">
        {(row.parts || []).map((part: any, i: number) => {
          const questionMeta = part?.type === 'tool' && part?.tool === 'question'
            ? getQuestionStore().get(sessionID) : null;
          return (
            <PartRenderer
              key={part.id || i}
              part={part}
              streaming={streaming}
              done={done}
              sessionID={sessionID}
              onReply={onReplyQuestion}
              preferredQuestionRequestID={questionMeta?.requestID}
            />
          );
        })}
        <div className="chat__msg-meta is-assistant">
          <button className="chat__msg-copy" onClick={copy} title="复制">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          {modelID && <span className="chat__msg-model">{modelID}</span>}
          {duration && <>
            <span className="chat__msg-sep">·</span>
            <span className="chat__msg-duration">{duration}</span>
          </>}
          {typeof tokens === 'number' && tokens > 0 && <>
            <span className="chat__msg-sep">·</span>
            <span className="chat__msg-duration">{tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tokens</span>
          </>}
          {typeof cost === 'number' && cost > 0 && <>
            <span className="chat__msg-sep">·</span>
            <span className="chat__msg-duration">${cost.toFixed(4)}</span>
          </>}
        </div>
      </div>
    </div>
  );
};