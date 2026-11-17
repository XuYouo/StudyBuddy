import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CodexGoalCard, CodexGoalMode, CodexGoalReplacement } from '../../src/web/codex-goal.tsx';
import type { CodexGoal } from '../../src/codex-goal.ts';
import '../../src/web/codex-chat.css';

const initial: CodexGoal = { threadId: 'fixture', objective: 'Check the manuscript and verify every reference.', status: 'active', tokenBudget: 4000, tokensUsed: 1500, timeUsedSeconds: 65, createdAt: 1, updatedAt: 2 };
const api = window as unknown as { fixture: { calls: { action: string; objective?: string }[]; fail: boolean; hold: boolean; release?: () => void; update: (goal: Partial<CodexGoal>) => void; replace: (text: string) => void } };
function Fixture() {
  const [goal, setGoal] = useState(initial), [replacement, setReplacement] = useState<string | null>(null), [mode, setMode] = useState(true);
  api.fixture ||= { calls: [], fail: false, hold: false, update: () => {}, replace: () => {} };
  api.fixture.update = next => setGoal(old => ({ ...old, ...next })); api.fixture.replace = setReplacement;
  async function act(action: string, objective?: string) {
    api.fixture.calls.push({ action, ...(objective === undefined ? {} : { objective }) });
    if (api.fixture.hold) await new Promise<void>(resolve => { api.fixture.release = resolve; });
    if (api.fixture.fail) throw new Error('Fixture request failed');
    setGoal(old => ({ ...old, ...(objective === undefined ? {} : { objective }), status: action === 'pause' ? 'paused' : action === 'resume' ? 'active' : old.status }));
  }
  return <main style={{ maxWidth: 650, margin: '60px auto', fontFamily: 'system-ui' }}><button type="button">Outside control</button>
    <CodexGoalCard goal={goal} onSet={objective => act('set', objective)} onPause={() => act('pause')} onResume={() => act('resume')} onClear={() => act('clear')}/>
    {mode && <CodexGoalMode onClear={() => setMode(false)}/>}
    {replacement !== null && <CodexGoalReplacement objective={replacement} onSet={objective => act('replace', objective)} onClose={() => setReplacement(null)}/>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
