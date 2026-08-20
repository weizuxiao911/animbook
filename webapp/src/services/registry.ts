/**
 * registry 客户端服务 — services/registry.ts
 *
 * 与 registry 分发服务器 (registry/) 通信:
 *   1. 启动期拉取 vsix 元数据清单 → 填充 __WEBAPP_REGISTRY_METADATA__,
 *      App 渲染时传给 codeblitz 走 in-process ext host 加载 vsix.
 *   2. 覆盖 kt-ext 静态资源解析 → 同源 <registryUrl>/<id> (dev webpack 反代 /
 *      生产反向代理到 registry), 避免直连 https://registry 的自签证书问题.
 */

import { Injectable } from '@opensumi/di';
import { BrowserModule, Domain, URI } from '@opensumi/ide-core-browser';
import { StaticResourceContribution, StaticResourceService } from '@opensumi/ide-core-browser/lib/static-resource';
import { EXT_SCHEME } from '@codeblitzjs/ide-sumi-core/lib/common/constant';

const REGISTRY_URL = (window as any).__WEBAPP_CONFIG__?.registryUrl || '/extensions';

/**
 * kt-ext 静态资源贡献 — 覆盖 codeblitz 默认的 kt-ext→https 解析.
 *
 * codeblitz 默认把 kt-ext://<host>/<id> 转成 https://<host>/<id> 直连, 本地自签证书会被浏览器拦.
 * 这里改成同源 <registryUrl>/<id>, 让扩展代码/资源统一走 webpack 反代 (dev) 或反向代理 (生产).
 * 注册顺序在 codeblitz 之后 (模块列表靠后), Map.set 覆盖默认 provider.
 */
@Injectable()
@Domain(StaticResourceContribution)
export class RegistryStaticResourceContribution implements StaticResourceContribution {
  registerStaticResolver(service: StaticResourceService): void {
    service.registerStaticResourceProvider({
      scheme: EXT_SCHEME,
      resolveStaticResource: (uri) => {
        const base = REGISTRY_URL.replace(/\/+$/, '');
        const path = uri.path.toString();
        return URI.from({
          scheme: window.location.protocol.replace(/:$/, ''),
          authority: window.location.host,
          path: `${base}${path}`,
        });
      },
      roots: [window.location.origin],
    });
  }
}

interface VsixMetadata {
  extension: { publisher: string; name: string; version: string };
  packageJSON: {
    name: string;
    displayName?: string;
    version: string;
    publisher: string;
    description?: string;
    main?: string;
    browser?: string;
    engines?: { vscode?: string };
    activationEvents?: string[];
    contributes?: {
      commands?: any[];
      viewsContainers?: Record<string, { id: string; title: string; icon?: string }>;
      views?: Record<string, Array<{ id: string; name: string; type?: string }>>;
    };
  };
  uri: string;
}

export async function fetchRegistryMetadata(): Promise<VsixMetadata[]> {
  const url = REGISTRY_URL.replace(/\/$/, '') + '/metadata.json';
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`registry metadata fetch failed: ${res.status} ${url}`);
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

export async function installRegistryMetadata(): Promise<VsixMetadata[]> {
  try {
    const metadata = await fetchRegistryMetadata();
    (window as any).__WEBAPP_REGISTRY_METADATA__ = metadata;
    console.log('[registry] metadata 拉取 OK,', metadata.length, 'entries:',
      metadata.map((m) => m.extension.name).join(', '));
    return metadata;
  } catch (e: any) {
    console.warn('[registry] metadata 拉取失败:', e?.message);
    (window as any).__WEBAPP_REGISTRY_METADATA__ = [];
    return [];
  }
}

/** registry 模块 — 注册 vsix 静态资源同源解析贡献 */
@Injectable()
export class RegistryModule extends BrowserModule {
  providers = [RegistryStaticResourceContribution];

  contributionProvider = [StaticResourceContribution];
}
