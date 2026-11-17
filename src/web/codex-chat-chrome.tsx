import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Task } from '../shared.ts';
import { ActionMenu, type MenuAction } from './action-menu.tsx';
import { CodexIcon } from './codex-icons.tsx';
import { locale, t } from './i18n.ts';
import './codex-chat-chrome.css';

export interface CodexChatNavigation {
  tasks: Task[];
  onOpenTask: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
  onShortcuts?: () => void;
  onExpand: () => void;
  expanded: boolean;
  actions?: MenuAction[];
}
const isActive = (task: Task) => ['preparing', 'running', 'building'].includes(task.status);
function recentTime(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return t('just now');
  if (minutes < 60) return t('{n}m', { n: minutes });
  if (minutes < 1440) return t('{n}h', { n: Math.floor(minutes / 60) });
  if (minutes < 10080) return t('{n}d', { n: Math.floor(minutes / 1440) });
  return new Date(timestamp).toLocaleDateString(locale(), { month: 'short', day: 'numeric' });
}
export function CodexChatHeader({ agent, title, navigation, hostControls }: {
  agent: string; title?: string; navigation: CodexChatNavigation; hostControls?: ReactNode;
}) {
  const [history, setHistory] = useState(false), [search, setSearch] = useState('');
  const chrome = useRef<HTMLDivElement>(null), nav = useRef<HTMLDivElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null), historyPanel = useRef<HTMLDivElement>(null), searchInput = useRef<HTMLInputElement>(null);
  const id = useId(), hasPopover = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;
  const tasks = navigation.tasks.filter(task => !task.archivedAt && task.status !== 'deleting'
    && `${task.title} ${task.instructions}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const working = navigation.tasks.some(task => !task.archivedAt && isActive(task));
  function closeHistory(restore = false) {
    if (hasPopover && historyPanel.current?.matches(':popover-open')) historyPanel.current.hidePopover();
    setHistory(false);
    if (restore) historyButton.current?.focus();
  }
  function openHistory() {
    if (history) { closeHistory(); return; }
    setSearch(''); setHistory(true);
    if (hasPopover) historyPanel.current?.showPopover();
  }
  useEffect(() => {
    if (!history) return;
    const panel = historyPanel.current!, pane = chrome.current!.getBoundingClientRect(), row = nav.current!.getBoundingClientRect();
    const width = Math.min(pane.width - 16, window.innerWidth - 16);
    panel.style.width = `${Math.max(0, width)}px`;
    panel.style.left = `${Math.max(8, Math.min(pane.left + 8, window.innerWidth - width - 8))}px`;
    panel.style.top = `${row.bottom + 9}px`;
    panel.style.maxHeight = `${Math.max(80, window.innerHeight - row.bottom - 17)}px`;
    searchInput.current?.focus();
    const dismiss = () => closeHistory();
    const outside = (event: Event) => {
      if (event.target instanceof Node && !panel.contains(event.target) && !historyButton.current?.contains(event.target)) closeHistory();
    };
    window.addEventListener('resize', dismiss); document.addEventListener('focusin', outside);
    if (!hasPopover) document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('resize', dismiss); document.removeEventListener('focusin', outside); document.removeEventListener('pointerdown', outside); };
  }, [history, hasPopover]);
  useEffect(() => { closeHistory(); }, [title]);
  const settingsActions: MenuAction[] = [
    { label: t('Settings'), icon: 'settings', select: navigation.onSettings },
    ...navigation.onShortcuts ? [{ label: t('Keyboard shortcuts'), icon: 'keyboard', select: navigation.onShortcuts }] : [],
  ];
  return <div ref={chrome} className="codex-chrome">
    <header className="codex-titlebar"><h2>{agent}</h2><span className="codex-chrome-spacer"/>{hostControls}
      <button type="button" className="codex-ghost" aria-label={navigation.expanded ? t('Review and chat side by side') : t('Chat only')} title={navigation.expanded ? t('Review and chat side by side') : t('Chat only')} aria-pressed={navigation.expanded} onClick={navigation.onExpand}><CodexIcon name="expand" size={16}/></button>
    </header>
    <div ref={nav} className="codex-navigation">
      {title && <><button type="button" className="codex-ghost codex-back" aria-label={t('Back')} title={t('Back')} onClick={navigation.onNew}><CodexIcon name="back" size={16}/></button><span className="codex-navigation-title" title={title}>{title}</span></>}
      <span className="codex-chrome-spacer"/>
      <div className="codex-navigation-actions">
        {!!navigation.actions?.length && <ActionMenu label={t('Chat actions')} className="codex-ghost" menuClassName="codex-chrome-menu" actions={navigation.actions}><CodexIcon name="more" size={16}/></ActionMenu>}
        <button ref={historyButton} type="button" className="codex-ghost" aria-label={t('History')} title={t('History')} aria-haspopup="dialog" aria-expanded={history} aria-controls={id} onClick={openHistory} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); if (!history) openHistory(); else searchInput.current?.focus(); } }}>{working ? <span className="codex-history-progress"/> : <ChromeGlyph name="history"/>}</button>
        <ActionMenu label={t('Settings')} className="codex-ghost" menuClassName="codex-chrome-menu codex-settings-menu" actions={settingsActions}><ChromeGlyph name="gear"/></ActionMenu>
        <button type="button" className="codex-ghost" aria-label={t('New chat')} title={t('New chat')} onClick={() => { closeHistory(); navigation.onNew(); }}><ChromeGlyph name="compose"/></button>
      </div>
    </div>
    <div ref={historyPanel} id={id} popover={hasPopover ? 'auto' : undefined} hidden={!hasPopover && !history} role="dialog" aria-label={t('History')} className="codex-history" onToggle={event => setHistory((event.nativeEvent as ToggleEvent).newState === 'open')} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeHistory(true); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (event.target !== searchInput.current || event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        const choices = Array.from(historyPanel.current!.querySelectorAll<HTMLButtonElement>('.codex-history-item'));
        if (!choices.length) return;
        event.preventDefault(); event.stopPropagation();
        const index = choices.indexOf(document.activeElement as HTMLButtonElement);
        choices[event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : event.key === 'ArrowDown' ? (index + 1) % choices.length : (index < 0 ? choices.length - 1 : (index - 1 + choices.length) % choices.length)]?.focus();
      }
    }}>
      <div className="codex-history-search"><CodexIcon name="search" size={16}/><input ref={searchInput} type="search" aria-label={t('Search recent chats')} placeholder={t('Search recent chats')} autoComplete="off" autoCapitalize="none" spellCheck={false} value={search} onChange={event => setSearch(event.target.value)}/></div>
      <ul>{tasks.map(task => <li key={task.id}><button type="button" className="codex-history-item" onClick={() => { closeHistory(true); navigation.onOpenTask(task.id); }}><span>{task.title}</span><small>{recentTime(task.updatedAt)}</small>{isActive(task) && <span className="codex-history-progress"/>}</button></li>)}</ul>
      {!tasks.length && <p>{search ? t('No matching tasks') : t('No tasks yet')}</p>}
    </div>
  </div>;
}

// Official OpenAI.chatgpt 26.51111.21308 webview glyphs, captured from its rendered DOM.
const chromeGlyphs = {
  "history": [
    {
      "d": "M7.99951 1.64062C11.511 1.64062 14.3577 4.48756 14.3579 7.99902C14.3579 11.5106 11.5111 14.3574 7.99951 14.3574C4.97316 14.3572 2.44194 12.2435 1.79932 9.41211C1.73517 9.12938 1.91212 8.8474 2.19482 8.7832C2.47756 8.71908 2.75859 8.89696 2.82275 9.17969C3.35918 11.5434 5.47412 13.3074 7.99951 13.3076C10.9312 13.3076 13.3081 10.9307 13.3081 7.99902C13.3079 5.06746 10.9311 2.69141 7.99951 2.69141C5.96082 2.69155 4.19173 3.84199 3.30225 5.53027H4.75928C5.04914 5.53037 5.28369 5.76577 5.28369 6.05566C5.28352 6.3454 5.04904 6.57998 4.75928 6.58008H2.1665C1.87666 6.58008 1.64129 6.34546 1.64111 6.05566V3.13867C1.64111 2.84872 1.87655 2.61328 2.1665 2.61328C2.45645 2.61328 2.69189 2.84872 2.69189 3.13867V4.50098C3.82896 2.77928 5.78029 1.64076 7.99951 1.64062Z"
    },
    {
      "d": "M7.99951 4.2334C8.28946 4.2334 8.5249 4.46884 8.5249 4.75879V8C8.52478 8.13907 8.46895 8.27275 8.37061 8.37109L6.75049 9.99121C6.54548 10.196 6.21327 10.1961 6.0083 9.99121C5.80341 9.78624 5.80348 9.45404 6.0083 9.24902L7.4751 7.78125V4.75879C7.4751 4.46897 7.70975 4.23362 7.99951 4.2334Z"
    }
  ],
  "gear": [
    {
      "d": "M8.00062 5.2793C9.50689 5.2793 10.7289 6.50063 10.7291 8.00684C10.7289 9.51311 9.50693 10.7354 8.00062 10.7354C6.49463 10.735 5.27328 9.51288 5.27308 8.00684C5.27335 6.50086 6.49467 5.27967 8.00062 5.2793ZM8.00062 6.33008C7.07457 6.33045 6.32413 7.08076 6.32386 8.00684C6.32406 8.93298 7.07453 9.68421 8.00062 9.68458C8.92703 9.68458 9.67816 8.93321 9.67836 8.00684C9.67809 7.08053 8.92699 6.33008 8.00062 6.33008Z",
      "fillRule": "evenodd",
      "clipRule": "evenodd"
    },
    {
      "d": "M8.59633 1.24024C9.07592 1.24041 9.51987 1.49643 9.75941 1.91309C9.97218 2.28352 10.2906 2.83779 10.5465 3.28223C10.5982 3.37176 10.694 3.42675 10.7985 3.42676L12.3795 3.42774C12.8587 3.42793 13.3021 3.68368 13.5416 4.09864L14.1295 5.11719C14.3672 5.52926 14.3684 6.03653 14.1334 6.4502L13.2536 8.00098L14.1334 9.54786C14.3685 9.96173 14.3675 10.4706 14.1295 10.8828L13.5416 11.9014C13.302 12.3162 12.8586 12.5721 12.3795 12.5723L10.7975 12.5713C10.6934 12.5715 10.5981 12.6276 10.5465 12.7168C10.2906 13.1614 9.97118 13.7156 9.75844 14.0859C9.51881 14.5027 9.07511 14.7588 8.59535 14.7588C8.17471 14.7588 7.8383 14.7578 7.40492 14.7578C6.92515 14.7578 6.48146 14.5027 6.24183 14.0859C6.02905 13.7155 5.70972 13.1614 5.45375 12.7168C5.40213 12.6273 5.3062 12.5713 5.20179 12.5713H3.62172C3.14243 12.5713 2.69927 12.3155 2.45961 11.9004L1.87172 10.8818C1.63401 10.4698 1.63199 9.96251 1.86683 9.54883L2.74769 7.99903L1.86683 6.4502C1.63181 6.03636 1.63375 5.52838 1.87172 5.11622L2.45961 4.09864C2.69922 3.68389 3.14176 3.42795 3.62074 3.42774H5.20179C5.30622 3.42774 5.4021 3.37172 5.45375 3.28223C5.70967 2.83774 6.0281 2.28351 6.24086 1.91309C6.48037 1.49635 6.92432 1.24044 7.40394 1.24024C7.83772 1.24023 8.1753 1.24023 8.59633 1.24024ZM7.40492 2.29004C7.2999 2.29005 7.20281 2.34636 7.15101 2.43653C6.93819 2.80705 6.62008 3.3617 6.3639 3.80665C6.12441 4.22231 5.6814 4.47732 5.20277 4.47754H3.62172C3.51764 4.47754 3.42093 4.533 3.36879 4.62305L2.7809 5.64161C2.72924 5.73111 2.72899 5.84174 2.77992 5.93165L3.80629 7.73926C3.84008 7.79878 3.86295 7.86417 3.87172 7.93165L3.87562 7.99903C3.87565 8.06763 3.86231 8.13613 3.83656 8.19922L3.80629 8.25977L2.77894 10.0674C2.72805 10.1573 2.72924 10.2679 2.7809 10.3574L3.36879 11.376C3.42092 11.4661 3.51761 11.5215 3.62172 11.5215H5.20179C5.68071 11.5215 6.12432 11.7765 6.3639 12.1924C6.62013 12.6374 6.93914 13.1919 7.15199 13.5625C7.20372 13.6524 7.29923 13.7088 7.40394 13.709C7.83771 13.709 8.17531 13.708 8.59633 13.708C8.70115 13.7078 8.79754 13.6525 8.84926 13.5625C9.06202 13.1921 9.38023 12.6382 9.63636 12.1934C9.87592 11.7773 10.3195 11.5215 10.7985 11.5215H12.3795C12.4834 11.5213 12.5794 11.4658 12.6315 11.376L13.2194 10.3574C13.271 10.2679 13.2714 10.1573 13.2203 10.0674L12.193 8.25977C12.1481 8.18049 12.1256 8.09011 12.1256 7.99903C12.1257 7.9079 12.149 7.81751 12.194 7.73829L13.2203 5.93165C13.2712 5.84187 13.2708 5.73203 13.2194 5.64258L12.6315 4.62403C12.5794 4.53379 12.4828 4.47754 12.3786 4.47754L10.7985 4.47852C10.3197 4.47852 9.87697 4.22238 9.63734 3.80665C9.38106 3.36152 9.0621 2.80612 8.84926 2.43555C8.79741 2.3456 8.70021 2.29005 8.59535 2.29004C8.17471 2.29004 7.8383 2.29004 7.40492 2.29004Z",
      "fillRule": "evenodd",
      "clipRule": "evenodd"
    }
  ],
  "compose": [
    {
      "d": "M6.33325 1.80775C6.62314 1.80775 6.85855 2.04327 6.85864 2.33314C6.85864 2.62309 6.6232 2.85853 6.33325 2.85853H4.66626C3.66786 2.85871 2.85891 3.66777 2.85864 4.66615V11.3331C2.85864 12.3317 3.66769 13.1416 4.66626 13.1417H11.3333C12.332 13.1417 13.1418 12.3319 13.1418 11.3331V9.66615C13.1421 9.37654 13.3766 9.14191 13.6663 9.14174C13.956 9.14174 14.1914 9.37643 14.1917 9.66615V11.3331C14.1917 12.9118 12.9119 14.1915 11.3333 14.1915H4.66626C3.0878 14.1914 1.80786 12.9116 1.80786 11.3331V4.66615C1.80813 3.08787 3.08796 1.80793 4.66626 1.80775H6.33325Z"
    },
    {
      "d": "M10.842 2.3224C11.6259 1.55062 12.8863 1.55447 13.6643 2.33217C14.4442 3.11217 14.4469 4.37719 13.6702 5.16029L9.41626 9.44642C9.05652 9.80891 8.59956 10.0602 8.10083 10.1701L6.19263 10.59C5.7111 10.696 5.28165 10.2668 5.38794 9.78529L5.80884 7.88197C5.9196 7.38049 6.17342 6.92108 6.53931 6.56068L10.842 2.3224ZM12.9221 3.07533C12.552 2.70522 11.9524 2.70334 11.5793 3.07045L7.27563 7.30873C7.05429 7.52675 6.90125 7.80517 6.83423 8.10853L6.54028 9.43861L7.87524 9.14467C8.17687 9.07819 8.45355 8.92637 8.67114 8.70717L12.9241 4.42006C13.2934 4.04753 13.2928 3.44643 12.9221 3.07533Z",
      "fillRule": "evenodd",
      "clipRule": "evenodd"
    }
  ]
} as const;
function ChromeGlyph({ name }: { name: keyof typeof chromeGlyphs }) { return <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">{chromeGlyphs[name].map((props, i) => <path key={i} {...props}/>)}</svg>; }

export function CodexEmptyMark() {
  const maskId = useId();
  return <svg className="codex-empty-mark" width="48" height="48" viewBox="149 149 418 418" fill="none" aria-hidden="true">
    <mask id={maskId} fill="white"><path fillRule="evenodd" clipRule="evenodd" d="M247.429 247.43C257.73 208.911 292.871 180.543 334.638 180.543C359.555 180.543 382.115 190.64 398.449 206.964C405.906 204.97 413.743 203.905 421.829 203.905C471.681 203.906 512.096 244.32 512.096 294.173C512.096 302.259 511.031 310.096 509.037 317.553C525.361 333.887 535.458 356.446 535.458 381.364C535.458 423.131 507.09 458.271 468.571 468.572C458.271 507.091 423.131 535.459 381.364 535.459C356.446 535.459 333.886 525.362 317.552 509.037C310.095 511.031 302.258 512.097 294.172 512.097C244.319 512.097 203.906 471.682 203.906 421.829C203.906 413.743 204.969 405.905 206.963 398.448C190.639 382.115 180.543 359.555 180.543 334.638C180.543 292.871 208.91 257.73 247.429 247.43Z"/></mask>
    <path d="M247.429 247.43L252.746 267.312L264.238 264.239L267.311 252.747L247.429 247.43ZM334.638 180.543L334.638 159.962L334.638 159.962L334.638 180.543ZM398.449 206.964L383.9 221.521L392.297 229.913L403.765 226.846L398.449 206.964ZM421.829 203.905L421.829 183.325L421.829 183.325L421.829 203.905ZM512.096 294.173L532.677 294.173L532.677 294.173L512.096 294.173ZM509.037 317.553L489.155 312.236L486.087 323.705L494.48 332.102L509.037 317.553ZM535.458 381.364L556.039 381.364L556.039 381.364L535.458 381.364ZM468.571 468.572L463.255 448.69L451.762 451.763L448.689 463.255L468.571 468.572ZM381.364 535.459L381.364 556.04L381.364 556.04L381.364 535.459ZM317.552 509.037L332.101 494.481L323.704 486.088L312.235 489.155L317.552 509.037ZM294.172 512.097L294.172 532.678L294.173 532.678L294.172 512.097ZM203.906 421.829L183.325 421.829L183.325 421.829L203.906 421.829ZM206.963 398.448L226.845 403.765L229.912 392.297L221.52 383.9L206.963 398.448ZM180.543 334.638L159.962 334.638L159.962 334.639L180.543 334.638ZM247.429 247.43L267.311 252.747C275.266 223.003 302.423 201.124 334.638 201.124L334.638 180.543L334.638 159.962C283.319 159.962 240.195 194.819 227.547 242.113L247.429 247.43ZM334.638 180.543L334.638 201.124C353.88 201.124 371.268 208.896 383.9 221.521L398.449 206.964L412.997 192.407C392.962 172.383 365.231 159.962 334.638 159.962L334.638 180.543ZM398.449 206.964L403.765 226.846C409.506 225.311 415.557 224.486 421.829 224.486L421.829 203.905L421.829 183.325C411.929 183.325 402.305 184.629 393.132 187.082L398.449 206.964ZM421.829 203.905L421.828 224.486C460.315 224.486 491.516 255.687 491.516 294.173L512.096 294.173L532.677 294.173C532.677 232.953 483.048 183.325 421.829 183.325L421.829 203.905ZM512.096 294.173L491.516 294.173C491.516 300.444 490.69 306.494 489.155 312.236L509.037 317.553L528.919 322.87C531.372 313.698 532.677 304.074 532.677 294.173L512.096 294.173ZM509.037 317.553L494.48 332.102C507.105 344.735 514.877 362.122 514.877 381.364L535.458 381.364L556.039 381.364C556.039 350.771 543.618 323.04 523.594 303.005L509.037 317.553ZM535.458 381.364L514.877 381.364C514.877 413.578 492.999 440.735 463.255 448.69L468.571 468.572L473.888 488.454C521.182 475.806 556.039 432.683 556.039 381.364L535.458 381.364ZM468.571 468.572L448.689 463.255C440.735 492.999 413.578 514.878 381.364 514.878L381.364 535.459L381.364 556.04C432.683 556.04 475.806 521.183 488.454 473.889L468.571 468.572ZM381.364 535.459L381.364 514.878C362.122 514.878 344.733 507.106 332.101 494.481L317.552 509.037L303.003 523.594C323.038 543.619 350.77 556.04 381.364 556.04L381.364 535.459ZM317.552 509.037L312.235 489.155C306.493 490.691 300.443 491.516 294.172 491.516L294.172 512.097L294.173 532.678C304.073 532.678 313.698 531.372 322.869 528.919L317.552 509.037ZM294.172 512.097L294.172 491.516C255.686 491.516 224.486 460.316 224.486 421.829L203.906 421.829L183.325 421.829C183.325 483.048 232.953 532.678 294.172 532.678L294.172 512.097ZM203.906 421.829L224.486 421.829C224.486 415.555 225.311 409.504 226.845 403.765L206.963 398.448L187.081 393.131C184.627 402.307 183.325 411.932 183.325 421.829L203.906 421.829ZM206.963 398.448L221.52 383.9C208.895 371.268 201.124 353.88 201.124 334.638L180.543 334.638L159.962 334.639C159.962 365.231 172.382 392.962 192.406 412.997L206.963 398.448ZM180.543 334.638L201.124 334.638C201.124 302.423 223.002 275.266 252.746 267.312L247.429 247.43L242.112 227.547C194.818 240.195 159.962 283.319 159.962 334.638L180.543 334.638Z" fill="currentColor" mask={`url(#${maskId})`}/>
    <path d="M436.706 408.738H370.021" stroke="currentColor" strokeWidth="24" strokeLinecap="round"/>
    <path d="M276.533 309.154L303.468 357.831C304.433 359.575 304.412 361.698 303.414 363.423L276.533 409.854" stroke="currentColor" strokeWidth="24" strokeLinecap="round"/>
  </svg>;
}
