/**
 * PdfReaderView — animbook PDF 阅读器
 *
 * 模式 (滚动位置与页面一致 + 懒加载):
 *   1. 加载 PDF 后: 算出 fitScale, 为所有页创建占位 div (高度 = 页高×fitScale + margin)
 *      → 滚动条完整, 滚动位置天然对应页面位置, 不需要手动翻页
 *   2. IntersectionObserver 监听占位 div: 进入视口 → 渲染该页 canvas (+ 标注层)
 *   3. 已渲染的页不重复渲染 (缓存标记)
 *   4. 滚动到哪页, 哪页自动加载显示, 位置一致
 *   5. 键盘/页码输入仍可跳转 (scrollIntoView)
 *
 * 读取走 FS API (__ANIMBOOK_FS_API__.readBinaryAbsolute).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// @ts-ignore — pdfjs-dist v4 ships ESM types, loose import
import * as pdfjsLib from 'pdfjs-dist';

const PDF_WORKER_CACHE_KEY = '__ANIMBOOK_PDF_WORKER_URL__';
function setupPdfWorker() {
  if (typeof window === 'undefined') return;
  if ((pdfjsLib as any).GlobalWorkerOptions.workerSrc) return;
  const cached = (window as any)[PDF_WORKER_CACHE_KEY];
  if (cached) { (pdfjsLib as any).GlobalWorkerOptions.workerSrc = cached; return; }
  const version = (pdfjsLib as any).version || '4.10.38';
  const candidates = [
    `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`,
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`,
  ];
  const tryOne = (url: string) => fetch(url)
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then((text) => {
      const blob = new Blob([text], { type: 'text/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      (window as any)[PDF_WORKER_CACHE_KEY] = blobUrl;
      (pdfjsLib as any).GlobalWorkerOptions.workerSrc = blobUrl;
    });
  (async () => {
    for (const u of candidates) {
      try { await tryOne(u); return; } catch { /* next */ }
    }
  })();
}
setupPdfWorker();

interface Props {
  resource: {
    uri: { codeUri: { fsPath: string; path: string } } | { path: string };
  };
}

function resolveHostPath(resource: any): string {
  const uri = resource?.uri;
  if (!uri) return '';
  if (uri.codeUri?.fsPath) return uri.codeUri.fsPath;
  if (typeof uri.path === 'string') return uri.path;
  if (typeof uri.toString === 'function') {
    const s = uri.toString();
    if (s.startsWith('file://')) return decodeURIComponent(s.slice('file://'.length));
    return s;
  }
  return '';
}

async function openPdfFromBytes(bytes: Uint8Array): Promise<any> {
  return await (pdfjsLib as any).getDocument({
    data: bytes.slice(0),
    cMapUrl: 'https://unpkg.com/pdfjs-dist@4.10.38/cmaps/',
    cMapPacked: true,
    isEvalSupported: false,
  }).promise;
}

export const PdfReaderView: React.FC<Props> = ({ resource }) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<any>(null);
  /** 已渲染完成的 page idx 集合 */
  const renderedRef = useRef<Set<number>>(new Set());
  /** 正在渲染中的 page idx 集合 (防并发) */
  const inFlightRef = useRef<Set<number>>(new Set());
  /** fitScale (所有页共用) */
  const fitScaleRef = useRef<number>(1);
  /** page 原始尺寸 */
  const pageBaseRef = useRef<{ width: number; height: number } | null>(null);
  /** 每页占位 div 引用 */
  const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map());

  const hostPath = useMemo(() => resolveHostPath(resource), [resource]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [numPages, setNumPages] = useState(0);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [currentPage, setCurrentPage] = useState(1);
  /** 页码输入框 (非受控, 输入时不被滚动同步抢走) */
  const pageInputRef = useRef<HTMLInputElement>(null);
  /** 输入框是否聚焦中 (聚焦时不更新它的值) */
  const inputFocusedRef = useRef(false);

  /** 同步页码显示 (滚动/跳转时更新输入框, 但聚焦中不抢) */
  const syncPageDisplay = useCallback((n: number) => {
    if (inputFocusedRef.current) return;
    const el = pageInputRef.current;
    if (el) el.value = String(n);
  }, []);

  /** 渲染单页: 在占位 div 里插入 canvas + 标注层 */
  const renderPage = useCallback(async (pageIdx: number) => {
    if (pageIdx < 1 || pageIdx > numPages) return;
    if (renderedRef.current.has(pageIdx)) return;
    if (inFlightRef.current.has(pageIdx)) return;
    const pdf = pdfDocRef.current;
    const pageEl = pageElsRef.current.get(pageIdx);
    if (!pdf || !pageEl) return;
    if (!pageBaseRef.current) return; // 等 fitScale 算好

    inFlightRef.current.add(pageIdx);
    try {
      const page = await pdf.getPage(pageIdx);
      const dpr = window.devicePixelRatio || 1;
      const renderScale = fitScaleRef.current * dpr;
      const viewport = page.getViewport({ scale: renderScale });

      const canvas = document.createElement('canvas');
      canvas.className = 'ab-pdf-canvas';
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';
      pageEl.appendChild(canvas);

      const ctx = canvas.getContext('2d');
      if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;

      // 标注层
      try {
        const annots = await page.getAnnotations();
        if (annots && annots.length > 0) {
          const layerDiv = document.createElement('div');
          layerDiv.className = 'ab-pdf-annot-layer';
          layerDiv.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;';
          pageEl.appendChild(layerDiv);

          const { AnnotationLayer } = pdfjsLib as any;
          const al = new AnnotationLayer({
            div: layerDiv,
            page,
            viewport: page.getViewport({ scale: renderScale }),
            accessibilityManager: null,
            annotationCanvasMap: null,
            annotationEditorUIManager: null,
            structTreeLayer: null,
          });
          await al.render({
            viewport: page.getViewport({ scale: renderScale }),
            div: layerDiv,
            annotations: annots,
            page,
            linkService: {
              goToLink: () => {},
              goToDestination: () => Promise.resolve(),
              getDestinationHash: () => '',
              getAnchorUrl: () => '',
              getPageNum: () => 1,
              getPage: () => null,
            },
            renderForms: false,
            enableScripting: false,
            hasJSActions: false,
            fieldObjects: null,
            annotationCanvasMap: null,
            accessibilityManager: null,
            annotationEditorUIManager: null,
          });
        }
      } catch (e) {
        console.warn('[pdf] annotation layer page', pageIdx, 'failed:', e);
      }

      renderedRef.current.add(pageIdx);
    } catch (e) {
      if ((e as any)?.name !== 'RenderingCancelledException') {
        console.warn('[pdf] render page', pageIdx, 'failed:', e);
      }
    } finally {
      inFlightRef.current.delete(pageIdx);
    }
  }, [numPages]);

  // ---------- 加载 PDF ----------
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    (async () => {
      setLoading(true);
      setError('');
      setProgress({ loaded: 0, total: 0 });
      try {
        const fsApi = (window as any).__ANIMBOOK_FS_API__;
        if (!fsApi?.readBinaryAbsolute) throw new Error('FS API not ready');
        if (!hostPath) throw new Error('无法解析文件路径');
        const bytes = await fsApi.readBinaryAbsolute(hostPath, {
          signal: ac.signal,
          onProgress: (loaded: number, total: number) => {
            if (!cancelled) setProgress({ loaded, total });
          },
        });
        if (cancelled) return;
        const pdf = await openPdfFromBytes(bytes);
        if (cancelled) return;
        pdfDocRef.current = pdf;
        setNumPages(pdf.numPages);
      } catch (e) {
        if (!cancelled) setError(String((e as any)?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
      try { pdfDocRef.current?.destroy?.(); } catch { /* */ }
    };
  }, [hostPath]);

  // ---------- 建占位 + 挂 IntersectionObserver (滚动懒加载) ----------
  useEffect(() => {
    if (!numPages) return;
    const viewer = viewerRef.current;
    if (!viewer) return;

    (async () => {
      // 算 fitScale (用第 1 页原生尺寸)
      const firstPage = await pdfDocRef.current.getPage(1);
      const base = firstPage.getViewport({ scale: 1 });
      pageBaseRef.current = { width: base.width, height: base.height };
      const containerW = Math.max(viewer.clientWidth - 16, 60);
      fitScaleRef.current = containerW / base.width;

      // 清空, 建所有页占位 div (高度 = 页高×fitScale + 页间距)
      viewer.innerHTML = '';
      pageElsRef.current.clear();
      renderedRef.current.clear();
      const pageGap = 8;
      const pageH = base.height * fitScaleRef.current;

      for (let i = 1; i <= numPages; i++) {
        const div = document.createElement('div');
        div.className = 'ab-pdf-page';
        div.dataset['page'] = String(i);
        div.style.cssText = `width:100%;height:${pageH}px;margin-bottom:${pageGap}px;`;
        viewer.appendChild(div);
        pageElsRef.current.set(i, div);
      }

      // IntersectionObserver: 进入视口 → 渲染
      // 页码取"可视区占比最大的页" (避免 200px 预加载余量导致页码漂移)
      const io = new IntersectionObserver(
        (entries) => {
          let best: { i: number; ratio: number } | null = null;
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            const i = Number((e.target as HTMLElement).dataset['page']);
            if (!i) continue;
            if (!best || e.intersectionRatio > best.ratio) {
              best = { i, ratio: e.intersectionRatio };
            }
            // 所有进入视口的页都渲染 (懒加载)
            void renderPage(i);
          }
          if (best) {
            setCurrentPage(best.i);
            syncPageDisplay(best.i);
          }
        },
        { root: viewer, rootMargin: '200px 0px' },
      );
      pageElsRef.current.forEach((el) => io.observe(el));

      // 首次渲染第 1 页 (立即显示)
      void renderPage(1);
      syncPageDisplay(1);
      setLoading(false);

      return () => io.disconnect();
    })();
  }, [numPages, renderPage, syncPageDisplay]);

  // ---------- 跳转到指定页 ----------
  const jumpToPage = useCallback((n: number) => {
    const clamped = Math.min(numPages, Math.max(1, n));
    setCurrentPage(clamped);
    syncPageDisplay(clamped);
    const el = pageElsRef.current.get(clamped);
    if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, [numPages, syncPageDisplay]);

  // ---------- 键盘翻页 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        jumpToPage(currentPage - 1);
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        jumpToPage(currentPage + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentPage, jumpToPage]);

  return (
    <div className="ab-pdf">
      <style>{STYLES}</style>
      {/* viewer div: 永不包含 React children, page DOM 全部手动插入 */}
      <div className="ab-pdf__viewerContainer" ref={viewerRef} />
      {loading && (
        <div className="ab-pdf__loading">
          <div className="ab-pdf__loadingText">
            加载 PDF 中… {progress.total > 0 && (
              <span>
                {Math.round((progress.loaded / progress.total) * 100)}%
                {' '}({formatBytes(progress.loaded)} / {formatBytes(progress.total)})
              </span>
            )}
          </div>
          <div className="ab-pdf__progress">
            <div
              className="ab-pdf__progressBar"
              style={{
                width: progress.total > 0
                  ? `${Math.min(100, (progress.loaded / progress.total) * 100)}%`
                  : '40%',
                animation: progress.total > 0 ? 'none' : 'ab-pdf-indet 1.2s ease-in-out infinite',
              }}
            />
          </div>
        </div>
      )}

      {error && <div className="ab-pdf__error">无法加载: {error}</div>}

      {!loading && !error && (
        <div className="ab-pdf__toolbar">
          <button className="ab-pdf__btn" disabled={currentPage <= 1} onClick={() => jumpToPage(currentPage - 1)}>‹</button>
          <span className="ab-pdf__pageno">
            <input
              ref={pageInputRef}
              className="ab-pdf__pagenoInput"
              defaultValue={currentPage}
              onFocus={() => { inputFocusedRef.current = true; }}
              onBlur={() => {
                inputFocusedRef.current = false;
                const v = parseInt(pageInputRef.current?.value || '', 10);
                if (!Number.isNaN(v) && v !== currentPage) {
                  jumpToPage(v);
                } else {
                  syncPageDisplay(currentPage);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = parseInt(pageInputRef.current?.value || '', 10);
                  if (!Number.isNaN(v)) {
                    inputFocusedRef.current = false;
                    jumpToPage(v);
                    (e.target as HTMLInputElement).blur();
                  }
                }
              }}
            />{' '}/ {numPages}
          </span>
          <button className="ab-pdf__btn" disabled={currentPage >= numPages} onClick={() => jumpToPage(currentPage + 1)}>›</button>
        </div>
      )}
    </div>
  );
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const STYLES = `
.ab-pdf {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  background: transparent;
  color: var(--editor-foreground);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
  overflow: hidden;
}
.ab-pdf__viewerContainer {
  flex: 1; min-height: 0;
  position: relative;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 8px 0;
  display: block;
  background: transparent;
}
.ab-pdf-page {
  position: relative;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,0.5);
  flex-shrink: 0;
  overflow: hidden;
}
.ab-pdf-canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
.ab-pdf-annot-layer {
  position: absolute;
  top: 0; left: 0;
  pointer-events: none;
  overflow: hidden;
}
.ab-pdf__error {
  position: absolute; inset: 0;
  margin: auto;
  color: #fca5a5; font-size: 14px; padding: 20px;
  text-align: center;
  display: flex; align-items: center; justify-content: center;
}
.ab-pdf__loading {
  position: absolute; inset: 0;
  margin: auto;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px;
  color: #d4d4d4; font-size: 13px;
  background: var(--editor-background, #1e1e1e);
  z-index: 5;
}
.ab-pdf__loadingText { font-variant-numeric: tabular-nums; }
.ab-pdf__loadingText span { color: #fff; }
.ab-pdf__progress { width: min(360px, 60%); height: 4px; background: rgba(255,255,255,0.15); border-radius: 2px; overflow: hidden; }
.ab-pdf__progressBar { height: 100%; background: #6366f1; transition: width .12s linear; }
@keyframes ab-pdf-indet { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }
.ab-pdf__toolbar {
  flex-shrink: 0;
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px;
  background: #252526;
  border-top: 1px solid #1e1e1e;
  color: #cccccc;
}
.ab-pdf__btn {
  height: 26px; min-width: 26px; padding: 0 8px;
  background: #3a3a3a; color: inherit;
  border: 1px solid transparent; border-radius: 5px;
  font-family: inherit; font-size: 12.5px; cursor: pointer;
}
.ab-pdf__btn:hover:not(:disabled) { background: #505050; }
.ab-pdf__btn:disabled { opacity: .4; cursor: not-allowed; }
.ab-pdf__pageno { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; }
.ab-pdf__pagenoInput {
  width: 36px; text-align: center;
  background: #3a3a3a; color: inherit;
  border: 1px solid transparent; border-radius: 4px; padding: 2px 4px; font: inherit;
}
`;
