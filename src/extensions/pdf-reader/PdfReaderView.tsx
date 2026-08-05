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

import { toAnnotMeta, runAnnotAction, type PdfAnnotMeta, type AnnotHandlers } from './annotations';
import { AnnotationActions } from './AnnotationActions';

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
    // 禁用 annotation 渲染: 高亮/交互全部由我们的渲染端负责, canvas 只画内容
    annotationMode: 0, // AnnotationMode.DISABLE
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
  /** 标注行为处理器 (组件挂载后赋值) */
  const annotHandlersRef = useRef<AnnotHandlers>({ modal: () => {}, tab: () => {}, terminal: () => {} });

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
      // 每页自己的 fitScale: 宽度适配 div 实际宽度 (div width:100% = viewer 内容宽)
      const pb = page.getViewport({ scale: 1 });
      const containerW = Math.max(pageEl.clientWidth, 60);
      const fitScale = containerW / pb.width;
      const dpr = window.devicePixelRatio || 1;
      const renderScale = fitScale * dpr;
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

      // 标注: 自定义渲染 (hover tip + 点击行为), 不用 pdf.js AnnotationLayer
      try {
        const annots = await page.getAnnotations();
        if (annots && annots.length > 0) {
          const metas = annots
            .map((a: any) => toAnnotMeta(a, pageIdx))
            // 只渲染有行为的热区 (纯信息标注无 action 不渲染, 避免旧标注干扰)
            .filter((m: PdfAnnotMeta) => m.action && m.raw?.rect);

          if (metas.length > 0) {
            const overlay = document.createElement('div');
            overlay.className = 'ab-pdf-annot-layer';
            overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;';
            pageEl.appendChild(overlay);

            // 用 canvas 实际渲染比例换算: PDF 坐标 × renderScale = canvas 内部像素,
            // ÷ (canvas.width / clientWidth) = CSS 像素 (精确对齐 canvas 内容)
            const scaleX = canvas.width / canvas.clientWidth;
            const scaleY = canvas.height / canvas.clientHeight;
            const pageH = pb.height; // 当前页自己的高度 (y 翻转用)
            for (const meta of metas) {
              const rect = meta.raw.rect as [number, number, number, number];
              if (!rect || rect.length < 4) continue;
              const [x1, y1, x2, y2] = rect;
              // PDF 坐标 (左下原点) → canvas 内部像素 (y 翻转) → CSS 像素
              const px1 = x1 * renderScale / scaleX;
              const py1 = (pageH - y1) * renderScale / scaleY;
              const px2 = x2 * renderScale / scaleX;
              const py2 = (pageH - y2) * renderScale / scaleY;
              const left = Math.min(px1, px2);
              const top = Math.min(py1, py2);
              const w = Math.abs(px2 - px1);
              const h = Math.abs(py2 - py1);

              // 高亮 = 标注颜色 (annotation C 字段: pdf.js 返回 Uint8ClampedArray [r,g,b] 0-255)
              const c: any = meta.raw?.color;
              let r = 153, g = 153, b = 255;
              if (c && c.length >= 3) {
                r = Number(c[0]) || r;
                g = Number(c[1]) || g;
                b = Number(c[2]) || b;
              }

              const el = document.createElement('button');
              el.className = 'ab-pdf-annot';
              el.dataset['page'] = String(pageIdx);
              el.dataset['annotId'] = meta.id;
              el.dataset['r'] = String(r);
              el.dataset['g'] = String(g);
              el.dataset['b'] = String(b);
              // 默认极淡 (几乎透明, 只提示位置), hover 时显示标注色高亮
              // 像素定位: viewport 渲染坐标直接对应页面 div 显示尺寸
              el.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${w}px;height:${h}px;pointer-events:auto;background:rgba(${r},${g},${b},0.08);border:1px dashed rgba(${r},${g},${b},0.25);`;
              el.title = meta.preview || meta.title; // 原生 title 兜底

              // hover: 显示标注色高亮 (JS 直接设色, 兼容性好)
              el.addEventListener('mouseenter', () => {
                el.style.background = `rgba(${r},${g},${b},0.35)`;
                el.style.boxShadow = `0 0 0 2px rgba(${r},${g},${b},0.6)`;
                showAnnotTip(el, meta);
              });
              el.addEventListener('mouseleave', () => {
                el.style.background = 'transparent';
                el.style.boxShadow = 'none';
                hideAnnotTip();
              });
              el.addEventListener('click', (ev) => {
                ev.stopPropagation();
                hideAnnotTip();
                if (meta.action) {
                  void runAnnotAction(meta.action, annotHandlersRef.current);
                }
              });

              overlay.appendChild(el);
            }
          }
        }
      } catch (e) {
        console.warn('[pdf] annotation overlay page', pageIdx, 'failed:', e);
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
      const containerW = Math.max(viewer.clientWidth, 60);
      fitScaleRef.current = containerW / base.width;

      // 清空, 建所有页占位 div (高度 = 每页自己的 页高×fitScale + 页间距)
      viewer.innerHTML = '';
      pageElsRef.current.clear();
      renderedRef.current.clear();
      const pageGap = 8;

      for (let i = 1; i <= numPages; i++) {
        const p = await pdfDocRef.current.getPage(i);
        const pb = p.getViewport({ scale: 1 });
        // 每页独立 fitScale: 宽度适配容器, 高度按该页比例
        const fit = containerW / pb.width;
        const pageH = pb.height * fit;
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
        { root: viewer, rootMargin: '50% 0px' },
      );
      pageElsRef.current.forEach((el) => io.observe(el));

      // 首次渲染第 1 页 (立即显示)
      void renderPage(1);
      syncPageDisplay(1);
      setLoading(false);

      return () => io.disconnect();
    })();
  }, [numPages, renderPage, syncPageDisplay]);

  // ---------- 标注行为处理器 (modal / tab / terminal) ----------
  useEffect(() => {
    // modal: 用全局事件打开 (由 App 层监听渲染模态框, 保持 PdfReaderView 独立)
    annotHandlersRef.current.modal = (title, content) => {
      window.dispatchEvent(new CustomEvent('animbook:pdf-annot-modal', {
        detail: { title, content, source: hostPath },
      }));
    };
    // tab: 编辑区打开 untitled tab, 内容写入
    annotHandlersRef.current.tab = (title, content) => {
      window.dispatchEvent(new CustomEvent('animbook:pdf-annot-tab', {
        detail: { title, content, source: hostPath },
      }));
    };
    // terminal: 打开/聚焦终端并执行命令
    annotHandlersRef.current.terminal = (command) => {
      window.dispatchEvent(new CustomEvent('animbook:pdf-annot-terminal', {
        detail: { command, source: hostPath },
      }));
    };
  }, [hostPath]);

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
      <AnnotationActions />
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

/* ========== 标注 tooltip (模块级单例) ========== */
let annotTipEl: HTMLDivElement | null = null;

const ACTION_LABEL: Record<string, string> = {
  modal: '打开内容',
  tab: '在编辑区打开',
  terminal: '在终端运行',
};

function ensureAnnotTip() {
  if (annotTipEl) return annotTipEl;
  const el = document.createElement('div');
  el.className = 'ab-pdf-tip';
  document.body.appendChild(el);
  annotTipEl = el;
  return el;
}

function showAnnotTip(anchor: HTMLElement, meta: PdfAnnotMeta) {
  const tip = ensureAnnotTip();
  const actionLabel = meta.action ? ACTION_LABEL[meta.action.type] : '';
  tip.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'ab-pdf-tip__title';
  title.textContent = meta.title || meta.subtype;
  tip.appendChild(title);
  if (meta.preview) {
    const preview = document.createElement('div');
    preview.className = 'ab-pdf-tip__preview';
    preview.textContent = meta.preview;
    tip.appendChild(preview);
  }
  if (actionLabel) {
    const act = document.createElement('div');
    act.className = 'ab-pdf-tip__action';
    act.textContent = `点击: ${actionLabel}`;
    tip.appendChild(act);
  }
  tip.style.display = 'block';

  // 定位: 在标注元素上方
  const rect = anchor.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  let top = rect.top - tipRect.height - 8;
  // 边界修正
  left = Math.max(4, Math.min(left, window.innerWidth - tipRect.width - 4));
  if (top < 4) top = rect.bottom + 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
  anchor.classList.add('is-hover');
}

function hideAnnotTip() {
  if (annotTipEl) {
    annotTipEl.style.display = 'none';
  }
  document.querySelectorAll('.ab-pdf-annot.is-hover').forEach((el) => el.classList.remove('is-hover'));
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
.ab-pdf-annot {
  border: none;
  cursor: pointer;
  background: transparent;
  transition: background .15s, box-shadow .15s;
}
.ab-pdf-tip {
  position: fixed;
  z-index: 10000;
  display: none;
  max-width: 320px;
  padding: 8px 10px;
  background: #2d2d30;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
  font-size: 12px;
  color: #e5e7eb;
  pointer-events: none;
  word-break: break-word;
}
.ab-pdf-tip__title {
  font-weight: 600;
  margin-bottom: 3px;
}
.ab-pdf-tip__preview {
  color: #9ca3af;
  white-space: pre-wrap;
  max-height: 120px;
  overflow: hidden;
}
.ab-pdf-tip__action {
  margin-top: 5px;
  color: #a5b4fc;
  font-weight: 500;
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
