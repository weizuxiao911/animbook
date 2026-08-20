/**
 * Extension Registry Client — vsix 清单拉取
 *
 * 从 extension-registry 服务 (本地 :13000) 拉取 metadata 清单, 注入 AppRenderer.
 * 流程: animbook App 启动 → fetch /metadata.json → extensionMetadata → opensumi 内部走 kt-ext 加载
 *
 * 设计要点:
 *   - baseUrl 走相对路径 /extensions (webpack proxy, dev 时转发到 https://127.0.0.1:13000).
 *   - 也支持绝对 baseUrl (生产环境 registry 在公网).
 *   - 失败时返回空数组, 由调用方决定 fallback (animbook App: fallback 到 hardcoded ChatModule).
 */

const DEFAULT_BASE_URL = '/extensions';

export class ExtensionRegistryClient {
  constructor(private readonly baseUrl: string = DEFAULT_BASE_URL) {}

  async fetchMetadata(): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/metadata.json`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`GET /metadata.json failed: ${res.status}`);
    }
    return res.json();
  }
}