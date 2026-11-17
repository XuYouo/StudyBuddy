import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useComposerDictation, dictationApi } from '../../src/web/composer-dictation.tsx';
import { ComposerEditor } from '../../src/web/composer-editor.tsx';
import type { ComposerInput } from '../../src/web/composer-input.ts';
import type { ComposerDocument } from '../../src/composer-reference.ts';
import '../../src/web/style.css';
import '../../src/web/codex-chat.css';
const api = dictationApi(() => 'fixture-csrf');
function Fixture() {
  const input = useRef<ComposerInput>(null), [key, setKey] = useState('task:a'), [enabled, setEnabled] = useState(true), [document, setDocument] = useState<ComposerDocument>({ text: '', references: [] });
  const recording = useComposerDictation({ inputRef: input, contextKey: key, enabled, api, onSubmit: () => { const fixture = window as unknown as { submitted?: ComposerDocument[] }; (fixture.submitted ||= []).push(document); } });
  Object.assign(window, { fixture: { setKey, setEnabled, setDocument, document, insertReference: () => input.current!.insertReference(input.current!.value.length, input.current!.value.length, { path: 'main.tex', label: 'main.tex', kind: 'file' }), getDocument: () => ({ text: input.current!.value, references: input.current!.references }) } });
  return <main style={{ maxWidth: 540, margin: '60px auto', padding: 8 }}>
    <button type="button" onClick={() => setKey('task:b')}>Switch task</button><button type="button" onClick={() => setEnabled(false)}>Switch provider</button>
    <form className="composer codex-composer" onSubmit={event => event.preventDefault()}>
      <div hidden={recording.busy}><ComposerEditor inputRef={input} value={document} label="Draft" placeholder="Ask anything" onChange={setDocument} onKeyDown={() => {}} onPasteFiles={() => {}} readOnly={recording.busy || recording.retained}/></div>
      {recording.panel}<div className="composer-footer" hidden={recording.busy || recording.retained}>{recording.button}</div>
    </form>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
