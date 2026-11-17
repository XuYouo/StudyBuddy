import type { RuntimeStatus, Task } from '../shared.ts';
import { resetText, windowName } from './usage.tsx';
import { t } from './i18n.ts';

// /status is an inline card in the official composer, independent of the
// context-ring popover. Keep it open until Close is selected.
export function CodexStatus({ task, runtime, onClose }: { task?: Task; runtime?: RuntimeStatus; onClose: () => void }) {
  return <section className="codex-status-card" aria-label={t('Status')}>
    <header><span>{t('Status')}</span><button type="button" onClick={onClose}>{t('Close')}</button></header>
    <dl><dt>{t('Session/Chat:')}</dt><dd>{task?.threadId || t('Not started')}</dd>
      {runtime?.usage?.windows.length ? runtime.usage.windows.map((window, index) => <div className="codex-status-limit" key={index}>
        <dt>{windowName(window.minutes)}</dt><dd>{t('{used}% used', { used: Math.round(window.usedPercent) })}{window.resetsAt ? ` · ${resetText(window.resetsAt)}` : ''}</dd>
      </div>) : <><dt>{t('Rate limit:')}</dt><dd>{t('Unavailable')}</dd></>}
    </dl>
  </section>;
}
