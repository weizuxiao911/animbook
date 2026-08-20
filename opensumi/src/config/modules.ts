/**
 * 内置模块注册表 — opensumi/src/config/modules.ts
 *
 * App.tsx 不再逐个 import 业务模块, 只从这个表取.
 * 加新模块: 在这里 import + 加进 builtinModules 一行即可, App.tsx 不动.
 *
 * 内置 chat vsix 覆盖决策:
 *   vsix metadata 中已有 chat-panel viewlet → 不挂载内置 ChatModule (避免两个 tab).
 *   App.tsx 拉 vsix metadata 后传 opts.vsixMetadata 进来即可.
 */

import { TerminalNextModule } from '@opensumi/ide-terminal-next/lib/browser';
import { FsCommandsModule } from '../_legacy/commands/fs/opensumi';
import { TerminalModule } from '../_legacy/commands/terminal';
import { ChatModule } from '../extensions/chat';
import { ActionsModule } from '../extensions/actions';
import { WelcomeModule } from '../extensions/welcome';

function hasVsixChatPanel(metadata: any[]): boolean {
  return metadata.some((m) => {
    const views = m?.packageJSON?.contributes?.browserViews?.right?.view;
    return Array.isArray(views) && views.some((v: any) => v?.id === 'chat-panel');
  });
}

export function getBuiltinModules(opts?: { vsixMetadata?: any[] }): any[] {
  const useBuiltinChat = !hasVsixChatPanel(opts?.vsixMetadata ?? []);
  return [
    TerminalNextModule,
    FsCommandsModule,
    TerminalModule,
    ActionsModule,
    WelcomeModule,
    ...(useBuiltinChat ? [ChatModule] : []),
  ];
}