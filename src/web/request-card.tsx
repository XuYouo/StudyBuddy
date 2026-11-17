import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FileEdit, PendingRequest } from '../shared.ts';
import { ActionMenu } from './action-menu.tsx';
import { CodexIcon } from './codex-icons.tsx';
import { FileDiffs } from './file-changes.tsx';
import { Icon } from './icons.tsx';
import { locale, t, tn } from './i18n.ts';
import './request-card.css';

interface RequestReply { choice?: string; decision?: string; answers?: Record<string, string> }
interface Props {
  request: PendingRequest;
  agent: string;
  changes?: FileEdit[];
  keyboard?: boolean;
  answerDrafts: Map<string, Record<string, string>>;
  respond: (id: string, body: RequestReply) => Promise<unknown>;
  onDone: () => void;
}

/** Preserve the whole command while matching the official three-line preview. */
function CommandPreview({ command }: { command: string }) {
  const text = useRef<HTMLPreElement>(null);
  const [expanded, setExpanded] = useState(false), [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const element = text.current;
    if (!element) return;
    const measure = () => setLong(element.scrollHeight > Number.parseFloat(getComputedStyle(element).lineHeight) * 3 + 17);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [command]);
  return <div className="approval-command"><pre ref={text} data-expanded={expanded}>{command}</pre>
    {long && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? t('Collapse') : t('Expand')}</button>}
  </div>;
}

function permissionPath(value: any): string {
  if (typeof value === 'string') return value;
  if (value?.type === 'path') return value.path || '';
  if (value?.type === 'glob_pattern') return value.pattern || '';
  if (value?.type === 'special') {
    const special = value.value;
    const root = special?.kind === 'root' ? '/' : special?.kind === 'slash_tmp' ? '/tmp' : special?.kind === 'unknown' ? special.path : ['minimal', 'project_roots', 'tmpdir'].includes(special?.kind) ? ':' + special.kind : '';
    return root && special?.subpath ? root.replace(/\/$/, '') + '/' + special.subpath : root;
  }
  return '';
}

function permissionTitle(permissions: any, agent: string): string | undefined {
  const entries = Array.isArray(permissions?.fileSystem?.entries) ? permissions.fileSystem.entries : [];
  // Unknown provider shapes stay visible rather than silently dropping requested access.
  const known = Object.keys(permissions || {}).every(key => key === 'network' || key === 'fileSystem')
    && (!permissions?.network || typeof permissions.network.enabled === 'boolean' && Object.keys(permissions.network).every(key => key === 'enabled'))
    && (!permissions?.fileSystem || Array.isArray(permissions.fileSystem.entries) && Object.keys(permissions.fileSystem).every(key => key === 'entries'))
    && entries.every((entry: any) => ['read', 'write'].includes(entry.access) && permissionPath(entry.path));
  if (!known || permissions?.network?.enabled === false) return;
  const paths = new Map<string, Set<string>>();
  for (const entry of entries) {
    const path = permissionPath(entry.path), access = paths.get(path) || new Set<string>();
    access.add(entry.access); paths.set(path, access);
  }
  const list = new Intl.ListFormat(locale(), { type: 'conjunction' });
  const groups = [
    { kind: 'readWrite', paths: [...paths].filter(([, access]) => access.size > 1).map(([path]) => path) },
    { kind: 'read', paths: [...paths].filter(([, access]) => access.size === 1 && access.has('read')).map(([path]) => path) },
    { kind: 'write', paths: [...paths].filter(([, access]) => access.size === 1 && access.has('write')).map(([path]) => path) },
  ].filter(group => group.paths.length);
  if (!permissions.network && groups.length === 1) {
    const group = groups[0], values = { agent, paths: list.format(group.paths) };
    return group.kind === 'readWrite' ? t('Allow {agent} to view and edit the contents of {paths}?', values)
      : group.kind === 'read' ? t('Allow {agent} to view the contents of {paths}?', values)
      : t('Allow {agent} to edit the contents of {paths}?', values);
  }
  if (!groups.length) return permissions.network ? t('Allow {agent} to connect to the internet?', { agent }) : undefined;
  const actions = [
    ...(permissions.network ? [t('connect to the internet')] : []),
    ...groups.map(group => group.kind === 'readWrite' ? t('view and edit the contents of {paths}', { paths: list.format(group.paths) })
      : group.kind === 'read' ? t('view the contents of {paths}', { paths: list.format(group.paths) })
      : t('edit the contents of {paths}', { paths: list.format(group.paths) })),
  ];
  return t('Allow {agent} to {actions}?', { agent, actions: list.format(actions) });
}

export function RequestCard({ request, agent, changes, keyboard = false, answerDrafts, respond: send, onDone }: Props) {
  const [answers, updateAnswers] = useState<Record<string, string>>(() => answerDrafts.get(request.id) || {});
  function setAnswers(next: Record<string, string>) { answerDrafts.set(request.id, next); updateAnswers(next); }
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  // Ref closes the interval before React commits disabled buttons, including menu actions.
  const pending = useRef(false);
  const card = useRef<HTMLElement>(null);
  const questions = request.method.endsWith('requestUserInput') ? request.params.questions || [] : [];
  async function respond(body: RequestReply) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await send(request.id, body); answerDrafts.delete(request.id); onDone(); }
    catch (e) { pending.current = false; setBusy(false); setError((e as Error).message); }
  }
  useEffect(() => {
    if (questions.length || !keyboard) return;
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || pending.current) return;
      if (!card.current?.getClientRects().length) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, [contenteditable]:not([contenteditable="false" i]), [role="menu"], dialog, [role="dialog"]')) return;
      // Let focused controls perform their own action. Menu Escape never denies.
      if (event.key === 'Enter' && target?.closest('button, a')) return;
      const choice = event.key === 'Enter' ? request.approvalChoices?.find(choice => choice.kind === 'once') : request.approvalChoices?.find(choice => choice.kind === 'decline') || request.approvalChoices?.find(choice => choice.kind === 'cancel');
      if (!['Enter', 'Escape'].includes(event.key) || request.approvalChoices && !choice) return;
      event.preventDefault();
      void respond(choice ? { choice: choice.id } : { decision: event.key === 'Enter' ? 'accept' : 'decline' });
    };
    document.addEventListener('keydown', keyDown);
    return () => document.removeEventListener('keydown', keyDown);
  }, [request, questions.length, keyboard]);
  useLayoutEffect(() => {
    if (keyboard && !questions.length && card.current?.getClientRects().length && !document.activeElement?.closest('input, textarea, [contenteditable]:not([contenteditable="false" i]), [role="menu"], dialog, [role="dialog"]')) {
      card.current?.querySelector<HTMLButtonElement>('.approval-primary:not(:disabled)')?.focus({ preventScroll: true });
    }
  }, [request.id, questions.length, keyboard]);
  // Question prompts keep their drafts and existing provider semantics.
  if (questions.length) return <div className="request-card"><h3><Icon name="chat" size={16}/>{t('{agent} needs your input', { agent })}</h3>
    {questions.map((q: any) => <fieldset className="question" key={q.id}><legend>{q.question || q.header}</legend>{q.options?.length > 0 && <div className="answer-options">{q.options.map((option: any) => <button type="button" disabled={busy} aria-pressed={answers[q.id] === option.label} className={answers[q.id] === option.label ? 'selected' : ''} key={option.label} onClick={() => setAnswers({ ...answers, [q.id]: option.label })}>{option.label}{option.description && <small>{option.description}</small>}</button>)}</div>}{!(q.isOther === false && q.options?.length > 0) && <input type={q.isSecret ? 'password' : 'text'} autoComplete="off" disabled={busy} aria-label={q.question || q.header} placeholder={t('Or type your own answer')} value={answers[q.id] || ''} onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })}/>}</fieldset>)}
    {error && <p className="inline-error" role="alert">{error}</p>}<div className="button-row"><button disabled={busy || questions.some((q: any) => !answers[q.id]?.trim())} className="button primary" onClick={() => void respond({ answers })}>{busy ? t('Submitting…') : t('Reply to {agent}', { agent })}</button></div>
  </div>;

  const { params } = request, file = request.method === 'item/fileChange/requestApproval', permissions = request.method === 'item/permissions/requestApproval';
  const network = params.networkApprovalContext;
  const internetOnly = permissions && params.permissions?.network?.enabled === true && Object.keys(params.permissions.network).every(key => key === 'enabled') && !params.permissions.fileSystem && Object.keys(params.permissions).every(key => key === 'network' || key === 'fileSystem');
  const permissionPrompt = permissions && params.permissions ? permissionTitle(params.permissions, agent) : undefined;
  const choices = request.approvalChoices;
  const once = choices?.find(choice => choice.kind === 'once');
  const deny = choices?.find(choice => choice.kind === 'decline') || choices?.find(choice => choice.kind === 'cancel');
  const scopes = choices?.filter(choice => choice.kind === 'rule' || choice.kind === 'session' && (file || permissions || network)) || [];
  const rules = choices?.filter(choice => choice.kind === 'network') || [];
  const decide = (choice: NonNullable<PendingRequest['approvalChoices']>[number] | undefined, fallback: string) => void respond(choice ? { choice: choice.id } : { decision: fallback });
  const label = (choice: NonNullable<PendingRequest['approvalChoices']>[number]) => choice.kind === 'rule' ? t('Allow similar commands') : file ? t('Allow all edits') : t('Allow this conversation');
  const reason = typeof params.reason === 'string' ? params.reason.trim() : '';
  const command = Array.isArray(params.command) ? params.command.join(' ') : typeof params.command === 'string' ? params.command : '';
  const identity = network || internetOnly ? t('Internet access') : permissions ? t('Permissions') : file ? t('Edit files') : t('Terminal');
  const title = network?.host ? t('Allow {agent} to connect to {host}?', { agent, host: network.host })
    : file ? tn(changes?.length || Object.keys(params.changes || {}).length, 'Allow {agent} to edit the following file?', 'Allow {agent} to edit the following files?', { agent })
    : permissions ? permissionPrompt || t('{agent} is requesting permission for this action.', { agent })
    : reason || t('Allow {agent} to run this command?', { agent });
  const approve = () => decide(once, 'accept');
  return <section ref={card} className="request-card codex-approval" aria-busy={busy}>
    <header className="approval-heading" role="alert" aria-atomic="true"><div className="approval-identity"><Icon name={file ? 'diff' : permissions || network ? 'shield' : 'terminal'} size={16}/>{identity}</div>
      <h3>{title}</h3>
      {(file || permissions || network) && reason && <p>{reason}</p>}
    </header>
    {command && !network && <CommandPreview command={command}/>}
    {permissions && params.permissions && !permissionPrompt && <pre className="approval-unknown-permissions">{JSON.stringify(params.permissions, null, 2)}</pre>}
    {file && <div className="approval-files">{changes?.length ? changes.map(change => <details key={change.path}><summary><span>{change.path}</span><span className="change-count"><ins>+{change.added}</ins> <del>−{change.removed}</del></span><CodexIcon name="chevronDown" size={12}/></summary><FileDiffs changes={[change]} files={[change.path]}/></details>) : <pre>{Object.keys(params.changes || {}).join('\n') || params.grantRoot || t('Apply file changes')}</pre>}</div>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <form className="approval-actions" onSubmit={event => { event.preventDefault(); if (!choices || once) approve(); }}>
      {rules.length === 1 ? <button type="button" disabled={busy} className="approval-button approval-rule" title={rules[0].detail} onClick={() => decide(rules[0], 'accept')}>{rules[0].networkAction === 'deny' ? t('Always deny') : t('Always allow')}</button>
        : rules.length > 1 && <ActionMenu label={t('Always allow')} className="approval-button approval-rule" menuClassName="codex-action-menu approval-menu" disabled={busy} actions={rules.map(choice => ({ id: choice.id, label: choice.networkAction === 'deny' ? t('Always deny') : t('Always allow'), detail: choice.detail, select: () => decide(choice, 'accept') }))}>{t('Always allow')}<CodexIcon name="chevronDown" size={12}/></ActionMenu>}
      <div className="approval-main-actions">
        {(!choices || deny) && <button type="button" disabled={busy} className="approval-button" onClick={() => decide(deny, 'decline')}>{deny?.kind === 'cancel' ? t('Cancel') : t('Deny')}{keyboard && <kbd aria-hidden="true">Esc</kbd>}</button>}
        {(!choices || once || scopes.length > 0) && <div className="approval-split">
          <button type="submit" disabled={busy || (!!choices && !once)} className="approval-button approval-primary">{busy ? t('Submitting…') : <>{t('Allow once')}{keyboard && <kbd aria-hidden="true">↵</kbd>}</>}</button>
          {scopes.length > 0 && <ActionMenu label={t('Approval options')} className="approval-button approval-primary approval-more" menuClassName="codex-action-menu approval-menu" disabled={busy} actions={[
            ...(once ? [{ label: t('Allow once'), select: approve }] : []),
            ...scopes.map(choice => ({ id: choice.id, label: label(choice), detail: choice.detail, select: () => decide(choice, 'accept') })),
          ]}><CodexIcon name="chevronDown" size={14}/></ActionMenu>}
        </div>}
      </div>
    </form>
  </section>;
}
