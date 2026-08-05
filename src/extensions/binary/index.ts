/**
 * 二进制文件兜底查看器拓展 — extensions/binary/
 *
 * OpenSumi 拓展:
 *   - module.ts        BinaryModule + BinaryContribution (注册 editor component)
 *   - BinaryViewer.tsx 二进制文件信息页 (文件名 + 图标 + 无法预览提示)
 *
 * 二进制扩展名 (office/图片/音视频/压缩包等) 双击打开时显示 BinaryViewer,
 * 不进文本编辑器避免崩溃. 文本文件不干扰, 由内置 resolver 处理.
 */
export { BinaryModule, BinaryContribution } from './module';
export { BinaryViewer } from './BinaryViewer';
