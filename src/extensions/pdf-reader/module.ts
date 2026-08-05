import { Injectable } from '@opensumi/di';
import { URI, Domain } from '@opensumi/ide-core-common';
import { BrowserModule } from '@opensumi/ide-core-browser';
import type { ResourceService } from '@opensumi/ide-editor';
import { BrowserEditorContribution, EditorComponentRegistry } from '@opensumi/ide-editor/lib/browser/types';

import { PdfReaderView } from './PdfReaderView';

const PDF_COMPONENT_ID = 'animbook.pdf-reader';
const PDF_SCHEME = 'file';

/**
 * PdfReader 拓展 — 把 .pdf 文件用 PdfReaderView 作为编辑器组件打开.
 *
 * 注册:
 *   - EditorComponent uid = PDF_COMPONENT_ID (scheme = file)
 *   - registerEditorComponentResolver for file scheme, 当 URI 以 .pdf 结尾时
 *     返回 component 类型, 优先级高于默认 text editor
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
    // 用 function 重载给所有 file:// URI 一个权重, 命中 .pdf 时高权重返回 PDF reader,
    // 其余情况 resolve(results) 把控制权交给其他 resolver
    // (OpenSumi 内置的 FileSystemEditorComponentContribution 把 .pdf 当 text 打开,
    //  我们用 weight=1000 抢在前面)
    registry.registerEditorComponentResolver(
      (scheme: string) => (scheme === 'file' ? 1000 : -1),
      (resource: any, results: any[], resolve: (r: any[]) => void) => {
        const uri: any = resource?.uri;
        const pathStr = (uri?.path?.toString?.() || '').toLowerCase();
        const codeFsPath = String(uri?.codeUri?.fsPath || '').toLowerCase();
        // eslint-disable-next-line no-console
        console.log('[pdf] resolver hit', { pathStr, codeFsPath, scheme: uri?.scheme, resultsBefore: results.length });
        if (pathStr.endsWith('.pdf') || codeFsPath.endsWith('.pdf')) {
          resolve([
            {
              componentId: PDF_COMPONENT_ID,
              type: 'component',
              title: 'PDF Reader',
              weight: 1000,
            },
          ]);
        } else {
          resolve(results);
        }
      },
    );
  }
}

@Injectable()
export class PdfReaderModule extends BrowserModule {
  providers = [PdfReaderContribution];
  contributionProvider = [BrowserEditorContribution];
}
