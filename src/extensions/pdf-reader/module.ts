import { Injectable } from '@opensumi/di';
import { URI, Domain } from '@opensumi/ide-core-common';
import { BrowserModule } from '@opensumi/ide-core-browser';
import type { ResourceService } from '@opensumi/ide-editor';
import { BrowserEditorContribution, EditorComponentRegistry } from '@opensumi/ide-editor/lib/browser/types';

import { PdfReaderView } from './PdfReaderView';
import { BinaryViewer } from './BinaryViewer';

const PDF_COMPONENT_ID = 'animbook.pdf-reader';
const BINARY_COMPONENT_ID = 'animbook.binary-viewer';
const PDF_SCHEME = 'file';

/** 二进制扩展名 (不能进文本编辑器, 走 BinaryViewer 兜底) */
const BINARY_EXTS = new Set([
  'pdf', 'ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx',
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
 * PdfReader 拓展 — .pdf 用 PdfReaderView; 其他二进制用 BinaryViewer 兜底;
 * 文本文件不干扰 (让内置 resolver 处理).
 *
 * 注册:
 *   - EditorComponent uid = PDF_COMPONENT_ID / BINARY_COMPONENT_ID (scheme = file)
 *   - registerEditorComponentResolver for file scheme 分类处理
 */
// eslint-disable-next-line no-console
console.log('[pdf] PdfReaderModule loaded');
@Injectable()
@Domain(BrowserEditorContribution)
export class PdfReaderContribution implements BrowserEditorContribution {
  registerResource(_resourceService: ResourceService): void {
    // file scheme 已由 FileSystemResourceContribution 提供, 不需要再注册
  }

  registerEditorComponent(registry: EditorComponentRegistry): void {
    // eslint-disable-next-line no-console
    console.log('[pdf] registerEditorComponent called');
    registry.registerEditorComponent({
      uid: PDF_COMPONENT_ID,
      scheme: PDF_SCHEME,
      component: PdfReaderView as any,
    });
    registry.registerEditorComponent({
      uid: BINARY_COMPONENT_ID,
      scheme: PDF_SCHEME,
      component: BinaryViewer as any,
    });
    // 用 function 重载给所有 file:// URI 一个权重, 分类处理:
    //   .pdf → PDF 阅读器; 其他二进制 → BinaryViewer 兜底; 文本 → 不 resolve 让内置处理
    registry.registerEditorComponentResolver(
      (scheme: string) => (scheme === 'file' ? 1000 : -1),
      (resource: any, results: any[], resolve: (r: any[]) => void) => {
        const uri: any = resource?.uri;
        const pathStr = (uri?.path?.toString?.() || '').toLowerCase();
        const codeFsPath = String(uri?.codeUri?.fsPath || '').toLowerCase();
        const fullPath = pathStr || codeFsPath;
        const ext = getExt(fullPath);
        // eslint-disable-next-line no-console
        console.log('[pdf] resolver hit', { pathStr, codeFsPath, ext, resultsBefore: results.length });
        if (ext === 'pdf') {
          resolve([
            {
              componentId: PDF_COMPONENT_ID,
              type: 'component',
              title: 'PDF Reader',
              weight: 1000,
            },
          ]);
          return;
        }
        if (BINARY_EXTS.has(ext)) {
          // 其他二进制: 兜底 BinaryViewer (不进文本编辑器, 避免崩溃)
          resolve([
            {
              componentId: BINARY_COMPONENT_ID,
              type: 'component',
              title: '二进制文件',
              weight: 1000,
            },
          ]);
          return;
        }
        // 文本: 不 resolve, 让后续 resolver 继续 (resolve 会截断 resolver 链)
      },
    );
  }
}

@Injectable()
export class PdfReaderModule extends BrowserModule {
  providers = [PdfReaderContribution];
  contributionProvider = [BrowserEditorContribution];
}
