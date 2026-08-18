import { Injectable } from '@opensumi/di';
import { Domain } from '@opensumi/ide-core-common';
import { BrowserModule } from '@opensumi/ide-core-browser';
import { ComponentContribution, ComponentRegistry } from '@opensumi/ide-core-browser/lib/layout';

import { Chat } from './webview/Chat';

/**
 * Chat 拓展 — right 槽位 (OpenSumi 标准槽位)
 *
 * OpenSumi 拓展标准:
 *   - ChatContribution @Domain(ComponentContribution), registerComponent
 *     registry.register('chat-panel', { component: Chat })
 *   - ChatModule (BrowserModule + contributionProvider = ComponentContribution)
 *     通过 appConfig.modules: [ChatModule] 注入 DI
 *   - slots.ts 的 layoutConfig['right'].modules = ['chat-panel']
 *   - RightPanelRenderer (框架级, 归 client 框架) 渲染 right 槽位, 面板内容 = Chat
 *
 * webview: 聊天交互界面 (消息流/输入/附件/模型/question/todos), 在 webview/ 目录.
 *
 * 可被业务 VSIX 通过 contributes.views + viewsContainers 注册自定义 view 替换 (铁律 12).
 */
@Injectable()
@Domain(ComponentContribution)
export class ChatContribution implements ComponentContribution {
  registerComponent(registry: ComponentRegistry): void {
    registry.register('chat-panel', {
      id: 'chat-panel',
      component: Chat,
    }, {
      containerId: 'chat-panel',
      iconClass: 'codicon codicon-sparkle',
      title: 'Chat',
    });
  }
}

@Injectable()
export class ChatModule extends BrowserModule {
  providers = [ChatContribution];

  contributionProvider = ComponentContribution;
}