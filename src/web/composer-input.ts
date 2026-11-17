import type { ComposerReference } from '../shared.ts';

// Explicit editor adapter shared by commands and model menus. The DOM element
// is only used for focus, accessibility and event routing; text lives in the
// ProseMirror document, never in synthetic textarea properties.
export interface ComposerInput {
  readonly element: HTMLElement;
  readonly value: string;
  readonly references: ComposerReference[];
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly composing: boolean;
  focus(options?: FocusOptions): void;
  hasFocus(): boolean;
  setSelectionRange(start: number, end: number): void;
  replaceRange(start: number, end: number, text: string, separateHistory?: boolean): void;
  insertReference(start: number, end: number, reference: Pick<ComposerReference, 'path' | 'label' | 'kind'>): void;
  subscribe(listener: () => void): () => void;
}
