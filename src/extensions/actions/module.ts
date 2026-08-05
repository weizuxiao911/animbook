import { Injectable } from '@opensumi/di';
import { Domain } from '@opensumi/ide-core-common';
import { BrowserModule } from '@opensumi/ide-core-browser';
import { ComponentContribution, ComponentRegistry } from '@opensumi/ide-core-browser/lib/layout';

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

@Injectable()
export class ActionsModule extends BrowserModule {
  providers = [ActionsContribution];

  contributionProvider = ComponentContribution;
}
