import React, { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { codeToHtml } from 'shiki';
import markedShiki from 'marked-shiki';

/**
 * Markdown 渲染 — 对齐官方 packages/web content-markdown.tsx 实现
 *
 * 管线:
 *   marked 7 + markedShiki 插件 (shiki codeToHtml 双主题高亮)
 *   - link 自动 target=_blank rel=noopener noreferrer
 *   - strip(): 剥离首尾 <tag>...</tag> wrapper (如 <text>)
 *   - 溢出折叠: 默认 3 行截断 (line-clamp) + "显示更多/收起" 按钮
 *   - 右上角复制按钮
 */

const markedWithShiki = marked.use(
  {
    renderer: {
      link({ href, title, text }: any) {
        const titleAttr = title ? ` title="${title}"` : '';
        return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
      },
    },
  },
  markedShiki({
    highlight(code: string, lang: string) {
      return codeToHtml(code, {
        lang: lang || 'text',
        themes: {
          light: 'github-light',
          dark: 'github-dark',
        },
      });
    },
  }),
);

function strip(text: string): string {
  const wrappedRe = /^\s*<([A-Za-z]\w*)>\s*([\s\S]*?)\s*<\/\1>\s*$/;
  const match = text.match(wrappedRe);
  return match ? match[2] : text;
}

export const Markdown: React.FC<{ content: string; streaming?: boolean; expand?: boolean }> = ({
  content,
  streaming,
  expand,
}) => {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(markedWithShiki.parse(strip(content || '')))
      .then((h: string) => { if (!cancelled) setHtml(h); })
      .catch(() => { if (!cancelled) setHtml(String(content || '')); });
    return () => { cancelled = true; };
  }, [content]);

  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => setOverflow(el.scrollHeight > el.clientHeight + 1);
    sync();
    const obs = new ResizeObserver(sync);
    obs.observe(el);
    return () => obs.disconnect();
  }, [html]);

  const showExpand = !expand && overflow;

  return (
    <div
      className={`tc-md${streaming ? ' tc-md--streaming' : ''}${expanded || expand ? ' tc-md--expanded' : ''}`}
    >
      <div className="tc-md__body" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
      {showExpand && (
        <button type="button" className="tc-md__toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '显示更少' : '显示更多'}
        </button>
      )}
      <button
        type="button"
        className="tc-md__copy"
        title="复制"
        aria-label="复制"
        onClick={() => {
          navigator.clipboard.writeText(content || '').catch(() => { /* ignore */ });
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      <style>{`
        .tc-md { position: relative; }
        .tc-md__body {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 3;
          line-clamp: 3;
          overflow: hidden;
          font-size: 13px;
          line-height: 1.6;
          color: var(--editor-foreground, var(--vscode-editor-foreground));
          word-break: break-word;
        }
        .tc-md--expanded .tc-md__body { display: block; }
        .tc-md--streaming .tc-md__body { display: block; }
        .tc-md__body p, .tc-md__body blockquote, .tc-md__body ul, .tc-md__body ol,
        .tc-md__body dl, .tc-md__body table, .tc-md__body pre { margin-bottom: 0.75rem; }
        .tc-md__body ul, .tc-md__body ol { padding-left: 1.4rem; margin-bottom: 0.5rem; }
        .tc-md__body ol > li { margin-bottom: 0.35rem; }
        .tc-md__body li ul, .tc-md__body li ol { margin-top: 0.2rem; margin-bottom: 0; }
        .tc-md__body h1, .tc-md__body h2, .tc-md__body h3, .tc-md__body h4,
        .tc-md__body h5, .tc-md__body h6 {
          font-size: 1em; font-weight: 600; margin-bottom: 0.5rem;
          color: var(--editor-foreground, var(--vscode-editor-foreground)) !important;
        }
        .tc-md__body > *:last-child { margin-bottom: 0; }
        .tc-md__body pre {
          --shiki-dark-bg: var(--editor-background, var(--vscode-editor-background)) !important;
          background: var(--editor-background, var(--vscode-editor-background)) !important;
          border: 1px solid var(--panel-border, var(--vscode-panel-border, rgba(255,255,255,0.06)));
          border-radius: 8px;
          padding: 0.6rem 0.75rem;
          line-height: 1.6;
          font-size: 12px;
          white-space: pre-wrap;
          word-break: break-word;
          overflow-x: auto;
        }
        .tc-md__body code { font-weight: 500; }
        .tc-md__body :not(pre) > code {
          background: var(--textCodeBlock-background, rgba(255,255,255,0.07));
          border-radius: 4px;
          padding: 1px 5px;
          font-size: 0.92em;
        }
        .tc-md__body table { border-collapse: collapse; width: 100%; }
        .tc-md__body th, .tc-md__body td {
          border: 1px solid var(--panel-border, var(--vscode-panel-border, rgba(255,255,255,0.08)));
          padding: 0.4rem 0.6rem;
          text-align: left;
        }
        .tc-md__body th { border-bottom: 1px solid var(--panel-border, var(--vscode-panel-border, rgba(255,255,255,0.12))); font-weight: 600; }
        .tc-md__body blockquote {
          border-left: 3px solid var(--panel-border, var(--vscode-panel-border, rgba(255,255,255,0.15)));
          padding-left: 0.75rem;
          color: var(--descriptionForeground, var(--vscode-descriptionForeground));
        }
        .tc-md__body a { color: var(--textLink-foreground, var(--vscode-textLink-foreground, var(--button-background))); text-decoration: none; }
        .tc-md__body a:hover { text-decoration: underline; }
        .tc-md__toggle {
          flex: 0 0 auto;
          padding: 2px 0;
          font-size: 11px;
          color: var(--descriptionForeground, var(--vscode-descriptionForeground));
          background: transparent; border: none; cursor: pointer;
        }
        .tc-md__toggle:hover { color: var(--editor-foreground, var(--vscode-editor-foreground)); }
        .tc-md__copy {
          position: absolute; top: 0; right: 0;
          width: 22px; height: 22px;
          display: none; align-items: center; justify-content: center;
          background: transparent; border: none; border-radius: 5px;
          color: var(--descriptionForeground, var(--vscode-descriptionForeground)); cursor: pointer;
          padding: 0;
        }
        .tc-md:hover .tc-md__copy { display: inline-flex; }
        .tc-md__copy:hover { background: var(--list-hoverBackground, rgba(255,255,255,0.08)); color: var(--editor-foreground, var(--vscode-editor-foreground)); }
      `}</style>
    </div>
  );
};
