/**
 * 文件命令模块 — commands/file/
 *
 * 把 services/ 的文件系统能力接入 OpenSumi:
 *   - FsCommandsContribution    FS_CMD 命令 (调用 services/fs)
 *   - FsServiceBridgeContribution 挂 IFileServiceClient 到 window (供 runtime 钩子)
 *   - FsWatchContribution       订阅 opencode 文件变化 → Explorer 强一致刷新
 */

import { Injectable, Autowired } from '@opensumi/di';
import { Domain, CommandContribution, CommandRegistry, CommandService } from '@opensumi/ide-core-common';
import { BrowserModule, ClientAppContribution } from '@opensumi/ide-core-browser';
import { IFileServiceClient } from '@opensumi/ide-file-service';

import { fsList, fsRead, fsWrite, fsDelete, fsMkdir, fsFind } from '../../services/fs';
import { installFsWatcher } from '../../services/fs-watch';

export const FS_CMD = {
  LIST: 'webapp.fs.list',
  READ: 'webapp.fs.read',
  WRITE: 'webapp.fs.write',
  DELETE: 'webapp.fs.delete',
  MKDIR: 'webapp.fs.mkdir',
  FIND: 'webapp.fs.find',
} as const;

/** CodeBlitz 文件树刷新命令 (file-tree-contribution 注册, 内部调 fileTreeService.refresh) */
const FILE_TREE_REFRESH = 'filetree.refresh.all';

/**
 * FsServiceBridgeContribution — 把 OpenSumi file service 暴露给 runtime 钩子
 *
 * runtime.ts 的 onDidCreateFiles 需要查询 FileStat 区分目录/文件,
 * 静态配置拿不到 injector, 这里在 onDidStart 挂到 window 供其使用.
 * 单一职责: 仅桥接 IFileServiceClient 到 window, 不承担 watcher/命令桥接.
 */
@Injectable()
@Domain(ClientAppContribution)
export class FsServiceBridgeContribution implements ClientAppContribution {
  @Autowired(IFileServiceClient)
  private readonly fileService!: IFileServiceClient;

  onDidStart(): void {
    (window as any).__APP_FILE_SERVICE__ = this.fileService;
  }
}

/**
 * FsWatchContribution — 订阅 opencode 文件变化 → Explorer 强一致
 *
 * 监听 opencode SSE file.watcher.updated (宿主机 cwd 被 AI/工具写文件),
 * 收到后执行 filetree.refresh.all → BrowserFS 重列目录 → Explorer 立即显示最新.
 * 单一职责: 只做"opencode 文件变化事件 → Explorer 刷新"桥接.
 */
@Injectable()
@Domain(ClientAppContribution)
export class FsWatchContribution implements ClientAppContribution {
  @Autowired(CommandService)
  private readonly commandService!: CommandService;

  private disposeWatcher: (() => void) | null = null;

  onDidStart(): void {
    void installFsWatcher(() => {
      this.commandService.executeCommand(FILE_TREE_REFRESH).catch(() => {});
    }).then((stop) => { this.disposeWatcher = stop; });
  }

  onStop(): void {
    this.disposeWatcher?.();
    this.disposeWatcher = null;
  }
}

@Injectable()
@Domain(CommandContribution)
export class FsCommandsContribution implements CommandContribution {
  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand({ id: FS_CMD.LIST }, { execute: (p: string) => fsList(p) });
    commands.registerCommand({ id: FS_CMD.READ }, { execute: (p: string) => fsRead(p) });
    commands.registerCommand(
      { id: FS_CMD.WRITE },
      { execute: (p: string, c: string | Uint8Array) => fsWrite(p, c) },
    );
    commands.registerCommand({ id: FS_CMD.DELETE }, { execute: (p: string) => fsDelete(p) });
    commands.registerCommand({ id: FS_CMD.MKDIR }, { execute: (p: string) => fsMkdir(p) });
    commands.registerCommand(
      { id: FS_CMD.FIND },
      { execute: (p: string, pat = '*') => fsFind(p, pat) },
    );
  }
}

@Injectable()
export class FsCommandsModule extends BrowserModule {
  providers = [FsCommandsContribution, FsServiceBridgeContribution, FsWatchContribution];
  contributionProvider = [CommandContribution, ClientAppContribution];
}
