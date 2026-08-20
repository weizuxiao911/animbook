import React from 'react';
import { getBrand } from '../../brand';

export const LoginGate: React.FC = () => (
  <div className="chat__gate">
    <div className="chat__gate-logo"><span>T</span></div>
    <h2 className="chat__gate-title">
      与 <span className="chat__gate-brand">{getBrand().nameZh}</span> 一起，开启智能阅读
    </h2>
    <ul className="chat__gate-features">
      <li>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>集成丰富上下文，回答更准确</span>
      </li>
      <li>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        <span>开放智能体生态，满足多样任务需求</span>
      </li>
      <li>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <span>理解需求、调动工具、端到端完成真实任务</span>
      </li>
    </ul>
    <button
      type="button"
      className="chat__gate-btn"
      onClick={() => window.dispatchEvent(new CustomEvent('chat:login-show'))}
    >
      {getBrand().loginButton}
    </button>
  </div>
);