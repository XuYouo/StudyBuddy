import type { ComposerInput } from './composer-input.ts';
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { filterCommands, removeSlashQuery, slashQuery, type ComposerCommand, type SlashQuery } from './codex-commands.ts';
import { t, useLanguage } from './i18n.ts';
import type { McpServerStatus, Skill } from '../shared.ts';
import { matchSkills, skillDescription, skillIcon, skillName, skillQuery } from './skills.tsx';
import { Icon } from './icons.tsx';
import type { AgentPickerNavigation } from './agent-picker.tsx';
import './codex-command-menu.css';

interface Command extends ComposerCommand { select: (navigation?: AgentPickerNavigation) => void; skill?: Skill; submenu?: boolean; disabled?: boolean; description?: string; secondary?: string }
interface Options {
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<ComposerInput | null>;
  disabled?: boolean;
  onInit?: () => void;
  onGoal?: () => void;
  onSketch?: () => void;
  onReview?: (navigation?: AgentPickerNavigation) => void;
  onFork?: (navigation?: AgentPickerNavigation) => void;
  onPlan?: () => void;
  planMode?: boolean;
  onPlanSkill?: (skill: Skill) => void;
  onFast?: () => void;
  fastServiceTier?: string;
  onModel?: (navigation?: AgentPickerNavigation) => void;
  onReasoning?: (navigation?: AgentPickerNavigation) => void;
  onStatus?: () => void;
  onCompact?: () => void;
  loadMcp?: (signal: AbortSignal) => Promise<McpServerStatus[]>;
  skills?: Skill[];
  onSkill?: (skill: Skill) => void;
}

const queryKey = (value: string, query: SlashQuery | null) => query ? `${query.from}:${query.to}:${value}` : '';

export function useCodexCommands({ value, onChange, inputRef, disabled, onInit, onGoal, onSketch, onReview, onFork, onPlan, planMode, onPlanSkill, onFast, fastServiceTier, onModel, onReasoning, onStatus, onCompact, loadMcp, skills, onSkill }: Options) {
  useLanguage();
  const id = useId();
  const [selection, setSelection] = useState({ start: value.length, end: value.length, focused: false });
  const [dismissed, setDismissed] = useState('');
  const [choice, setChoice] = useState({ key: '', index: 0 });
  const [submenu, setSubmenu] = useState(false);
  const [mcp, setMcp] = useState<{ from: number; state: 'loading' | 'ready' | 'error'; servers: McpServerStatus[] } | null>(null);
  const submenuSubmit = useRef<(() => void) | null>(null);
  const submenuInput = useRef<(() => void) | null>(null);
  const restore = useRef<{ text: string; caret: number } | null>(null);
  const committedValue = useRef(value);
  const composing = useRef(false);
  const planSkill = !planMode && onPlanSkill ? skills?.find(skill => skill.name.toLowerCase() === 'plan') : undefined;
  const commands: Command[] = [
    ...(onGoal ? [{ id: 'goal', title: t('Goal'), description: t('Set a goal to keep pursuing'), select: onGoal }] : []),
    ...(onReview ? [{ id: 'review-mode', title: t('Code review'), description: t('Review uncommitted changes or compare against a branch'), searchAliases: ['review'], requiresEmptyComposer: true, submenu: true, select: onReview }] : []),
    ...(onFork ? [{ id: 'fork', title: t('Fork chat'), description: t('Fork this chat into an isolated worktree'), searchAliases: ['fork'], requiresEmptyComposer: true, submenu: true, select: onFork }] : []),
    ...(onSketch ? [{ id: 'sketch', title: t('Sketch'), select: onSketch }] : []),
    ...(planSkill || onPlan ? [{ id: 'plan-mode', title: planSkill ? t('plan') : t('Plan mode'), searchAliases: ['plan'], description: planSkill ? t('Use the plan skill') : planMode ? t('Turn plan mode off') : t('Turn plan mode on'), select: () => planSkill ? onPlanSkill?.(planSkill) : onPlan?.() }] : []),
    ...(onInit ? [{ id: 'init', title: t('Init'), select: onInit, requiresEmptyComposer: true }] : []),
    ...(onFast && fastServiceTier ? [{ id: `service-tier:${fastServiceTier}`, title: t('Fast'), searchAliases: ['fast'], select: onFast }] : []),
    ...(onModel ? [{ id: 'model', title: t('Model'), select: onModel, submenu: true }] : []),
    ...(onReasoning ? [{ id: 'reasoning', title: t('Reasoning'), select: onReasoning, submenu: true }] : []),
    ...(onStatus ? [{ id: 'status', title: t('Status'), select: onStatus }] : []),
    ...(onCompact ? [{ id: 'compact', title: t('Compact context'), select: onCompact, requiresEmptyComposer: true }] : []),
    ...(loadMcp ? [{ id: 'mcp', title: t('MCP'), select: () => {}, submenu: true }] : []),
  ];
  useEffect(() => {
    if (mcp?.state !== 'loading' || !loadMcp) return;
    const abort = new AbortController();
    loadMcp(abort.signal).then(servers => {
      if (!abort.signal.aborted) setMcp(previous => previous ? { ...previous, state: 'ready', servers } : null);
    }, () => {
      if (!abort.signal.aborted) setMcp(previous => previous ? { ...previous, state: 'error', servers: [] } : null);
    });
    return () => abort.abort();
  }, [mcp?.from, mcp?.state, loadMcp]);
  function options(text: string, match: SlashQuery) {
    if (mcp && match.from === mcp.from) {
      const auth = (server: McpServerStatus) => server.authStatus === 'oAuth' ? t('Authenticated (OAuth)') : server.authStatus === 'bearerToken' ? t('Authenticated (API key)') : server.authStatus === 'notLoggedIn' ? t('Not authenticated') : t('Auth unsupported');
      const rows: Command[] = mcp.servers.map(server => ({ id: `mcp:${server.name}`, title: server.name, description: server.enabled ? t('Enabled') : t('Disabled'), secondary: auth(server), searchAliases: [server.enabled ? t('Enabled') : t('Disabled'), auth(server)], disabled: true, select: () => {} }));
      return { found: filterCommands(rows, match.query), skills: false };
    }
    const search = skills?.length && onSkill ? skillQuery(text) : null;
    return {
      found: [
        ...filterCommands(commands, match.query, text),
        ...(search === null ? [] : matchSkills(skills!, search).filter(skill => skill.id !== planSkill?.id).map(skill => ({ id: skill.id, title: skillName(skill), skill, select: () => onSkill!(skill) }))),
      ] as Command[],
      skills: search !== null,
    };
  }
  const optionId = (entry: Command) => `${id}-${entry.skill ? 'skill' : 'command'}-${entry.id}`;

  function syncSelection() {
    const input = inputRef.current;
    if (!input) return;
    // Selection events can accompany an edit before the parent's onChange has
    // committed it. Let that edit settle before causing any hook re-render.
    if (input.value !== committedValue.current) return;
    const next = { start: input.selectionStart, end: input.selectionEnd, focused: input.hasFocus() };
    setSelection(previous => previous.start === next.start && previous.end === next.end && previous.focused === next.focused ? previous : next);
  }
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const start = () => { composing.current = true; };
    const end = () => { composing.current = false; syncSelection(); };
    // Controlled text changes are observed after React commits `value` below.
    // A native input listener runs before React's delegated onChange; setting
    // state there can restore the old controlled value before it is read.
    const events = ['select', 'keyup', 'click', 'focus', 'blur'] as const;
    for (const event of events) input.element.addEventListener(event, syncSelection);
    input.element.addEventListener('compositionstart', start);
    input.element.addEventListener('compositionend', end);
    input.element.ownerDocument.addEventListener('selectionchange', syncSelection);
    const unsubscribe = input.subscribe(syncSelection);
    syncSelection();
    return () => {
      unsubscribe();
      for (const event of events) input.element.removeEventListener(event, syncSelection);
      input.element.removeEventListener('compositionstart', start);
      input.element.removeEventListener('compositionend', end);
      input.element.ownerDocument.removeEventListener('selectionchange', syncSelection);
    };
  }, [inputRef]);
  useLayoutEffect(() => {
    committedValue.current = value;
    const pending = restore.current, input = inputRef.current;
    if (pending) {
      restore.current = null;
      if (input?.value === pending.text) input.setSelectionRange(pending.caret, pending.caret);
    }
    syncSelection();
    submenuInput.current?.();
  }, [value, inputRef]);

  const query = disabled ? null : slashQuery(value, selection.start, selection.end);
  useEffect(() => {
    if (!mcp) return;
    // A command shortens `/mcp` to `/`; selection state may still describe the
    // previous value for one render. Read the committed DOM after restoration.
    const input = inputRef.current;
    if (!loadMcp || disabled) { setMcp(null); return; }
    if (input?.value !== value) return;
    const current = slashQuery(value, input.selectionStart, input.selectionEnd);
    if (!current || current.from !== mcp.from) setMcp(null);
  }, [value, loadMcp, disabled, mcp?.from]);
  const key = queryKey(value, query);
  useEffect(() => { if (dismissed && dismissed !== key) setDismissed(''); }, [dismissed, key]);
  const available = query ? options(value, query) : { found: [], skills: false };
  const matches = available.found;
  const index = choice.key === key ? Math.min(choice.index, Math.max(0, matches.length - 1)) : 0;
  const active = Boolean(!submenu && selection.focused && query && dismissed !== key && (commands.length || available.skills));

  function pick(command: Command, match: SlashQuery, text: string) {
    if (command.disabled) return;
    if (command.id === 'mcp') {
      const next = { text: text.slice(0, match.from + 1) + text.slice(match.to), caret: match.from + 1 };
      restore.current = next; setMcp({ from: match.from, state: 'loading', servers: [] });
      setDismissed(''); onChange(next.text); return;
    }
    if (command.skill) {
      restore.current = null;
      setDismissed(queryKey(text, match));
      command.select();
      return;
    }
    // The official editor retains `/` while its submenu is open, then removes
    // it only after a model/effort is selected. Escape leaves the slash draft.
    const next = command.submenu ? { text: text.slice(0, match.from + 1) + text.slice(match.to), caret: match.from + 1 } : removeSlashQuery(text, match);
    restore.current = next;
    setDismissed(queryKey(text, match));
    // Change the controlled draft before opening the host picker. No queued
    // callback can later overwrite typing or a different task's draft.
    onChange(next.text);
    if (command.submenu) setSubmenu(true);
    command.select(command.submenu ? {
      input: inputRef.current || undefined,
      registerSubmit: submit => { submenuSubmit.current = submit; },
      registerInput: read => { submenuInput.current = read; },
      onCommit: () => {
        const input = inputRef.current;
        if (!input) return;
        const current = slashQuery(input.value, input.selectionStart, input.selectionEnd);
        if (current?.from === match.from) { const result = removeSlashQuery(input.value, current); restore.current = result; onChange(result.text); }
      },
      onClose: restoreFocus => {
        setSubmenu(false); submenuSubmit.current = null; submenuInput.current = null;
        const input = inputRef.current;
        if (!input) return;
        setDismissed(queryKey(input.value, slashQuery(input.value, input.selectionStart, input.selectionEnd)));
        if (restoreFocus) input.focus({ preventScroll: true });
      },
    } : undefined);
  }
  function current() {
    const input = inputRef.current;
    if (disabled || submenu || !input) return null;
    const match = slashQuery(input.value, input.selectionStart, input.selectionEnd);
    if (!match) return null;
    return { input, match, ...options(input.value, match), key: queryKey(input.value, match) };
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229 || composing.current) return false;
    const live = current();
    if (!live || dismissed === live.key) return false;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    if (event.key === 'Escape' && (commands.length || live.skills)) {
      event.preventDefault(); event.stopPropagation(); setMcp(null); setDismissed(live.key); return true;
    }
    if (!live.found.length) {
      if ((event.key === 'Enter' || event.key === 'Tab') && (commands.length || live.skills)) { event.preventDefault(); return true; }
      return false;
    }
    const selected = choice.key === live.key ? Math.min(choice.index, live.found.length - 1) : 0;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      setChoice({ key: live.key, index: event.key === 'Home' ? 0 : event.key === 'End' ? live.found.length - 1 : (selected + (event.key === 'ArrowDown' ? 1 : live.found.length - 1)) % live.found.length });
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault(); pick(live.found[selected], live.match, live.input.value); return true;
    }
    return false;
  }
  function interceptSubmit() {
    if (composing.current) return true;
    if (submenu) { submenuSubmit.current?.(); return true; }
    const live = current();
    if (!live || dismissed === live.key) return false;
    if (!live.found.length) return Boolean(commands.length || live.skills);
    const selected = choice.key === live.key ? Math.min(choice.index, live.found.length - 1) : 0;
    pick(live.found[selected], live.match, live.input.value);
    return true;
  }

  const mcpMenu = mcp && query?.from === mcp.from;
  const menu = active && <div className={'codex-command-menu' + (available.skills ? ' skill-menu' : '') + (mcpMenu ? ' codex-mcp-menu' : '')} role="listbox" id={id} aria-label={mcpMenu ? t('MCP') : available.skills ? t('Skills') : t('Search')}>
    {matches.map((command, option) => <div key={optionId(command)} id={optionId(command)} role="option" aria-selected={!command.disabled && option === index} aria-disabled={command.disabled || undefined}
      title={command.skill ? skillDescription(command.skill) : command.description}
      className={command.skill ? 'skill-option' + (option === index ? ' active' : '') : 'codex-command-option'} onPointerEnter={() => setChoice({ key, index: option })}
      onPointerDown={event => { event.preventDefault(); const live = current(); if (live) pick(command, live.match, live.input.value); }}>
      {command.skill ? <>
        <span className="skill-name" data-skill-icon={skillIcon(command.skill)}><Icon name={skillIcon(command.skill)} size={14}/>{command.title}</span>
        {command.skill.source !== 'builtin' && <span className="skill-source">{command.skill.source === 'paper' ? t('This paper') : t('Yours')}</span>}
      </> : command.disabled ? <><span className="codex-mcp-heading">{command.title}<small>{command.description}</small></span><small>{command.secondary}</small></> : <><Icon name={command.id.startsWith('service-tier:') ? 'bolt' : command.id === 'reasoning' ? 'brain' : command.id === 'status' ? 'chart' : command.id === 'compact' ? 'compress' : 'layers'} size={16}/><span>{command.title}</span>{command.submenu && <Icon name="chevronRight" size={13}/>}</>}
    </div>)}
    {!matches.length && <p className="skill-empty" role="status">{mcpMenu ? mcp.state === 'loading' ? t('Loading MCP status…') : mcp.state === 'error' ? t('Unable to load MCP status') : !mcp.servers.length ? t('No MCP servers configured') : t('No matching commands') : available.skills ? t('No matching skills') : t('No matching commands')}</p>}
  </div>;
  const inputProps = active ? { 'aria-autocomplete': 'list' as const, 'aria-controls': id, 'aria-activedescendant': matches.length ? optionId(matches[index]) : undefined } : {};
  return { menu, onKeyDown, interceptSubmit, active, inputProps };
}
