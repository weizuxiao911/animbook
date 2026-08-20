/**
 * AI 服务模块 — services/ai.module.ts
 *
 * 注册默认 AI 服务实现 (opencode) 到 DI token IAIService.
 * 切换实现: 改 useClass 即可, 消费者零修改.
 *
 * 注入路径:
 *   App.tsx modules: [..., AIServiceModule]
 *   consumer: @Autowired(IAIService) @Optional() ai?: IAIService
 */

import { Injectable } from '@opensumi/di';
import { BrowserModule } from '@opensumi/ide-core-browser';

import { IAIService } from './ai';
import { OpencodeAIService } from './ai.opencode';

@Injectable()
export class AIServiceModule extends BrowserModule {
  providers = [
    {
      token: IAIService,
      useClass: OpencodeAIService,
    },
  ];
}