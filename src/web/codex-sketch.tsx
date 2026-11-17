import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { t } from './i18n.ts';
import { CodexSketchIcon } from './codex-sketch-icons.tsx';
import { eraseSketch, exportSketch, hitSketchObject, renderSketch, SKETCH_SHAPES, sketchBounds, transformSketchObject, validSketchObject, type SketchDocument, type SketchObject, type SketchPoint, type SketchTool } from './codex-sketch-model.ts';
import './codex-sketch.css';
export type { SketchDocument } from './codex-sketch-model.ts';

export interface CodexSketchEditorProps {
  initialDocument?: SketchDocument;
  isDarkMode?: boolean;
  onSave: (file: File, document: SketchDocument, signal: AbortSignal) => Promise<void>;
  onClose: () => void;
}
type Gesture = { pointer: number; start: SketchPoint; points: SketchPoint[]; base: SketchDocument; object?: SketchObject; handle?: number; tool: SketchTool };
const colors = ['#000000', '#6b7280', '#92400e', '#dc2626', '#f97316', '#f59e0b', '#16a34a', '#0d9488', '#06b6d4', '#2563eb', '#4f46e5', '#9333ea', '#db2777'];
const handles = [[0, 0], [.5, 0], [1, 0], [0, .5], [1, .5], [0, 1], [.5, 1], [1, 1]];
const uid = () => crypto.randomUUID();
const sameDocument = (a: SketchDocument, b: SketchDocument) => JSON.stringify(a) === JSON.stringify(b);
const icons: Record<string, string> = {
  close: 'M3 3l10 10M13 3L3 13', select: 'M3 2.5l10 4-4.5 2-2 4.5z', pen: 'M2 9c3-3 7-7 8-6S3 12 5 13s7-9 8-7-5 7-2 7l3-2',
  text: 'M3 4V2.5h10V4M8 2.5v11M5.5 13.5h5', shapes: 'M7.5 9H5a4 4 0 1 1 4-4v2.5M7.5 7.5H13v6H7.5z',
  eraser: 'M3 11l-1-1a1.5 1.5 0 0 1 0-2l6-6a1.5 1.5 0 0 1 2 0l4 4a1.5 1.5 0 0 1 0 2l-5 5H5zM5 5l6 6',
  undo: 'M6 3L2.5 6.5 6 10M2.5 6.5H9a4 4 0 0 1 0 8H7', redo: 'M10 3l3.5 3.5L10 10m3.5-3.5H7a4 4 0 0 0 0 8h2', attach: 'M3 8l3.5 3.5L13 3',
  line: 'M4.22667 11.77333L11.77333 4.22667', arrow: 'M3.66667 12.33333L12.33333 3.66667M6.66667 3.66667H12.33333V9.33333',
  rectangle: 'M4 3.5h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z', ellipse: 'M13.16667 8.33333a5.16667 5.16667 0 1 0-10.33334 0a5.16667 5.16667 0 1 0 10.33334 0',
  triangle: 'M8 3.5L13.30667 13H2.69333L8 3.5Z', diamond: 'M8 3.5L13.89333 8.5L8 13.5L2.10667 8.5L8 3.5Z',
  star: 'M8 3.5L9.50667 7.01333L13.42 7.32L10.44 9.79333L11.34667 13.5L8 11.51333L4.65333 13.5L5.56 9.79333L2.58 7.32L6.49333 7.01333L8 3.5Z',
  heart: 'M8 13.5L3.15333 9C1 7 2.43333 3.5 5 3.5C6.36667 3.5 7.36 4.21333 8 5.16667C8.64 4.21333 9.63333 3.5 11 3.5C13.56667 3.5 15 7 12.84667 9L8 13.5Z',
};
function SketchIcon({ name }: { name: string }) {
  if (!SKETCH_SHAPES.includes(name as typeof SKETCH_SHAPES[number])) return <CodexSketchIcon name={name as Parameters<typeof CodexSketchIcon>[0]['name']}/>;
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.05" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[name]}/></svg>;
}
function labels() { return { select: t('Select'), pen: t('Pen'), text: t('Text'), shapes: t('Shapes'), eraser: t('Eraser'), line: t('Line'), arrow: t('Arrow'), rectangle: t('Rectangle'), ellipse: t('Ellipse'), triangle: t('Triangle'), diamond: t('Diamond'), star: t('Star'), heart: t('Heart') }; }

// The caller owns attachment identity and upload replacement. Mount with a new
// key for each editing session so one task's asynchronous save cannot edit another.
export function CodexSketchEditor({ initialDocument, isDarkMode, onSave, onClose }: CodexSketchEditorProps) {
  const dark = isDarkMode ?? document.documentElement.dataset.theme === 'dark';
  const [small, setSmall] = useState(() => matchMedia('(max-width: 639px)').matches);
  const [history, setHistory] = useState(() => ({ past: [] as SketchDocument[], present: structuredClone(initialDocument || { version: 1, width: 0, height: 0, objects: [] } as SketchDocument), future: [] as SketchDocument[] }));
  const [preview, setPreview] = useState<SketchDocument | null>(null), [tool, setTool] = useState<SketchTool>('pen');
  const [color, setColor] = useState(dark ? '#ffffff' : '#000000'), [width, setWidth] = useState(12), [eraserSize, setEraserSize] = useState(32), [fontSize, setFontSize] = useState(24);
  const [selectedId, setSelectedId] = useState<string | null>(null), [shapesOpen, setShapesOpen] = useState(false), [confirmDiscard, setConfirmDiscard] = useState(false);
  const [textEdit, setTextEdit] = useState<SketchObject | null>(null), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [surface, setSurface] = useState({ width: 0, height: 0 });
  const dialog = useRef<HTMLDialogElement>(null), discard = useRef<HTMLDialogElement>(null), canvas = useRef<HTMLCanvasElement>(null), surfaceElement = useRef<HTMLDivElement>(null), textInput = useRef<HTMLTextAreaElement>(null);
  const shapes = useRef<HTMLDivElement>(null), shapeButton = useRef<HTMLButtonElement>(null), gesture = useRef<Gesture | null>(null), upload = useRef<AbortController | null>(null), mounted = useRef(true);
  const current = useRef(history.present), initial = useRef(initialDocument), sliderBase = useRef<SketchDocument | null>(null), lastPreview = useRef<SketchDocument | null>(null);
  const titleId = useId(), discardTitle = useId(), discardDescription = useId(), shapeId = useId();
  current.current = history.present; lastPreview.current = preview;
  const view = preview || history.present, selected = view.objects.find(object => object.id === selectedId);
  const scale = view.width && view.height ? Math.min(surface.width / view.width, surface.height / view.height) : 1;
  const offset = { x: (surface.width - view.width * scale) / 2, y: (surface.height - view.height * scale) / 2 };
  const toolLabels = labels();

  function commit(next: SketchDocument) {
    current.current = next;
    setPreview(null);
    setHistory(state => sameDocument(state.present, next) ? state : { past: [...state.past, state.present], present: next, future: [] });
  }
  function editObject(object: SketchObject) { commit({ ...current.current, objects: current.current.objects.map(existing => existing.id === object.id ? object : existing) }); }
  function commitText() {
    if (!textEdit) return;
    const context = canvas.current?.getContext('2d');
    if (context) context.font = `${textEdit.fontSize || 24}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    const object = { ...textEdit, textWidth: Math.max(1, ...(textEdit.text || '').split('\n').map(line => context?.measureText(line).width || 1)) };
    const base = current.current, objects = base.objects.filter(item => item.id !== object.id);
    commit({ ...base, objects: object.text?.trim() ? [...objects, object] : objects }); setTextEdit(null);
  }
  function changeTool(next: SketchTool) { commitText(); setTool(next); setSelectedId(null); setShapesOpen(false); canvas.current?.focus(); }
  function undo() {
    setPreview(null); gesture.current = null; setTextEdit(null); setSelectedId(null);
    setHistory(state => !state.past.length ? state : { past: state.past.slice(0, -1), present: state.past.at(-1)!, future: [state.present, ...state.future] });
  }
  function redo() {
    setPreview(null); gesture.current = null; setTextEdit(null); setSelectedId(null);
    setHistory(state => !state.future.length ? state : { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) });
  }
  function requestClose() {
    if (saving) return;
    if (shapesOpen) { setShapesOpen(false); shapeButton.current?.focus(); return; }
    const dirtyText = textEdit && (textEdit.text || '').trim() && !sameDocument({ ...current.current, objects: [textEdit] }, { ...current.current, objects: current.current.objects.filter(item => item.id === textEdit.id) });
    const dirty = initial.current ? !sameDocument(current.current, initial.current) : current.current.objects.length > 0;
    if (dirty || dirtyText || gesture.current) setConfirmDiscard(true); else onClose();
  }
  useLayoutEffect(() => {
    const node = dialog.current!; node.showModal(); node.focus();
    return () => { node.close(); };
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; upload.current?.abort(); }; }, []);
  useLayoutEffect(() => {
    if (!surfaceElement.current) return;
    const measure = () => { const node = surfaceElement.current!; const size = { width: node.clientWidth, height: node.clientHeight }; setSurface(size);
      if (size.width > 0 && size.height > 0) setHistory(state => state.present.width ? state : { ...state, present: { ...state.present, ...size } }); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(surfaceElement.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const query = matchMedia('(max-width: 639px)'); const change = () => { setSmall(query.matches); if (query.matches) { setTool(old => ['select', 'text'].includes(old) ? 'pen' : old); setSelectedId(null); } };
    query.addEventListener('change', change); return () => query.removeEventListener('change', change);
  }, []);
  useLayoutEffect(() => {
    if (!canvas.current || !view.width || !view.height || !surface.width) return;
    const element = canvas.current, dpr = window.devicePixelRatio || 1;
    element.width = Math.ceil(surface.width * dpr); element.height = Math.ceil(surface.height * dpr);
    const context = element.getContext('2d')!;
    context.scale(dpr, dpr); context.fillStyle = dark ? '#212121' : '#ffffff'; context.fillRect(0, 0, surface.width, surface.height);
    const drawing = document.createElement('canvas'); renderSketch(textEdit ? { ...view, objects: view.objects.filter(object => object.id !== textEdit.id) } : view, drawing, scale * dpr);
    context.drawImage(drawing, offset.x, offset.y, view.width * scale, view.height * scale);
    if (selected && !textEdit) {
      const box = sketchBounds(selected); const x = offset.x + box.x * scale, y = offset.y + box.y * scale, w = box.width * scale, h = box.height * scale;
      context.strokeStyle = '#2c67ff'; context.lineWidth = 1; context.setLineDash([8, 6]); context.strokeRect(x, y, w, h); context.setLineDash([]); context.fillStyle = '#fff';
      for (const [hx, hy] of handles) { context.fillRect(x + w * hx - 5, y + h * hy - 5, 10, 10); context.strokeRect(x + w * hx - 5, y + h * hy - 5, 10, 10); }
    }
  }, [view, surface, selected, textEdit, dark, scale, offset.x, offset.y]);
  useLayoutEffect(() => { if (confirmDiscard) { discard.current?.showModal(); discard.current?.querySelector<HTMLButtonElement>('[data-keep]')?.focus(); } }, [confirmDiscard]);
  useLayoutEffect(() => { if (textEdit) textInput.current?.focus(); }, [textEdit?.id]);
  useEffect(() => {
    if (!shapesOpen) return;
    const close = (event: PointerEvent) => {
      if (shapes.current?.contains(event.target as Node) || shapeButton.current?.contains(event.target as Node)) return;
      if (event.target === canvas.current) { event.preventDefault(); event.stopPropagation(); }
      setShapesOpen(false);
    };
    document.addEventListener('pointerdown', close, true); return () => document.removeEventListener('pointerdown', close, true);
  }, [shapesOpen]);

  function point(event: ReactPointerEvent<HTMLCanvasElement>): SketchPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(view.width, (event.clientX - rect.left - offset.x) / scale)), y: Math.max(0, Math.min(view.height, (event.clientY - rect.top - offset.y) / scale)) };
  }
  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (saving || event.button !== 0 || gesture.current) return;
    event.preventDefault(); event.currentTarget.focus(); commitText();
    const p = point(event), base = current.current;
    if (tool === 'text') {
      const hit = [...base.objects].reverse().find(object => object.kind === 'text' && hitSketchObject(object, p));
      setTextEdit(hit ? { ...hit } : { id: uid(), kind: 'text', points: [p], color, width, fontSize, text: '' }); return;
    }
    let object: SketchObject | undefined, handle: number | undefined;
    if (tool === 'select') {
      if (selected) { const box = sketchBounds(selected); const index = handles.findIndex(([x, y]) => Math.hypot(p.x - box.x - box.width * x, p.y - box.y - box.height * y) * scale <= 9); if (index >= 0) { object = selected; handle = index; } }
      object ||= [...base.objects].reverse().find(object => hitSketchObject(object, p));
      setSelectedId(object?.id || null);
      if (!object) return;
    } else if (tool !== 'eraser') object = { id: uid(), kind: tool, points: [p, p], color, width };
    gesture.current = { pointer: event.pointerId, start: p, points: [p], base, object, handle, tool }; event.currentTarget.setPointerCapture(event.pointerId);
    updateGesture(p, event.shiftKey);
  }
  function updateGesture(p: SketchPoint, shift: boolean) {
    const g = gesture.current; if (!g) return;
    if (g.tool === 'pen' || g.tool === 'eraser') g.points.push(p);
    let next = g.base;
    if (g.tool === 'eraser') next = eraseSketch(g.base, { points: g.points.slice(), width: eraserSize });
    else if (g.object) {
      let object = g.object;
      if (g.tool === 'select') {
        const before = sketchBounds(object), after = { ...before }, dx = p.x - g.start.x, dy = p.y - g.start.y;
        if (g.handle == null) { after.x += dx; after.y += dy; }
        else {
          const [hx, hy] = handles[g.handle];
          if (hx === 0) { after.x += dx; after.width -= dx; } else if (hx === 1) after.width += dx;
          if (hy === 0) { after.y += dy; after.height -= dy; } else if (hy === 1) after.height += dy;
          after.width = Math.max(2, after.width); after.height = Math.max(2, after.height);
          if (shift) after.height = after.width * before.height / Math.max(before.width, 1);
        }
        object = transformSketchObject(object, before, after);
        next = { ...g.base, objects: g.base.objects.map(item => item.id === object.id ? object : item) };
      } else {
        let end = p;
        if (shift) {
          const dx = p.x - g.start.x, dy = p.y - g.start.y;
          if (g.tool === 'line' || g.tool === 'arrow') { const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, length = Math.hypot(dx, dy); end = { x: g.start.x + Math.cos(angle) * length, y: g.start.y + Math.sin(angle) * length }; }
          else { const size = Math.max(Math.abs(dx), Math.abs(dy)); end = { x: g.start.x + Math.sign(dx || 1) * size, y: g.start.y + Math.sign(dy || 1) * size }; }
        }
        object = { ...object, points: g.tool === 'pen' ? g.points.slice() : [g.start, end] };
        next = { ...g.base, objects: [...g.base.objects, object] };
      }
    }
    lastPreview.current = next; setPreview(next);
  }
  function pointerEnd(event: ReactPointerEvent<HTMLCanvasElement>, canceled = false) {
    const g = gesture.current; if (!g || g.pointer !== event.pointerId) return;
    if (!canceled) updateGesture(point(event), event.shiftKey);
    gesture.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!canceled && lastPreview.current) commit(lastPreview.current); else setPreview(null);
  }
  function changeStyle(nextColor?: string, nextSize?: number) {
    if (nextColor) setColor(nextColor);
    if (nextSize !== undefined) { if (tool === 'eraser') setEraserSize(nextSize); else if (tool === 'text' || selected?.kind === 'text') setFontSize(nextSize); else setWidth(nextSize); }
    if (textEdit) setTextEdit({ ...textEdit, ...(nextColor ? { color: nextColor } : {}), ...(nextSize !== undefined ? { fontSize: nextSize } : {}) });
    else if (selected && tool !== 'eraser') {
      const object = { ...selected, ...(nextColor ? { color: nextColor } : {}), ...(nextSize !== undefined ? selected.kind === 'text' ? { fontSize: nextSize, textWidth: (selected.textWidth || 1) * nextSize / (selected.fontSize || 24) } : { width: nextSize } : {}) };
      if (sliderBase.current) { const base = sliderBase.current; setPreview({ ...base, objects: base.objects.map(item => item.id === object.id ? object : item) }); }
      else editObject(object);
    }
  }
  async function save() {
    if (saving || gesture.current) return;
    if (textEdit) commitText();
    if (initial.current && sameDocument(current.current, initial.current)) { onClose(); return; }
    const controller = new AbortController(); upload.current = controller; setSaving(true); setError('');
    try {
      const snapshot = structuredClone(current.current), file = await exportSketch(snapshot, dark ? '#212121' : '#ffffff');
      if (!file) { setError(t('Draw something before attaching the sketch.')); return; }
      await onSave(file, snapshot, controller.signal);
      if (mounted.current && !controller.signal.aborted) onClose();
    } catch (caught) {
      if (mounted.current && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : t('Sketch could not be saved. Please try again.'));
    } finally { if (mounted.current) setSaving(false); upload.current = null; }
  }
  function canvasKey(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.target instanceof HTMLTextAreaElement) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); if (!saving) event.shiftKey ? redo() : undo(); return; }
    if (event.ctrlKey && event.key.toLowerCase() === 'y') { event.preventDefault(); event.stopPropagation(); if (!saving) redo(); return; }
    if (event.target !== canvas.current || saving) return;
    if (event.key === 'Escape') {
      if (gesture.current) { gesture.current = null; setPreview(null); event.preventDefault(); }
      else if (selectedId) { setSelectedId(null); event.preventDefault(); }
      else if (tool === 'text') { setTool('pen'); event.preventDefault(); }
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
      event.preventDefault(); commit({ ...current.current, objects: current.current.objects.filter(object => object.id !== selected.id) }); setSelectedId(null);
    } else if (selected && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); const distance = event.shiftKey ? 10 : 1, bounds = sketchBounds(selected);
      editObject(transformSketchObject(selected, bounds, { ...bounds, x: bounds.x + (event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0), y: bounds.y + (event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0) }));
    } else if (selected?.kind === 'text' && ['Enter', ' '].includes(event.key)) { event.preventDefault(); setTextEdit({ ...selected }); }
  }
  const sizeIsText = tool === 'text' || selected?.kind === 'text';
  const sizeLabel = tool === 'eraser' ? t('Eraser size') : sizeIsText ? t('Text size') : t('Stroke width');
  const sizeValue = tool === 'eraser' ? eraserSize : sizeIsText ? textEdit?.fontSize || selected?.fontSize || fontSize : selected?.width || width;
  const colorLabels = [dark ? t('Use white') : t('Use black'), t('Use gray'), t('Use brown'), t('Use red'), t('Use orange'), t('Use yellow'), t('Use green'), t('Use teal'), t('Use cyan'), t('Use blue'), t('Use indigo'), t('Use purple'), t('Use pink')];
  const currentColor = textEdit?.color || selected?.color || color;
  const actualColors = dark ? ['#ffffff', ...colors.slice(1)] : colors;
  const button = (name: string, label: string, action: () => void, disabled = false) => <button type="button" aria-label={label} title={label} disabled={disabled || saving} onClick={action}><SketchIcon name={name}/></button>;
  return <>
    <dialog ref={dialog} className="codex-sketch" data-dark={dark || undefined} aria-labelledby={titleId} onKeyDown={canvasKey} onCancel={event => { event.preventDefault(); requestClose(); }} onPointerDown={event => { if (event.target === event.currentTarget) requestClose(); }}>
      <h2 id={titleId} className="codex-sketch-sr">{t('Sketch editor')}</h2>
      <div className="codex-sketch-surface" ref={surfaceElement}>
        <canvas ref={canvas} role="application" aria-label={t('Sketch canvas')} tabIndex={0} aria-keyshortcuts="Meta+C Control+C Meta+V Control+V Meta+Z Control+Z Meta+Shift+Z Control+Shift+Z Control+Y Enter Space Delete Escape ArrowUp ArrowDown ArrowLeft ArrowRight"
          onPointerDown={pointerDown} onPointerMove={event => { if (gesture.current?.pointer === event.pointerId) updateGesture(point(event), event.shiftKey); }} onPointerUp={event => pointerEnd(event)} onPointerCancel={event => pointerEnd(event, true)}
          onDoubleClick={event => { if (saving || small) return; const rect = event.currentTarget.getBoundingClientRect(), p = { x: (event.clientX - rect.left - offset.x) / scale, y: (event.clientY - rect.top - offset.y) / scale }; const object = [...current.current.objects].reverse().find(object => object.kind === 'text' && hitSketchObject(object, p)); if (object) setTextEdit({ ...object }); }}
          onCopy={event => { if (!selected) return; event.clipboardData.setData('application/x-studybuddy-sketch', JSON.stringify(selected)); event.clipboardData.setData('text/plain', selected.text || ''); event.preventDefault(); }}
          onPaste={event => { if (saving) return; let object: SketchObject | null = null; const raw = event.clipboardData.getData('application/x-studybuddy-sketch'); if (raw) { try { const value = JSON.parse(raw); object = validSketchObject(value) ? value : null; } catch { /* Unrelated clipboard data is ignored. */ } } if (object) { event.preventDefault(); const bounds = sketchBounds(object), duplicate = { ...transformSketchObject(object, bounds, { ...bounds, x: bounds.x + 16, y: bounds.y + 16 }), id: uid() }; commit({ ...current.current, objects: [...current.current.objects, duplicate] }); setSelectedId(duplicate.id); setTool('select'); } }}/>
        {textEdit && <textarea ref={textInput} className="codex-sketch-text" aria-label={t('Text')} value={textEdit.text || ''} style={{ left: offset.x + textEdit.points[0].x * scale, top: offset.y + textEdit.points[0].y * scale, color: textEdit.color, fontSize: (textEdit.fontSize || 24) * scale, width: Math.max(80, Math.min(surface.width - offset.x - textEdit.points[0].x * scale, (textEdit.textWidth || 220) * scale)), height: Math.max(1, (textEdit.text || '').split('\n').length) * (textEdit.fontSize || 24) * 1.2 * scale + 4 }} onChange={event => setTextEdit({ ...textEdit, text: event.target.value })} onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === 'Escape' || event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); commitText(); canvas.current?.focus(); } }} onBlur={event => { if (!(event.relatedTarget instanceof HTMLElement) || !event.relatedTarget.closest('.codex-sketch-colors,.codex-sketch-size')) commitText(); }}/ >}
        <div className="codex-sketch-top">
          <div className="codex-sketch-close">{button('close', t('Close sketch editor'), requestClose)}</div>
          <fieldset className="codex-sketch-tools" aria-label={t('Drawing tools')} disabled={saving}>
            {(small ? ['pen', 'shapes', 'eraser'] : ['select', 'pen', 'text', 'shapes', 'eraser']).map(name => name === 'shapes'
              ? <div className="codex-sketch-shapes" key={name}><button type="button" ref={shapeButton} aria-label={toolLabels.shapes} title={toolLabels.shapes} aria-controls={shapeId} aria-expanded={shapesOpen} aria-pressed={SKETCH_SHAPES.includes(tool as typeof SKETCH_SHAPES[number])} onClick={() => { commitText(); setShapesOpen(!shapesOpen); }}><SketchIcon name="shapes"/></button>
                {shapesOpen && <div id={shapeId} ref={shapes} className="codex-sketch-shape-menu" role="group" aria-label={toolLabels.shapes} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setShapesOpen(false); shapeButton.current?.focus(); } }}>{SKETCH_SHAPES.map(name => <button key={name} type="button" aria-label={toolLabels[name]} title={toolLabels[name]} aria-pressed={tool === name} onClick={() => changeTool(name)}><SketchIcon name={name}/></button>)}</div>}</div>
              : <button key={name} type="button" aria-label={toolLabels[name as keyof typeof toolLabels]} title={toolLabels[name as keyof typeof toolLabels]} aria-pressed={tool === name} onClick={() => changeTool(name as SketchTool)}><SketchIcon name={name}/></button>)}
          </fieldset>
          <div className="codex-sketch-history">{button('undo', t('Undo'), undo, !history.past.length)}{!small && button('redo', t('Redo'), redo, !history.future.length)}</div>
        </div>
        <input className="codex-sketch-size" type="range" aria-label={sizeLabel} aria-orientation="vertical" min={tool === 'eraser' ? 4 : sizeIsText ? 8 : 2} max={tool === 'eraser' ? 96 : sizeIsText ? 128 : 48} value={sizeValue} disabled={saving || Boolean(selected?.erasures?.length) && !sizeIsText && tool !== 'eraser'} title={selected?.erasures?.length ? t('Width cannot be changed after partial erasing. Use the selection handles to resize.') : undefined} onPointerDown={() => { sliderBase.current = current.current; }} onPointerUp={() => { if (lastPreview.current) commit(lastPreview.current); sliderBase.current = null; }} onPointerCancel={() => { setPreview(null); sliderBase.current = null; }} onChange={event => changeStyle(undefined, Number(event.target.value))}/>
        <div className="codex-sketch-bottom">
          <fieldset className="codex-sketch-colors" aria-label={t('Ink color')} disabled={saving}>
            <label className="codex-sketch-custom" title={t('Choose a custom color')} data-selected={!actualColors.includes(currentColor) || undefined}><span className="codex-sketch-sr">{t('Choose a custom color')}</span><input type="color" value={currentColor} onChange={event => changeStyle(event.target.value)}/></label>
            {actualColors.map((value, index) => <button key={value} type="button" aria-label={colorLabels[index]} title={colorLabels[index]} aria-pressed={currentColor === value} style={{ backgroundColor: value }} onClick={() => changeStyle(value)}/>)}
          </fieldset>
          <button type="button" className="codex-sketch-attach" aria-label={saving ? t('Saving sketch') : t('Attach sketch')} title={saving ? t('Saving sketch') : t('Attach sketch')} disabled={saving || !view.objects.length && !textEdit?.text?.trim()} aria-busy={saving} onClick={() => void save()}><SketchIcon name="attach"/></button>
        </div>
        {error && <div className="codex-sketch-error" role="alert">{error}</div>}
      </div>
    </dialog>
    {confirmDiscard && <dialog ref={discard} className="codex-sketch-discard" aria-labelledby={discardTitle} aria-describedby={discardDescription} onCancel={event => { event.preventDefault(); setConfirmDiscard(false); }}>
      <h2 id={discardTitle}>{t('Discard changes?')}</h2><p id={discardDescription}>{t("Your changes won't be saved")}</p>
      <div><button type="button" data-keep onClick={() => setConfirmDiscard(false)}>{t('Keep editing')}</button><button type="button" className="danger" onClick={onClose}>{t('Discard changes')}</button></div>
    </dialog>}
  </>;
}
