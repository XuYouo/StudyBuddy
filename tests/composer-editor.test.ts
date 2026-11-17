import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDocument, encodeDocument, editDocument, referenceText } from '../src/composer-reference.ts';
import { editorDocument, serializeEditor } from '../src/web/composer-editor-model.ts';

test('file mention serialization follows official escaping and UTF-16 offsets', () => {
  const file = { label: '文 [a](b).tex', path: 'chapters/文 [a](b).tex', kind: 'file' as const };
  const token = '[文 \\[a\\]\\(b).tex](chapters/文 [a](b\\).tex)';
  assert.equal(referenceText(file), token);
  const text = '🧪 ' + token + '\nlast\n';
  const reference = { ...file, from: 3, to: 3 + token.length };
  const serialized = serializeEditor(editorDocument({ text, references: [reference] }));
  assert.equal(serialized.text, text); assert.deepEqual(serialized.references, [reference]);
  for (const offset of [0, 2, 3, reference.to, text.length]) assert.equal(serialized.offset(serialized.position(offset)), offset);
});

test('plain markdown stays literal unless a validated reference span accompanies it', () => {
  const text = '[paper.tex](paper.tex)';
  assert.equal(editorDocument({ text, references: [] }).firstChild?.firstChild?.isText, true);
  assert.equal(decodeDocument('{"text":"do not parse me","references":[]}').text, '{"text":"do not parse me","references":[]}');
  const reference = { from: 0, to: text.length, label: 'paper.tex', path: 'paper.tex', kind: 'file' as const };
  const document = { text, references: [reference] };
  assert.deepEqual(decodeDocument(encodeDocument(document)), document);
  assert.equal(editDocument(document, 'prefix ' + text).references[0].from, 7);
  assert.equal(editDocument(document, text.replace('paper', 'draft')).references.length, 0);
});
