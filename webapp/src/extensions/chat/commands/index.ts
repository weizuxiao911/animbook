import { Injectable } from '@opensumi/di';
import { Domain, CommandContribution, CommandRegistry } from '@opensumi/ide-core-common';
import { BrowserModule } from '@opensumi/ide-core-browser';

import {
  aiCreateSession,
  aiListSessions,
  aiListMessages,
  aiSendMessage,
  aiAbort,
  aiListAgents,
  aiSwitchAgent,
  aiReplyQuestion,
} from './api';

/**
 * ai commands — AI 会话/消息/agent 能力 (按工具集分组维护)
 *
 * 命名约定: chat.ai.{action}
 *   chat.ai.session.create      (title?)           → sessionID   创建新会话
 *   chat.ai.session.list        ()                 → Session[]   历史会话
 *   chat.ai.session.switch      (sessionID)        → void        切换会话
 *   chat.ai.message.list        (sessionID)        → Message[]   会话消息
 *   chat.ai.message.send        (sessionID, text)  → void        发送消息 (async_prompt)
 *   chat.ai.message.abort       (sessionID)        → void        中断
 *   chat.ai.agent.list          ()                 → Agent[]     subagent 列表
 *   chat.ai.agent.switch        (sessionID, agent) → void        切换 agent
 *   chat.ai.a2ui.question.reply (sessionID, requestID, answers) → void
 *
 * 全部走 @opencode-ai/sdk (v2) client, 不直连 HTTP.
 * Module: AiCommandsModule, appConfig.modules: [AiCommandsModule] 注入 DI.
 */

export const AI_CMD = {
  SESSION_CREATE: 'chat.ai.session.create',
  SESSION_LIST: 'chat.ai.session.list',
  SESSION_SWITCH: 'chat.ai.session.switch',
  MESSAGE_LIST: 'chat.ai.message.list',
  MESSAGE_SEND: 'chat.ai.message.send',
  MESSAGE_ABORT: 'chat.ai.message.abort',
  AGENT_LIST: 'chat.ai.agent.list',
  AGENT_SWITCH: 'chat.ai.agent.switch',
  A2UI_QUESTION_REPLY: 'chat.ai.a2ui.question.reply',
} as const;

@Injectable()
@Domain(CommandContribution)
export class AiCommandsContribution implements CommandContribution {
  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(
      { id: AI_CMD.SESSION_CREATE },
      { execute: (title?: string) => aiCreateSession(title) }
    );
    commands.registerCommand(
      { id: AI_CMD.SESSION_LIST },
      { execute: () => aiListSessions() }
    );
    commands.registerCommand(
      { id: AI_CMD.SESSION_SWITCH },
      { execute: (sessionID: string) => aiSwitchSession(sessionID) }
    );
    commands.registerCommand(
      { id: AI_CMD.MESSAGE_LIST },
      { execute: (sessionID: string) => aiListMessages(sessionID) }
    );
    commands.registerCommand(
      { id: AI_CMD.MESSAGE_SEND },
      { execute: (sessionID: string, textOrParts: string | any[], agent?: string, model?: { providerID: string; modelID: string }, variant?: string) =>
        aiSendMessage(sessionID, textOrParts, agent, model, variant) }
    );
    commands.registerCommand(
      { id: AI_CMD.MESSAGE_ABORT },
      { execute: (sessionID: string) => aiAbort(sessionID) }
    );
    commands.registerCommand(
      { id: AI_CMD.AGENT_LIST },
      { execute: () => aiListAgents() }
    );
    commands.registerCommand(
      { id: AI_CMD.AGENT_SWITCH },
      { execute: (sessionID: string, agent: string) => aiSwitchAgent(sessionID, agent) }
    );
    commands.registerCommand(
      { id: AI_CMD.A2UI_QUESTION_REPLY },
      {
        execute: (sessionID: string, requestID: string, answers: string[][]) =>
          aiReplyQuestion(sessionID, requestID, answers),
      }
    );
  }
}

async function aiSwitchSession(sessionID: string): Promise<void> {
  // 切换会话由 webview 直接处理 (更新 UI 状态), command 只做透传
  return;
}

@Injectable()
export class AiCommandsModule extends BrowserModule {
  providers = [AiCommandsContribution];

  contributionProvider = CommandContribution;
}