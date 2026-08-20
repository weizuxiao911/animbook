import { Injectable } from '@opensumi/di';
import { Domain } from '@opensumi/ide-core-common';
import { BrowserModule } from '@opensumi/ide-core-browser';
import type { ResourceService } from '@opensumi/ide-editor';
import { BrowserEditorContribution, EditorComponentRegistry } from '@opensumi/ide-editor/lib/browser/types';

import { BinaryViewer } from './BinaryViewer';

const BINARY_COMPONENT_ID = 'webapp.binary-viewer';
const FILE_SCHEME = 'file';

/** 二进制扩展名 (不能进文本编辑器, 走 BinaryViewer 兜底) */
const BINARY_EXTS = new Set([
  'ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx',
  'zip', 'rar', '7z', 'gz', 'tar', 'bz2',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp',
  'mp4', 'mkv', 'avi', 'mov', 'webm', 'mp3', 'wav', 'ogg', 'flac',
  'exe', 'dll', 'bin', 'dat', 'iso', 'dmg',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
]);

function getExt(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path || '');
  return m ? m[1].toLowerCase() : '';
}

/**
 * 二进制文件兜底查看器 — 独立扩展 (不属于 PDF 插件)
 *
 * 二进制扩展名 (office/图片/音视频/压缩包等) 打开时显示 BinaryViewer,
 * 不进文本编辑器避免崩溃. 文本文件不干扰 (内置 resolver 处理).
 */
@Injectable()
@Domain(BrowserEditorContribution)
export class BinaryContribution implements BrowserEditorContribution {
  registerResource(_resourceService: ResourceService): void {
    // file scheme 已由框架提供
  }

  registerEditorComponent(registry: EditorComponentRegistry): void {
    registry.registerEditorComponent({
      uid: BINARY_COMPONENT_ID,
      scheme: FILE_SCHEME,
      component: BinaryViewer as any,
    });
    registry.registerEditorComponentResolver(
      (scheme: string) => (scheme === 'file' ? 900 : -1),
      (resource: any, results: any[], resolve: (r: any[]) => void) => {
        const uri: any = resource?.uri;
        const pathStr = (uri?.path?.toString?.() || '').toLowerCase();
        const codeFsPath = String(uri?.codeUri?.fsPath || '').toLowerCase();
        const ext = getExt(pathStr || codeFsPath);
        if (BINARY_EXTS.has(ext)) {
          // 二进制: 兜底 BinaryViewer (不进文本编辑器, 避免崩溃)
          resolve([
            {
              componentId: BINARY_COMPONENT_ID,
              type: 'component',
              title: '二进制文件',
              weight: 900,
            },
          ]);
        }
        // 非二进制: 不 resolve, 让后续 resolver 继续
      },
    );
  }
}

@Injectable()
export class BinaryModule extends BrowserModule {
  providers = [BinaryContribution];
  contributionProvider = [BrowserEditorContribution];
}
