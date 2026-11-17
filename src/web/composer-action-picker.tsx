import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { AgentPickerNavigation } from './agent-picker.tsx';
import { commandScore, slashQuery } from './codex-commands.ts';
import { t, useLanguage } from './i18n.ts';
import './codex-review-picker.css';

export type ComposerActionControl = { open(navigation: AgentPickerNavigation): void };
export type ComposerActionChoice<T> = { id: string; title: string; value: T; group?: string; icon?: ReactNode; description?: string };

// A native composer action consumes the slash only after the host confirms it.
export function ComposerActionPicker<T>({ controlRef, disabled, load, select, label, loadingLabel, loadError, selectError, initialChoices = [] }: {
  controlRef: RefObject<ComposerActionControl | null>; disabled?: boolean;
  load(signal: AbortSignal): Promise<ComposerActionChoice<T>[]>;
  select(value: T): Promise<void>;
  label: string; loadingLabel: string; loadError: string; selectError: string;
  initialChoices?: ComposerActionChoice<T>[];
}) {
  useLanguage();
  const id = useId(), panel = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null);
  const navigation = useRef<AgentPickerNavigation>({}), generation = useRef(0), mounted = useRef(true);
  const operation = useRef(false), keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  const loadChoices = useRef(load); loadChoices.current = load;
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const [loadedChoices, setLoadedChoices] = useState<ComposerActionChoice<T>[] | null>(null), [error, setError] = useState('');
  const choices = (loadedChoices || initialChoices).filter(choice => !query.trim() || commandScore(choice.title, query) > 0 || choice.description && commandScore(choice.description, query) > 0);
  const selected = Math.min(active, Math.max(0, choices.length - 1));
  const ready = !loading && loadedChoices !== null && !busy;

  function close(restoreFocus = true) {
    generation.current++;
    const callbacks = navigation.current; navigation.current = {};
    callbacks.registerSubmit?.(null); callbacks.registerInput?.(null);
    panel.current?.hidePopover?.(); setOpen(false);
    callbacks.onClose?.(restoreFocus);
  }
  function position() {
    const element = panel.current, composer = navigation.current.input?.element.closest('.composer');
    if (!element || !composer) return;
    const rect = composer.getBoundingClientRect(), width = Math.min(rect.width, innerWidth - 16);
    element.style.width = `${width}px`;
    if (CSS.supports('position-area: block-start span-inline-end')) return;
    element.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
    const above = rect.top - element.offsetHeight - 6;
    element.style.top = `${Math.max(8, Math.min(above >= 8 ? above : rect.bottom + 6, innerHeight - element.offsetHeight - 8))}px`;
  }
  useImperativeHandle(controlRef, () => ({ open(callbacks) {
    if (disabled || operation.current) return;
    generation.current++; navigation.current = callbacks;
    setQuery(''); setActive(0); setError(''); setLoadedChoices(null); setOpen(true); setRevision(value => value + 1);
  } }));
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; navigation.current.registerInput?.(null); navigation.current.registerSubmit?.(null); };
  }, []);
  useEffect(() => {
    if (disabled && !operation.current) close(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setLoading(true); setError('');
    loadChoices.current(controller.signal).then(value => {
      if (!controller.signal.aborted) setLoadedChoices(value);
    }, failure => {
      if (!controller.signal.aborted) { setLoadedChoices(null); setError(failure instanceof Error ? failure.message : loadError); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, revision]);
  useLayoutEffect(() => {
    if (!open) return;
    const composer = navigation.current.input?.element.closest<HTMLElement>('.composer');
    const anchor = `--codex-review-${id.replace(/[^a-zA-Z0-9-]/g, '')}`, previous = composer?.style.getPropertyValue('anchor-name');
    composer?.style.setProperty('anchor-name', anchor); panel.current?.style.setProperty('position-anchor', anchor);
    panel.current?.showPopover?.(); position(); navigation.current.input?.focus({ preventScroll: true });
    return () => { if (previous) composer?.style.setProperty('anchor-name', previous); else composer?.style.removeProperty('anchor-name'); };
  }, [open]);
  useLayoutEffect(() => { if (open) position(); }, [open, loading, choices.length, error]);
  useEffect(() => {
    if (!open) return;
    const input = navigation.current.input, resize = new ResizeObserver(position);
    if (panel.current) resize.observe(panel.current);
    const key = (event: KeyboardEvent) => keyHandler.current(event);
    const dismiss = () => close(false);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !input?.element.contains(event.target)) close(false);
    };
    input?.element.addEventListener('keydown', key, true);
    window.addEventListener('resize', dismiss);
    if (!('popover' in HTMLElement.prototype)) document.addEventListener('pointerdown', outside);
    return () => { resize.disconnect(); input?.element.removeEventListener('keydown', key, true); window.removeEventListener('resize', dismiss); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const callbacks = navigation.current;
    callbacks.registerInput?.(() => {
      const input = callbacks.input;
      if (!input) return;
      const match = slashQuery(input.value, input.selectionStart, input.selectionEnd);
      if (!match) close(false); else { setQuery(match.query); setActive(0); }
    });
    return () => callbacks.registerInput?.(null);
  }, [open]);
  async function choose(choice: ComposerActionChoice<T>) {
    if (!ready || operation.current) return;
    const version = generation.current, callbacks = navigation.current;
    operation.current = true; setBusy(choice.id); setError('');
    try {
      await select(choice.value);
      if (mounted.current && generation.current === version) { callbacks.onCommit?.(); close(); }
    } catch (failure) {
      if (mounted.current && generation.current === version) setError(failure instanceof Error ? failure.message : selectError);
    } finally { operation.current = false; if (mounted.current) setBusy(null); }
  }
  useLayoutEffect(() => {
    if (!open) return;
    navigation.current.registerSubmit?.(() => { if (!navigation.current.input?.composing && choices[selected]) void choose(choices[selected]); });
    const input = navigation.current.input?.element;
    input?.setAttribute('aria-controls', `${id}-list`);
    if (choices.length) input?.setAttribute('aria-activedescendant', `${id}-${selected}`);
    const container = list.current, option = container?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    if (container && option) {
      const bounds = container.getBoundingClientRect(), rect = option.getBoundingClientRect();
      if (rect.top < bounds.top) container.scrollTop -= bounds.top - rect.top;
      else if (rect.bottom > bounds.bottom) container.scrollTop += rect.bottom - bounds.bottom;
    }
    return () => { input?.removeAttribute('aria-controls'); input?.removeAttribute('aria-activedescendant'); };
  });
  keyHandler.current = event => {
    if (event.isComposing || event.keyCode === 229 || navigation.current.input?.composing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      setActive(event.key === 'Home' ? 0 : event.key === 'End' ? Math.max(0, choices.length - 1) : (selected + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % Math.max(1, choices.length));
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation(); if (choices[selected]) void choose(choices[selected]);
    }
  };
  return <div ref={panel} popover="auto" role="dialog" aria-label={label} className="codex-model-menu codex-review-menu" data-open={open} data-slash="true"
    onKeyDown={event => { if (!(event.target instanceof Element && event.target.closest('.codex-review-error'))) keyHandler.current(event.nativeEvent); }} onToggle={event => { if ((event.nativeEvent as ToggleEvent).newState === 'closed' && open) close(false); }}>
    <div ref={list} id={`${id}-list`} role="listbox" aria-label={label} aria-busy={loading || !!busy} className="codex-menu-list">
      {choices.map((choice, index) => <div key={choice.id}>
        {choice.group && (index === 0 || choices[index - 1].group !== choice.group) && <div className="codex-menu-group">{choice.group}</div>}
        <button type="button" role="option" id={`${id}-${index}`} data-index={index} aria-selected={index === selected} disabled={!ready} tabIndex={-1} aria-label={choice.title} aria-describedby={choice.description ? `${id}-${index}-description` : undefined}
          className={'codex-menu-option' + (choice.description ? ' codex-action-described' : '') + (index === selected ? ' active' : '')} onPointerEnter={() => setActive(index)} onPointerDown={event => event.preventDefault()} onClick={() => void choose(choice)}>{choice.icon && <span className="codex-action-icon" aria-hidden="true">{choice.icon}</span>}<span className="codex-action-title">{choice.title}</span>{choice.description && <span className="codex-action-description" id={`${id}-${index}-description`}>{choice.description}</span>}{busy === choice.id && <span className="spinner" aria-hidden="true"/>}</button>
      </div>)}
      {loading && <p className="codex-menu-empty" role="status">{loadingLabel}</p>}
      {!loading && !choices.length && <p className="codex-menu-empty" role="status">{t('No matching commands')}</p>}
    </div>
    {error && <div className="codex-review-error" role="alert"><span>{error}</span>{!loadedChoices && <button type="button" onClick={() => setRevision(value => value + 1)}>{t('Retry')}</button>}</div>}
  </div>;
}
