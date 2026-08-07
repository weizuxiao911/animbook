/**
 * 二进制文件查看器 — 兜底处理非文本二进制文件 (ppt/pptx/docx/xlsx/图片等)
 *
 * 打开时显示文件信息 + 提示不可预览, 避免 OpenSumi 当文本打开崩溃.
 */

import React from 'react';

interface Props {
  resource: {
    uri: { codeUri: { fsPath: string; path: string } } | { path: string };
  };
}

const BINARY_ICON = {
  pptx: '📊',
  ppt: '📊',
  docx: '📄',
  doc: '📄',
  xlsx: '📈',
  xls: '📈',
  zip: '📦',
  rar: '📦',
  '7z': '📦',
  png: '🖼️',
  jpg: '🖼️',
  jpeg: '🖼️',
  gif: '🖼️',
  webp: '🖼️',
  svg: '🖼️',
  mp4: '🎬',
  mp3: '🎵',
  wav: '🎵',
  exe: '⚙️',
  dll: '⚙️',
  bin: '⚙️',
};

function getExt(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path || '');
  return m ? m[1].toLowerCase() : '';
}

function getFileName(resource: any): string {
  const uri = resource?.uri;
  if (!uri) return '';
  const path = uri.codeUri?.fsPath || (typeof uri.path === 'string' ? uri.path : '');
  const parts = String(path).split('/');
  return parts[parts.length - 1] || String(path);
}

export const BinaryViewer: React.FC<Props> = ({ resource }) => {
  const fileName = getFileName(resource);
  const ext = getExt(fileName);
  const icon = (BINARY_ICON as any)[ext] || '📄';

  return (
    <div className="ab-binary">
      <style>{STYLES}</style>
      <div className="ab-binary__icon">{icon}</div>
      <div className="ab-binary__name">{fileName}</div>
      <div className="ab-binary__ext">.{ext}</div>
      <div className="ab-binary__hint">二进制文件，无法在编辑器中预览</div>
      <div className="ab-binary__note">该文件不是文本文件，请使用相应软件打开</div>
    </div>
  );
};

const STYLES = `
.ab-binary {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 6px;
  background: var(--editor-background, var(--vscode-editor-background));
  color: var(--editor-foreground, var(--vscode-editor-foreground));
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
}
.ab-binary__icon {
  font-size: 48px;
  margin-bottom: 8px;
}
.ab-binary__name {
  font-size: 16px; font-weight: 600;
  max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ab-binary__ext {
  font-size: 12px; color: var(--descriptionForeground, var(--vscode-descriptionForeground));
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--list-hoverBackground, rgba(128,128,128,0.12));
  padding: 2px 8px; border-radius: 4px;
}
.ab-binary__hint {
  margin-top: 12px;
  font-size: 13px;
  background: color-mix(in srgb, var(--button-background, #2563eb) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--button-background, #2563eb) 30%, transparent);
  padding: 6px 14px; border-radius: 8px;
  color: var(--button-background, #2563eb);
}
.ab-binary__note {
  font-size: 12px; color: var(--descriptionForeground, var(--vscode-descriptionForeground));
}
`;
