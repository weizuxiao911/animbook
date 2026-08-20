/**
 * build.mjs — esbuild 把 chat vsix 打成单文件 CJS bundle
 *
 * opensumi 兼容 VS Code 扩展标准:
 *   - format: 'cjs' → module.exports, 供 loadBrowserModule 的
 *     new Function('module','exports','require') 执行并取命名导出
 *   - external: ['React'] → 产物保留 require("React"), 由 opensumi
 *     require 拦截器注入宿主 react (避免 vsix 内联第二份 React 崩 hooks)
 *   - jsx: 'transform' → React.createElement (React 由上述拦截器提供)
 */

import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(__dirname, 'dist', 'extension.js');

await build({
  entryPoints: [path.resolve(__dirname, 'src/extension.tsx')],
  bundle: true,
  format: 'cjs',
  outfile: out,
  target: 'es2020',
  platform: 'browser',
  jsx: 'transform',
  external: ['React'],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
  minify: false,
});

console.log(`[chat-vsix] built: ${out}`);
