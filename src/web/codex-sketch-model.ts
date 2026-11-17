export type SketchPoint = { x: number; y: number };
export type SketchShape = 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'triangle' | 'diamond' | 'star' | 'heart';
export type SketchTool = 'select' | 'pen' | 'text' | 'eraser' | SketchShape;
export type SketchBounds = { x: number; y: number; width: number; height: number };
export type SketchErase = { points: SketchPoint[]; width: number };
export type SketchObject = {
  id: string; kind: Exclude<SketchTool, 'select' | 'eraser'>; points: SketchPoint[];
  color: string; width: number; text?: string; fontSize?: number; textWidth?: number;
  erasures?: SketchErase[];
};
export type SketchDocument = { version: 1; width: number; height: number; objects: SketchObject[] };
export const SKETCH_SHAPES: SketchShape[] = ['line', 'arrow', 'rectangle', 'ellipse', 'triangle', 'diamond', 'star', 'heart'];

export function validSketchObject(value: unknown): value is SketchObject {
  if (!value || typeof value !== 'object') return false;
  const object = value as SketchObject;
  const points = (value: unknown): value is SketchPoint[] => Array.isArray(value) && value.length > 0 && value.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y));
  return typeof object.id === 'string' && ['pen', 'text', ...SKETCH_SHAPES].includes(object.kind) && points(object.points)
    && typeof object.color === 'string' && /^#[\da-f]{6}$/i.test(object.color) && Number.isFinite(object.width) && object.width > 0
    && (object.kind !== 'text' || typeof object.text === 'string' && Number.isFinite(object.fontSize) && object.fontSize! > 0 && Number.isFinite(object.textWidth) && object.textWidth! > 0)
    && (object.erasures === undefined || Array.isArray(object.erasures) && object.erasures.every(erase => erase && points(erase.points) && Number.isFinite(erase.width) && erase.width > 0));
}

export function sketchBounds(object: SketchObject, padding = true): SketchBounds {
  const xs = object.points.map(p => p.x), ys = object.points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  if (object.kind === 'text') return { x, y, width: object.textWidth || 1, height: (object.fontSize || 24) * 1.2 * (object.text || '').split('\n').length };
  const pad = padding ? object.width / 2 : 0;
  return { x: x - pad, y: y - pad, width: Math.max(...xs) - x + pad * 2, height: Math.max(...ys) - y + pad * 2 };
}

export function transformSketchObject(object: SketchObject, before: SketchBounds, after: SketchBounds): SketchObject {
  const sx = after.width / Math.max(before.width, 1), sy = after.height / Math.max(before.height, 1);
  const transform = (p: SketchPoint) => ({ x: after.x + (p.x - before.x) * sx, y: after.y + (p.y - before.y) * sy });
  const scale = Math.sqrt(Math.abs(sx * sy));
  return { ...object, points: object.points.map(transform), width: object.width * scale,
    ...(object.kind === 'text' ? { fontSize: (object.fontSize || 24) * scale, textWidth: (object.textWidth || 1) * Math.abs(sx) } : {}),
    erasures: object.erasures?.map(erase => ({ points: erase.points.map(transform), width: erase.width * scale })) };
}

export function sketchDistance(point: SketchPoint, a: SketchPoint, b: SketchPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
function nearPath(point: SketchPoint, points: SketchPoint[], width: number) {
  return points.some((p, i) => sketchDistance(point, points[Math.max(0, i - 1)], p) <= width / 2);
}
export function hitSketchObject(object: SketchObject, point: SketchPoint): boolean {
  if (object.erasures?.some(erase => nearPath(point, erase.points, erase.width))) return false;
  if (['pen', 'line', 'arrow'].includes(object.kind)) return nearPath(point, object.points, object.width + 8);
  const box = sketchBounds(object);
  return point.x >= box.x - 4 && point.x <= box.x + box.width + 4 && point.y >= box.y - 4 && point.y <= box.y + box.height + 4;
}

export function eraseSketch(document: SketchDocument, erase: SketchErase): SketchDocument {
  const changed = document.objects.map(object => {
    const box = sketchBounds(object), radius = erase.width / 2;
    const overlaps = erase.points.some((p, i) => {
      const previous = erase.points[Math.max(0, i - 1)];
      return Math.max(p.x, previous.x) + radius >= box.x && Math.min(p.x, previous.x) - radius <= box.x + box.width
        && Math.max(p.y, previous.y) + radius >= box.y && Math.min(p.y, previous.y) - radius <= box.y + box.height;
    });
    return overlaps ? { ...object, erasures: [...object.erasures || [], erase] } : object;
  });
  return { ...document, objects: changed };
}

function strokePath(context: CanvasRenderingContext2D, points: SketchPoint[], width: number, color: string) {
  context.lineWidth = width; context.strokeStyle = color; context.fillStyle = color; context.lineCap = 'round'; context.lineJoin = 'round';
  context.beginPath();
  if (points.length === 1) { context.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2); context.fill(); return; }
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
}

export function paintSketchObject(context: CanvasRenderingContext2D, object: SketchObject) {
  const { points, kind, color, width } = object;
  context.strokeStyle = color; context.fillStyle = color; context.lineWidth = width; context.lineCap = 'round'; context.lineJoin = 'round';
  if (kind === 'pen') { strokePath(context, points, width, color); return; }
  if (kind === 'text') {
    const size = object.fontSize || 24;
    context.font = `${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; context.textBaseline = 'top';
    (object.text || '').split('\n').forEach((line, index) => context.fillText(line, points[0].x, points[0].y + index * size * 1.2)); return;
  }
  const a = points[0], b = points.at(-1)!;
  const { x, y, width: w, height: h } = sketchBounds(object, false);
  context.beginPath();
  if (kind === 'line' || kind === 'arrow') {
    context.moveTo(a.x, a.y); context.lineTo(b.x, b.y);
    if (kind === 'arrow') {
      const angle = Math.atan2(b.y - a.y, b.x - a.x), head = Math.min(Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.max(14, width * 3));
      context.moveTo(b.x - head * Math.cos(angle - Math.PI / 6), b.y - head * Math.sin(angle - Math.PI / 6));
      context.lineTo(b.x, b.y); context.lineTo(b.x - head * Math.cos(angle + Math.PI / 6), b.y - head * Math.sin(angle + Math.PI / 6));
    }
  } else if (kind === 'rectangle') context.rect(x, y, w, h);
  else if (kind === 'ellipse') context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (kind === 'heart') {
    context.moveTo(x + w / 2, y + h);
    context.bezierCurveTo(x - w * .5, y + h * .3, x + w * .05, y - h * .4, x + w / 2, y + h * .2);
    context.bezierCurveTo(x + w * .95, y - h * .4, x + w * 1.5, y + h * .3, x + w / 2, y + h); context.closePath();
  } else {
    const vertices: SketchPoint[] = kind === 'triangle' ? [{ x: x + w / 2, y }, { x: x + w, y: y + h }, { x, y: y + h }]
      : kind === 'diamond' ? [{ x: x + w / 2, y }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x, y: y + h / 2 }]
      : Array.from({ length: 10 }, (_, index) => { const angle = index * Math.PI / 5 - Math.PI / 2, radius = index % 2 ? .42 : 1; return { x: x + w / 2 + Math.cos(angle) * w / 2 * radius, y: y + h / 2 + Math.sin(angle) * h / 2 * radius }; });
    context.moveTo(vertices[0].x, vertices[0].y); vertices.slice(1).forEach(p => context.lineTo(p.x, p.y)); context.closePath();
  }
  context.stroke();
}

// Each object keeps its own eraser mask: later strokes are never erased by an
// older gesture, and moving/resizing an object carries its cut-outs with it.
export function renderSketch(document: SketchDocument, canvas: HTMLCanvasElement, scale = 1) {
  canvas.width = Math.max(1, Math.ceil(document.width * scale)); canvas.height = Math.max(1, Math.ceil(document.height * scale));
  const context = canvas.getContext('2d')!;
  const layer = canvas.ownerDocument.createElement('canvas'); layer.width = canvas.width; layer.height = canvas.height;
  const pen = layer.getContext('2d')!;
  for (const object of document.objects) {
    pen.setTransform(1, 0, 0, 1, 0, 0); pen.clearRect(0, 0, layer.width, layer.height); pen.scale(scale, scale);
    pen.globalCompositeOperation = 'source-over'; paintSketchObject(pen, object);
    pen.globalCompositeOperation = 'destination-out';
    for (const erase of object.erasures || []) strokePath(pen, erase.points, erase.width, '#000');
    context.drawImage(layer, 0, 0);
  }
}

export async function exportSketch(document: SketchDocument, background: string): Promise<File | null> {
  const canvas = window.document.createElement('canvas'); renderSketch(document, canvas);
  const context = canvas.getContext('2d')!, pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (pixels[(y * canvas.width + x) * 4 + 3]) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (maxX < minX) return null;
  const output = window.document.createElement('canvas'); output.width = maxX - minX + 73; output.height = maxY - minY + 73;
  const final = output.getContext('2d')!; final.fillStyle = background; final.fillRect(0, 0, output.width, output.height);
  final.drawImage(canvas, minX, minY, maxX - minX + 1, maxY - minY + 1, 36, 36, maxX - minX + 1, maxY - minY + 1);
  const blob = await new Promise<Blob | null>(resolve => output.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG export failed.');
  return new File([blob], 'Sketch.png', { type: 'image/png' });
}
