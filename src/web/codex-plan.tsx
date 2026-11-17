import { useEffect, useId, useRef, useState } from 'react';
import type { PendingRequest, Task } from '../shared.ts';
import { ComposerEditor } from './composer-editor.tsx';
import type { ComposerInput } from './composer-input.ts';
import { CodexIcon } from './codex-icons.tsx';
import { Icon } from './icons.tsx';
import { Markdown } from './markdown.tsx';
import { t } from './i18n.ts';
import { browserStorage } from './storage.ts';
import { PLAN_GLYPH } from './codex-plan-glyph.ts';
import './codex-plan.css';

export function PlanModeButton({ disabled, onExit }: { disabled?: boolean; onExit(): void }) {
  return <button type="button" className="codex-plan-mode" aria-label={t('Plan')} title={t('Create a plan')} disabled={disabled} onClick={onExit}>
    <svg className="plan-mode-glyph" width="16" height="16" viewBox={PLAN_GLYPH.viewBox} fill="currentColor" aria-hidden="true">{PLAN_GLYPH.paths.map((d, index) => <path key={index} d={d}/>)}</svg><span className="plan-mode-close"><CodexIcon name="close" size={16}/></span><span>{t('Plan')}</span>
  </button>;
}

export function planDraft(taskId: string, plan: NonNullable<Task['pendingPlan']>) {
  return browserStorage.getItem(`studybuddy:plan:${taskId}:${plan.itemId}`) ?? plan.text;
}

export function NativePlan({ text, editable, onEdit }: { text: string; editable?: boolean; onEdit?: (text: string) => void }) {
  const [expanded, setExpanded] = useState(false), [collapsed, setCollapsed] = useState(false), [editing, setEditing] = useState(false), [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), title = useId();
  useEffect(() => { if (editing) dialog.current?.showModal(); }, [editing]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(timer); }, [copied]);
  async function copy() {
    try { await navigator.clipboard.writeText(text); }
    catch { const area = document.createElement('textarea'); area.value = text; area.readOnly = true; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); }
    setCopied(true);
  }
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })), link = document.createElement('a');
    link.href = url; link.download = 'plan.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <article className="codex-native-plan" data-expanded={expanded}>
    <header><strong>{t('Plan')}</strong><span className="codex-chrome-spacer"/>
      <button type="button" aria-label={t('Download plan')} onClick={download}><Icon name="download" size={16}/></button>
      <button type="button" aria-label={copied ? t('Copied') : t('Copy')} onClick={() => void copy()}><Icon name={copied ? 'check' : 'copy'} size={16}/></button>
      <button type="button" className="plan-open" onClick={() => setEditing(true)}>{t('Open')} ↗</button>
      <button type="button" aria-label={collapsed ? t('Expand plan summary') : t('Collapse plan summary')} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}><CodexIcon name="chevronDown" size={14}/></button>
    </header>
    {!collapsed && <div className="codex-plan-preview"><div className="codex-native-plan-content markdown"><Markdown text={text}/></div><button type="button" className="plan-expand" onClick={() => setExpanded(value => !value)}>{expanded ? t('Collapse plan') : t('Expand plan')}</button></div>}
    {editing && <dialog ref={dialog} className="codex-plan-dialog" aria-labelledby={title} onClose={() => setEditing(false)}><header><h2 id={title}>{t('Plan')}</h2><button type="button" aria-label={t('Close')} onClick={() => dialog.current?.close()}><CodexIcon name="close"/></button></header>
      {editable && onEdit ? <><label htmlFor={title + '-text'}>{t('Edit plan')}</label><textarea id={title + '-text'} value={text} onChange={event => onEdit(event.target.value)}/></> : <div className="markdown"><Markdown text={text}/></div>}
      <footer><button type="button" className="button secondary" onClick={() => dialog.current?.close()}>{t('Done')}</button></footer>
    </dialog>}
  </article>;
}

type Question = { id: string; header?: string; question: string; isOther?: boolean; isSecret?: boolean; options?: { label: string; description?: string }[] };
type Answers = Record<string, string>;

/** Native questions select one answer per page, then send one exact RPC reply. */
function QuestionCard({ questions, initial, disabled, onRemember, onSubmit, onDismiss, plan = false }: {
  questions: Question[]; initial?: Answers; disabled?: boolean; onRemember?: (answers: Answers) => void;
  onSubmit(answers: Answers, source: 'option' | 'freeform'): Promise<unknown>; onDismiss(): Promise<unknown>; plan?: boolean;
}) {
  const [answers, setAnswers] = useState<Answers>(initial || {}), [index, setIndex] = useState(0), [selected, setSelected] = useState(() => Math.max(0, questions[0]?.options?.findIndex(option => option.label === initial?.[questions[0].id]) ?? -1)), [free, setFree] = useState(() => { const first = questions[0], saved = initial?.[first?.id] || ''; return first?.options?.some(option => option.label === saved) ? '' : saved; });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), card = useRef<HTMLFormElement>(null), input = useRef<ComposerInput>(null), heading = useRef<HTMLHeadingElement>(null), title = useId();
  const question = questions[index], options = question?.options || [];
  function remember(next: Answers) { setAnswers(next); onRemember?.(next); }
  function go(next: number) {
    const saved = answers[questions[next].id] || '', choices = questions[next].options || [], position = choices.findIndex(option => option.label === saved);
    setIndex(next); setSelected(Math.max(0, position)); setFree(position >= 0 ? '' : saved); setError('');
  }
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [index]);
  async function send(next: Answers, source: 'option' | 'freeform') {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError('');
    try { await onSubmit(next, source); }
    catch (e) { setError((e as Error).message); pending.current = false; setBusy(false); }
  }
  async function dismiss() {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError('');
    try { await onDismiss(); }
    catch (e) { setError((e as Error).message); pending.current = false; setBusy(false); }
  }
  function choose(value: string, source: 'option' | 'freeform' = 'option') {
    if (pending.current || disabled) return;
    const next = { ...answers, [question.id]: value }; remember(next);
    if (index < questions.length - 1) {
      const nextQuestion = questions[index + 1], saved = next[nextQuestion.id] || '', position = nextQuestion.options?.findIndex(option => option.label === saved) ?? -1;
      setIndex(index + 1); setSelected(Math.max(0, position)); setFree(position >= 0 ? '' : saved);
    } else void send(next, source);
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || input.current?.composing || pending.current || disabled || !card.current?.getClientRects().length) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('dialog,[role=menu],[role=listbox]') || target?.closest('input,textarea,[contenteditable=true]') && !card.current.contains(target)) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void dismiss(); return; }
      if (target?.closest('input,textarea,[contenteditable=true],button,a')) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected(value => (value + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % Math.max(1, options.length)); }
      else if (event.key === 'Enter' && options[selected]) { event.preventDefault(); choose(options[selected].label); }
      else if (/^[1-9]$/.test(event.key) && options[Number(event.key) - 1]) { event.preventDefault(); choose(options[Number(event.key) - 1].label); }
    };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  });
  if (!question) return null;
  const submitFree = () => choose(free.trim(), 'freeform');
  return <form ref={card} className="codex-question-card" aria-labelledby={title} onSubmit={event => { event.preventDefault(); submitFree(); }} aria-busy={busy}>
    <header><h3 ref={heading} tabIndex={-1} id={title}>{question.question}</h3>
      {questions.length > 1 && <nav aria-label={t('Questions')}><button type="button" aria-label={t('Previous question')} disabled={busy || disabled || index === 0} onClick={() => go(index - 1)}><CodexIcon name="back" size={14}/></button><span>{t('{current} of {total}', { current: index + 1, total: questions.length })}</span><button type="button" aria-label={t('Next question')} disabled={busy || disabled || index === questions.length - 1} onClick={() => go(index + 1)}><CodexIcon name="chevronRight" size={14}/></button></nav>}
      <button type="button" aria-label={t('Dismiss')} disabled={busy || disabled} onClick={() => void dismiss()}><CodexIcon name="close" size={16}/></button>
    </header>
    <div className="codex-question-options" role="radiogroup" aria-labelledby={title}>{options.map((option, position) => <button key={option.label} type="button" role="radio" aria-label={option.label} aria-checked={position === selected} disabled={busy || disabled} onFocus={() => setSelected(position)} onClick={() => choose(option.label)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = (position + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length; (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus(); } }}>
      <span className="codex-question-number">{plan ? '•' : position + 1}</span><span><span>{option.label.replace(/\s*\(Recommended\)$/, '')}{/\(Recommended\)$/.test(option.label) && <small>{t('Recommended')}</small>}</span>{option.description && <span className="codex-question-description">{option.description}</span>}</span><span className="codex-question-arrow">→</span>
    </button>)}</div>
    <div className="codex-question-free"><CodexIcon name="pencil" size={16}/>
      {question.isOther !== false || !options.length ? question.isSecret ? <input aria-label={question.question} type="password" value={free} disabled={busy || disabled} onChange={event => { setFree(event.target.value); remember({ ...answers, [question.id]: event.target.value }); }}/> : <ComposerEditor key={question.id} inputRef={input} value={{ text: free, references: [] }} label={t('No, and tell ChatGPT what to do differently')} placeholder={t('No, and tell ChatGPT what to do differently')} onChange={value => { setFree(value.text); remember({ ...answers, [question.id]: value.text }); }} readOnly={busy || disabled} onPasteFiles={() => {}} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submitFree(); } }}/>: <span/>}
      <button type="submit" disabled={busy || disabled}>{free.trim() ? t('Submit') : t('Skip')}</button>
    </div>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </form>;
}

export function NativeQuestions({ request, answerDrafts, respond, onDone, onDismiss }: { request: PendingRequest; answerDrafts: Map<string, Answers>; respond(id: string, body: { answers: Answers; skipped: string[] }): Promise<unknown>; onDone(): void; onDismiss(): Promise<unknown> }) {
  return <QuestionCard questions={request.params.questions || []} initial={answerDrafts.get(request.id)} onRemember={answers => answerDrafts.set(request.id, answers)} onDismiss={onDismiss} onSubmit={async answers => { const questions = request.params.questions || []; const missing = questions.find((question: Question) => !Object.hasOwn(answers, question.id)); if (missing) throw new Error(t('Answer every question before submitting.')); await respond(request.id, { answers, skipped: Object.keys(answers).filter(id => answers[id] === '') }); answerDrafts.delete(request.id); onDone(); }}/>;
}

export function PlanDecision({ task, text, disabled, submit, onDone }: { task: Task; text: string; disabled?: boolean; submit(body: { turnId: string; action: string; text?: string; requestKey?: string }): Promise<unknown>; onDone(): void }) {
  const plan = task.pendingPlan!, key = `studybuddy:plan-response:${task.id}:${plan.turnId}`, draftKey = key + ':draft';
  return <QuestionCard plan disabled={disabled} initial={{ implement: browserStorage.getItem(draftKey) || '' }} onRemember={answers => browserStorage.setItem(draftKey, answers.implement || '')} questions={[{ id: 'implement', question: t('Implement this plan?'), options: [{ label: t('Yes, implement this plan') }] }]}
    onDismiss={async () => { await submit({ turnId: plan.turnId, action: 'dismiss' }); browserStorage.removeItem(draftKey); onDone(); }} onSubmit={async (answers, source) => {
      if (!answers.implement) { await submit({ turnId: plan.turnId, action: 'skip' }); browserStorage.removeItem(draftKey); onDone(); return; }
      const implement = source === 'option', body = { turnId: plan.turnId, action: implement ? 'implement' : 'feedback', text: implement ? text : answers.implement };
      const signature = JSON.stringify(body); let requestKey = '';
      try { const saved = JSON.parse(browserStorage.getItem(key) || 'null'); if (saved?.signature === signature) requestKey = saved.requestKey; } catch { /* Start a new identity for an invalid local receipt. */ }
      requestKey ||= crypto.randomUUID(); browserStorage.setItem(key, JSON.stringify({ signature, requestKey }));
      await submit({ ...body, requestKey }); browserStorage.removeItem(key); browserStorage.removeItem(draftKey); onDone();
    }}/>
}
