import { Injectable } from '@opensumi/di';
import { Domain } from '@opensumi/ide-core-common';
import { BrowserModule } from '@opensumi/ide-core-browser';
import type { ResourceService } from '@opensumi/ide-editor';
import { BrowserEditorContribution, EditorComponentRegistry } from '@opensumi/ide-editor/lib/browser/types';

import { PdfReaderView } from './PdfReaderView';

const PDF_COMPONENT_ID = 'webapp.pdf-reader';
const PDF_SCHEME = 'file';

/**
 * PDF 阅读器拓展 — 只处理 .pdf 文件.
 *
 * 注册:
 *   - EditorComponent uid = PDF_COMPONENT_ID (scheme = file)
 *   - registerEditorComponentResolver for file scheme, 命中 .pdf 时高权重返回
 *     PDF reader; 其余情况不 resolve (让后续 resolver 继续, resolve 会截断链)
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
    registry.registerEditorComponentResolver(
      (scheme: string) => (scheme === 'file' ? 1000 : -1),
      (resource: any, results: any[], resolve: (r: any[]) => void) => {
        const uri: any = resource?.uri;
        const pathStr = (uri?.path?.toString?.() || '').toLowerCase();
        const codeFsPath = String(uri?.codeUri?.fsPath || '').toLowerCase();
        // eslint-disable-next-line no-console
        console.log('[pdf] resolver hit', { pathStr, codeFsPath, resultsBefore: results.length });
        if (pathStr.endsWith('.pdf') || codeFsPath.endsWith('.pdf')) {
          resolve([
            {
              componentId: PDF_COMPONENT_ID,
              type: 'component',
              title: 'PDF Reader',
              weight: 1000,
            },
          ]);
        }
        // 非 pdf: 不 resolve, 让后续 resolver 继续 (resolve 会截断 resolver 链)
      },
    );
  }
}

@Injectable()
export class PdfReaderModule extends BrowserModule {
  providers = [PdfReaderContribution];
  contributionProvider = [BrowserEditorContribution];
}
