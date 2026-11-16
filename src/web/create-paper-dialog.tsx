import { useEffect, useRef, useState } from 'react';
import type { Project } from '../shared.ts';
import { Icon } from './icons.tsx';
import { keepDialogFocus } from './focus.ts';
import { t } from './i18n.ts';
import { chooseDirectory, nativeFolders } from './desktop-chrome.tsx';
import { browserStorage } from './storage.ts';
import { requestId } from './request-id.ts';
import './create-paper-dialog.css';

const draftKey = 'papilot:create-paper', identityKey = draftKey + ':request';
function initialForm() {
  try {
    const saved = JSON.parse(browserStorage.getItem(draftKey) || 'null');
    if (typeof saved?.name === 'string' && typeof saved?.parent === 'string') return { name: saved.name, parent: saved.parent };
  } catch { /* Ignore an unreadable draft. */ }
  return { name: '', parent: '' };
}
// crypto.randomUUID is unavailable on LAN HTTP. Keep a UUID-shaped random ID.
const uuid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
export function CreatePaperDialog({ api, onDone, onClose }: { api: <T>(url: string, body?: unknown) => Promise<T>; onDone: (paper: Project) => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), pending = useRef(false);
  const [form, setForm] = useState(initialForm), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current!, opener = document.activeElement as HTMLElement | null;
    element.showModal(); element.querySelector<HTMLInputElement>('[name="name"]')?.focus();
    let live = true;
    if (!form.parent) void api<{ parent: string }>('/projects/create-defaults').then(value => { if (live) setForm(current => current.parent ? current : { ...current, parent: value.parent }); }, failure => { if (live) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { live = false; element.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  useEffect(() => { browserStorage.setItem(draftKey, JSON.stringify(form)); }, [form]);
  function close() { if (!pending.current) onClose(); }
  async function submit() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const body = { name: form.name.trim(), parent: form.parent.trim() };
      const id = requestId(browserStorage, identityKey, JSON.stringify(body), uuid);
      const paper = await api<Project>('/projects/create', { id, ...body });
      await onDone(paper);
      browserStorage.removeItem(draftKey); browserStorage.removeItem(identityKey);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { pending.current = false; setBusy(false); }
  }
  async function browse() {
    try { const parent = await chooseDirectory(); if (parent) setForm(current => ({ ...current, parent })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }
  return <dialog ref={dialog} className="modal-backdrop" aria-labelledby="create-paper-title" onKeyDown={keepDialogFocus} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="modal create-paper-dialog">
      <button type="button" className="modal-close icon-button" aria-label={t('Close')} disabled={busy} onClick={close}><Icon name="close"/></button>
      <h2 id="create-paper-title">{t('Create a new paper')}</h2>
      <p className="modal-description">{t('Start with a minimal LaTeX paper and local version history. No Git hosting account is needed.')}</p>
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label>{t('Paper name')}<input name="name" value={form.name} required maxLength={120} autoComplete="off" disabled={busy} onChange={event => setForm({ ...form, name: event.target.value })}/></label>
        <label htmlFor="create-paper-parent">{t('Save in')}</label>
        <div className="create-paper-location">
          <input id="create-paper-parent" value={form.parent} required maxLength={4000} autoComplete="off" spellCheck={false} disabled={busy} onChange={event => setForm({ ...form, parent: event.target.value })}/>
          {nativeFolders && <button type="button" className="button secondary compact" disabled={busy} onClick={() => void browse()}>{t('Choose folder')}</button>}
        </div>
        <p className="create-paper-hint">{nativeFolders ? t('A new folder with the paper name will be created here. Existing folders are never replaced.') : t('This location is on the computer running StudyBuddy. A new folder with the paper name will be created here; existing folders are never replaced.')}</p>
        <p className="create-paper-hint">{t('Next, edit main.tex in the source editor or ask an agent to help write your paper. Compilation starts in the workspace.')}</p>
        {busy && <p className="create-paper-status" role="status"><span className="spinner"/>{t('Creating your paper…')}</p>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="button-row">
          <button type="button" className="button secondary" disabled={busy} onClick={close}>{t('Cancel')}</button>
          <button type="submit" className="button primary" disabled={busy || !form.name.trim() || !form.parent.trim()}>{t('Create paper')}</button>
        </div>
      </form>
    </section>
  </dialog>;
}
