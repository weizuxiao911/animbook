/**
 * useInjectableOptional — hooks/useInjectableOptional.ts
 *
 * useInjectable 在 provider 缺失时抛错. 这里捕获后返回 undefined,
 * 让消费者 (如 chat 面板) 优雅处理"AI 服务未配置"场景.
 */

import { useContext, useMemo } from 'react';
import { ConfigContext } from '@opensumi/ide-core-browser/lib/react-providers/config-provider';

export function useInjectableOptional<T>(token: symbol | any): T | undefined {
  const { injector } = useContext(ConfigContext);
  return useMemo(() => {
    try {
      return injector.get(token) as T;
    } catch {
      return undefined;
    }
  }, [injector, token]);
}