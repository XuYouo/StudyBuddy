import { Fragment, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { AgentConnectionNotice, type AgentPickerNavigation, type AgentPickerProps } from './agent-picker.tsx';
import { type ComposerModelConfiguration, configurationKey, modelConfiguration, recentConfigurations } from './codex-model-config.ts';
import { filterCommands, slashQuery } from './codex-commands.ts';
import { effortName } from './effort-slider.tsx';
import { browserStorage } from './storage.ts';
import { t, tc, useLanguage } from './i18n.ts';
import { Icon } from './icons.tsx';
import type { AgentId } from '../shared.ts';
import { taskEffort } from './task-effort.ts';
import './codex-command-menu.css';

const RECENT = 'studybuddy:composer-model-configurations';
function readRecent() { try { return recentConfigurations(JSON.parse(browserStorage.getItem(RECENT) || '[]')); } catch { return []; } }
export function codexEffortName(value: string) {
  return value === 'low' ? tc('Light', 'reasoning effort') : value === 'xhigh' ? t('Extra High') : effortName(value);
}
type Level = 'effort' | 'model' | 'reasoning' | 'service';
interface Entry { id: string; title: string; description?: string; group?: string; selected: boolean; configuration: ComposerModelConfiguration; searchAliases?: string[] }
export type CodexModelPickerProps = Omit<AgentPickerProps, 'onSelect' | 'onChange' | 'permissions' | 'permissionMode'> & {
  onConfigurationSelect: (configuration: ComposerModelConfiguration) => void;
  preferences?: Partial<Record<AgentId, { effort: string | null; fast: boolean }>>;
};

// Official 26.51111.21308 has two distinct entry paths: the footer opens an
// effort slider then a compact model menu; slash commands open editor-filtered
// lists. Screenshots in test-results/official-codex-reference cover both.
export function CodexModelPicker({ agents, agent, model, effort, fast, preferences, reconnecting, onReconnect, onConfigurationSelect, disabled, description, controlRef, allowUnknownDefault = true, noAgent = false }: CodexModelPickerProps) {
  useLanguage();
  const id = useId(), anchor = `--codex-model-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [level, setLevel] = useState<Level>('effort'), [fromSlash, setFromSlash] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0), [recent, setRecent] = useState(readRecent);
  const navigation = useRef<AgentPickerNavigation>({}), keyHandler = useRef<(event: KeyboardEvent) => void>(() => {}), composing = useRef(false);
  const currentAgent = agents.find(item => item.value === agent), runtime = currentAgent?.runtime;
  const selectedModel = runtime?.models.find(item => model ? item.id === model : item.isDefault);
  const configuration = modelConfiguration(agent, selectedModel, { effort, fast }, model || selectedModel?.id || '');
  const modelName = selectedModel?.name || model || t('Default model'), shortName = modelName.replace(/^GPT[- ]/i, '');
  const effortLabel = agent === 'codex' ? codexEffortName(configuration.effort) : effortName(configuration.effort);
  const title = level === 'reasoning' || level === 'effort' ? t('Reasoning effort') : level === 'service' ? t('Fast mode') : fromSlash ? t('Recent models') : t('Select model');
  const known = agents.flatMap(option => {
    const models = option.runtime?.models || [];
    return [...models.map(item => ({ option, item, id: item.id, name: item.name })),
      ...(allowUnknownDefault && !models.some(item => item.isDefault) ? [{ option, item: undefined, id: '', name: t('Default model') }] : [])];
  });
  const modelEntries = known.map(({ option, item, id: modelId, name }): Entry => ({
    id: `${option.value}:${modelId}`, title: fromSlash ? name : name.replace(/^GPT[- ]/i, ''), description: item?.source,
    group: agents.length > 1 ? option.label : undefined, selected: option.value === agent && modelId === configuration.model,
    searchAliases: [modelId, option.label, item?.source || ''], configuration: modelConfiguration(option.value, item,
      option.value !== agent && preferences?.[option.value] ? { effort: taskEffort(preferences[option.value]!.effort, item), fast: preferences[option.value]!.fast } : configuration, modelId),
  }));
  let entries: Entry[];
  if (level === 'reasoning') entries = (selectedModel?.efforts || []).map(value => ({
    id: value, title: agent === 'codex' ? codexEffortName(value) : effortName(value), selected: value === configuration.effort, configuration: { ...configuration, effort: value },
  }));
  else if (level === 'service') entries = selectedModel?.fastMode && agent === 'codex' ? [
    { id: 'default', title: t('Standard'), selected: !configuration.fast, configuration: { ...configuration, fast: false } },
    { id: selectedModel.fastMode.serviceTier, title: t('Fast'), selected: configuration.fast, configuration: { ...configuration, fast: true } },
  ] : [];
  else if (fromSlash) {
    const saved = recentConfigurations([configuration, ...recent]).flatMap(saved => {
      const found = known.find(item => item.option.value === saved.agent && item.id === saved.model);
      if (!found) return [];
      const normalized = modelConfiguration(saved.agent, found.item, saved, saved.model);
      return [{ id: `recent:${configurationKey(normalized)}`, title: found.name, configuration: normalized, selected: configurationKey(normalized) === configurationKey(configuration), searchAliases: [found.id, found.option.label] }];
    });
    const seen = new Set(saved.map(item => configurationKey(item.configuration)));
    entries = [...saved, ...modelEntries.filter(item => !seen.has(configurationKey(item.configuration)))];
  } else entries = modelEntries;
  if (query.trim()) entries = filterCommands(entries, query);
  const selectedIndex = Math.min(active, Math.max(entries.length - 1, 0));

  function position() {
    const element = panel.current, button = trigger.current;
    if (!element || !button) return;
    const composer = fromSlash ? navigation.current.input?.element.closest('.composer') : null;
    const rect = (composer || button).getBoundingClientRect();
    if (composer) element.style.width = `${Math.min(rect.width, innerWidth - 16)}px`;
    else element.style.removeProperty('width');
    if (!fromSlash && CSS.supports('position-area: block-start span-inline-start')) { element.style.removeProperty('left'); element.style.removeProperty('top'); return; }
    element.style.left = `${Math.max(8, Math.min(fromSlash ? rect.left : rect.right - element.offsetWidth, innerWidth - element.offsetWidth - 8))}px`;
    const above = rect.top - element.offsetHeight - 8;
    element.style.top = `${Math.max(8, Math.min(above >= 8 ? above : rect.bottom + 8, innerHeight - element.offsetHeight - 8))}px`;
  }
  function close(restoreFocus = true) {
    const callbacks = navigation.current; navigation.current = {}; callbacks.registerSubmit?.(null); callbacks.registerInput?.(null);
    if (restoreFocus) (callbacks.input || trigger.current)?.focus({ preventScroll: true });
    panel.current?.hidePopover?.(); setOpen(false); callbacks.onClose?.(restoreFocus);
  }
  function show(next: Level, callbacks: AgentPickerNavigation = {}, slash = false) {
    if (disabled || noAgent) return;
    composing.current = false;
    navigation.current = callbacks; setFromSlash(slash); setLevel(next); setQuery(''); setActive(0); setRecent(readRecent()); setOpen(true);
  }
  useImperativeHandle(controlRef, () => ({
    open: (section, callbacks) => show(section, callbacks, true),
    toggleFast: () => {
      if (!disabled && !noAgent && agent === 'codex' && selectedModel?.fastMode) persist({ ...configuration, fast: !configuration.fast });
    },
  }));
  useLayoutEffect(() => {
    if (!open) return;
    panel.current?.showPopover?.(); position();
    if (fromSlash) navigation.current.input?.focus({ preventScroll: true });
    else panel.current?.querySelector<HTMLElement>('input, [role="menuitemradio"]')?.focus({ preventScroll: true });
  }, [open, level, fromSlash]);
  useLayoutEffect(() => { if (open) position(); }, [open, query, entries.length]);
  useEffect(() => { if (disabled || noAgent) close(false); }, [disabled, noAgent]);
  useEffect(() => {
    if (!open) return;
    const dismiss = () => close(false), resize = new ResizeObserver(position), input = navigation.current.input;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target) && event.target !== input?.element) close(false); };
    const key = (event: KeyboardEvent) => keyHandler.current(event);
    const start = () => { composing.current = true; }, end = () => { composing.current = false; };
    if (panel.current) resize.observe(panel.current);
    window.addEventListener('resize', dismiss);
    if (!('popover' in HTMLElement.prototype)) document.addEventListener('pointerdown', outside);
    if (fromSlash && input) { input.element.addEventListener('keydown', key, true); input.element.addEventListener('compositionstart', start); input.element.addEventListener('compositionend', end); }
    return () => { resize.disconnect(); window.removeEventListener('resize', dismiss); document.removeEventListener('pointerdown', outside); input?.element.removeEventListener('keydown', key, true); input?.element.removeEventListener('compositionstart', start); input?.element.removeEventListener('compositionend', end); };
  }, [open, fromSlash]);
  useLayoutEffect(() => {
    if (!open || !fromSlash) return;
    const callbacks = navigation.current;
    // The composer calls this only after committing its controlled value.
    // Native input listeners (including microtasks) can otherwise flush this
    // sibling's state before React observes the edit and restore the old draft.
    callbacks.registerInput?.(() => {
      const input = callbacks.input;
      if (!input) return;
      const match = slashQuery(input.value, input.selectionStart, input.selectionEnd);
      if (!match) close(false);
      else { setQuery(match.query); setActive(0); }
    });
    return () => callbacks.registerInput?.(null);
  }, [open, fromSlash]);
  useEffect(() => {
    const container = list.current, option = container?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    if (!open || !container || !option) return;
    const bounds = container.getBoundingClientRect(), rect = option.getBoundingClientRect();
    if (rect.top < bounds.top) container.scrollTop -= bounds.top - rect.top;
    else if (rect.bottom > bounds.bottom) container.scrollTop += rect.bottom - bounds.bottom;
    const input = navigation.current.input;
    if (fromSlash && input) { input.element.setAttribute('aria-controls', `${id}-list`); input.element.setAttribute('aria-activedescendant', `${id}-${selectedIndex}`); }
    return () => { input?.element.removeAttribute('aria-activedescendant'); input?.element.removeAttribute('aria-controls'); };
  }, [selectedIndex, open, level, query, fromSlash]);
  function persist(next: ComposerModelConfiguration) {
    browserStorage.setItem(RECENT, JSON.stringify(recentConfigurations([next, ...readRecent()]))); onConfigurationSelect(next);
  }
  function choose(entry: Entry) { navigation.current.onCommit?.(); persist(entry.configuration); close(); }
  useLayoutEffect(() => { if (open && fromSlash) navigation.current.registerSubmit?.(() => { if (!composing.current && entries[selectedIndex]) choose(entries[selectedIndex]); }); });
  function keyDown(event: KeyboardEvent | ReactKeyboardEvent) {
    if (('nativeEvent' in event ? event.nativeEvent.isComposing : event.isComposing) || event.keyCode === 229 || composing.current) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.altKey || event.ctrlKey || event.metaKey || level === 'effort') return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (entries.length) { const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (selectedIndex + (event.key === 'ArrowDown' ? 1 : entries.length - 1)) % entries.length; setActive(next); if (!fromSlash) list.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus({ preventScroll: true }); }
    } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && fromSlash) {
      event.preventDefault(); event.stopPropagation(); if (entries[selectedIndex]) choose(entries[selectedIndex]);
    }
  }
  keyHandler.current = keyDown;
  const efforts = selectedModel?.efforts || [], effortIndex = Math.max(0, efforts.indexOf(configuration.effort)), fill = efforts.length > 1 ? effortIndex / (efforts.length - 1) * 100 : 0;
  return <span className="codex-model-picker">
    <button ref={trigger} type="button" className="codex-model-trigger" style={{ anchorName: anchor } as CSSProperties}
      aria-label={t('Models')} aria-description={[currentAgent?.label, modelName, effortLabel, configuration.fast ? t('Fast') : ''].filter(Boolean).join(' · ')} aria-haspopup={efforts.length ? 'dialog' : 'menu'} aria-expanded={open} aria-controls={id}
      disabled={disabled || noAgent} onClick={() => open ? close() : show(efforts.length ? 'effort' : 'model')} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); show(efforts.length ? 'effort' : 'model'); } }}>
      <span>{noAgent ? t('No agent') : shortName}</span>{configuration.effort && <span className="codex-model-effort">{effortLabel}</span>}
      {configuration.fast && <Icon name="bolt" size={13}/>}<Icon name="chevronDown" size={13}/>
    </button>
    <div ref={panel} id={id} popover="auto" role={fromSlash || level === 'effort' ? 'dialog' : 'menu'} aria-label={title} className="codex-model-menu" data-open={open} data-level={level} data-slash={fromSlash}
      style={{ positionAnchor: anchor } as CSSProperties} onKeyDown={keyDown}
      onToggle={event => { if ((event.nativeEvent as ToggleEvent).newState === 'closed') { setOpen(false); const callbacks = navigation.current; navigation.current = {}; callbacks.registerSubmit?.(null); callbacks.registerInput?.(null); callbacks.onClose?.(false); } }}>
      {level === 'effort' ? <>
        <div className="codex-effort-value">{effortLabel}</div>
        <button type="button" className="codex-effort-model" onClick={() => { setLevel('model'); setActive(0); }}>{shortName}<Icon name="chevronRight" size={12}/></button>
        <div className="codex-effort-track" style={{ '--effort-fill': `${fill}%` } as CSSProperties}>
          {efforts.map((value, index) => <i key={value} aria-hidden="true" style={{ left: `calc(12px + (100% - 24px) * ${efforts.length > 1 ? index / (efforts.length - 1) : 0})` }}/>) }
          <input type="range" min={0} max={Math.max(0, efforts.length - 1)} value={effortIndex} step={1} aria-label={t('Reasoning effort')} aria-valuetext={effortLabel} disabled={efforts.length < 2}
            onChange={event => persist({ ...configuration, effort: efforts[Number(event.target.value)] })}/>
        </div>
      </> : <>
        {level === 'model' && <div className="codex-menu-heading">{title}</div>}
        <div ref={list} id={`${id}-list`} role={fromSlash ? 'listbox' : 'group'} aria-label={title} className="codex-menu-list">
          {entries.map((entry, index) => <Fragment key={entry.id}>
            {entry.group && entry.group !== entries[index - 1]?.group && <div className="codex-menu-group" aria-hidden="true">{entry.group}</div>}
            <button type="button" id={`${id}-${index}`} data-index={index} role={fromSlash ? 'option' : 'menuitemradio'} aria-selected={fromSlash ? entry.selected : undefined} aria-checked={!fromSlash ? entry.selected : undefined}
              aria-label={agents.length > 1 ? `${entry.title} · ${agents.find(option => option.value === entry.configuration.agent)?.label || entry.configuration.agent}` : undefined}
              tabIndex={fromSlash ? -1 : index === selectedIndex ? 0 : -1} className={'codex-menu-option' + (index === selectedIndex ? ' active' : '')}
              onPointerDown={event => { if (fromSlash) event.preventDefault(); }} onPointerMove={() => setActive(index)} onClick={() => choose(entry)}>
              {fromSlash && level === 'model' && <span className="codex-model-number" aria-hidden="true">{index + 1}</span>}
              {fromSlash && level === 'reasoning' && <Icon name="brain" size={18}/>}
              <span className="codex-menu-option-label">{entry.title}</span>
              {fromSlash && level === 'model' ? <><span className="codex-model-config-effort">{entry.configuration.agent === 'codex' ? codexEffortName(entry.configuration.effort) : effortName(entry.configuration.effort)}</span><span className="codex-model-tier">{entry.configuration.fast ? t('Fast') : t('Standard')}</span></> : entry.selected && <Icon name="check" size={16}/>}
            </button>
          </Fragment>)}
          {!entries.length && <p className="codex-menu-empty">{t('No models match “{query}”', { query: query.trim() })}</p>}
        </div>
        {!fromSlash && level === 'model' && agent === 'codex' && selectedModel?.fastMode && <button type="button" className="codex-service-trigger" onClick={() => { setLevel('service'); setActive(0); }}><span>{t('Fast mode')}</span><span>{configuration.fast ? t('Fast') : t('Standard')}</span><Icon name="chevronRight" size={13}/></button>}
      </>}
      <AgentConnectionNotice name={currentAgent?.label || agent} runtime={runtime} reconnecting={reconnecting} onReconnect={onReconnect}/>
      {description && <p className="codex-menu-description">{description}</p>}
    </div>
  </span>;
}
