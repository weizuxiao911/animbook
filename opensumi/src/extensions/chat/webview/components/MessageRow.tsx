import React, { useState } from 'react';
import { PartRenderer } from '../parts/PartRenderer';
import { getQuestionStore, extractText, formatDuration, type Row } from '../helpers';

export const MessageRow: React.FC<{
  row: Row;
  streaming: boolean;
  sessionID: string;
  onReplyQuestion: (sid: string, rid: string, answers: string[][]) => Promise<void>;
}> = ({ row, streaming, sessionID, onReplyQuestion }) => {
  const [hover, setHover] = useState(false);
  if (row.role === 'user') {
    const text = extractText(row.parts);
    const copy = () => navigator.clipboard?.writeText(text);
    return (
      <div
        className="chat__msg is-user"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div className="chat__msg-user-col">
          <div className="chat__msg-bubble is-user">{text}</div>
          <div className={`chat__msg-meta is-user${hover ? ' is-visible' : ''}`}>
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
  const start = stepFinish?.time?.start;
  const end = stepFinish?.time?.end;
  const duration = formatDuration(start, end);
  const textParts = row.parts?.filter((p: any) => p?.type === 'text') || [];
  const fullText = textParts.map((p: any) => p.text).join('\n');
  const copy = () => navigator.clipboard?.writeText(fullText);

  return (
    <div
      className="chat__msg is-assistant"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="chat__msg-body">
        {(row.parts || []).map((part: any, i: number) => {
          const questionMeta = part?.type === 'tool' && part?.tool === 'question'
            ? getQuestionStore().get(part.id) : null;
          return (
            <PartRenderer
              key={part.id || i}
              part={part}
              streaming={streaming}
              sessionID={sessionID}
              onReply={onReplyQuestion}
              preferredQuestionRequestID={questionMeta?.requestID}
            />
          );
        })}
        <div className={`chat__msg-meta is-assistant${hover ? ' is-visible' : ''}`}>
          <button className="chat__msg-copy" onClick={copy} title="复制">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          {modelID && <span className="chat__msg-model">{modelID}</span>}
          {duration && <>
            <span className="chat__msg-sep">·</span>
            <span className="chat__msg-duration">{duration}</span>
          </>}
        </div>
      </div>
    </div>
  );
};