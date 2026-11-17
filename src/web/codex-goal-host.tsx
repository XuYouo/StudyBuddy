import { useRef, useState } from 'react';
import type { ComposerReference, Task } from '../shared.ts';
import { CodexGoalCard, CodexGoalReplacement } from './codex-goal.tsx';
import { browserStorage } from './storage.ts';
import { t } from './i18n.ts';

type GoalDraft = { objective: string; references?: ComposerReference[]; attachments?: string[] };
type Call = <T>(url: string, body?: unknown) => Promise<T>;

/** Bind native goal controls to the task's confirmed revision and operation receipt. */
export function useTaskGoal({ task, disabled, api, saved, refresh }: { task: Task; disabled: boolean; api: Call; saved(task: Task): void; refresh(): void }) {
  const [checkError, setCheckError] = useState('');
  const [busy, setBusy] = useState(false), [replacement, setReplacement] = useState<{ draft: GoalDraft; revision: number; done(): void } | null>(null);
  const running = useRef(false);
  const key = `studybuddy:goal-operation:${task.id}`, unknown = task.goalControl?.sync === 'unknown', pending = task.goalControl?.sync === 'pending';
  const locked = disabled || busy || unknown || pending;
  async function change(action: 'set' | 'pause' | 'resume' | 'clear', draft?: GoalDraft, revision = task.goalControl?.revision || 0, appendTranscriptItem = true) {
    if (running.current || disabled || unknown && !(action === 'resume' && task.goalControl?.resumeRequired) || pending) throw new Error(t('Check the current goal operation before changing it.'));
    const body = { action, expectedRevision: revision, ...(action === 'set' ? { ...draft, appendTranscriptItem } : {}) }, signature = JSON.stringify(body);
    let requestKey = '';
    try { const receipt = JSON.parse(browserStorage.getItem(key) || 'null'); if (receipt?.signature === signature) requestKey = receipt.requestKey; } catch { /* Invalid local identity starts a fresh request. */ }
    requestKey ||= crypto.randomUUID(); browserStorage.setItem(key, JSON.stringify({ signature, requestKey }));
    running.current = true; setBusy(true);
    try { const result = await api<Task>(`/tasks/${task.id}/goal`, { ...body, requestKey }); saved(result); browserStorage.removeItem(key); }
    finally { running.current = false; setBusy(false); refresh(); }
  }
  async function check() {
    if (running.current) return;
    running.current = true; setBusy(true); setCheckError('');
    try { saved(await api<Task>(`/tasks/${task.id}/goal/check`, {})); }
    catch (error) { setCheckError((error as Error).message); }
    finally { running.current = false; setBusy(false); refresh(); }
  }
  const goal = task.goal ? { ...task.goal, objective: task.goalSource?.nativeObjective === task.goal.objective ? task.goalSource.objective : task.goal.objective } : null;
  async function submit(draft: GoalDraft, done: () => void) {
    if (goal && (goal.objective !== draft.objective || draft.attachments?.length)) { setReplacement({ draft, done, revision: task.goalControl?.revision || 0 }); return; }
    await change('set', draft); done();
  }
  const notice = unknown || task.goalControl?.error || checkError ? <div className="codex-goal-notice"><span>{checkError || task.goalControl?.error || t('Check task status before sending')}</span>{unknown && <button type="button" disabled={busy} onClick={() => void check().catch(() => {})}>{t('Check status')}</button>}</div> : null;
  return { busy, locked, submit,
    card: <>{goal && <CodexGoalCard goal={goal} revision={task.goalControl?.revision || 0} resumeRequired={task.goalControl?.resumeRequired} disabled={disabled || busy || pending || unknown && !task.goalControl?.resumeRequired} notice={notice} onSet={(objective, revision) => change('set', { objective }, revision, false)} onPause={() => change('pause')} onResume={() => change('resume')} onClear={() => change('clear')}/>} {!goal && notice}
      {replacement && <CodexGoalReplacement attachmentCount={replacement.draft.attachments?.length} objective={replacement.draft.objective} disabled={locked} onSet={async () => { const current = replacement; await change('set', current.draft, current.revision); current.done(); }} onClose={() => setReplacement(null)}/>}</>,
  };
}
