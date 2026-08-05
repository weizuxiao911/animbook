import { Injectable } from '@opensumi/di';
import { Domain } from '@opensumi/ide-core-common';
import { BrowserModule } from '@opensumi/ide-core-browser';
import { ComponentContribution, ComponentRegistry } from '@opensumi/ide-core-browser/lib/layout';

import { AiPanel } from './webview/AiPanel';

/**
 * AI 助手拓展 — right 槽位 (OpenSumi 标准槽位)
 *
 * OpenSumi 拓展标准:
 *   - AssistantContribution @Domain(ComponentContribution), registerComponent
 *     registry.register('ai-panel-default', { component: AiPanel })
 *   - AssistantModule (BrowserModule + contributionProvider = ComponentContribution)
 *     通过 appConfig.modules: [AssistantModule] 注入 DI
 *   - slots.ts 的 layoutConfig['right'].modules = ['ai-panel-default']
 *   - RightPanelRenderer (框架级, 归 client 框架) 渲染 right 槽位, 面板内容 = AiPanel
 *
 * webview: AI 交互界面 (消息流/输入/附件/模型/question/todos), 在 webview/ 目录.
 *
 * 可被业务 VSIX 通过 contributes.views + viewsContainers 注册自定义 view 替换 (铁律 12).
 */
@Injectable()
@Domain(ComponentContribution)
export class AssistantContribution implements ComponentContribution {
  registerComponent(registry: ComponentRegistry): void {
    registry.register('ai-panel-default', {
      id: 'ai-panel-default',
      component: AiPanel,
    }, {
      containerId: 'ai-panel-default',
      iconClass: 'codicon codicon-sparkle',
      title: 'AI 助手',
    });
  }
}

@Injectable()
export class AssistantModule extends BrowserModule {
  providers = [AssistantContribution];

  contributionProvider = ComponentContribution;
}
