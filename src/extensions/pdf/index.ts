/**
 * PDF 阅读器拓展 — extensions/pdf/
 *
 * OpenSumi 拓展:
 *   - module.ts        PdfReaderModule + PdfReaderContribution (注册 editor component)
 *   - PdfReaderView.tsx pdf.js 渲染 + 标注层 + 侧边栏
 *
 * 双击资源管理器中的 .pdf 文件即可以自定义阅读器打开.
 */
export { PdfReaderModule, PdfReaderContribution } from './module';
export { PdfReaderView } from './PdfReaderView';
