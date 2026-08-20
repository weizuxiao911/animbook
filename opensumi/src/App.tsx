import React, { useEffect, useState } from 'react';

import { AppRenderer, getDefaultAppConfig, WORKSPACE_ROOT } from '@codeblitzjs/ide-core';
import '@codeblitzjs/ide-core/bundle/codeblitz.css';
import '@codeblitzjs/ide-core/languages';

import { buildSlots } from './config/slots';
import { getBuiltinModules } from './config/modules';
import { preferences } from './config/preferences';
import { runtimeConfig } from './config/runtime';
import { getWorkspaceDir } from './_legacy/commands/fs';
import { ExtensionRegistryClient } from './services/registry';
import './styles/overrides.css';

export const App: React.FC = () => {
  const [workspaceDir, setWorkspaceDir] = useState<string>(WORKSPACE_ROOT);
  /** vsix 清单 — 来自 extension-registry (本地 :13000). 拉到则激活扩展, 否则空启动. */
  const [extensionMetadata, setExtensionMetadata] = useState<any[]>([]);

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

  useEffect(() => {
    const client = new ExtensionRegistryClient();
    client
      .fetchMetadata()
      .then((list) => setExtensionMetadata(Array.isArray(list) ? list : []))
      .catch((err) => {
        console.warn('[animbook] registry 拉取失败, 继续空启动:', err.message);
        setExtensionMetadata([]);
      });
  }, []);

  const defaultModules = getDefaultAppConfig().modules || [];

  return (
    <AppRenderer
      appConfig={{
        workspaceDir,
        ...buildSlots(),
        defaultPreferences: preferences,
        extensionMetadata,
        modules: [
          ...defaultModules,
          ...getBuiltinModules({ vsixMetadata: extensionMetadata }),
        ],
      }}
      runtimeConfig={runtimeConfig as any}
    />
  );
};