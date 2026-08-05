/**
 * PdfReaderView — animbook PDF 阅读器 (最简化版)
 *
 * 模式 (按用户要求, 全部去复杂化):
 *   1. 一次性渲染所有页 (不懒加载, 简单)
 *   2. 每页 = .page div, width 100% + canvas width 100% height auto
 *   3. fitScale 一次性按初始容器宽算, 不响应 resize (等用户再说要不要)
 *   4. 翻页: setCurrentPage + scrollIntoView
 *   5. 键盘: ArrowLeft/ArrowRight/PageUp/PageDown
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
  const hostPath = useMemo(() => resolveHostPath(resource), [resource]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [numPages, setNumPages] = useState(0);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [currentPage, setCurrentPage] = useState(1);

  // ---------- 加载 PDF + 一次性渲染所有页 ----------
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
        // 一次性渲染所有页
        await renderAllPages(pdf, viewerRef.current);
        setLoading(false);
      } catch (e) {
        if (!cancelled) setError(String((e as any)?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; ac.abort(); try { pdfDocRef.current?.destroy?.(); } catch { /* */ } };
  }, [hostPath]);

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
  }, [currentPage, numPages]);

  const jumpToPage = useCallback((n: number) => {
    const clamped = Math.min(numPages, Math.max(1, n));
    setCurrentPage(clamped);
    const el = viewerRef.current?.querySelector(`[data-page="${clamped}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, [numPages]);

  return (
    <div className="ab-pdf">
      <style>{STYLES}</style>
      <div className="ab-pdf__viewerContainer" ref={viewerRef}>
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
      </div>

      {!loading && !error && (
        <div className="ab-pdf__toolbar">
          <button className="ab-pdf__btn" disabled={currentPage <= 1} onClick={() => jumpToPage(currentPage - 1)}>‹</button>
          <span className="ab-pdf__pageno">
            <input
              className="ab-pdf__pagenoInput"
              value={currentPage}
              onChange={(e) => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v)) jumpToPage(v); }}
            />{' '}/ {numPages}
          </span>
          <button className="ab-pdf__btn" disabled={currentPage >= numPages} onClick={() => jumpToPage(currentPage + 1)}>›</button>
        </div>
      )}
    </div>
  );
};

/**
 * 一次性渲染所有页.
 * canvas width: 100% height: auto, 由 CSS 决定显示尺寸.
 * 渲染时 fitScale = containerW / pageW (一次性按初始容器宽算).
 */
async function renderAllPages(pdf: any, viewer: HTMLElement | null) {
  if (!viewer) return;
  viewer.innerHTML = '';

  const firstPage = await pdf.getPage(1);
  const base = firstPage.getViewport({ scale: 1 });
  const containerW = Math.max(viewer.clientWidth - 16, 60);
  const fitScale = containerW / base.width;
  const dpr = window.devicePixelRatio || 1;
  const renderScale = fitScale * dpr;

  // 串行渲染所有页 (避免一次并发 439 个, 卡浏览器)
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: renderScale });

    const pageDiv = document.createElement('div');
    pageDiv.className = 'ab-pdf-page';
    pageDiv.dataset['page'] = String(i);

    const canvas = document.createElement('canvas');
    canvas.className = 'ab-pdf-canvas';
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.display = 'block';
    pageDiv.appendChild(canvas);

    viewer.appendChild(pageDiv);

    const ctx = canvas.getContext('2d');
    if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
  }
}

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
  display: flex; flex-direction: column; align-items: stretch;
  background: transparent;
}
.ab-pdf-page {
  position: relative;
  margin: 8px 0;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,0.5);
  flex-shrink: 0;
}
.ab-pdf-canvas {
  display: block;
  width: 100% !important;
  height: auto !important;
}
.ab-pdf__error { margin: auto; color: #fca5a5; font-size: 14px; padding: 20px; }
.ab-pdf__loading {
  margin: auto;
  display: flex; flex-direction: column; align-items: center;
  gap: 14px;
  color: #d4d4d4; font-size: 13px;
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
