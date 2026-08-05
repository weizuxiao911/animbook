/**
 * 给 workspace/机器学习.pdf 加标注 (高亮 + 批注)
 * 用 pdf-lib 低层 API (pdf-lib 无 addAnnotation 包装, 手动构造 Annot dict)
 * 不动 git
 */
import { PDFDocument, PDFName, PDFHexString, rgb } from 'pdf-lib';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = join(__dirname, 'workspace/机器学习2.pdf');

/**
 * 中文 → PDF UTF-16BE hex 字符串 (<FEFF 005B 006D ...>)
 * PDF 字符串字面量用 hex 形式存非 ASCII 文本 (ASCII 会被 pdf-lib 原样写坏)
 */
function pdfUtf16Hex(text) {
  const units = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x10000) {
      // surrogate pair
      const hi = Math.floor((code - 0x10000) / 0x400) + 0xd800;
      const lo = ((code - 0x10000) % 0x400) + 0xdc00;
      units.push(hi, lo);
    } else {
      units.push(code);
    }
  }
  const hex = units.map((u) => u.toString(16).padStart(4, '0')).join('');
  return `FEFF${hex}`;
}

async function main() {
  const bytes = await readFile(PDF_PATH);
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  console.log(`[annotate] PDF: ${pages.length} pages, ${bytes.length} bytes`);

  const annots = [
    {
      page: 0,  // 第 1 页
      x: 60, y: 560, w: 220, h: 22,
      color: [1, 0.9, 0],      // 黄
      text: '[modal:西瓜书简介] 机器学习经典教材。\n作者周志华, 清华大学出版社。\n这本书系统介绍机器学习基础理论。',
    },
    {
      page: 1,  // 第 2 页
      x: 120, y: 520, w: 280, h: 20,
      color: [0.2, 0.9, 0.5],  // 绿
      text: '[tab:第3章 线性模型] 线性模型是机器学习最基础的模型。\n包括线性回归、逻辑回归、线性判别分析等。',
    },
    {
      page: 2,  // 第 3 页
      x: 120, y: 480, w: 250, h: 18,
      color: [1, 0.55, 0.1],   // 橙
      text: '[terminal] echo "SVM 章节内容已就绪"; ls',
    },
  ];

  // 清空 PDF 原本所有标注 (重新标注)
  for (const page of pages) {
    const node = page.node;
    const existing = node.Annots?.();
    if (existing) {
      node.set(PDFName.of('Annots'), doc.context.obj([]));
    }
  }
  console.log('[annotate] cleared existing annotations');

  for (const a of annots) {
    const page = pages[a.page];
    const { width: pw, height: ph } = page.getSize();

    // 不在 PDF 内容里画高亮 (前端渲染端按 annotation 渲染高亮, 避免两套高亮)
    // 只写 Highlight annotation: rect + contents(行为) + 颜色 C
    // QuadPoints 是 Highlight 必需的 (四个角的坐标, PDF 坐标系左下原点)
    const rect = [a.x, ph - a.y - a.h, a.x + a.w, ph - a.y];
    const quadPoints = [
      rect[0], rect[1],
      rect[2], rect[1],
      rect[0], rect[3],
      rect[2], rect[3],
    ];
    const noteDict = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: rect,
      QuadPoints: quadPoints,
      Contents: PDFHexString.of(pdfUtf16Hex(a.text)),
      T: PDFHexString.of(pdfUtf16Hex('animbook')),
      Open: false,
      C: [a.color[0], a.color[1], a.color[2]],
      M: `D:${new Date().toISOString().slice(0, 10).replace(/-/g, '')}000000Z`,
    });
    const noteRef = doc.context.register(noteDict);

    // Popup (视觉气泡)
    const popupDict = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Popup',
      Rect: [a.x + 10, ph - a.y - a.h - 30, a.x + 260, ph - a.y + 10],
      Parent: noteRef,
      Open: true,
    });
    const popupRef = doc.context.register(popupDict);

    // 关联 note → popup
    noteDict.set(PDFName.of('Popup'), popupRef);

    // 加入 page annotations (pdf-lib 内置 addAnnot 自动处理 Annots 数组)
    page.node.addAnnot(noteRef);

    console.log(`[annotate] page ${a.page + 1} +highlight(${a.w}x${a.h}) +note: ${a.text}`);
  }

  const out = await doc.save();
  await writeFile(PDF_PATH, out);
  console.log(`[annotate] DONE. wrote ${out.length} bytes (${(out.length / 1024 / 1024).toFixed(1)}MB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
