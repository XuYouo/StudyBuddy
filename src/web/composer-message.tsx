import { Fragment, type ReactNode } from 'react';
import { validReferences } from '../composer-reference.ts';
import type { ComposerFile } from '../shared.ts';
import { COMPOSER_FILE_GLYPH, COMPOSER_FOLDER_GLYPH } from './composer-file-glyph.ts';
import './composer-message.css';

// Only saved, canonical reference spans become mentions. Markdown that the user
// typed as ordinary text remains literal, including its surrounding whitespace.
export function ComposerMessage({ text, references, onOpenReference }: { text: string; references?: unknown; onOpenReference?: (file: ComposerFile) => void }) {
  const parts: ReactNode[] = [];
  let from = 0;
  for (const reference of validReferences(text, references)) {
    parts.push(text.slice(from, reference.from));
    const content = <><svg width="10" height="10" viewBox={reference.kind === 'directory' ? '0 0 16 16' : '0 0 10 10'} aria-hidden="true"><path d={reference.kind === 'directory' ? COMPOSER_FOLDER_GLYPH : COMPOSER_FILE_GLYPH} fill="currentColor" fillRule="evenodd" clipRule="evenodd"/></svg><span>{reference.label}</span></>;
    parts.push(<Fragment key={reference.from}>{reference.kind === 'file' && onOpenReference
      ? <button type="button" className="message-file-reference" title={reference.path} data-reference-path={reference.path} onClick={() => onOpenReference(reference)}>{content}</button>
      : <span className="message-file-reference" title={reference.path} data-reference-path={reference.path}>{content}</span>}</Fragment>);
    from = reference.to;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}
