/**
 * Sessions 拓展 — extensions/sessions/
 *
 * OpenSumi 拓展 (一个子目录一个拓展):
 *   - module.ts        OpenSumi 扩展注册 (SessionsModule + SessionsContribution)
 *   - SessionsView.tsx 左侧第一个活动栏图标对应的面板 UI
 *
 * 挂载: slots.ts 的 layoutConfig['left'].modules = ['sessions-default', '@opensumi/ide-explorer']
 *       priority=0 让 sessions 在 explorer (priority=10) 之前.
 */
export { SessionsModule, SessionsContribution, SessionsDefaultContribution } from './module';
export { SessionsView } from './SessionsView';
export type { SessionsViewProps } from './SessionsView';
