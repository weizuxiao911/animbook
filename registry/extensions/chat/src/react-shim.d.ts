/**
 * 'React' 类型垫片 — 与 build.mjs external:['React'] 对应.
 * 运行时由 opensumi require 拦截器注入宿主 react; 这里仅给编辑器/tsc 提供类型.
 */
declare module 'React' {
  import * as React from 'react';
  export = React;
}
