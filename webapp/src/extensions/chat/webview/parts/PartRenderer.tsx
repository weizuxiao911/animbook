import React from 'react';
import { Markdown } from './Markdown';
import { ReasoningView } from './Reasoning';
import { TodoCard } from './TodoCard';
import { QuestionCard } from './QuestionCard';
import { SubAgentCard } from './SubAgentCard';
import { ToolView } from './ToolView';

export type ToolKind = 'question' | 'subagent' | 'todowrite' | 'default';

export function getToolKind(tool: string): ToolKind {
  if (!tool) return 'default';
  const n = tool.toLowerCase();
  if (n === 'question' || n.includes('question')) return 'question';
  if (n === 'todowrite' || n === 'todo_write') return 'todowrite';
  if (n === 'task' || n === 'subagent' || n === 'subagent_task' || n.includes('subagent')) return 'subagent';
  return 'default';
}

export const PartRenderer: React.FC<{
  part: any;
  streaming?: boolean;
  sessionID: string;
  onReply: (sid: string, rid: string, answers: string[][]) => Promise<void>;
  preferredQuestionRequestID?: string;
  preferredQuestionQuestions?: any[];
}> = ({ part, streaming, sessionID, onReply, preferredQuestionRequestID, preferredQuestionQuestions }) => {
  if (!part || part.synthetic || part.ignored) return null;

  switch (part.type) {
    case 'text': {
      const text = String(part.text || '');
      if (!text) return null;
      return <Markdown content={text} streaming={streaming} expand={streaming} />;
    }
    case 'reasoning':
      return <ReasoningView part={part} streaming={streaming} />;
    case 'tool': {
      const kind = getToolKind(String(part.tool || ''));
      switch (kind) {
        case 'question': {
          const status = part?.state?.status;
          if (status === 'pending' || status === 'running') {
            return <div className="q q--waiting"><span className="q__badge">?</span><span>等待回答...</span></div>;
          }
          return (
            <QuestionCard
              part={part}
              sessionID={sessionID}
              onReply={onReply}
              preferredRequestID={preferredQuestionRequestID}
            />
          );
        }
        case 'todowrite':
          return <TodoCard part={part} />;
        case 'subagent':
          return <SubAgentCard part={part} />;
        default:
          return <ToolView part={part} />;
      }
    }
    case 'step-start':
    case 'step-finish':
    case 'snapshot':
    case 'patch':
    case 'agent':
    case 'retry':
    case 'compaction':
      return null;
    default:
      return null;
  }
};
