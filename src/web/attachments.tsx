import { type PointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Attachment } from '../shared.ts';
import { AttachmentDraft, attachmentDrafts as drafts, type UploadAttachment } from './attachment-draft.ts';
import { browserStorage } from './storage.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import './attachments.css';

export function useAttachmentDraft(key: string) {
  const draft = useMemo(() => {
    let draft = drafts.get(key);
    if (!draft) { draft = new AttachmentDraft(key, browserStorage); drafts.set(key, draft); }
    return draft;
  }, [key]);
  return { draft, ...useSyncExternalStore(draft.subscribe, draft.getSnapshot) };
}
export const attachmentUrl = (file: Attachment) => `/api/projects/${encodeURIComponent(file.projectId)}/attachments/${encodeURIComponent(file.id)}`;
const sizeLabel = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

function FileIcon({ file }: { file?: Attachment }) {
  return file?.mime.startsWith('image/') ? <img src={attachmentUrl(file)} alt="" loading="lazy"/> : <Icon name={file?.mime === 'application/pdf' ? 'pdf' : 'paper'} size={20}/>;
}
export function DraftAttachments({ draft, upload, discard, disabled, edit }: { draft: AttachmentDraft; upload: UploadAttachment; discard: (file: Attachment) => void; disabled?: boolean; edit?: { canEdit(key: string): boolean; edit(key: string): void } }) {
  const { entries, error } = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  return <>
    {entries.length > 0 && <ul className="composer-attachments" aria-label={t('Attachments')}>{entries.map(entry => <li className={'attachment' + (entry.error ? ' attachment-failed' : '')} key={entry.key}>
      {edit?.canEdit(entry.key) ? <button type="button" className="attachment-icon" aria-label={t('Edit sketch')} disabled={disabled || entry.uploading} onClick={() => edit.edit(entry.key)}><FileIcon file={entry.attachment}/></button>
        : <span className="attachment-icon">{entry.uploading ? <span className="spinner"/> : <FileIcon file={entry.attachment}/>}</span>}
      <span className="attachment-info"><span className="attachment-name" title={entry.name}>{entry.name}</span><small title={entry.error} role={entry.uploading ? 'status' : entry.error ? 'alert' : undefined}>{entry.uploading ? t('Uploading…') : entry.error || sizeLabel(entry.size)}</small></span>
      {entry.error && <button type="button" className="icon-button" aria-label={t('Retry uploading {name}', { name: entry.name })} disabled={disabled} onClick={() => void draft.upload(entry.key, upload)}><Icon name="refresh" size={14}/></button>}
      <button type="button" className="icon-button" aria-label={t('Remove attachment {name}', { name: entry.name })} disabled={disabled} onClick={() => { draft.remove(entry.key); if (entry.attachment) discard(entry.attachment); }}><Icon name="close" size={14}/></button>
    </li>)}</ul>}
    {error && <p className="attachment-error" role="alert">{error}</p>}
  </>;
}
export function MessageAttachments({ files }: { files?: Attachment[] }) {
  const [preview, setPreview] = useState<Attachment | null>(null);
  if (!files?.length) return null;
  return <><ul className="message-attachments" aria-label={t('Attachments')}>{files.map(file => <li key={file.id}>{file.mime.startsWith('image/')
    ? <button type="button" className="attachment image-attachment" aria-label={t('Open attachment {name}', { name: file.name })} onClick={() => setPreview(file)}><img src={attachmentUrl(file)} alt={file.name} loading="lazy"/></button>
    : <a className="attachment" href={attachmentUrl(file)} target="_blank" rel="noreferrer" title={t('Open attachment {name}', { name: file.name })}>
    <span className="attachment-icon"><FileIcon file={file}/></span><span className="attachment-info"><span className="attachment-name">{file.name}</span><small>{sizeLabel(file.size)}</small></span><Icon name="external" size={13}/>
  </a>}</li>)}</ul>{preview && <ImagePreview key={preview.id} file={preview} onClose={() => setPreview(null)}/>}</>;
}

// Zoom stops and fit behavior follow imagePreviewDialog (26.51111.21308).
const IMAGE_ZOOM = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];
function ImagePreview({ file, onClose }: { file: Attachment; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), viewport = useRef<HTMLDivElement>(null), image = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 }), [bounds, setBounds] = useState({ width: 0, height: 0 }), [zoom, setZoom] = useState<number | null>(null), [failed, setFailed] = useState(false);
  const fit = natural.width && natural.height && bounds.width && bounds.height ? Math.min(1, bounds.width / natural.width, bounds.height / natural.height) * 100 : 100;
  const percent = zoom ?? fit, stops = [...new Set([fit, ...IMAGE_ZOOM])].sort((a, b) => a - b);
  const latest = useRef({ percent, minimum: stops[0], maximum: stops.at(-1)! });
  latest.current = { percent, minimum: stops[0], maximum: stops.at(-1)! };
  const zoomOrigin = useRef<{ x: number; y: number; fractionX: number; fractionY: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; left: number; top: number; distance: number; zoom: number } | null>(null);
  const pressedOutside = useRef(false);
  useLayoutEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const box = viewport.current;
    if (!box) return;
    const measure = () => setBounds({ width: box.clientWidth, height: box.clientHeight });
    const observer = new ResizeObserver(measure); observer.observe(box); measure();
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault(); event.stopPropagation();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1);
      changeZoom(latest.current.percent * Math.exp(-delta / 300), event.clientX, event.clientY);
    };
    box.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); box.removeEventListener('wheel', wheel); };
  }, []);
  useLayoutEffect(() => {
    const point = zoomOrigin.current, box = viewport.current, target = image.current;
    if (!point || !box || !target) return;
    zoomOrigin.current = null;
    const rect = target.getBoundingClientRect();
    box.scrollLeft += rect.left + rect.width * point.fractionX - point.x;
    box.scrollTop += rect.top + rect.height * point.fractionY - point.y;
  }, [percent]);
  function changeZoom(value: number, x?: number, y?: number) {
    const box = viewport.current, target = image.current;
    if (box && target) {
      const view = box.getBoundingClientRect(), rect = target.getBoundingClientRect();
      x ??= view.left + view.width / 2; y ??= view.top + view.height / 2;
      zoomOrigin.current = { x, y, fractionX: Math.max(0, Math.min(1, (x - rect.left) / rect.width)), fractionY: Math.max(0, Math.min(1, (y - rect.top) / rect.height)) };
    }
    setZoom(Math.max(latest.current.minimum, Math.min(latest.current.maximum, value)));
  }
  function step(direction: number) {
    changeZoom(direction > 0 ? stops.find(value => value > percent + .001) ?? stops.at(-1)! : stops.findLast(value => value < percent - .001) ?? stops[0]);
  }
  function startGesture() {
    const points = [...pointers.current.values()], box = viewport.current;
    if (!points.length || !box) { gesture.current = null; return; }
    const first = points[0], second = points[1];
    gesture.current = { x: first.x, y: first.y, left: box.scrollLeft, top: box.scrollTop, zoom: latest.current.percent, distance: second ? Math.hypot(first.x - second.x, first.y - second.y) : 0 };
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch') return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId); startGesture();
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const [first, second] = [...pointers.current.values()], start = gesture.current, box = viewport.current;
    if (second && start.distance) changeZoom(start.zoom * Math.hypot(first.x - second.x, first.y - second.y) / start.distance, (first.x + second.x) / 2, (first.y + second.y) / 2);
    else if (box) { box.scrollLeft = start.left - (event.clientX - start.x); box.scrollTop = start.top - (event.clientY - start.y); }
  }
  function pointerEnd(event: PointerEvent<HTMLDivElement>) { pointers.current.delete(event.pointerId); startGesture(); }
  const outside = (event: PointerEvent<HTMLDialogElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  };
  return <dialog ref={dialog} className="attachment-preview" aria-label={t('Image preview')} closedby="any" onClose={onClose}
    onPointerDown={event => { if (!('closedBy' in HTMLDialogElement.prototype)) pressedOutside.current = outside(event); }}
    onPointerUp={event => { if (!('closedBy' in HTMLDialogElement.prototype) && pressedOutside.current && outside(event)) dialog.current?.close(); }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); step(1); }
      else if (event.key === '-') { event.preventDefault(); step(-1); }
      else if (event.key === '0') { event.preventDefault(); setZoom(null); }
    }}>
    <div className="attachment-preview-actions">
      <a href={attachmentUrl(file)} download={file.name} aria-label={t('Download image')} title={t('Download image')}><Icon name="download" size={20}/></a>
      <button type="button" autoFocus aria-label={t('Close image preview')} title={t('Close image preview')} onClick={() => dialog.current?.close()}><Icon name="close" size={20}/></button>
    </div>
    <div ref={viewport} className="attachment-preview-viewport" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
      {failed ? <p role="alert">{t('Image could not be loaded.')}</p> : <img ref={image} src={attachmentUrl(file)} alt={file.name} draggable={false}
        style={natural.width ? { width: natural.width * percent / 100, height: natural.height * percent / 100 } : undefined}
        onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailed(true)}/>}
    </div>
    <div className="attachment-preview-zoom">
      <button type="button" aria-label={t('Zoom out')} disabled={failed || percent <= stops[0]} onClick={() => step(-1)}><Icon name="minus" size={18}/></button>
      <span>{Math.round(percent)}%</span>
      <button type="button" aria-label={t('Zoom in')} disabled={failed || percent >= stops.at(-1)!} onClick={() => step(1)}><Icon name="plus" size={18}/></button>
    </div>
  </dialog>;
}
