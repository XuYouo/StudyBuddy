import { Schema, type Node as DocumentNode, type DOMOutputSpec } from 'prosemirror-model';
import { referenceText, validReferences, type ComposerDocument } from '../composer-reference.ts';

import { COMPOSER_FILE_GLYPH, COMPOSER_FOLDER_GLYPH } from './composer-file-glyph.ts';

const fileGlyph: DOMOutputSpec = ['http://www.w3.org/2000/svg svg', { width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': 'true' }, ['http://www.w3.org/2000/svg path', { d: COMPOSER_FILE_GLYPH, fill: 'currentColor', 'fill-rule': 'evenodd', 'clip-rule': 'evenodd' }]];
const folderGlyph: DOMOutputSpec = ['http://www.w3.org/2000/svg svg', { width: 10, height: 10, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, ['http://www.w3.org/2000/svg path', { d: COMPOSER_FOLDER_GLYPH, fill: 'currentColor', 'fill-rule': 'evenodd', 'clip-rule': 'evenodd' }]];

export const composerSchema = new Schema({ nodes: {
  doc: { content: 'paragraph+' },
  paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
  text: { group: 'inline' },
  hard_break: { inline: true, group: 'inline', selectable: false, toDOM: () => ['br'], parseDOM: [{ tag: 'br' }] },
  fileMention: {
    inline: true, group: 'inline', atom: true, selectable: false, draggable: false,
    attrs: { path: {}, label: {}, kind: { default: 'file' } },
    toDOM: node => ['span', { class: 'composer-file-mention', contenteditable: 'false', 'data-reference-path': node.attrs.path, 'data-reference-label': node.attrs.label, 'data-reference-kind': node.attrs.kind, 'data-reference-text': referenceText(node.attrs as Parameters<typeof referenceText>[0]), title: node.attrs.path },
      ['span', { class: 'composer-file-icon', 'aria-hidden': 'true' }, node.attrs.kind === 'directory' ? folderGlyph : fileGlyph], ['span', {}, node.attrs.label]],
    // Rich clipboard data is accepted only with the exact canonical token.
    parseDOM: [{ tag: 'span[data-reference-path][data-reference-label][data-reference-kind][data-reference-text]', getAttrs: element => {
      const attrs = { path: element.getAttribute('data-reference-path')!, label: element.getAttribute('data-reference-label')!, kind: element.getAttribute('data-reference-kind')! };
      return ['file', 'directory'].includes(attrs.kind) && element.getAttribute('data-reference-text') === referenceText(attrs as Parameters<typeof referenceText>[0]) ? attrs : false;
    } }],
  },
} });

export function editorDocument(value: ComposerDocument) {
  const paragraphs: DocumentNode[] = [], inline: DocumentNode[] = [];
  const flush = () => { paragraphs.push(composerSchema.nodes.paragraph.create(null, inline.splice(0))); };
  function append(text: string) { text.split('\n').forEach((line, index) => { if (index) flush(); if (line) inline.push(composerSchema.text(line)); }); }
  let from = 0;
  for (const reference of validReferences(value.text, value.references)) {
    append(value.text.slice(from, reference.from)); inline.push(composerSchema.nodes.fileMention.create(reference)); from = reference.to;
  }
  append(value.text.slice(from)); flush();
  return composerSchema.nodes.doc.create(null, paragraphs);
}

type Segment = { from: number; to: number; position: number; end: number; text: boolean };
export function serializeEditor(doc: DocumentNode) {
  const document: ComposerDocument = { text: '', references: [] }, segments: Segment[] = [];
  function append(text: string, position: number, end: number, plain = false) {
    const from = document.text.length; document.text += text;
    segments.push({ from, to: document.text.length, position, end, text: plain });
    return from;
  }
  doc.forEach((paragraph, offset, index) => {
    if (index) append('\n', offset - 1, offset + 1);
    paragraph.forEach((node, childOffset) => {
      const position = offset + childOffset + 1;
      if (node.isText) append(node.text!, position, position + node.nodeSize, true);
      else if (node.type.name === 'hard_break') append('\n', position, position + 1);
      else if (node.type.name === 'fileMention') {
        const reference = node.attrs as Parameters<typeof referenceText>[0];
        const from = append(referenceText(reference), position, position + 1);
        document.references.push({ ...reference, from, to: document.text.length });
      }
    });
  });
  return { ...document,
    position(offset: number, bias = 1) {
      for (const segment of segments) {
        if (offset <= segment.from) return segment.position;
        if (offset < segment.to) return segment.text ? segment.position + offset - segment.from : bias < 0 ? segment.position : segment.end;
      }
      return Math.max(1, doc.content.size - 1);
    },
    offset(position: number) {
      for (const segment of segments) {
        if (position <= segment.position) return segment.from;
        if (position < segment.end) return segment.text ? segment.from + position - segment.position : segment.from;
      }
      return document.text.length;
    },
  };
}
