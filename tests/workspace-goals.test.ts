import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/server/workspace.ts';
import { Store } from '../src/server/store.ts';
import { Codex, RpcResponseError } from '../src/server/codex.ts';
import { goalMutation, nativeGoal } from '../src/server/goals.ts';
import type { CodexGoal, GoalMutation } from '../src/codex-goal.ts';
import type { Task, Run } from '../src/shared.ts';
import type { ReviewClient } from '../src/server/review.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const goal = (update: Partial<CodexGoal> = {}): CodexGoal => ({ threadId: 'thread', objective: 'Check every citation.', status: 'active', tokenBudget: 4000, tokensUsed: 10, timeUsedSeconds: 2, createdAt: 100, updatedAt: 100, ...update });
class GoalAgent extends EventEmitter {
  ready = true;
  calls: { method: string; params: any }[] = [];
  rejected: unknown[] = []; replies: unknown[] = [];
  goal: CodexGoal | null = null;
  turns: any[] = []; status = 'idle'; enabled = true;
  handler?: (method: string, params: any) => Promise<any>;
  start = async () => {};
  permissionOptions = () => [{ value: 'workspace', label: 'Workspace' }];
  taskPermissionConfig = async () => ({ thread: { sandbox: 'workspace-write' }, turn: { approvalPolicy: 'on-request', sandboxPolicy: { type: 'workspaceWrite' } } });
  async request(method: string, params: any): Promise<any> {
    this.calls.push({ method, params });
    if (this.handler) { const result = await this.handler(method, params); if (result !== undefined) return result; }
    if (method === 'account/read') return { account: { type: 'apiKey' } };
    if (method === 'model/list') return { data: [{ id: 'model', model: 'model', displayName: 'Model', supportedReasoningEfforts: [{ reasoningEffort: 'high' }], defaultReasoningEffort: 'high', isDefault: true }] };
    if (method === 'experimentalFeature/list') return { data: [{ name: 'goals', enabled: this.enabled }] };
    if (method === 'config/read') return { config: { approvals_reviewer: 'user', model: 'model' } };
    if (method === 'thread/read') return { thread: { id: 'thread', turns: structuredClone(this.turns), status: { type: this.status } } };
    if (method === 'thread/goal/get') return { goal: structuredClone(this.goal) };
    if (method === 'thread/goal/set') { this.goal = goal({ ...this.goal, ...('objective' in params ? { objective: params.objective } : {}), status: params.status, ...(params.tokenBudget === undefined ? {} : { tokenBudget: params.tokenBudget }), updatedAt: (this.goal?.updatedAt || 100) + 1 }); return { goal: structuredClone(this.goal) }; }
    if (method === 'thread/goal/clear') { this.goal = null; return {}; }
    if (method === 'thread/start' || method === 'thread/resume') { this.status = 'idle'; return { thread: { id: 'thread' }, model: 'model' }; }
    if (method === 'turn/start') return { turn: { id: 'ordinary-turn' } };
    return {};
  }
  reject(...args: unknown[]) { this.rejected.push(args); }
  respond(...args: unknown[]) { this.replies.push(args); }
  close() { this.ready = false; }
}
function fixture() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'studybuddy-goals-'));
  const store = new Store(path.join(folder, 'store.sqlite')), agent = new GoalAgent();
  const client: ReviewClient = { url: 'http://fixture.invalid', token: 'fixture', get: async <T,>() => ({ round: 0, changed: [], dirty: false } as T), post: async <T,>() => ({ worktree: folder, deferred: true } as T) };
  const workspace = new Workspace(store, agent as unknown as Codex, async () => client);
  const task: Task = { id: 'task', projectId: 'project', name: 'p-task', title: 'Goal fixture', instructions: 'Check this manuscript.', worktree: folder, threadId: 'thread', turnId: null, model: 'model', effort: 'high', permissions: 'workspace', serviceTier: 'default', status: 'idle', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
  store.saveProject({ id: 'project', name: 'Fixture', path: folder, createdAt: 1 }); store.saveTask(task);
  workspace.runtime.connected = true; workspace.runtime.authenticated = true; workspace.runtime.goalAvailable = true;
  workspace.runtime.models = [{ id: 'model', name: 'Model', efforts: ['high'], defaultEffort: 'high', isDefault: true }];
  (workspace as any).loaded.add('thread');
  const publications: string[] = [];
  workspace.publish = async (taskId: string, run?: Run) => { publications.push(run!.id); for (const run of store.runs().filter(run => run.taskId === taskId && run.reviewRound === 0)) store.saveRun({ ...run, reviewRound: 1 }); store.updateTask(taskId, { status: 'reviewing' }); };
  let key = 0;
  const mutate = (action: GoalMutation['action'], extra: Partial<GoalMutation> = {}, taskId = task.id) => workspace.changeGoal(taskId, { action, requestKey: 'operation-' + ++key, expectedRevision: store.task(taskId).goalControl?.revision || 0, ...extra });
  const notify = (method: string, params: any) => (workspace as any).notification({ method, params: { threadId: 'thread', ...params } }, 'codex');
  const start = async (id: string) => { agent.status = 'active'; agent.turns.push({ id, status: 'inProgress', startedAt: 101, items: [] }); await notify('turn/started', { turn: agent.turns.at(-1) }); };
  const complete = async (id: string) => { agent.status = 'idle'; const turn = agent.turns.find(turn => turn.id === id); Object.assign(turn, { status: 'completed', completedAt: 104, durationMs: 3000 }); await notify('turn/completed', { turn }); };
  return { folder, store, agent, workspace, task, mutate, notify, start, complete, publications, close: () => { workspace.close(); store.close(); fs.rmSync(folder, { recursive: true, force: true }); } };
}

test('Goal validates native snapshots and user budgets without inventing usage', () => {
  assert.deepEqual(nativeGoal(goal(), 'thread'), goal());
  for (const value of [undefined, {}, goal({ threadId: 'foreign' }), goal({ tokensUsed: NaN })]) assert.throws(() => nativeGoal(value, 'thread'), /invalid goal/);
  for (const tokenBudget of [-1, 0, 1.5, Infinity]) assert.throws(() => goalMutation({ action: 'set', requestKey: 'key', expectedRevision: 0, objective: 'Do this', tokenBudget }), /positive whole/);
  assert.equal(goalMutation({ action: 'set', requestKey: 'key', expectedRevision: 0, objective: '', attachments: ['file'] }).objective, '');
  assert.throws(() => goalMutation({ action: 'pause', requestKey: 'key', expectedRevision: 0, objective: 'injection' }), /Invalid goal/);
});

test('native Goal applies task policy and activates once without turn/start', async () => {
  const f = fixture();
  try {
    const input = { action: 'set', requestKey: 'set-1', expectedRevision: 0, objective: '  Check every citation.  ', tokenBudget: 5000 };
    const first = f.workspace.changeGoal(f.task.id, input), second = f.workspace.changeGoal(f.task.id, input);
    assert.equal(first, second); await first;
    await f.workspace.changeGoal(f.task.id, input);
    assert.deepEqual(f.agent.calls.find(call => call.method === 'thread/goal/set')!.params, { threadId: 'thread', origin: 'user', objective: 'Check every citation.', tokenBudget: 5000, status: 'active' });
    const settings = f.agent.calls.find(call => call.method === 'thread/settings/update')!.params;
    assert.equal(settings.cwd, f.folder); assert.deepEqual(settings.sandboxPolicy, { type: 'workspaceWrite' }); assert.equal(settings.collaborationMode.mode, 'default');
    assert.equal(f.agent.calls.filter(call => call.method === 'thread/goal/set').length, 1);
    assert.equal(f.agent.calls.some(call => call.method === 'turn/start'), false);
    assert.equal(f.workspace.queue(f.task.id).waiting, 'goal'); assert.equal(f.workspace.busyForUpdate, true);
    assert.throws(() => f.workspace.changeGoal(f.task.id, { ...input, requestKey: 'stale' }), /changed/);
    await assert.rejects(f.workspace.changeGoal(f.task.id, { ...input, attachments: ['changed'] }), /already in use/);
    assert.throws(() => f.workspace.updateTaskPermissions(f.task.id, 'workspace'), /Pause/);
  } finally { f.close(); }
});

test('Goal capability fails closed and native settings rejection never activates work', async () => {
  const f = fixture();
  try {
    f.workspace.runtime.goalAvailable = false;
    assert.throws(() => f.mutate('set', { objective: 'Check.' }), /not enabled/);
    assert.equal(f.agent.calls.length, 0);
    f.workspace.runtime.goalAvailable = true;
    f.agent.handler = async method => { if (method === 'thread/settings/update') throw new RpcResponseError('settings unsupported', -32601); };
    await assert.rejects(f.mutate('set', { objective: 'Check.' }), /unsupported/);
    assert.equal(f.agent.calls.some(call => call.method === 'thread/goal/set'), false);
    assert.equal(f.store.task(f.task.id).goalControl?.sync, 'ready');
  } finally { f.close(); }
});

test('autonomous turns preserve approvals, timing and summaries and publish once after the whole Goal', async () => {
  const f = fixture();
  try {
    await f.mutate('set', { objective: 'Check every citation.' });
    await f.start('auto-1'); await f.start('auto-1');
    (f.workspace as any).serverRequest({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', turnId: 'auto-1', command: 'git diff', availableDecisions: ['accept', 'decline'] } }, 'codex');
    const request = [...f.workspace.requests.values()][0]; assert.ok(request); f.workspace.answer(request.id, { decision: 'accept' });
    await f.notify('item/completed', { turnId: 'auto-1', item: { id: 'reason', type: 'reasoning', summary: ['Checking citations'], content: ['hidden'] } });
    await f.complete('auto-1'); assert.equal(f.publications.length, 0);
    await f.start('auto-2');
    f.agent.goal = goal({ status: 'complete', tokensUsed: 3456, timeUsedSeconds: 42 });
    await f.notify('thread/goal/updated', { goal: f.agent.goal }); assert.equal(f.publications.length, 0);
    await f.complete('auto-2');
    await f.notify('thread/goal/updated', { goal: f.agent.goal });
    assert.equal(f.publications.length, 1); assert.equal(f.store.runs().length, 2);
    assert.ok(f.store.runs().every(run => run.durationMs === 3000 && run.reviewRound === 1));
    assert.equal(f.store.items(f.task.id).find(item => item.type === 'reasoning')?.text, 'Checking citations');
    assert.equal(f.store.task(f.task.id).completedGoal?.tokensUsed, 3456);
    assert.equal(f.agent.calls.some(call => call.method === 'turn/start'), false);
  } finally { f.close(); }
});

test('local queue waits between Goal turns and another task can dispatch', async () => {
  const f = fixture();
  try {
    await f.mutate('set', { objective: 'Check.' });
    await f.workspace.enqueue(f.task.id, 'After the goal.', 'queued', false);
    f.store.saveTask({ ...f.task, id: 'other', name: 'other', titleSource: 'manual', threadId: 'other-thread' });
    (f.workspace as any).loaded.add('other-thread');
    await f.workspace.enqueue('other', 'Independent work.', 'independent', false); await tick(); await tick();
    assert.equal(f.store.runByKey('queued')!.status, 'queued');
    assert.equal(f.agent.calls.filter(call => call.method === 'turn/start').length, 1);
    assert.equal(f.agent.calls.find(call => call.method === 'turn/start')!.params.threadId, 'other-thread');
  } finally { f.close(); }
});

test('Goal pause and clear retain current native turn ownership until completion', async () => {
  for (const action of ['pause', 'clear'] as const) {
    const f = fixture();
    try {
      await f.mutate('set', { objective: 'Check.' }); await f.start('auto');
      await f.mutate(action); assert.equal(f.publications.length, 0); assert.equal(f.store.task(f.task.id).turnId, 'auto');
      await f.complete('auto'); assert.equal(f.publications.length, 1);
      assert.equal(f.agent.calls.some(call => call.method === 'turn/interrupt'), false);
    } finally { f.close(); }
  }
});

test('Stop pauses Goal before interrupting the verified native turn', async () => {
  const f = fixture();
  try {
    await f.mutate('set', { objective: 'Check.' }); await f.start('auto');
    await f.workspace.interrupt(f.task.id, true);
    const methods = f.agent.calls.filter(call => call.method === 'turn/interrupt' || call.method === 'thread/goal/set').map(call => [call.method, call.params.status]);
    assert.deepEqual(methods, [['thread/goal/set', 'active'], ['thread/goal/set', 'paused'], ['turn/interrupt', undefined]]);
  } finally { f.close(); }
});

test('lost Goal activation is checked without replay; stale reads cannot regress newer native updates', async () => {
  const f = fixture();
  try {
    f.agent.handler = async (method, params) => { if (method === 'thread/goal/set') { f.agent.goal = goal({ objective: params.objective }); throw new Error('Response timed out'); } };
    const input = { action: 'set', objective: 'Check.', requestKey: 'lost', expectedRevision: 0 };
    await assert.rejects(f.workspace.changeGoal(f.task.id, input), /timed out/);
    assert.equal(f.store.task(f.task.id).goalControl?.sync, 'unknown');
    await f.workspace.changeGoal(f.task.id, input); await f.workspace.checkGoal(f.task.id);
    assert.equal(f.agent.calls.filter(call => call.method === 'thread/goal/set').length, 1); assert.equal(f.store.task(f.task.id).goalControl?.sync, 'ready');
    let release!: (value: any) => void;
    f.agent.handler = async method => method === 'thread/goal/get' ? new Promise(resolve => { release = resolve; }) : undefined;
    const pending = f.workspace.checkGoal(f.task.id); await tick();
    const completed = goal({ objective: 'Check.', status: 'complete', tokensUsed: 321 });
    await f.notify('thread/goal/updated', { goal: completed }); release({ goal: goal({ objective: 'Check.' }) }); await pending;
    assert.equal(f.store.task(f.task.id).goal?.status, 'complete'); assert.equal(f.store.task(f.task.id).goal?.tokensUsed, 321);
  } finally { f.close(); }
});

test('restart adopts current Goal turn by read only and excludes baseline history', async () => {
  const f = fixture();
  try {
    f.agent.turns = [{ id: 'old', status: 'completed', items: [] }];
    await f.mutate('set', { objective: 'Check.' }); await f.start('active');
    f.store.recover(); (f.workspace as any).active.clear(); (f.workspace as any).loaded.clear();
    assert.equal(f.store.task(f.task.id).turnId, 'active'); assert.equal(f.store.runs()[0].status, 'uncertain');
    const count = f.agent.calls.length; await f.workspace.checkGoal(f.task.id);
    assert.deepEqual(f.agent.calls.slice(count).map(call => call.method).sort(), ['thread/goal/get', 'thread/read']);
    assert.equal(f.store.runs().length, 1); assert.equal(f.store.runs()[0].status, 'running');
    assert.equal(f.store.task(f.task.id).goalControl?.sync, 'ready');
  } finally { f.close(); }
});

test('active unloaded Goal requires explicit Resume and paused Goal never auto-resumes', async () => {
  const f = fixture();
  try {
    await f.mutate('set', { objective: 'Check.' });
    f.agent.status = 'notLoaded'; (f.workspace as any).loaded.clear();
    await f.workspace.checkGoal(f.task.id);
    assert.equal(f.store.task(f.task.id).goalControl?.resumeRequired, true); assert.equal(f.store.task(f.task.id).goalControl?.sync, 'unknown');
    assert.equal(f.agent.calls.some(call => call.method === 'thread/resume'), false);
    await f.mutate('resume'); assert.equal(f.store.task(f.task.id).goalControl?.resumeRequired, false);
    assert.equal(f.agent.calls.filter(call => call.method === 'thread/resume').length, 1);
    await f.mutate('pause'); const count = f.agent.calls.length; await f.workspace.checkGoal(f.task.id);
    assert.equal(f.agent.calls.slice(count).some(call => call.method === 'thread/goal/set' || call.method === 'thread/resume'), false);
  } finally { f.close(); }
});

test('Goal attachment-only materialization survives ambiguous response and cleans definite rejection', async () => {
  for (const uncertain of [true, false]) {
    const f = fixture();
    try {
      const attachment = await f.workspace.attachments.upload('project', 'notes.txt', Buffer.from('Check the diagram captions.'));
      f.agent.handler = async method => { if (method === 'thread/goal/set') throw uncertain ? new Error('Response lost') : new RpcResponseError('Rejected', -32602); };
      await assert.rejects(f.mutate('set', { objective: '', attachments: [attachment.id] }));
      const submitted = f.agent.calls.find(call => call.method === 'thread/goal/set')!.params.objective;
      assert.match(submitted, /^Referenced pasted text files:/);
      const directory = path.join(f.folder, 'attachments', '.studybuddy-goals');
      assert.equal(fs.readdirSync(directory).length, uncertain ? 1 : 0);
      assert.equal(Boolean(f.store.task(f.task.id).goalSource), uncertain);
      assert.equal(fs.existsSync(path.join(f.folder, '.studybuddy-goals')), false, 'Goal materials never enter manuscript changes');
      f.workspace.attachments.discard('project', attachment.id);
      assert.equal(fs.existsSync(f.workspace.attachments.path(attachment)), uncertain, 'Only an uncertain operation retains a formerly unsent draft');
    } finally { f.close(); }
  }
});

test('new Goal task prepares ordinary isolated worktree but never dispatches an initial turn', async () => {
  const f = fixture();
  try {
    const id = 'new-goal-task-0001';
    await f.workspace.createTask({ id, projectId: 'project', title: 'Goal', instructions: 'Check all references.', goal: { tokenBudget: null } });
    await (f.workspace as any).preparing.get(id); await tick();
    const task = f.store.task(id); assert.equal(task.goal?.objective, 'Check all references.'); assert.equal(task.initialGoal, null);
    assert.equal(f.agent.calls.some(call => call.method === 'turn/start'), false);
    assert.equal(f.agent.calls.filter(call => call.method === 'thread/start').length, 1);
    assert.equal(f.store.runByKey('initial-' + id)?.reviewRound, null);
    assert.equal(f.store.items(id).find(item => item.type === 'user')?.meta?.goal, true);
    assert.equal(f.workspace.queue(id).messages.length, 0);
  } finally { f.close(); }
});

test('Goal material ownership and its transmission receipt are atomic across restart', async () => {
  const f = fixture();
  try {
    const attachment = await f.workspace.attachments.upload('project', 'notes.txt', Buffer.from('Check the references.'));
    const claimed = () => JSON.parse((f.store.db.prepare('SELECT data FROM attachments WHERE id=?').get(attachment.id) as { data: string }).data).taskId;
    const transaction = f.store.transaction.bind(f.store);
    let ownedCommits = 0;
    f.store.transaction = fn => {
      const result = transaction(fn);
      if (claimed() === f.task.id) {
        ownedCommits++;
        assert.equal(f.store.task(f.task.id).goalControl?.operation?.sent, true, 'No committed state claims goal files with a never-transmitted operation');
        assert.equal(f.store.preference<any>('goal-operation:' + f.task.id + ':operation-1')?.operation?.sent, true);
        assert.ok(f.store.task(f.task.id).goalSource?.directory, 'The registered source material is part of the same commit');
      }
      return result;
    };
    f.agent.handler = async method => { if (method === 'thread/goal/set') throw new Error('Response lost'); };
    await assert.rejects(f.mutate('set', { objective: '', attachments: [attachment.id] }), /Response lost/);
    assert.equal(ownedCommits, 1);
    f.store.transaction = transaction;
    f.store.recover();
    assert.equal(f.store.task(f.task.id).goalControl?.sync, 'unknown');
    assert.equal(claimed(), f.task.id, 'An ambiguous submission retains its authored attachment after recovery');
    assert.equal(f.store.task(f.task.id).goalControl?.operation?.sent, true);
    assert.equal(f.agent.calls.filter(call => call.method === 'thread/goal/set').length, 1, 'Recovery does not resend activation');
  } finally { f.close(); }
});

test('Goal early approval recovery binds only the native active turn and disconnect discards old RPC IDs', async () => {
  const f = fixture();
  try {
    await f.mutate('set', { objective: 'Check.' });
    f.agent.status = 'active'; f.agent.turns = [{ id: 'early', status: 'inProgress', items: [] }];
    (f.workspace as any).serverRequest({ id: 'early-approval', method: 'item/fileChange/requestApproval', params: { threadId: 'thread', turnId: 'early' } }, 'codex');
    await (f.workspace as any).goalChecks.get(f.task.id);
    assert.equal(f.store.task(f.task.id).turnId, 'early'); assert.equal(f.workspace.requests.size, 1);
    assert.equal(f.agent.rejected.length, 0);
    f.agent.emit('disconnected', new Error('Connection lost'));
    assert.equal(f.workspace.requests.size, 0); assert.equal((f.workspace as any).earlyRequests.size, 0);
    assert.equal(f.store.runs()[0].status, 'uncertain'); assert.equal(f.store.task(f.task.id).turnId, 'early');
    f.workspace.runtime.connected = true; f.agent.turns = []; f.agent.status = 'idle';
    await f.workspace.checkGoal(f.task.id);
    assert.equal(f.store.task(f.task.id).goalControl?.sync, 'unknown', 'Missing saved turn evidence cannot release the task');
    assert.equal(f.publications.length, 0);
  } finally { f.close(); }
});

test('Goal history reconciliation publishes once after replaying the entire missed chain', async () => {
  const f = fixture();
  try {
    await f.mutate('set', { objective: 'Check.' });
    f.agent.turns = [1, 2].map(index => ({ id: 'missed-' + index, status: 'completed', items: [{ id: 'reply', type: 'agentMessage', text: 'Result ' + index }] }));
    f.agent.goal = goal({ objective: 'Check.', status: 'complete' });
    await f.workspace.checkGoal(f.task.id);
    assert.equal(f.publications.length, 1); assert.equal(f.store.runs().length, 2);
    assert.deepEqual(f.store.items(f.task.id).map(item => item.text), ['Check.', 'Result 1', 'Result 2']);
    assert.ok(f.store.runs().every(run => run.reviewRound === 1));
    await f.workspace.checkGoal(f.task.id); assert.equal(f.publications.length, 1);
  } finally { f.close(); }
});

test('a rejected Goal pause still interrupts the verified turn and reports continuation risk', async () => {
  const f = fixture();
  try {
    await f.mutate('set', { objective: 'Check.' }); await f.start('active');
    f.agent.handler = async (method, params) => { if (method === 'thread/goal/set' && params.status === 'paused') throw new RpcResponseError('Could not pause goal'); };
    await assert.rejects(f.workspace.interrupt(f.task.id, true), /Could not pause/);
    assert.equal(f.agent.calls.at(-1)?.method, 'turn/interrupt');
    assert.equal(f.workspace.queue(f.task.id).waiting, 'goal');
  } finally { f.close(); }
});

test('native capability catalog is authoritative and unavailable catalogs fail closed', async () => {
  const f = fixture();
  try {
    f.agent.enabled = false; await f.workspace.refreshAgent('codex'); assert.equal(f.workspace.runtime.goalAvailable, false);
    f.agent.enabled = true; await f.workspace.refreshAgent('codex'); assert.equal(f.workspace.runtime.goalAvailable, true);
    f.agent.handler = async method => { if (method === 'experimentalFeature/list') throw new RpcResponseError('Method not found', -32601); };
    await f.workspace.refreshAgent('codex'); assert.equal(f.workspace.runtime.goalAvailable, false);
    assert.equal(f.agent.calls.some(call => call.method === 'thread/goal/set' || call.method === 'turn/start'), false);
  } finally { f.close(); }
});

test('Goal usage changes do not invalidate an objective editor and edits do not append another user item', async () => {
  const f = fixture();
  try {
    await f.mutate('set', { objective: 'Check.' }); const revision = f.store.task(f.task.id).goalControl!.revision;
    f.agent.goal = { ...f.agent.goal!, tokensUsed: 100, timeUsedSeconds: 12, updatedAt: 102 };
    await f.notify('thread/goal/updated', { goal: f.agent.goal });
    assert.equal(f.store.task(f.task.id).goalControl!.revision, revision);
    await f.workspace.changeGoal(f.task.id, { action: 'set', requestKey: 'edit-objective', expectedRevision: revision, objective: 'Check citations and captions.', appendTranscriptItem: false });
    assert.deepEqual(f.store.items(f.task.id).filter(item => item.type === 'user').map(item => item.text), ['Check.']);
    assert.equal(f.store.items(f.task.id).find(item => item.type === 'user')?.meta?.goal, true);
    assert.equal(f.store.task(f.task.id).goal!.objective, 'Check citations and captions.');
  } finally { f.close(); }
});

test('Goal preflight never overwrites an externally created or cleared objective', async () => {
  for (const cleared of [false, true]) {
    const f = fixture();
    try {
      if (cleared) { await f.mutate('set', { objective: 'Original.' }); f.agent.goal = null; }
      else f.agent.goal = goal({ objective: 'External goal.' });
      const count = f.agent.calls.filter(call => call.method === 'thread/goal/set').length;
      await assert.rejects(f.mutate('set', { objective: 'Replacement.' }), /goal changed/);
      assert.equal(f.agent.calls.filter(call => call.method === 'thread/goal/set').length, count);
      assert.deepEqual(f.store.task(f.task.id).goal, f.agent.goal, 'Actual native state is projected for a fresh explicit decision');
    } finally { f.close(); }
  }
});

test('unknown native thread status is never idle evidence for Goal publication', async () => {
  for (const status of [{ type: 'systemError' }, undefined]) {
    const f = fixture();
    try {
      await f.mutate('set', { objective: 'Check.' }); await f.start('auto');
      f.agent.goal = goal({ objective: 'Check.', status: 'complete' });
      f.agent.turns[0].status = 'completed';
      (f.workspace as any).active.clear(); f.store.recover();
      f.agent.handler = async method => method === 'thread/read' ? { thread: { id: 'thread', turns: f.agent.turns, status } } : undefined;
      await f.workspace.checkGoal(f.task.id);
      assert.equal(f.publications.length, 0); assert.equal(f.store.task(f.task.id).goalControl?.nativeStatus, 'unknown');
      assert.equal(f.store.task(f.task.id).goalControl?.sync, 'unknown'); assert.equal(f.workspace.queue(f.task.id).waiting, 'goal');
    } finally { f.close(); }
  }
});

test('Goal set while an ordinary turn finishes preserves its Run and defers publication', async () => {
  for (const reject of [false, true]) {
    const f = fixture();
    try {
      const run: Run = { id: 'manual', taskId: f.task.id, requestKey: 'manual', prompt: 'Ordinary request.', status: 'running', turnId: 'manual-turn', createdAt: 1, startedAt: 2, finishedAt: null, reviewRound: 0 };
      f.store.saveRun(run); (f.workspace as any).active.set(f.task.id, run); f.store.updateTask(f.task.id, { status: 'running', turnId: 'manual-turn' });
      f.agent.status = 'active'; f.agent.turns = [{ id: 'manual-turn', status: 'inProgress', items: [] }];
      f.agent.handler = async method => {
        if (method === 'thread/settings/update') {
          await f.complete('manual-turn'); assert.equal(f.publications.length, 0);
          if (reject) throw new RpcResponseError('Settings rejected');
        }
      };
      if (reject) { await assert.rejects(f.mutate('set', { objective: 'Complete the larger goal.' }), /Settings rejected/); assert.equal(f.publications.length, 1); }
      else {
        await f.mutate('set', { objective: 'Complete the larger goal.' }); assert.equal(f.publications.length, 0);
        assert.equal(f.store.runs()[0].goalCreatedAt, f.agent.goal!.createdAt);
        f.agent.handler = undefined; await f.mutate('pause'); assert.equal(f.publications.length, 1);
      }
      assert.equal(f.store.runs().length, 1); assert.equal(f.store.runs()[0].prompt, 'Ordinary request.');
    } finally { f.close(); }
  }
});

test('Goal cannot start while native code review owns the task', async () => {
  const f = fixture();
  try {
    const run = { id: 'review', taskId: f.task.id, requestKey: 'review', prompt: '', status: 'running', kind: 'codeReview', createdAt: 1 } as Run;
    f.store.saveRun(run); (f.workspace as any).active.set(f.task.id, run);
    assert.throws(() => f.mutate('set', { objective: 'Goal.' }), /current task operation/);
    assert.equal(f.agent.calls.length, 0);
  } finally { f.close(); }
});

test('paused Goal metadata does not turn subsequent ordinary work into a Goal run', async () => {
  const f = fixture();
  try {
    await f.mutate('set', { objective: 'Check.' }); await f.mutate('pause');
    const run = await f.workspace.enqueue(f.task.id, 'Ordinary request.', 'ordinary-after-goal', false); await tick(); await tick();
    await f.notify('thread/status/changed', { status: { type: 'active' } });
    assert.equal(f.workspace.queue(f.task.id).waiting, undefined);
    await f.notify('turn/completed', { turn: { id: 'ordinary-turn', status: 'completed', items: [] } });
    assert.equal(f.publications.length, 1); assert.equal(f.store.runByKey(run.requestKey)!.goalCreatedAt, undefined);
  } finally { f.close(); }
});

test('a lost Resume response can reconcile native completion without another activation', async () => {
  const f = fixture();
  try {
    await f.mutate('set', { objective: 'Check.' }); await f.mutate('pause');
    f.agent.handler = async (method, params) => { if (method === 'thread/goal/set' && params.status === 'active') { f.agent.goal = { ...f.agent.goal!, status: 'complete', tokensUsed: 321, updatedAt: 200 }; throw new Error('Response lost'); } };
    await assert.rejects(f.mutate('resume'), /Response lost/);
    await f.workspace.checkGoal(f.task.id);
    assert.equal(f.store.task(f.task.id).goalControl?.sync, 'ready'); assert.equal(f.store.task(f.task.id).completedGoal?.tokensUsed, 321);
    assert.equal(f.agent.calls.filter(call => call.method === 'thread/goal/set').length, 3);
  } finally { f.close(); }
});

test('unrecognized active native work cannot be released by a Goal status check', async () => {
  const f = fixture();
  try {
    await f.mutate('set', { objective: 'Check.' }); await f.mutate('pause');
    f.agent.status = 'active'; f.agent.turns = [{ id: 'unrelated-active', status: 'inProgress', items: [] }];
    await f.workspace.checkGoal(f.task.id);
    assert.equal(f.store.task(f.task.id).goalControl?.sync, 'unknown');
    assert.equal(f.workspace.queue(f.task.id).waiting, 'goal'); assert.equal(f.publications.length, 0);
  } finally { f.close(); }
});

test('restart releases a never-transmitted initial Goal without replaying activation', async () => {
  for (const threadId of [null, 'thread']) {
    const f = fixture();
    try {
      const operation = { action: 'set' as const, objective: 'Initial objective.', requestKey: 'initial-goal-task', expectedRevision: 0, requestedAt: 1, baseline: null };
      f.store.updateTask(f.task.id, { threadId, initialGoal: {}, goalControl: { revision: 1, sync: 'pending', operation } });
      f.store.savePreference('goal-operation:task:initial-goal-task', { operation, state: 'pending' });
      f.store.recover();
      assert.equal(f.store.task(f.task.id).initialGoal, null); assert.equal(f.store.task(f.task.id).goalControl?.sync, 'ready');
      assert.equal(f.store.task(f.task.id).status, 'failed');
      await f.workspace.checkGoal(f.task.id);
      assert.equal(f.workspace.queue(f.task.id).waiting, undefined);
      assert.equal(f.agent.calls.some(call => call.method === 'thread/goal/set' || call.method === 'thread/start' || call.method === 'thread/resume'), false);
      await f.mutate('set', { objective: 'Explicit fresh retry.' });
      assert.equal(f.store.task(f.task.id).goal?.objective, 'Explicit fresh retry.');
    } finally { f.close(); }
  }
});
