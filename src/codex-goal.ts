// Codex app-server 0.164 ThreadGoal. Usage and timestamps are native values;
// callers must not infer goal progress from ordinary task status or wall time.
export interface CodexGoal {
  threadId: string;
  objective: string;
  status: 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete';
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface GoalMutation {
  action: 'set' | 'pause' | 'resume' | 'clear';
  requestKey: string;
  expectedRevision: number;
  objective?: string;
  tokenBudget?: number | null;
  attachments?: string[];
  references?: import('./shared.ts').ComposerReference[];
  appendTranscriptItem?: boolean;
}

export interface GoalControl {
  revision: number;
  sync: 'ready' | 'pending' | 'unknown';
  nativeStatus?: 'active' | 'idle' | 'notLoaded' | 'unknown';
  /** Explicit user resume is required to load an active, unloaded goal. */
  resumeRequired?: boolean;
  /** A sent activation needs native idle evidence before final publication. */
  awaitingIdle?: boolean;
  error?: string;
  /** Turns predating this goal chain are never adopted as autonomous work. */
  previousTurns?: string[];
  workPending?: boolean;
  operation?: GoalMutation & { requestedAt: number; baseline: CodexGoal | null; runId?: string; sent?: boolean; nativeObjective?: string };
}

// Matches the official thread-goal status toggle: exhausted and completed
// goals require a new/edited objective, not a resume request.
export function goalStatusAction(status: CodexGoal['status']): 'pause' | 'resume' | null {
  switch (status) {
    case 'active': return 'pause';
    case 'paused': case 'blocked': case 'usageLimited': return 'resume';
    case 'budgetLimited': case 'complete': return null;
  }
}

export function goalUsageKind(goal: Pick<CodexGoal, 'status' | 'tokenBudget'>): 'tokens' | 'time' {
  return goal.tokenBudget !== null && (goal.status === 'active' || goal.status === 'budgetLimited') ? 'tokens' : 'time';
}

// Official compact duration (whole native seconds, omit zero units). Keep this
// free of Date.now so render frequency cannot increase reported reasoning use.
export function goalTime(seconds: number, locale = 'en'): string {
  const total = Math.max(0, Math.floor(seconds));
  const units: [number, string][] = [[Math.floor(total / 86400), 'day'], [Math.floor(total / 3600) % 24, 'hour'], [Math.floor(total / 60) % 60, 'minute'], [total % 60, 'second']];
  const present = units.filter(([value]) => value > 0);
  return (present.length ? present : [[0, 'second']] as [number, string][]).map(([value, unit]) => new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(value)).join(' ');
}
