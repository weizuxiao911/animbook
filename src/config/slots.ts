import type { IAppRendererProps } from '@codeblitzjs/ide-core';
import { SlotLocation } from '@opensumi/ide-core-browser';

import { LayoutComponent } from './layout';

export type Slots = Pick<
  IAppRendererProps['appConfig'],
  'workspaceDir' | 'layoutComponent' | 'layoutConfig'
>;

/**
 * 构建 slots.
 *
 * 注意: appConfig.workspaceDir 是 CodeBlitz/OpenSumi 的 **IDE 内虚拟工作区路径**,
 * 用作 BrowserFS 挂载点 (rootFS.mount(workspaceDir, overlayFS)) 与 file URI 前缀,
 * 必须是 POSIX 风格虚拟路径 (如 '/workspace'), **不能**传宿主机绝对路径
 * (Windows 盘符 D:\... 含 ':' 和 '\' 会破坏挂载点与 URI 解析, 导致 explorer 无法渲染).
 * 宿主机真实目录由 sandbox/fs.getWorkspaceDir() (GET /ai/path) 单独维护, 用于
 * 把 IDE 相对路径映射到 opencode 宿主机路径.
 */
export function buildSlots(): Slots {
  return {
    workspaceDir: '/workspace',
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
          'sessions-default',
          '@opensumi/ide-explorer',
        ],
      },
      [SlotLocation.right]: {
        modules: [
          'chat-panel'
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
  };
}
