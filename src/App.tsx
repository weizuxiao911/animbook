import React, { useEffect, useState } from 'react';

import { AppRenderer } from '@codeblitzjs/ide-core';
import '@codeblitzjs/ide-core/bundle/codeblitz.css';
import '@codeblitzjs/ide-core/languages';

import { getDefaultAppConfig } from '@codeblitzjs/ide-core';

import { buildSlots } from './config/slots';
import { AssistantModule } from './extensions/assistant';
import { ActionsModule } from './extensions/actions';
import { WelcomeModule } from './extensions/welcome';
import { PdfReaderModule } from './extensions/pdf';
import { BinaryModule } from './extensions/binary';
import { preferences } from './config/preferences';
import { runtimeConfig } from './config/runtime';
import { FsCommandsModule, getWorkspaceDir } from './commands/fs';
import { TerminalModule } from './commands/terminal';
import { TerminalNextModule } from '@opensumi/ide-terminal-next/lib/browser';
import './styles/overrides.css';

export const App: React.FC = () => {
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = async () => {
      try {
        const dir = await getWorkspaceDir();
        if (cancelled) return;
        setWorkspaceDir(dir);
      } catch (e) {
        if (cancelled) return;
        const msg = String((e as any)?.message || e);
        setBootError(msg);
        timer = setTimeout(attempt, 1500);
      }
    };
    void attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (bootError && !workspaceDir) {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 10,
        color: 'var(--errorForeground, var(--vscode-errorForeground, #fca5a5))',
        background: 'var(--editor-background, var(--vscode-editor-background))',
        fontFamily: 'sans-serif', fontSize: 13,
      }}>
        <div>无法连接 opencode ({bootError})</div>
        <div style={{ color: 'var(--descriptionForeground, var(--vscode-descriptionForeground, #9ca3af))' }}>
          请确认 opencode 正在运行, 1.5 秒后自动重试…
        </div>
      </div>
    );
  }

  if (!workspaceDir) {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--descriptionForeground, var(--vscode-descriptionForeground, #9ca3af))',
        background: 'var(--editor-background, var(--vscode-editor-background))',
        fontFamily: 'sans-serif', fontSize: 13,
      }}>
        正在连接 opencode 工作区…
      </div>
    );
  }

  const slots = buildSlots(workspaceDir);
  const defaultModules = getDefaultAppConfig().modules || [];

  return (
    <AppRenderer
      appConfig={{
        ...slots,
        defaultPreferences: preferences,
        extensionMetadata: [],
        modules: [
          ...defaultModules,
          TerminalNextModule,
          FsCommandsModule,
          TerminalModule,
          WelcomeModule,
          PdfReaderModule,
          BinaryModule,
          AssistantModule,
          ActionsModule,
        ],
      }}
      runtimeConfig={runtimeConfig as any}
    />
  );
};
