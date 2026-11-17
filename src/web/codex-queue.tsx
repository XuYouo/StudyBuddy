import { useEffect, useRef, useState } from 'react';
import type { Task, TaskQueueSnapshot } from '../shared.ts';
import { ActionMenu } from './action-menu.tsx';
import { Icon } from './icons.tsx';
import { errorText, t } from './i18n.ts';

export function CodexQueue({ queue, busy, active, editingId, edit, cancelEdit, remove, resume, steer, check }: {
  queue?: TaskQueueSnapshot; busy: boolean; editingId?: string;
  active: boolean; steer: (id: string) => void; check: (id: string) => void;
  edit: (id: string) => void; cancelEdit: (id: string, lease?: string) => void;
  remove: (id: string) => void; resume: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<TaskQueueSnapshot['messages'][number] | null>(null);
  useEffect(() => { if (preview !== null) dialog.current?.showModal(); }, [preview]);
  if (!queue?.messages.length) return null;
  return <div className="codex-queue">
    {queue.paused && <div className="codex-queue-paused"><span>{queue.paused === 'interrupted' ? t('Queue paused because you interrupted') : t('Queue paused')}</span><button type="button" disabled={busy || queue.messages.some(item => item.status !== 'queued')} onClick={resume}><Icon name="play" size={12}/>{t('Resume')}</button></div>}
    <ul className="codex-queue-list" aria-label={t('Queued messages')}>{queue.messages.map((message, index) => <li key={message.id} data-queue-id={message.id} data-status={message.status}>
      <Icon name="arrowUp" size={12}/>
      <button type="button" className="codex-queue-preview" aria-label={t('Preview queued message {n}', { n: index + 1 })} onClick={() => setPreview(message)}>{message.text.trim() || message.attachments?.map(file => file.name).join(', ') || t('Attachments')}</button>
      {message.status === 'unconfirmed' ? <button type="button" className="codex-queue-steer" disabled={busy} onClick={() => check(message.id)}>{t('Check status')}</button> : message.status === 'sending' ? <span className="spinner" aria-label={t('Sending…')}/> : active && queue.capabilities.steer && <button type="button" className="codex-queue-steer" disabled={busy || !message.steerable} title={message.steerUnavailable === 'note-alternatives' ? t('Notes requesting alternative edits need their own turn. Leave this message queued.') : t('Send to the current turn')} onClick={() => steer(message.id)}><Icon name="arrowRight" size={14}/>{t('Steer')}</button>}
      <button type="button" className="icon-button" aria-label={t('Remove queued message')} disabled={busy || message.status !== 'queued'} onClick={() => remove(message.id)}><Icon name="trash" size={13}/></button>
      <ActionMenu label={t('Queued message actions')} disabled={busy || editingId === message.id} className="icon-button" menuClassName="codex-action-menu" actions={[{
        label: message.status === 'editing' ? t('Cancel editing') : t('Edit message'), icon: 'pencil',
        disabled: message.status !== 'editing' && !message.editable,
        select: () => message.status === 'editing' ? cancelEdit(message.id, message.editLease) : edit(message.id),
      }]}/>
      {message.error && <small className="codex-queue-error" role="alert">{errorText(message.error)}</small>}
    </li>)}</ul>
    <dialog className="codex-queue-dialog" ref={dialog} aria-label={t('Queued message')} onClose={() => { setPreview(null); if (dialog.current) dialog.current.returnValue = ''; }}>
      <pre>{preview?.text}</pre>{preview?.attachments?.length ? <ul>{preview.attachments.map(file => <li key={file.id}>{file.name}</li>)}</ul> : null}<form method="dialog"><button className="button secondary" autoFocus>{t('Close')}</button></form>
    </dialog>
  </div>;
}

export function CodexCompaction({ operation, check, busy = false }: { operation: Task['compaction']; check?: () => void; busy?: boolean }) {
  if (!operation) return null;
  const working = operation.state === 'pending' || operation.state === 'running';
  const labels = {
    pending: t('Compacting context…'), running: t('Compacting context…'), completed: t('Context compacted'),
    failed: t('Context compaction failed'), interrupted: t('Context compaction interrupted'), unknown: t('Context compaction result not confirmed'),
  };
  return <div className={'codex-compaction' + (working ? ' running' : '')} role={operation.state === 'failed' ? 'alert' : 'status'}>
    {working ? <span className="spinner"/> : <Icon name={operation.state === 'completed' ? 'check' : 'alert'} size={14}/>}
    <span>{labels[operation.state]}{operation.error && <small>{errorText(operation.error)}</small>}</span>
    {operation.state === 'unknown' && check && <button type="button" className="button secondary compact" disabled={busy} onClick={check}>{t('Check status')}</button>}
  </div>;
}
