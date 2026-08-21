/**
 * fs-watch — services/fs-watch.ts
 *
 * 订阅 opencode 服务端文件变化事件 (SSE file.watcher.updated),
 * 宿主机 cwd 被 AI/工具写文件后通知浏览器侧 (用于触发 Explorer 强一致刷新).
 *
 * 事件格式 (opencode v2):
 *   { type: 'file.watcher.updated', properties: { file: string, event: 'add'|'change'|'unlink' } }
 *
 * 职责单一: 只负责订阅 opencode 事件并回调, 不关心 Explorer/命令 (由调用方桥接).
 * 不创建自己的 opencode client, 复用全局 __APP_OPENCODE__ SDK 实例.
 */

export interface FsWatchChange {
  /** 变化的宿主绝对路径 */
  file: string;
  event: 'add' | 'change' | 'unlink';
}

let installed = false;
let stopped = false;

/**
 * 安装 fs watcher — 订阅 opencode 文件变化事件.
 * onChange 在每次宿主机文件变化时调用 (file.watcher.updated).
 * 返回停止函数. 只安装一次 (幂等).
 */
export async function installFsWatcher(onChange: (change: FsWatchChange) => void): Promise<() => void> {
  if (installed) return () => {};
  installed = true;
  stopped = false;

  const getClient = () => (window as any).__APP_OPENCODE__;

  const run = async () => {
    while (!stopped) {
      const client = getClient();
      if (!client?.event) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      try {
        const evt = await client.event.subscribe();
        for await (const ev of evt.stream) {
          if (stopped) break;
          const { type, properties } = ev || {};
          if (type === 'file.watcher.updated' && properties?.file) {
            onChange({ file: String(properties.file), event: properties.event });
          }
        }
      } catch {
        // SSE 断开, 重连
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };
  void run();

  return () => {
    stopped = true;
    installed = false;
  };
}
