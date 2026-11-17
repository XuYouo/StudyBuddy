import { useLayoutEffect, useRef, type RefObject } from 'react';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { baseKeymap } from 'prosemirror-commands';
import { history, undo, redo, closeHistory } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { ComposerDocument } from '../composer-reference.ts';
import type { ComposerFile } from '../shared.ts';
import type { ComposerInput } from './composer-input.ts';
import { composerSchema, editorDocument, serializeEditor } from './composer-editor-model.ts';
import './composer-editor.css';

type Props = {
  value: ComposerDocument; inputRef: RefObject<ComposerInput | null>; label: string; placeholder: string; readOnly?: boolean;
  onChange(value: ComposerDocument): void; onKeyDown(event: KeyboardEvent): void;
  onPasteFiles(files: File[], text: string): void;
  onOpenReference?: (file: ComposerFile) => void;
  attributes?: Record<string, string | undefined>;
};

export function ComposerEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null), current = useRef(props); current.current = props;
  const viewRef = useRef<EditorView | null>(null), syncRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    if (!host.current) return;
    const listeners = new Set<() => void>();
    let composition = false;
    const emit = () => { for (const listener of listeners) listener(); };
    // Commit document-boundary navigation synchronously. ProseMirror's delayed
    // focus-repair heuristic can otherwise mistake a real native move to the
    // start for a browser focus reset and restore the previous caret.
    const boundary = (end: boolean, extend: boolean): Command => (state, dispatch) => {
      const head = end ? state.doc.content.size - 1 : 1;
      const anchor = extend ? Math.max(1, Math.min(state.doc.content.size - 1, state.selection.anchor)) : head;
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, anchor, head)).scrollIntoView());
      return true;
    };
    const boundaries: Record<string, Command> = {};
    const apple = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
    for (const [key, end] of [['Mod-Home', false], ['Mod-End', true], ...(apple ? [['Meta-ArrowUp', false], ['Meta-ArrowDown', true]] : [])] as [string, boolean][]) {
      boundaries[key] = boundary(end, false); boundaries['Shift-' + key] = boundary(end, true);
    }
    const view = new EditorView(host.current, {
      state: EditorState.create({ doc: editorDocument(current.current.value), plugins: [history(), keymap(boundaries), keymap({ 'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo, 'Shift-Enter': (state, dispatch) => { dispatch?.(state.tr.replaceSelectionWith(composerSchema.nodes.hard_break.create()).scrollIntoView()); return true; } }), keymap(baseKeymap)] }),
      editable: () => !current.current.readOnly,
      dispatchTransaction(transaction) {
        view.updateState(view.state.apply(transaction));
        const snapshot = serializeEditor(view.state.doc);
        view.dom.dataset.empty = String(!snapshot.text);
        if (transaction.docChanged && !transaction.getMeta('external')) current.current.onChange({ text: snapshot.text, references: snapshot.references });
        emit();
      },
      handleKeyDown: (_view, event) => {
        if (event.isComposing || event.keyCode === 229 || composition || view.composing) return false;
        current.current.onKeyDown(event); return event.defaultPrevented;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []);
        if (!files.length) return false;
        current.current.onPasteFiles(files, event.clipboardData?.getData('text/plain') || ''); return true;
      },
      clipboardTextSerializer: slice => {
        const blocks = slice.content.firstChild?.isInline ? [composerSchema.nodes.paragraph.create(null, slice.content)] : slice.content;
        const doc = composerSchema.nodes.doc.create(null, blocks);
        return serializeEditor(doc).text;
      },
      handleDOMEvents: {
        // Consume the custom handler before ProseMirror's base Enter keymap.
        // Do not preventDefault: the native IME still owns this keystroke.
        keydown: (_view, event) => {
          if (event.isComposing || event.keyCode === 229 || composition || view.composing) return true;
          const mention = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-reference-path]') : null;
          if (mention?.dataset.referenceKind === 'file' && event.key === 'Enter' && current.current.onOpenReference) { event.preventDefault(); openMention(mention); return true; }
          return false;
        },
        click: (_view, event) => {
          const mention = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-reference-path]') : null;
          if (mention?.dataset.referenceKind === 'file' && current.current.onOpenReference) { event.preventDefault(); openMention(mention); return true; }
          return false;
        },
        focus: () => { emit(); return false; }, blur: () => { emit(); return false; },
        compositionstart: () => { composition = true; return false; },
        compositionend: () => { composition = false; queueMicrotask(() => { if (!view.isDestroyed) { syncRef.current(); emit(); } }); return false; },
      },
    });
    function openMention(element: HTMLElement) {
      current.current.onOpenReference?.({ path: element.dataset.referencePath!, label: element.dataset.referenceLabel!, kind: element.dataset.referenceKind as ComposerFile['kind'] });
    }
    viewRef.current = view;
    const control: ComposerInput = {
      element: view.dom,
      get value() { return serializeEditor(view.state.doc).text; },
      get references() { return serializeEditor(view.state.doc).references; },
      get selectionStart() { return serializeEditor(view.state.doc).offset(view.state.selection.from); },
      get selectionEnd() { return serializeEditor(view.state.doc).offset(view.state.selection.to); },
      get composing() { return composition || view.composing; },
      focus: options => { view.dom.focus(options); view.focus(); }, hasFocus: () => view.hasFocus(),
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      setSelectionRange(start, end) { const snapshot = serializeEditor(view.state.doc); view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, snapshot.position(start, -1), snapshot.position(end))).setMeta('addToHistory', false)); },
      replaceRange(start, end, text, separateHistory = false) { const snapshot = serializeEditor(view.state.doc), transaction = separateHistory ? closeHistory(view.state.tr) : view.state.tr; view.dispatch(transaction.insertText(text, snapshot.position(start, -1), snapshot.position(end)).scrollIntoView()); },
      insertReference(start, end, reference) {
        const snapshot = serializeEditor(view.state.doc), from = snapshot.position(start, -1), to = snapshot.position(end);
        const tr = closeHistory(view.state.tr).replaceWith(from, to, [composerSchema.nodes.fileMention.create(reference), composerSchema.text(' ')]);
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 2)).scrollIntoView());
        // A picked reference is one undo step; subsequent typing/deleting must
        // not be folded into the autocomplete insertion.
        view.dispatch(closeHistory(view.state.tr)); view.focus();
      },
    };
    props.inputRef.current = control;
    syncRef.current = () => {
      const next = current.current;
      const attrs: Record<string, string> = { class: 'composer-input', role: 'textbox', 'aria-multiline': 'true', 'aria-label': next.label, 'aria-placeholder': next.placeholder, 'aria-readonly': String(Boolean(next.readOnly)), 'data-placeholder': next.placeholder, 'data-empty': String(!control.value), spellcheck: 'true', tabindex: '0' };
      for (const [key, value] of Object.entries(next.attributes || {})) if (value !== undefined) attrs[key] = value;
      view.setProps({ attributes: attrs, editable: () => !current.current.readOnly });
      for (const element of view.dom.querySelectorAll<HTMLElement>('[data-reference-path]')) {
        if (next.onOpenReference && element.dataset.referenceKind === 'file') { element.setAttribute('role', 'link'); element.tabIndex = 0; }
        else { element.removeAttribute('role'); element.removeAttribute('tabindex'); }
      }
      if (control.composing) return;
      const live = serializeEditor(view.state.doc);
      if (live.text === next.value.text && live.references.length === next.value.references.length && live.references.every((reference, index) => {
        const other = next.value.references[index];
        return reference.from === other.from && reference.to === other.to && reference.path === other.path && reference.label === other.label && reference.kind === other.kind;
      })) return;
      const doc = editorDocument(next.value);
      if (view.state.doc.eq(doc)) return;
      const snapshot = serializeEditor(doc);
      const caret = Math.min(control.selectionStart, next.value.text.length);
      // External draft changes start a separate undo history; matching controlled echoes
      // above never disturb browser composition, selection or undo history.
      view.updateState(EditorState.create({ doc, plugins: view.state.plugins, selection: TextSelection.create(doc, snapshot.position(caret)) }));
      emit();
    };
    syncRef.current();
    return () => { props.inputRef.current = null; viewRef.current = null; view.destroy(); listeners.clear(); syncRef.current = () => {}; };
  }, [props.inputRef]);
  useLayoutEffect(() => syncRef.current());
  return <div className="composer-editor" ref={host}/>;
}
