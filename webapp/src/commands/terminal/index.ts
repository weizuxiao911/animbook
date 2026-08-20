/**
 * 终端命令模块 — commands/terminal/
 *
 * 接入 OpenSumi TerminalNext, 把 node pty 层替换为 opencode /pty:
 *   - OpenCodePtyService (services/pty): browser 端实现 ITerminalServiceClient
 *   - TerminalSetupContribution: 启动后覆盖 ITerminalServicePath 的 provider
 *
 * TerminalNextModule (UI/xterm) 由 config/modules.ts 注册.
 */

import { Injectable, Autowired, INJECTOR_TOKEN, Injector } from '@opensumi/di';
import { BrowserModule, ClientAppContribution } from '@opensumi/ide-core-browser';
import { ITerminalServicePath } from '@opensumi/ide-terminal-next/lib/common';

import { OpenCodePtyService } from '../../services/pty';

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

/**
 * 终端注入 — App 启动时把 ITerminalServicePath 替换为 OpenCode PTY 实现
 */
@Injectable()
export class TerminalSetupContribution implements ClientAppContribution {
  @Autowired(INJECTOR_TOKEN)
  private injector: Injector;

  onStart(): void {
    this.injector.addProviders({
      token: ITerminalServicePath,
      useValue: this.injector.get(OpenCodePtyService),
    });
  }
}
