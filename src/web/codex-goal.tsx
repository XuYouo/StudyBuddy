import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { type CodexGoal, goalStatusAction, goalTime, goalUsageKind } from '../codex-goal.ts';
import { errorText, locale, t, useLanguage } from './i18n.ts';
import { Icon } from './icons.tsx';
import './codex-goal.css';

export interface CodexGoalActions {
  onSet: (objective: string, revision?: number) => Promise<void>;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onClear: () => Promise<void>;
}

// Static paths measured in the official Goal rail; no webview runtime is loaded.
const goalGlyphs = {
  goal: <><path d="M9.96861 1.91681C10.3002 1.91681 10.569 2.18564 10.569 2.51722C10.5688 2.84865 10.3001 3.11764 9.96861 3.11764C6.14529 3.11779 3.04595 6.21713 3.04579 10.0404C3.04597 13.8637 6.14531 16.964 9.96861 16.9641C13.792 16.9641 16.8921 13.8638 16.8923 10.0404C16.8925 9.709 17.1612 9.44003 17.4927 9.44003C17.8241 9.44019 18.093 9.7091 18.0931 10.0404C18.0929 14.527 14.4552 18.165 9.96861 18.165C5.48215 18.1648 1.84515 14.5269 1.84497 10.0404C1.84513 5.55398 5.48214 1.91697 9.96861 1.91681Z" fill="currentColor"/><path d="M8.73428 5.4417C9.05275 5.34987 9.38553 5.53321 9.47752 5.85167C9.56932 6.17 9.38575 6.50275 9.06755 6.59491C7.60672 7.01688 6.53899 8.36477 6.53894 9.96021C6.53907 11.8943 8.10685 13.4629 10.0409 13.4631C11.6106 13.463 12.9407 12.429 13.385 11.0041C13.4838 10.6877 13.8206 10.5114 14.1371 10.61C14.4536 10.7087 14.6308 11.0455 14.5321 11.3621C13.9357 13.2742 12.1509 14.663 10.0409 14.663C7.44369 14.6628 5.33824 12.5574 5.33812 9.96021C5.33816 7.81571 6.77345 6.00809 8.73428 5.4417Z" fill="currentColor"/><path fillRule="evenodd" clipRule="evenodd" d="M13.8656 1.99087C14.3948 1.60393 15.1805 1.97721 15.1739 2.67063L15.1528 4.83776L17.319 4.8166L17.4539 4.82541C18.1023 4.92002 18.4014 5.73603 17.9115 6.22638L15.5046 8.63331C15.3075 8.83039 15.04 8.94171 14.7613 8.94189H12.2063L10.3936 10.7555C10.1591 10.9899 9.77811 10.9899 9.54364 10.7555C9.30989 10.521 9.30952 10.1407 9.54364 9.90643L11.0486 8.40144V5.22922C11.0486 4.95027 11.1591 4.68234 11.3563 4.48509L13.7633 2.07816L13.8656 1.99087ZM12.2495 5.29005V7.74107H14.6978L16.4136 6.02536L13.9414 6.05004L13.9643 3.57434L12.2495 5.29005Z" fill="currentColor"/></>,
  clear: <><path d="M10.6299 1.33496C12.0335 1.33496 13.2695 2.25996 13.666 3.60645L13.8809 4.33496H17L17.1338 4.34863C17.4369 4.41057 17.665 4.67858 17.665 5C17.665 5.32142 17.4369 5.58943 17.1338 5.65137L17 5.66504H16.6543L15.8574 14.9912C15.7177 16.629 14.3478 17.8877 12.7041 17.8877H7.2959C5.75502 17.8877 4.45439 16.7815 4.18262 15.2939L4.14258 14.9912L3.34668 5.66504H3C2.63273 5.66504 2.33496 5.36727 2.33496 5C2.33496 4.63273 2.63273 4.33496 3 4.33496H6.11914L6.33398 3.60645L6.41797 3.3584C6.88565 2.14747 8.05427 1.33496 9.37012 1.33496H10.6299ZM5.46777 14.8779L5.49121 15.0537C5.64881 15.9161 6.40256 16.5576 7.2959 16.5576H12.7041C13.6571 16.5576 14.4512 15.8275 14.5322 14.8779L15.3193 5.66504H4.68164L5.46777 14.8779ZM7.66797 12.8271V8.66016C7.66797 8.29299 7.96588 7.99528 8.33301 7.99512C8.70028 7.99512 8.99805 8.29289 8.99805 8.66016V12.8271C8.99779 13.1942 8.70012 13.4912 8.33301 13.4912C7.96604 13.491 7.66823 13.1941 7.66797 12.8271ZM11.002 12.8271V8.66016C11.002 8.29289 11.2997 7.99512 11.667 7.99512C12.0341 7.9953 12.332 8.293 12.332 8.66016V12.8271C12.3318 13.1941 12.0339 13.491 11.667 13.4912C11.2999 13.4912 11.0022 13.1942 11.002 12.8271ZM9.37012 2.66504C8.60726 2.66504 7.92938 3.13589 7.6582 3.83789L7.60938 3.98145L7.50586 4.33496H12.4941L12.3906 3.98145C12.1607 3.20084 11.4437 2.66504 10.6299 2.66504H9.37012Z" fill="currentColor"/></>,
  pause: <><path d="M10.625 7.91667C10.625 7.57149 10.9048 7.29167 11.25 7.29167H12.0833C12.4285 7.29167 12.7083 7.57149 12.7083 7.91667V12.0833C12.7083 12.4285 12.4285 12.7083 12.0833 12.7083H11.25C10.9048 12.7083 10.625 12.4285 10.625 12.0833V7.91667Z" fill="currentColor"/><path d="M7.91667 7.29167C7.57149 7.29167 7.29167 7.57149 7.29167 7.91667V12.0833C7.29167 12.4285 7.57149 12.7083 7.91667 12.7083H8.75001C9.09518 12.7083 9.37501 12.4285 9.37501 12.0833V7.91667C9.37501 7.57149 9.09518 7.29167 8.75001 7.29167H7.91667Z" fill="currentColor"/><path fillRule="evenodd" clipRule="evenodd" d="M10 2.08496C14.3713 2.08496 17.915 5.62867 17.915 10C17.915 14.3713 14.3713 17.915 10 17.915C5.62867 17.915 2.08496 14.3713 2.08496 10C2.08496 5.62867 5.62867 2.08496 10 2.08496ZM10 3.41504C6.3632 3.41504 3.41504 6.3632 3.41504 10C3.41504 13.6368 6.3632 16.585 10 16.585C13.6368 16.585 16.585 13.6368 16.585 10C16.585 6.3632 13.6368 3.41504 10 3.41504Z" fill="currentColor"/></>,
  resume: <><path d="M7.96582 7.81836C7.96613 7.17202 8.68075 6.78163 9.22461 7.13086L12.6182 9.3125C13.1184 9.6343 13.1184 10.3657 12.6182 10.6875L9.22461 12.8691C8.68075 13.2184 7.96613 12.828 7.96582 12.1816V7.81836Z" fill="currentColor"/><path fillRule="evenodd" clipRule="evenodd" d="M10 2.08496C14.3713 2.08496 17.915 5.62867 17.915 10C17.915 14.3713 14.3713 17.915 10 17.915C5.62867 17.915 2.08496 14.3713 2.08496 10C2.08496 5.62867 5.62867 2.08496 10 2.08496ZM10 3.41504C6.3632 3.41504 3.41504 6.3632 3.41504 10C3.41504 13.6368 6.3632 16.585 10 16.585C13.6368 16.585 16.585 13.6368 16.585 10C16.585 6.3632 13.6368 3.41504 10 3.41504Z" fill="currentColor"/></>,
  edit: <><path d="M4.33496 11C4.33496 10.6327 4.63273 10.335 5 10.335C5.36727 10.335 5.66504 10.6327 5.66504 11V14.335H9L9.13379 14.3486C9.43692 14.4106 9.66504 14.6786 9.66504 15C9.66504 15.3214 9.43692 15.5894 9.13379 15.6514L9 15.665H5C4.63273 15.665 4.33496 15.3673 4.33496 15V11ZM14.335 9V5.66504H11C10.6327 5.66504 10.335 5.36727 10.335 5C10.335 4.63273 10.6327 4.33496 11 4.33496H15L15.1338 4.34863C15.4369 4.41057 15.665 4.67857 15.665 5V9C15.665 9.36727 15.3673 9.66504 15 9.66504C14.6327 9.66504 14.335 9.36727 14.335 9Z" fill="currentColor"/></>,
};

function GoalIcon({ kind = 'goal' }: { kind?: keyof typeof goalGlyphs }) {
  return <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">{goalGlyphs[kind]}</svg>;
}

export function CodexGoalSent() {
  useLanguage();
  return <span className="codex-goal-sent"><GoalIcon/>{t('Sent as goal')}</span>;
}

function goalStatusLabel(status: CodexGoal['status']) {
  switch (status) {
    case 'active': return t('Pursuing goal');
    case 'paused': return t('Paused goal');
    case 'blocked': return t('Goal stalled');
    case 'usageLimited': return t('Goal usage limited');
    case 'budgetLimited': return t('Goal limited');
    case 'complete': return t('Goal achieved');
  }
}

function GoalUsage({ goal }: { goal: CodexGoal }) {
  const number = new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 });
  const time = goalTime(goal.timeUsedSeconds, locale());
  // The official summary chooses tokens for active/budget-limited goals and
  // time otherwise. Keep the server's usage value; no local ticking timer.
  const label = goalUsageKind(goal) === 'tokens' ? t('{used} / {budget}', { used: number.format(goal.tokensUsed), budget: number.format(goal.tokenBudget!) }) : time;
  return <span className="codex-goal-usage">{label}</span>;
}

// One in-flight action per mounted goal. Errors preserve the last confirmed
// snapshot and draft; switching tasks never receives an old action's UI result.
function useGoalAction() {
  const alive = useRef(true), running = useRef(false);
  const [pending, setPending] = useState<string | null>(null), [error, setError] = useState('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run(name: string, action: () => Promise<void>, after?: () => void) {
    if (running.current) return;
    running.current = true; setPending(name); setError('');
    try { await action(); if (alive.current) after?.(); }
    catch (cause) { if (alive.current) setError(cause instanceof Error && cause.message ? errorText(cause.message) : t('Unable to update goal')); }
    finally { running.current = false; if (alive.current) setPending(null); }
  }
  return { pending, error, run };
}

/** Official composer rail: clear, pause/resume, edit. Host owns capability and
 * reconciliation locks through disabled; no optimistic native status changes. */
export function CodexGoalCard(props: CodexGoalActions & { goal: CodexGoal; disabled?: boolean; resumeRequired?: boolean; revision?: number; notice?: ReactNode }) {
  return <GoalCard key={`${props.goal.threadId}:${props.goal.createdAt}`} {...props}/>;
}

function GoalCard({ goal, disabled, resumeRequired, revision, notice, onSet, onPause, onResume, onClear }: CodexGoalActions & { goal: CodexGoal; disabled?: boolean; resumeRequired?: boolean; revision?: number; notice?: ReactNode }) {
  useLanguage();
  const [editing, setEditing] = useState(false), action = useGoalAction();
  const locked = disabled || action.pending !== null, toggle = resumeRequired ? 'resume' : goalStatusAction(goal.status), id = useId();
  const label = toggle === 'pause' ? t('Pause goal') : t('Resume goal');
  function edit() { if (!locked && !resumeRequired) setEditing(true); }
  return <div className="codex-goal" data-goal-status={goal.status} aria-busy={action.pending !== null}>
    <div className="codex-goal-row">
      <button type="button" className="codex-goal-summary" onClick={edit} disabled={locked || resumeRequired} aria-describedby={id} title={goal.objective}>
        <GoalIcon/><span className="codex-goal-summary-text"><span className="codex-goal-status">{goalStatusLabel(goal.status)}</span><span className="codex-goal-objective">{goal.objective}<span aria-hidden="true"> •</span></span><GoalUsage goal={goal}/></span>
      </button>
      <span className="codex-goal-actions">
        <button type="button" disabled={locked || resumeRequired} aria-label={t('Clear goal')} title={t('Clear goal')} onClick={() => void action.run('clear', onClear)}>{action.pending === 'clear' ? <span className="codex-goal-spinner"/> : <GoalIcon kind="clear"/>}</button>
        {toggle && <button type="button" disabled={locked} aria-label={label} title={label} onClick={() => void action.run('status', toggle === 'pause' ? onPause : onResume)}>{action.pending === 'status' ? <span className="codex-goal-spinner"/> : <GoalIcon kind={toggle === 'pause' ? 'pause' : 'resume'}/>}</button>}
        <button type="button" disabled={locked || resumeRequired} aria-label={t('Edit goal')} title={t('Edit goal')} onClick={edit}><GoalIcon kind="edit"/></button>
      </span>
    </div>
    <span id={id} className="codex-goal-sr-only">{t('Edit goal')}</span>
    {notice && <div className="codex-goal-notice">{notice}</div>}
    {action.error && <p className="codex-goal-error" role="alert">{action.error}</p>}
    <CodexGoalEditor open={editing} goal={goal} revision={revision} disabled={disabled || resumeRequired} onSet={onSet} onClose={() => setEditing(false)}/>
  </div>;
}

/** /goal selects a composer mode; only editing an existing goal opens a modal. */
export function CodexGoalMode({ disabled, onClear }: { disabled?: boolean; onClear: () => void }) {
  useLanguage();
  return <button type="button" className="codex-goal-mode" disabled={disabled} onClick={onClear} aria-label={t('Clear goal')} title={t('Clear goal')}><GoalIcon/><span>{t('Goal')}</span><Icon name="close" size={12}/></button>;
}

function GoalDialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null), id = useId();
  const outside = useRef(false);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); };
  }, []);
  function isOutside(event: React.PointerEvent<HTMLDialogElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  }
  return <dialog ref={dialog} className="codex-goal-dialog" aria-labelledby={id} aria-busy={busy} closedby={busy ? 'none' : 'any'}
    onCancel={event => { if (busy) event.preventDefault(); }} onClose={() => { if (dialog.current) { dialog.current.returnValue = ''; if (!dialog.current.open) onClose(); } }}
    onPointerDown={event => { outside.current = !('closedBy' in HTMLDialogElement.prototype) && isOutside(event); }}
    onPointerUp={event => { if (!busy && outside.current && isOutside(event)) event.currentTarget.close(); outside.current = false; }}>

    <header><span className="codex-goal-dialog-icon"><GoalIcon/></span><h2 id={id}>{title}</h2></header>{children}
    <button type="button" className="codex-goal-close" aria-label={t('Close')} title={t('Close')} disabled={busy} onClick={() => dialog.current?.close()}><svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true"><path d="M14.6549 5.57307C14.9283 5.2997 15.3718 5.2997 15.6451 5.57307C15.9185 5.84643 15.9185 6.28993 15.6451 6.5633L11.3903 10.8182L15.6451 15.0731L15.735 15.1834C15.9141 15.4551 15.8842 15.8242 15.6451 16.0633C15.4061 16.3024 15.0369 16.3322 14.7653 16.1531L14.6549 16.0633L10.4 11.8084L6.14515 16.0633C5.87178 16.3367 5.42828 16.3367 5.15492 16.0633C4.88155 15.7899 4.88155 15.3464 5.15492 15.0731L9.4098 10.8182L5.15492 6.5633L5.06507 6.45295C4.88597 6.18128 4.91584 5.81214 5.15492 5.57307C5.39399 5.33399 5.76313 5.30413 6.0348 5.48322L6.14515 5.57307L10.4 9.82795L14.6549 5.57307Z" fill="currentColor"/></svg></button>
  </dialog>;
}

export function CodexGoalEditor({ open, goal, ...props }: { open: boolean; goal: CodexGoal; revision?: number; disabled?: boolean; onSet: (objective: string, revision?: number) => Promise<void>; onClose: () => void }) {
  return open ? <GoalEditor key={`${goal.threadId}:${goal.createdAt}`} goal={goal} {...props}/> : null;
}

function GoalEditor({ goal, revision, disabled, onSet, onClose }: { goal: CodexGoal; revision?: number; disabled?: boolean; onSet: (objective: string, revision?: number) => Promise<void>; onClose: () => void }) {
  useLanguage();
  const [baselineRevision] = useState(revision);
  const [draft, setDraft] = useState(goal.objective), [baseline] = useState(goal.objective), action = useGoalAction(), id = useId();
  const objective = draft.trim(), busy = action.pending !== null, changed = objective.length > 0 && objective !== baseline;
  return <GoalDialog title={t('Edit goal')} busy={busy} onClose={onClose}>
    <form aria-label={t('Edit goal')} onSubmit={event => { event.preventDefault(); if (!disabled && changed) void action.run('edit', () => onSet(objective, baselineRevision), onClose); }}>
      <label className="codex-goal-sr-only" htmlFor={id}>{t('Goal')}</label>
      <textarea id={id} name="objective" rows={12} autoFocus required value={draft} disabled={busy || disabled} aria-describedby={action.error ? `${id}-error` : undefined}
        onChange={event => setDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
        }}/>
      {action.error && <p id={`${id}-error`} className="codex-goal-error" role="alert">{action.error}</p>}
      <footer><button type="button" className="codex-goal-secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</button><button type="submit" className="codex-goal-primary" disabled={busy || disabled || !changed}>{busy && <span className="codex-goal-spinner"/>}{busy ? t('Saving…') : t('Save')}</button></footer>
    </form>
  </GoalDialog>;
}

/** Mount only after a composer Goal submission would replace a different
 * native objective. Failure leaves the proposed objective available to retry. */
export function CodexGoalReplacement({ objective, onSet, onClose, disabled, attachmentCount = 0 }: { attachmentCount?: number; objective: string; onSet: (objective: string, revision?: number) => Promise<void>; onClose: () => void; disabled?: boolean }) {
  useLanguage();
  const action = useGoalAction(), busy = action.pending !== null;
  return <GoalDialog title={t('Replace current goal?')} busy={busy} onClose={onClose}>
    <p className="codex-goal-description">{t('This will keep the chat but replace the saved goal with your current composer text')}</p>
    <p className="codex-goal-preview">{objective}{attachmentCount > 0 && <span>{t('{n} attachments', { n: attachmentCount })}</span>}</p>
    <form aria-label={t('Replace current goal?')} onSubmit={event => { event.preventDefault(); if (!disabled && (objective.trim() || attachmentCount)) void action.run('replace', () => onSet(objective.trim()), onClose); }}>
      {action.error && <p className="codex-goal-error" role="alert">{action.error}</p>}
      <footer><button type="button" className="codex-goal-secondary" disabled={busy} onClick={onClose} autoFocus>{t('Cancel')}</button><button type="submit" className="codex-goal-primary" disabled={busy || disabled || !objective.trim() && !attachmentCount}>{busy && <span className="codex-goal-spinner"/>}{t('Replace goal')}</button></footer>
    </form>
  </GoalDialog>;
}
