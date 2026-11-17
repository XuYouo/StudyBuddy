import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatTurn } from '../shared.ts';
import { CodexIcon } from './codex-icons.tsx';
import { locale, t, useLanguage } from './i18n.ts';

export function CodexTurn({ turn, children }: { turn?: ChatTurn; children: ReactNode }) {
  useLanguage();
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false), [now, setNow] = useState(Date.now);
  const running = turn?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  function toggle() {
    const next = !expanded;
    setExpanded(next);
    root.current?.querySelectorAll<HTMLDetailsElement>('details.tool-group, details.tool-item, details.reasoning').forEach(element => { element.open = next; });
  }
  const seconds = turn ? Math.max(0, Math.floor((turn.durationMs ?? ((turn.finishedAt ?? now) - turn.startedAt)) / 1000)) : 0;
  const format = (value: number, unit: 'minute' | 'second') => new Intl.NumberFormat(locale(), { style: 'unit', unit, unitDisplay: 'short' }).format(value);
  const duration = seconds >= 60 ? `${format(Math.floor(seconds / 60), 'minute')} ${format(seconds % 60, 'second')}` : format(seconds, 'second');
  return <div className="codex-turn" ref={root} data-turn={turn?.id}>
    {turn && <button type="button" className="codex-elapsed" aria-expanded={expanded} onClick={toggle}>{t(running ? 'Working for {duration}' : 'Worked for {duration}', { duration })}<CodexIcon name="chevronDown" size={14}/></button>}
    {children}
  </div>;
}
