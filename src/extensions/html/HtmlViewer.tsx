/**
 * HtmlViewer — animbook HTML 预览/编辑组件
 *
 * 默认 webview (iframe srcDoc) 渲染 HTML 页面, 工具栏可切换为 monaco 文本编辑模式:
 *   - 预览模式: iframe 渲染 (sandbox=allow-scripts), 支持刷新
 *   - 编辑模式: monaco editor (html language), 支持 Cmd/Ctrl+S 保存 + 切换回预览自动更新
 *
 * 读写走 OpenSumi file service (IFileServiceClient):
 *   插件 → OpenSumi (OverlayFS) → onDidChangeFiles 钩子 → 宿主机 (opencode)
 * 不再直接使用 __ANIMBOOK_FS_API__ 的 PTY 通道.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInjectable } from '@opensumi/ide-core-browser';
import { IFileServiceClient } from '@opensumi/ide-file-service';

// @ts-ignore — monaco fork standalone api
import * as monaco from '@opensumi/monaco-editor-core/esm/vs/editor/editor.api';

interface Props {
  resource: {
    uri: { codeUri: { fsPath: string; path: string } } | { path: string };
  };
}

type Mode = 'preview' | 'edit';

function getUriString(resource: any): string {
  const uri = resource?.uri;
  if (!uri) return '';
  if (typeof uri.toString === 'function') return uri.toString(true);
  if (uri.codeUri?.fsPath) return `file://${uri.codeUri.fsPath}`;
  return '';
}

/**
 * 从 URI 字符串取文件名 (仅展示用)
 */
function getFileName(uriStr: string): string {
  const clean = uriStr.replace(/^file:\/\//, '').split('?')[0];
  const parts = clean.split('/');
  return parts[parts.length - 1] || clean;
}

export const HtmlViewer: React.FC<Props> = ({ resource }) => {
  const fileService = useInjectable<IFileServiceClient>(IFileServiceClient);
  const uriStr = useMemo(() => getUriString(resource), [resource]);
  const fileName = useMemo(() => getFileName(uriStr), [uriStr]);

  const [html, setHtml] = useState('');
  const [mode, setMode] = useState<Mode>('preview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [savedTip, setSavedTip] = useState(false);

  const editRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const htmlRef = useRef('');
  useEffect(() => { htmlRef.current = html; }, [html]);

  // 加载文件 (OpenSumi file service, 内部 OverlayFS → 宿主)
  useEffect(() => {
    if (!uriStr) return;
    let cancelled = false;
    (async () => {
      try {
        const { content } = await fileService.readFile(uriStr);
        if (cancelled) return;
        const text = typeof (content as any)?.toString === 'function'
          ? (content as any).toString()
          : String(content);
        setHtml(text);
        setError('');
      } catch (e) {
        if (cancelled) return;
        setError(String((e as any)?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [uriStr, fileService]);

  // 编辑模式: 创建 monaco editor
  useEffect(() => {
    if (mode !== 'edit' || !editRef.current) return;
    const editor = (monaco as any).editor.create(editRef.current, {
      value: htmlRef.current,
      language: 'html',
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false,
      renderWhitespace: 'none',
      tabSize: 2,
    });
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave(editor.getValue());
    });
    return () => {
      editorRef.current = null;
      editor.dispose();
    };
  }, [mode]);

  // 保存 (走 OpenSumi file service → OverlayFS 写层 → onDidChangeFiles 钩子 → 宿主机)
  const handleSave = useCallback(async (content: string) => {
    try {
      const stat = await fileService.getFileStat(uriStr);
      if (!stat) throw new Error('file stat not found');
      await fileService.setContent(stat, content);
      setHtml(content);
    } catch (e) {
      console.warn('[html] save failed:', uriStr, e);
    } finally {
      setSavedTip(true);
      setTimeout(() => setSavedTip(false), 1200);
    }
  }, [uriStr, fileService]);

  const switchToEdit = useCallback(() => {
    if (editorRef.current) {
      handleSave(editorRef.current.getValue());
    }
    setMode('edit');
  }, [handleSave]);

  const switchToPreview = useCallback(() => {
    if (editorRef.current) {
      handleSave(editorRef.current.getValue());
      setMode('preview');
      setRefreshTick((t) => t + 1);
    } else {
      setMode('preview');
    }
  }, [handleSave]);

  const toolbarBtn = (active: boolean, label: string, onClick: () => void) => (
    <button
      className={active ? 'ab-html__btn ab-html__btn--active' : 'ab-html__btn'}
      onClick={onClick}
    >{label}</button>
  );

  return (
    <div className="ab-html">
      <style>{STYLES}</style>
      <div className="ab-html__toolbar">
        <span className="ab-html__name">📄 {fileName}</span>
        <span className="ab-html__spacer" />
        {savedTip && <span className="ab-html__saved">✓ 已保存</span>}
        <button className="ab-html__btn" onClick={() => setRefreshTick((t) => t + 1)} disabled={mode !== 'preview'}>⟳ 刷新</button>
        {mode === 'preview'
          ? toolbarBtn(true, '👁 预览', () => {})
          : toolbarBtn(false, '👁 预览', switchToPreview)}
        {mode === 'preview'
          ? toolbarBtn(false, '✏️ 编辑', switchToEdit)
          : toolbarBtn(true, '✏️ 编辑', () => {})}
      </div>
      <div className="ab-html__body">
        {loading ? (
          <div className="ab-html__msg">正在加载 {fileName}…</div>
        ) : error ? (
          <div className="ab-html__msg ab-html__msg--error">加载失败: {error}</div>
        ) : mode === 'preview' ? (
          <iframe
            key={refreshTick}
            className="ab-html__frame"
            srcDoc={html}
            sandbox="allow-scripts allow-modals allow-popups allow-forms"
          />
        ) : (
          <div ref={editRef} className="ab-html__editor" />
        )}
      </div>
    </div>
  );
};

const STYLES = `
.ab-html {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  background: var(--editor-background, #1e1e1e);
  color: var(--editor-foreground, #e5e7eb);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
}
.ab-html__toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  background: var(--panel-background, #252526);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  font-size: 13px;
}
.ab-html__name {
  font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ab-html__spacer { flex: 1; }
.ab-html__saved { color: #4ade80; font-size: 12px; }
.ab-html__btn {
  border: 1px solid rgba(255,255,255,0.15);
  background: rgba(255,255,255,0.06);
  color: inherit;
  padding: 3px 10px; border-radius: 6px;
  font-size: 12px; cursor: pointer;
}
.ab-html__btn:hover { background: rgba(255,255,255,0.12); }
.ab-html__btn:disabled { opacity: 0.4; cursor: default; }
.ab-html__btn--active {
  background: rgba(99,102,241,0.25);
  border-color: rgba(99,102,241,0.6);
  color: #c7d2fe;
}
.ab-html__body { flex: 1; min-height: 0; position: relative; }
.ab-html__frame {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  border: none; background: #fff;
}
.ab-html__editor { position: absolute; inset: 0; }
.ab-html__msg {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--descriptionForeground, #9ca3af);
  font-size: 13px;
}
.ab-html__msg--error { color: #fca5a5; }
`;
