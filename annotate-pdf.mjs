/**
 * 给 workspace/机器学习.pdf 加标注 (高亮 + 批注)
 * 用 pdf-lib 低层 API (pdf-lib 无 addAnnotation 包装, 手动构造 Annot dict)
 * 不动 git
 */
import { PDFDocument, PDFName, rgb } from 'pdf-lib';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = join(__dirname, 'workspace/机器学习 -- 周志华-(书签带目录).pdf');

async function main() {
  const bytes = await readFile(PDF_PATH);
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  console.log(`[annotate] PDF: ${pages.length} pages, ${bytes.length} bytes`);

  const annots = [
    {
      page: 0,
      x: 60, y: 560, w: 220, h: 22,
      color: [1, 0.9, 0],      // 黄
      text: 'Machine Learning classic — the Watermelon Book opening!',
    },
    {
      page: 4,
      x: 120, y: 520, w: 280, h: 20,
      color: [0.2, 0.9, 0.5],  // 绿
      text: 'TOC: focus on Ch.3 Linear Models + Ch.7 SVM',
    },
    {
      page: 4,
      x: 120, y: 480, w: 250, h: 18,
      color: [1, 0.55, 0.1],   // 橙
      text: 'Ch.7 SVM — high-frequency interview topic',
    },
    {
      page: 99,
      x: 90, y: 620, w: 260, h: 18,
      color: [0.2, 0.55, 1],   // 蓝
      text: 'Page 100 — key formula derivation',
    },
  ];

  for (const a of annots) {
    const page = pages[a.page];
    const { width: pw, height: ph } = page.getSize();

    // 高亮矩形 (半透明)
    page.drawRectangle({
      x: a.x,
      y: ph - a.y - a.h,
      width: a.w,
      height: a.h,
      color: rgb(a.color[0], a.color[1], a.color[2]),
      opacity: 0.35,
      borderColor: rgb(a.color[0], a.color[1], a.color[2]),
      borderWidth: 1.5,
    });

    // 批注 dict (Subtype Text = sticky note)
    const noteDict = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [a.x, ph - a.y - a.h, a.x + a.w, ph - a.y],
      Contents: a.text,
      T: 'animbook demo',
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
