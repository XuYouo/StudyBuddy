import type { CodexGoal, GoalMutation } from '../codex-goal.ts';
import type { Task } from '../shared.ts';

export function goalThreadStatus(value: unknown): 'active' | 'idle' | 'notLoaded' | 'unknown' {
  const type = value && typeof value === 'object' ? (value as { type?: unknown }).type : undefined;
  return type === 'active' || type === 'idle' || type === 'notLoaded' ? type : 'unknown';
}

export function nativeGoal(value: unknown, threadId: string): CodexGoal | null {
  if (value === null) return null;
  const goal = value as Partial<CodexGoal> | undefined;
  if (!goal || goal.threadId !== threadId || typeof goal.objective !== 'string' || !goal.objective.trim()
    || !['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'].includes(goal.status || '')
    || ![goal.tokensUsed, goal.timeUsedSeconds, goal.createdAt, goal.updatedAt].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    || !(goal.tokenBudget === null || (typeof goal.tokenBudget === 'number' && Number.isSafeInteger(goal.tokenBudget) && goal.tokenBudget >= 0))) throw new Error('Codex returned an invalid goal state.');
  return { threadId, objective: goal.objective, status: goal.status!, tokenBudget: goal.tokenBudget!, tokensUsed: goal.tokensUsed!, timeUsedSeconds: goal.timeUsedSeconds!, createdAt: goal.createdAt!, updatedAt: goal.updatedAt! };
}

export function goalMutation(value: unknown): GoalMutation {
  const input = value as GoalMutation | undefined;
  if (!input || typeof input !== 'object' || !['set', 'pause', 'resume', 'clear'].includes(input.action)
    || typeof input.requestKey !== 'string' || !/^[\w-]{1,100}$/.test(input.requestKey)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || Object.keys(input).some(key => !['action', 'requestKey', 'expectedRevision', 'objective', 'tokenBudget', 'attachments', 'references', 'appendTranscriptItem'].includes(key))) throw new Error('Invalid goal request.');
  if (input.action === 'set' && (typeof input.objective !== 'string' || (!input.objective.trim() && !input.attachments?.length))) throw new Error('Describe the goal.');
  if (input.action !== 'set' && (input.objective !== undefined || input.tokenBudget !== undefined || input.attachments !== undefined || input.references !== undefined || input.appendTranscriptItem !== undefined)) throw new Error('Invalid goal request.');
  if (input.appendTranscriptItem !== undefined && typeof input.appendTranscriptItem !== 'boolean') throw new Error('Invalid goal request.');
  if (input.attachments !== undefined && (!Array.isArray(input.attachments) || input.attachments.some(id => typeof id !== 'string' || !id))) throw new Error('Invalid goal attachments.');
  if (input.references !== undefined && !Array.isArray(input.references)) throw new Error('Invalid file reference.');
  if (input.tokenBudget !== undefined && input.tokenBudget !== null && (!Number.isSafeInteger(input.tokenBudget) || input.tokenBudget <= 0)) throw new Error('Choose a positive whole token budget.');
  return { action: input.action, requestKey: input.requestKey, expectedRevision: input.expectedRevision,
    ...(input.action === 'set' ? { objective: input.references?.length ? input.objective! : input.objective!.trim(), ...(input.appendTranscriptItem === undefined ? {} : { appendTranscriptItem: input.appendTranscriptItem }), ...(input.tokenBudget === undefined ? {} : { tokenBudget: input.tokenBudget }), ...(input.attachments === undefined ? {} : { attachments: [...input.attachments] }), ...(input.references === undefined ? {} : { references: input.references }) } : {}) };
}

export function goalHoldsTask(task: Pick<Task, 'goal' | 'goalControl' | 'initialGoal'>) {
  return Boolean(task.initialGoal || task.goal?.status === 'active' || task.goalControl?.awaitingIdle || task.goalControl?.sync === 'pending' || task.goalControl?.sync === 'unknown');
}

export function goalMatchesMutation(goal: CodexGoal | null, operation: GoalMutation & { nativeObjective?: string; baseline?: CodexGoal | null }) {
  if (operation.action === 'clear') return goal === null;
  if (!goal) return false;
  if (operation.action === 'pause') return goal.status === 'paused';
  if (operation.action === 'resume') return goal.status === 'active' || (goal.status !== 'paused' && operation.baseline && goal.status !== operation.baseline.status && goal.objective === operation.baseline.objective && goal.createdAt === operation.baseline.createdAt);
  // A native goal can finish before the acknowledgement reaches this client.
  return goal.status !== 'paused' && goal.objective === (operation.nativeObjective || operation.objective?.trim()) && (operation.tokenBudget === undefined || operation.tokenBudget === null || operation.tokenBudget === goal.tokenBudget);
}
