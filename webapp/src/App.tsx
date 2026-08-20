import React, { useEffect, useState } from 'react';

import { AppRenderer, getDefaultAppConfig, WORKSPACE_ROOT } from '@codeblitzjs/ide-core';
import '@codeblitzjs/ide-core/bundle/codeblitz.css';
import '@codeblitzjs/ide-core/languages';

import { buildSlots } from './config/slots';
import { getBuiltinModules } from './config/modules';
import { preferences } from './config/preferences';
import { runtimeConfig } from './config/runtime';
import { getWorkspaceDir } from './services/workspace';
import './styles/overrides.css';

export const App: React.FC = () => {
  const [workspaceDir, setWorkspaceDir] = useState<string>(WORKSPACE_ROOT);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = async () => {
      try {
        const dir = await getWorkspaceDir();
        if (cancelled) return;
        if (dir && dir !== WORKSPACE_ROOT) setWorkspaceDir(dir);
      } catch {
        if (cancelled) return;
        timer = setTimeout(attempt, 1500);
      }
    };
    void attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const defaultModules = getDefaultAppConfig().modules || [];

  return (
    <AppRenderer
      appConfig={{
        workspaceDir,
        ...buildSlots(),
        defaultPreferences: preferences,
        // 业务 vsix 元数据 (启动期 registry 拉取填充, codeblitz in-process ext host 加载)
        extensionMetadata: (window as any).__APP_REGISTRY_METADATA__ || [],
        modules: [
          ...defaultModules,
          ...getBuiltinModules(),
        ],
      }}
      runtimeConfig={runtimeConfig as any}
    />
  );
};