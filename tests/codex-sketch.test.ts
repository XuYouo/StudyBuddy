import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eraseSketch, hitSketchObject, sketchBounds, transformSketchObject, validSketchObject, type SketchDocument, type SketchObject } from '../src/web/codex-sketch-model.ts';

const stroke: SketchObject = { id: 'stroke', kind: 'pen', points: [{ x: 10, y: 20 }, { x: 110, y: 20 }], color: '#000000', width: 10 };
test('eraser masks belong to existing objects and move with their geometry', () => {
  const original: SketchDocument = { version: 1, width: 500, height: 500, objects: [stroke] };
  const erased = eraseSketch(original, { points: [{ x: 60, y: 10 }, { x: 60, y: 30 }], width: 20 });
  assert.equal(hitSketchObject(erased.objects[0], { x: 60, y: 20 }), false);
  assert.equal(hitSketchObject(erased.objects[0], { x: 30, y: 20 }), true);
  assert.equal(original.objects[0].erasures, undefined);
  const bounds = sketchBounds(erased.objects[0]);
  const moved = transformSketchObject(erased.objects[0], bounds, { ...bounds, x: bounds.x + 20, y: bounds.y + 40 });
  assert.equal(hitSketchObject(moved, { x: 80, y: 60 }), false);
  assert.equal(hitSketchObject(moved, { x: 50, y: 60 }), true);
  const later = { ...stroke, id: 'later' };
  assert.equal(hitSketchObject(later, { x: 60, y: 20 }), true);
});
test('resizing carries stroke width and eraser masks without mutating the saved document', () => {
  const object = { ...stroke, erasures: [{ points: [{ x: 60, y: 20 }], width: 20 }] };
  const resized = transformSketchObject(object, { x: 0, y: 0, width: 100, height: 100 }, { x: 10, y: 20, width: 200, height: 200 });
  assert.deepEqual(resized.points, [{ x: 30, y: 60 }, { x: 230, y: 60 }]);
  assert.equal(resized.width, 20);
  assert.deepEqual(resized.erasures, [{ points: [{ x: 130, y: 60 }], width: 40 }]);
  assert.equal(object.width, 10);
});
test('clipboard rejects malformed objects, masks and non-finite dimensions', () => {
  assert.ok(validSketchObject(stroke));
  for (const value of [null, {}, { ...stroke, points: [] }, { ...stroke, points: [{ x: Infinity, y: 1 }] }, { ...stroke, erasures: [{}] }, { ...stroke, color: 'url(secret)' }, { ...stroke, kind: 'text' }]) assert.equal(validSketchObject(value), false);
});
