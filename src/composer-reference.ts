import type { ComposerReference } from './shared.ts';

export type ComposerDocument = { text: string; references: ComposerReference[] };

// Match the official composer's Markdown serializer. Offsets are UTF-16 string
// offsets, not native text_elements byte ranges (file mentions do not use those).
export function referenceText(reference: Pick<ComposerReference, 'path' | 'label' | 'kind'>) {
  const label = reference.label.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll('](', ']\\(').replaceAll(']', '\\]');
  const path = (reference.kind === 'directory' && !reference.path.endsWith('/') ? reference.path + '/' : reference.path).replaceAll('\\', '\\\\').replaceAll(')', '\\)');
  return `[${label}](${path})`;
}

export function validReferences(text: string, value: unknown): ComposerReference[] {
  if (!Array.isArray(value)) return [];
  const references: ComposerReference[] = [];
  for (const reference of value) {
    if (!reference || !Number.isSafeInteger(reference.from) || !Number.isSafeInteger(reference.to) || reference.from < (references.at(-1)?.to ?? 0) || reference.to > text.length || reference.from >= reference.to || typeof reference.path !== 'string' || typeof reference.label !== 'string' || !['file', 'directory'].includes(reference.kind)) continue;
    if (text.slice(reference.from, reference.to) === referenceText(reference)) references.push({ from: reference.from, to: reference.to, path: reference.path, label: reference.label, kind: reference.kind });
  }
  return references;
}

// External plain-text edits (such as adding a note instruction) retain nodes
// outside the changed range. Editing any part of a mention makes it plain text.
export function editDocument(previous: ComposerDocument, text: string, references?: ComposerReference[]): ComposerDocument {
  if (references) return { text, references: validReferences(text, references) };
  let from = 0, end = previous.text.length, nextEnd = text.length;
  while (from < end && from < nextEnd && previous.text[from] === text[from]) from++;
  while (end > from && nextEnd > from && previous.text[end - 1] === text[nextEnd - 1]) { end--; nextEnd--; }
  const shift = nextEnd - end;
  return { text, references: validReferences(text, previous.references.flatMap(reference => reference.to <= from ? [reference] : reference.from >= end ? [{ ...reference, from: reference.from + shift, to: reference.to + shift }] : [])) };
}

const prefix = 'studybuddy:composer:v1\n';
export function encodeDocument(document: ComposerDocument) {
  return document.references.length ? prefix + JSON.stringify({ text: document.text, references: document.references }) : document.text;
}
export function decodeDocument(value: string | null): ComposerDocument {
  if (value?.startsWith(prefix)) {
    try { const parsed = JSON.parse(value.slice(prefix.length)); if (typeof parsed.text === 'string') return { text: parsed.text, references: validReferences(parsed.text, parsed.references) }; } catch { /* Keep corrupt or coincidental text editable. */ }
  }
  return { text: value || '', references: [] };
}
