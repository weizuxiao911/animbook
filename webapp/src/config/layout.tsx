import React, { useEffect } from 'react';
import { SlotLocation, SlotRenderer } from '@opensumi/ide-core-browser';
import { BoxPanel, SplitPanel } from '@opensumi/ide-core-browser/lib/components';
import { useInjectable } from '@opensumi/ide-core-browser/lib/react-hooks/injectable-hooks';
import { IMainLayoutService } from '@opensumi/ide-main-layout/lib/common';

/**
 * webapp LayoutComponent — config/layout.tsx (容器装配配置目录)
 *
 * 结构 (仿照早期实验仓 layout):
 *   - top-to-bottom BoxPanel: top 槽位 (actions-default: 3 布局 toggle) + 主 SplitPanel
 *   - main-horizontal: left (资源管理器) + main-vertical (主编辑器 + bottom) + right (AI 面板)
 *   - main-vertical: main + bottom (SplitPanel top-to-bottom)
 *   - right 与 main-vertical 平级, 在 main-horizontal 右侧
 *
 * 槽位 id 用 OpenSumi 标准 id.
 */
export function LayoutComponent(): React.ReactElement {
  const layoutService = useInjectable<IMainLayoutService>(IMainLayoutService);

  return (
    <React.Fragment>
      <BoxPanel direction="top-to-bottom">
        <SlotRenderer slot="top" />
        <SplitPanel overflow="hidden" id="main-horizontal" flex={1}>
          <SlotRenderer
            slot={SlotLocation.left}
            isTabbar
            defaultSize={286}
            minResize={204}
            minSize={49}
          />
          <SplitPanel id="main-vertical" minResize={300} flexGrow={1} direction="top-to-bottom">
            <SlotRenderer flex={2} flexGrow={1} minResize={200} slot={SlotLocation.main} />
            <SlotRenderer flex={1} minResize={160} slot={SlotLocation.bottom} isTabbar defaultSize={200} />
          </SplitPanel>
          <SlotRenderer slot={SlotLocation.right} isTabbar defaultSize={438} minResize={320} minSize={49} />
        </SplitPanel>
      </BoxPanel>
    </React.Fragment>
  );
}
