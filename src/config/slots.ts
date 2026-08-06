import type { IAppRendererProps } from '@codeblitzjs/ide-core';
import { SlotLocation } from '@opensumi/ide-core-browser';

import { LayoutComponent } from './layout';

export type Slots = Pick<
  IAppRendererProps['appConfig'],
  'workspaceDir' | 'layoutComponent' | 'layoutConfig' | 'defaultPanels'
>;

/**
 * 构建 slots — workspaceDir 由调用方 (App) 从 sandbox/fs.getWorkspaceDir() 拿到后注入.
 * 不再硬编码 '/workspace'.
 */
export function buildSlots(workspaceDir: string): Slots {
  return {
    workspaceDir,
    layoutComponent: LayoutComponent,
    layoutConfig: {
      [SlotLocation.top]: {
        modules: [
          'actions-default',
        ],
      },
      [SlotLocation.action]: {
        modules: []
      },
      [SlotLocation.left]: {
        modules: [
          '@opensumi/ide-explorer',
        ],
      },
      [SlotLocation.right]: {
        modules: [
          'ai-panel-default'
        ]
      },
      [SlotLocation.main]: {
        modules: [
          '@opensumi/ide-editor'
        ]
      },
      [SlotLocation.bottom]: {
        modules: [
          '@opensumi/ide-terminal-next',
          '@opensumi/ide-output',
          '@opensumi/ide-markers',
        ],
      },
      [SlotLocation.extra]: {
        modules: []
      },
    } as any,
    defaultPanels: {
      left: "@opensumi/ide-explorer"
    }
  };
}
