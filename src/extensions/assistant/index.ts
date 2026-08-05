/**
 * AI 助手拓展 — extensions/assistant/
 *
 * OpenSumi 拓展 (一个子目录一个拓展):
 *   - module.ts       OpenSumi 扩展注册 (AssistantModule + AssistantContribution)
 *   - webview/        AI 交互界面 (React: AiPanel + parts)
 *
 * 数据/命令: commands/ai/ (OpenCode SDK 封装 + 会话/消息 commands)
 */
export { AssistantModule, AssistantContribution } from './module';
