import { Injectable } from '@opensumi/di';
import { BrowserModule } from '@opensumi/ide-core-browser';
import { ITerminalServicePath } from '@opensumi/ide-terminal-next/lib/common';

import { OpenCodePtyService, TerminalSetupContribution } from './OpenCodePtyService';

/**
 * 终端模块 — 接入 OpenSumi TerminalNext, 把 node pty 层替换为 OpenCode /pty
 *
 * - OpenCodePtyService: browser 端实现 ITerminalServiceClient (映射 OpenCode /pty)
 * - TerminalSetupContribution: 启动后覆盖 ITerminalServicePath 的 provider
 *
 * TerminalNextModule (UI/xterm) 由 App.tsx 注册.
 */
@Injectable()
export class TerminalModule extends BrowserModule {
  providers = [
    OpenCodePtyService,
    TerminalSetupContribution,
    {
      token: ITerminalServicePath,
      useFactory: (injector: any) => injector.get(OpenCodePtyService),
    },
  ];
}
