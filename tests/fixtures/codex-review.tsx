import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CodexReviewPicker, type CodeReviewControl } from '../../src/web/codex-review-picker.tsx';
import { ComposerEditor } from '../../src/web/composer-editor.tsx';
import type { ComposerInput } from '../../src/web/composer-input.ts';
import type { CodeReviewTarget } from '../../src/code-review.ts';
import '../../src/web/style.css';
import '../../src/web/codex-chat.css';

const fixture = window as unknown as { fixture: { calls: CodeReviewTarget[]; reads: number; failLoad: boolean; failReview: boolean; hold: boolean; holdLoad: boolean; releaseLoad?: () => void; release?: () => void; disabled: (value: boolean) => void } };
fixture.fixture = { calls: [], reads: 0, failLoad: false, failReview: false, hold: false, holdLoad: false, disabled: () => {} };
function Fixture() {
  const [value, setValue] = useState('/'), [disabled, setDisabled] = useState(false);
  const picker = useRef<CodeReviewControl>(null), input = useRef<ComposerInput>(null), onInput = useRef<(() => void) | null>(null), onSubmit = useRef<(() => void) | null>(null);
  fixture.fixture.disabled = setDisabled;
  useLayoutEffect(() => { onInput.current?.(); }, [value]);
  function open() {
    input.current?.focus(); input.current?.setSelectionRange(value.length, value.length);
    picker.current?.open({ input: input.current!, registerInput: read => { onInput.current = read; }, registerSubmit: submit => { onSubmit.current = submit; }, onCommit: () => setValue(''), onClose: restore => { if (restore) input.current?.focus(); } });
  }
  return <main className="codex-chat-panel" style={{ height: '100dvh', padding: 8, display: 'flex', flexDirection: 'column' }}>
    <button type="button" style={{ alignSelf: 'start', padding: 8 }} onClick={open}>Open review</button>
    <button type="button" style={{ alignSelf: 'start', padding: 8 }}>Outside control</button>
    <div className="composer codex-composer" style={{ marginTop: 'auto', width: '100%' }}>
      <ComposerEditor inputRef={input} value={{ text: value, references: [] }} label="Review command" placeholder="Type a command" onChange={draft => setValue(draft.text)} onPasteFiles={() => {}} onKeyDown={() => {}}/>
      <div className="composer-footer"><button type="button" onClick={() => onSubmit.current?.()}>Submit</button></div>
      <CodexReviewPicker controlRef={picker} disabled={disabled} load={async signal => {
        fixture.fixture.reads++;
        if (fixture.fixture.holdLoad) await new Promise<void>(resolve => { fixture.fixture.releaseLoad = resolve; });
        signal.throwIfAborted();
        if (fixture.fixture.failLoad) throw new Error('Unable to load branches');
        return { current: 'feature', branches: [{ name: 'main', ref: 'refs/heads/main' }, { name: 'research/量子', ref: 'refs/heads/research/量子' }, { name: 'origin/release', ref: 'refs/remotes/origin/release' }] };
      }} review={async target => {
        fixture.fixture.calls.push(target);
        if (fixture.fixture.hold) await new Promise<void>(resolve => { fixture.fixture.release = resolve; });
        if (fixture.fixture.failReview) throw new Error('Failed to start code review');
      }}/>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
