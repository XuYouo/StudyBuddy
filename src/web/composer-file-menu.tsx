import { useEffect, useId, useState, type RefObject } from 'react';
import type { ComposerReference } from '../shared.ts';
import type { ComposerInput } from './composer-input.ts';
import { t } from './i18n.ts';
import { Icon } from './icons.tsx';

type FileChoice = Pick<ComposerReference, 'path' | 'label' | 'kind'>;
type SearchResult = { files: FileChoice[]; more: boolean };
export function useComposerFiles({ inputRef, url, disabled }: { inputRef: RefObject<ComposerInput | null>; url?: string; disabled?: boolean }) {
  const id = useId();
  const [selection, setSelection] = useState({ text: '', from: 0, to: 0, focused: false, references: [] as ComposerReference[] });
  const [dismissed, setDismissed] = useState(''), [active, setActive] = useState(0);
  const [result, setResult] = useState<{ key: string; state: 'loading' | 'ready' | 'error'; files: FileChoice[]; more: boolean }>({ key: '', state: 'ready', files: [], more: false });
  function sync() { const input = inputRef.current; if (input) setSelection({ text: input.value, from: input.selectionStart, to: input.selectionEnd, focused: input.hasFocus(), references: input.references }); }
  useEffect(() => { sync(); return inputRef.current?.subscribe(sync); }, [inputRef]);
  const match = !disabled && url && selection.from === selection.to ? /(?:^|[\s(])@([^\n]*)$/.exec(selection.text.slice(0, selection.from)) : null;
  const query = match?.[1] ?? '', from = match ? selection.from - query.length - 1 : -1;
  const key = `${url}:${selection.text}:${from}:${selection.to}`;
  const open = Boolean(match && selection.focused && dismissed !== key && !selection.references.some(reference => from < reference.to && selection.to > reference.from));
  useEffect(() => {
    if (!open || !query.trim() || !url) return;
    const abort = new AbortController();
    setResult({ key, state: 'loading', files: [], more: false }); setActive(0);
    fetch(`${url}?query=${encodeURIComponent(query)}`, { signal: abort.signal }).then(async response => { if (!response.ok) throw new Error('File search failed'); return response.json() as Promise<SearchResult>; }).then(data => {
      if (!abort.signal.aborted) setResult({ key, state: 'ready', files: data.files, more: data.more });
    }, () => { if (!abort.signal.aborted) setResult({ key, state: 'error', files: [], more: false }); });
    return () => abort.abort();
  }, [open, query, key, url]);
  const files = result.key === key ? result.files : [], index = Math.min(active, Math.max(0, files.length - 1));
  function pick(file: FileChoice) { inputRef.current?.insertReference(from, selection.to, file); setDismissed(key); }
  function interceptSubmit() { if (!open) return false; if (!inputRef.current?.composing && files[index]) pick(files[index]); return true; }
  function onKeyDown(event: KeyboardEvent) {
    if (!open || event.isComposing || event.keyCode === 229 || inputRef.current?.composing) return false;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(key); return true; }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive((index + (event.key === 'ArrowDown' ? 1 : files.length - 1)) % Math.max(1, files.length)); return true; }
    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); if (files[index]) pick(files[index]); return true; }
    return false;
  }
  const menu = open && <div className="codex-command-menu composer-file-menu" role="listbox" id={id} aria-label={t('Files and folders')}>
    {files.map((file, i) => <div className="codex-command-option" role="option" id={`${id}-${i}`} key={file.path} aria-selected={i === index} onPointerEnter={() => setActive(i)} onPointerDown={event => { event.preventDefault(); pick(file); }}><Icon name={file.kind === 'directory' ? 'folder' : 'paper'} size={14}/><span>{file.label}</span><small>{file.path === file.label ? '' : file.path}</small></div>)}
    {!files.length && <p className="skill-empty" role="status">{!query.trim() ? t('Type to search for files') : result.key !== key || result.state === 'loading' ? t('Searching files…') : result.state === 'error' ? t('Unable to search files') : t('No matching files')}</p>}
    {result.key === key && result.more && <p className="skill-empty">{t('Type more to narrow the results')}</p>}
  </div>;
  return { open, menu, onKeyDown, interceptSubmit, inputProps: open ? { 'aria-autocomplete': 'list', 'aria-controls': id, 'aria-activedescendant': files.length ? `${id}-${index}` : undefined } : {} };
}
