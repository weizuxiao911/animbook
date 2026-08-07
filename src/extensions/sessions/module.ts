import { Injectable, Autowired } from '@opensumi/di';
import { Domain } from '@opensumi/ide-core-common';
import { BrowserModule, ClientAppContribution, SlotLocation } from '@opensumi/ide-core-browser';
import { ComponentContribution, ComponentRegistry } from '@opensumi/ide-core-browser/lib/layout';
import { IMainLayoutService } from '@opensumi/ide-main-layout/lib/common';

import { SessionsView } from './SessionsView';

const SESSIONS_CONTAINER_ID = 'sessions-default';

/**
 * Sessions 拓展 — 左侧第一个活动栏图标 (会话/AI 入口面板).
 *
 * OpenSumi 拓展标准 (与 assistant/actions 对齐):
 *   - SessionsContribution @Domain(ComponentContribution), registerComponent
 *     registry.register('sessions-default', { component: SessionsView })
 *   - SessionsModule (BrowserModule + contributionProvider = ComponentContribution)
 *     通过 appConfig.modules: [SessionsModule] 注入 DI
 *   - slots.ts 的 layoutConfig['left'].modules = ['sessions-default', '@opensumi/ide-explorer']
 *
 * 顺序: 通过 priority=0 让 sessions 排在 explorer (priority=10) 之前.
 * OpenSumi TabbarService.registerContainer 内部按 options.priority 升序插入.
 *
 * 后续: 会话列表/团队接入真实数据走 props 注入或 contextKey, 骨架先行.
 */
@Injectable()
@Domain(ComponentContribution)
export class SessionsContribution implements ComponentContribution {
  registerComponent(registry: ComponentRegistry): void {
    registry.register(
      'sessions-default',
      {
        id: 'sessions-default',
        component: SessionsView,
      },
      {
        containerId: SESSIONS_CONTAINER_ID,
        iconClass: 'ab-logo-v',
        title: '会话管理',
        priority: 100,
      },
    );
  }
}

/**
 * 启动后把 left slot 默认激活容器设为 sessions-default.
 *
 * 仅在 left slot 没有 currentContainerId 时设置一次, 不再强制覆盖.
 * 用户切换到 explorer 等其他容器后不会被抢回.
 */
@Injectable()
@Domain(ClientAppContribution)
export class SessionsDefaultContribution implements ClientAppContribution {
  @Autowired(IMainLayoutService)
  private readonly layoutService!: IMainLayoutService;

  onDidStart(): void {
    const tryActivate = () => {
      const service = this.layoutService.getTabbarService(SlotLocation.left);
      if (!service.containersMap.has(SESSIONS_CONTAINER_ID)) return;
      // 仅当 left 槽位还没有激活项时才默认选中 sessions;
      // 一旦用户/系统已经选了别的容器 (例如 explorer), 就不再抢.
      if (!service.currentContainerId.get()) {
        service.updateCurrentContainerId(SESSIONS_CONTAINER_ID);
      }
    };
    for (const delay of [60, 200, 600, 1500]) {
      setTimeout(tryActivate, delay);
    }
  }
}

@Injectable()
export class SessionsModule extends BrowserModule {
  providers = [SessionsContribution, SessionsDefaultContribution];

  contributionProvider = [ComponentContribution, ClientAppContribution];
}
