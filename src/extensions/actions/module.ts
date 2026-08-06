import { Injectable, Autowired } from '@opensumi/di';
import { Domain } from '@opensumi/ide-core-common';
import { BrowserModule, ClientAppContribution, SlotLocation } from '@opensumi/ide-core-browser';
import { ComponentContribution, ComponentRegistry } from '@opensumi/ide-core-browser/lib/layout';
import { IMainLayoutService } from '@opensumi/ide-main-layout/lib/common';

import { ActionsView } from './ActionsView';

/**
 * Actions 拓展 — top 槽位 (3 布局 toggle)
 *
 * OpenSumi 拓展标准:
 *   - ActionsContribution @Domain(ComponentContribution), registerComponent
 *     registry.register('actions-default', { component: ActionsView })
 *   - ActionsModule (BrowserModule + contributionProvider = ComponentContribution)
 *   - slots.ts 的 layoutConfig['top'].modules = ['actions-default']
 *
 * 内容: 3 个布局 toggle (左侧栏/底部栏/右侧栏). 无品牌 logo, 无登录/账号按钮.
 */
@Injectable()
@Domain(ComponentContribution)
export class ActionsContribution implements ComponentContribution {
  registerComponent(registry: ComponentRegistry): void {
    registry.register('actions-default', {
      id: 'actions-default',
      component: ActionsView,
    });
  }
}

/**
 * 默认布局 — 启动后展开左侧资源管理器.
 * (defaultPanels 只激活容器不控制显隐; LayoutComponent mount 时机太早;
 *  onDidStart 时 toggleSlot 才可靠)
 */
@Injectable()
@Domain(ClientAppContribution)
export class DefaultLayoutContribution implements ClientAppContribution {
  @Autowired(IMainLayoutService)
  private readonly layoutService!: IMainLayoutService;

  onDidStart(): void {
    this.layoutService.toggleSlot(SlotLocation.left, true);
  }
}

@Injectable()
export class ActionsModule extends BrowserModule {
  providers = [ActionsContribution, DefaultLayoutContribution];

  contributionProvider = [ComponentContribution, ClientAppContribution];
}
