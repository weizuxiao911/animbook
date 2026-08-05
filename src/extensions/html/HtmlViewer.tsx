/**
 * HtmlViewer — animbook HTML 预览/编辑组件
 *
 * 默认 webview (iframe srcDoc) 渲染 HTML 页面, 工具栏可切换为 monaco 文本编辑模式:
 *   - 预览模式: iframe 渲染 (sandbox=allow-scripts), 支持刷新
 *   - 编辑模式: monaco editor (html language), 支持 Cmd/Ctrl+S 保存 + 切换回预览自动更新
 *
 * 读取走 FS API (__ANIMBOOK_FS_API__.readBinaryAbsolute), 保存走 fsWrite (PTY base64 通道).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// @ts-ignore — monaco fork standalone api
import * as monaco from '@opensumi/monaco-editor-core/esm/vs/editor/editor.api';

interface Props {
  resource: {
    uri: { codeUri: { fsPath: string; path: string } } | { path: string };
  };
}

type Mode = 'preview' | 'edit';

const FS = () => (window as any).__ANIMBOOK_FS_API__;

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

function getFileName(hostPath: string): string {
  const parts = String(hostPath).split('/');
  return parts[parts.length - 1] || String(hostPath);
}

/** 绝对 hostPath → workspace 相对路径 (fsWrite 入参) */
function toIdePath(hostPath: string): string {
  const root = FS()?.getWorkspaceDirSync?.();
  if (root && hostPath.startsWith(root)) {
    return hostPath.slice(root.length).replace(/^\/+/, '');
  }
  return hostPath;
}

export const HtmlViewer: React.FC<Props> = ({ resource }) => {
  const hostPath = useMemo(() => resolveHostPath(resource), [resource]);
  const fileName = useMemo(() => getFileName(hostPath), [hostPath]);

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

  // 加载文件
  useEffect(() => {
    if (!hostPath) return;
    let cancelled = false;
    (async () => {
      try {
        const bytes = await FS()?.readBinaryAbsolute(hostPath);
        if (cancelled) return;
        setHtml(new TextDecoder().decode(bytes));
        setError('');
      } catch (e) {
        if (cancelled) return;
        setError(String((e as any)?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hostPath]);

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

  const handleSave = useCallback(async (content: string) => {
    const ok = await FS()?.write(toIdePath(hostPath), content);
    setSavedTip(true);
    setTimeout(() => setSavedTip(false), 1200);
    if (ok) setHtml(content);
  }, [hostPath]);

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
