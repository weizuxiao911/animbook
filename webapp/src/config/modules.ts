/**
 * 内置模块注册表 — webapp/src/config/modules.ts
 *
 * App.tsx 拉 vsix metadata 传给 codeblitz ext host, ext host 自动加载 vsix.
 * 内置 chat vsix 不再 import (由 ext host 加载).
 *
 * 只保留: 框架级 builtin modules (terminal / fs / actions / welcome).
 */

import { TerminalNextModule } from '@opensumi/ide-terminal-next/lib/browser';
import { FsCommandsModule } from '../commands/file';
import { TerminalModule } from '../commands/terminal';
import { ActionsModule } from '../extensions/actions';
import { WelcomeModule } from '../extensions/welcome';
import { ChatModule } from '../extensions/chat';
import { RegistryModule } from '../services/registry';

export function getBuiltinModules(_opts?: { vsixMetadata?: any[] }): any[] {
  return [
    TerminalNextModule,
    FsCommandsModule,
    TerminalModule,
    ActionsModule,
    WelcomeModule,
    ChatModule,
    // 注册顺序在 codeblitz 之后, 覆盖 kt-ext 静态资源解析 (vsix 走同源 registry 代理)
    RegistryModule,
  ];
}
