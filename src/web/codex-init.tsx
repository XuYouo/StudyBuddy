import { useEffect, useRef, useState } from 'react';
import { INIT_INSTRUCTIONS } from '../init-instructions.ts';
import { t } from './i18n.ts';
import { Icon } from './icons.tsx';

export type InitTarget = { url: string; submit(prompt: string): Promise<void> };

export function useCodexInit(target: InitTarget | undefined, check: (url: string, signal: AbortSignal) => Promise<{ exists: boolean }>) {
  const current = useRef(target); current.current = target;
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    setBusy(false); setNotice(null);
    return () => { request.current?.abort(); request.current = null; };
  }, [target?.url]);
  async function run() {
    const selected = current.current;
    if (!selected || request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setNotice(null);
    try {
      const result = await check(selected.url, controller.signal);
      if (controller.signal.aborted || current.current?.url !== selected.url) return;
      if (result.exists) setNotice({ text: t('AGENTS.md already exists here. Skipping /init to avoid overwriting it'), error: false });
      else await current.current.submit(INIT_INSTRUCTIONS);
    } catch (error) {
      if (!controller.signal.aborted) setNotice({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }
  return { busy, run, notice: notice && <div className={'toast' + (notice.error ? '' : ' toast-status')} role={notice.error ? 'alert' : 'status'}>
    <span>{notice.text}</span><button type="button" className="icon-button" aria-label={t('Close')} onClick={() => setNotice(null)}><Icon name="close" size={14}/></button>
  </div> };
}
