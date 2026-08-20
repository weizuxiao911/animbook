/**
 * FS 的 OpenSumi 集成 — opensumi/src/commands/fs/opensumi.ts
 *
 * 把 FS API 包成 OpenSumi CommandContribution + ClientAppContribution, 供 IDE 内部调用.
 * 同时把 IFileServiceClient 挂到 window 供 runtime 钩子用.
 */

import { Injectable, Autowired } from '@opensumi/di';
import { Domain, CommandContribution, CommandRegistry } from '@opensumi/ide-core-common';
import { BrowserModule, ClientAppContribution } from '@opensumi/ide-core-browser';
import { IFileServiceClient } from '@opensumi/ide-file-service';

import { fsList, fsRead, fsWrite, fsDelete, fsMkdir, fsFind } from './api';

export const FS_CMD = {
  LIST: 'animbook.fs.list',
  READ: 'animbook.fs.read',
  WRITE: 'animbook.fs.write',
  DELETE: 'animbook.fs.delete',
  MKDIR: 'animbook.fs.mkdir',
  FIND: 'animbook.fs.find',
} as const;

/**
 * FsServiceBridgeContribution — 把 OpenSumi file service 暴露给 runtime 钩子
 *
 * runtime.ts 的 onDidCreateFiles 需要查询 FileStat 区分目录/文件,
 * 静态配置拿不到 injector, 这里在 onDidStart 挂到 window 供其使用.
 */
@Injectable()
@Domain(ClientAppContribution)
export class FsServiceBridgeContribution implements ClientAppContribution {
  @Autowired(IFileServiceClient)
  private readonly fileService!: IFileServiceClient;

  onDidStart(): void {
    (window as any).__ANIMBOOK_FILE_SERVICE__ = this.fileService;
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
  providers = [FsCommandsContribution, FsServiceBridgeContribution];
  contributionProvider = [CommandContribution, ClientAppContribution];
}