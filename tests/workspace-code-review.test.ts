import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/server/workspace.ts';
import { Store } from '../src/server/store.ts';
import { Codex, RpcResponseError } from '../src/server/codex.ts';
import type { Task } from '../src/shared.ts';
import { nativeReviewItem } from '../src/server/code-review.ts';

class ReviewAgent extends EventEmitter {
  ready = true;
  calls: { method: string; params: any }[] = [];
  rejected: unknown[] = [];
  turns: any[] = [];
  status = 'idle';
  handler?: (method: string, params: any) => Promise<any>;
  taskPermissionConfig = async (permissions: string, _cwd: string) => ({ thread: { sandbox: permissions === 'full' ? 'danger-full-access' : 'workspace-write' }, turn: { approvalPolicy: permissions === 'full' ? 'never' : 'on-request', sandboxPolicy: { type: permissions === 'full' ? 'dangerFullAccess' : 'workspaceWrite' } } });
  async request(method: string, params: any): Promise<any> {
    this.calls.push({ method, params });
    if (this.handler) { const result = await this.handler(method, params); if (result !== undefined) return result; }
    if (method === 'config/read') return { config: { approvals_reviewer: 'user' } };
    if (method === 'thread/read') return { thread: { id: 'thread', turns: this.turns, status: { type: this.status } } };
    if (method === 'review/start') return { reviewThreadId: 'thread', turn: { id: 'review-turn', status: 'inProgress', startedAt: 100, items: [] } };
    if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: 'thread' }, model: 'model' };
    if (method === 'thread/settings/update') return {};
    if (method === 'turn/start') return { turn: { id: 'ordinary-turn' } };
    return {};
  }
  reject(...args: unknown[]) { this.rejected.push(args); }
  respond() {}
  close() { this.ready = false; }
}
function fixture(persistent = false) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'studybuddy-code-review-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(folder, 'paper.tex'), 'base\n'); git('add', 'paper.tex'); git('commit', '-qm', 'base'); git('checkout', '-b', 'feature');
  fs.writeFileSync(path.join(folder, 'paper.tex'), 'changed\n');
  const store = new Store(persistent ? path.join(folder, 'store.sqlite') : ':memory:'), agent = new ReviewAgent(), reviewCalls: string[] = [];
  const workspace = new Workspace(store, agent as unknown as Codex, async () => ({ url: 'http://fixture.invalid', token: 'fixture', get: async <T>(route: string) => { reviewCalls.push(route); return {} as T; }, post: async <T>(route: string) => { reviewCalls.push(route); return {} as T; } }));
  const task: Task = { id: 'task', projectId: 'project', name: 'p-task', title: 'Review fixture', instructions: 'Check this manuscript.', worktree: folder, threadId: 'thread', turnId: null, model: 'model', effort: 'high', permissions: 'workspace', serviceTier: 'default', status: 'idle', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
  store.saveProject({ id: 'project', name: 'Fixture', path: folder, createdAt: 1 }); store.saveTask(task);
  workspace.runtime.connected = true; workspace.runtime.authenticated = true;
  workspace.runtime.models = [{ id: 'model', name: 'Model', efforts: ['high'], defaultEffort: 'high', isDefault: true }];
  (workspace as any).loaded.add('thread');
  const notify = (method: string, params: any) => (workspace as any).notification({ method, params: { threadId: 'thread', ...params } }, 'codex');
  return { folder, store, agent, workspace, task, reviewCalls, git, notify, close: () => { workspace.close(); store.close(); fs.rmSync(folder, { recursive: true, force: true }); } };
}

test('native review applies task settings, uses review/start, preserves native items and never publishes PDF', async () => {
  const f = fixture();
  try {
    const options = await f.workspace.codeReviewOptions(f.task.id);
    assert.deepEqual(options, { current: 'feature', branches: [{ name: 'main', ref: 'refs/heads/main' }] });
    await f.workspace.startCodeReview(f.task.id, { type: 'baseBranch', branch: 'refs/heads/main' }, 'review-1');
    const settings = f.agent.calls.find(call => call.method === 'thread/settings/update')!.params;
    assert.deepEqual(settings, { threadId: 'thread', cwd: f.folder, approvalPolicy: 'on-request', sandboxPolicy: { type: 'workspaceWrite' }, approvalsReviewer: 'user', model: 'model', effort: 'high', serviceTier: 'default', collaborationMode: { mode: 'default', settings: { model: 'model', reasoning_effort: 'high', developer_instructions: null } } });
    assert.deepEqual(f.agent.calls.find(call => call.method === 'review/start')!.params, { threadId: 'thread', target: { type: 'baseBranch', branch: 'refs/heads/main' }, delivery: 'inline' });
    assert.ok(f.agent.calls.findIndex(call => call.method === 'thread/settings/update') < f.agent.calls.findIndex(call => call.method === 'review/start'));
    assert.equal(f.agent.calls.some(call => call.method === 'turn/start'), false);
    await f.notify('item/completed', { turnId: 'review-turn', item: { id: 'begin', type: 'enteredReviewMode', review: 'Changes against main' } });
    await f.notify('item/completed', { turnId: 'review-turn', item: { id: 'result', type: 'exitedReviewMode', review: 'No correctness issues found.' } });
    await f.notify('item/completed', { turnId: 'review-turn', item: { id: 'answer', type: 'agentMessage', text: 'No correctness issues found.' } });
    await f.notify('turn/completed', { turn: { id: 'review-turn', status: 'completed', startedAt: 100, completedAt: 104, durationMs: 4000 } });
    assert.equal(f.store.task(f.task.id).status, 'idle'); assert.equal(f.store.runByKey('review-1')!.reviewRound, null);
    assert.deepEqual(f.store.items(f.task.id).map(item => [item.type, item.text]), [['codeReviewMarker', 'Changes against main'], ['codeReviewMarker', 'No correctness issues found.'], ['assistant', 'No correctness issues found.']]);
    assert.equal(f.store.runByKey('review-1')!.durationMs, 4000); assert.deepEqual(f.reviewCalls, []);
    assert.deepEqual(nativeReviewItem({ type: 'userMessage', review: 'not a review' }), null);
  } finally { f.close(); }
});

test('review submission reserves the task, is idempotent, and accepts early approvals', async () => {
  const f = fixture(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    f.agent.handler = async method => {
      if (method !== 'review/start') return;
      (f.workspace as any).serverRequest({ id: 14, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', turnId: 'review-turn', itemId: 'command', command: 'git diff', availableDecisions: ['accept', 'decline'] } }, 'codex');
      await gate;
      return { reviewThreadId: 'thread', turn: { id: 'review-turn', status: 'inProgress', items: [] } };
    };
    const first = f.workspace.startCodeReview(f.task.id, { type: 'uncommittedChanges' }, 'review-2');
    const second = f.workspace.startCodeReview(f.task.id, { type: 'uncommittedChanges' }, 'review-2');
    assert.equal(first, second);
    assert.throws(() => f.workspace.startCodeReview(f.task.id, { type: 'uncommittedChanges' }, 'other'), /Wait for this task/);
    assert.throws(() => f.workspace.startCodeReview(f.task.id, { type: 'baseBranch', branch: 'refs/heads/main' }, 'review-2'), /already in use/);
    release(); await first;
    assert.equal(f.agent.calls.filter(call => call.method === 'review/start').length, 1);
    assert.deepEqual(f.agent.rejected, []); assert.equal(f.workspace.snapshot().requests.length, 1);
    assert.equal(f.store.task(f.task.id).status, 'waiting_input');
    await f.notify('turn/completed', { turn: { id: 'review-turn', status: 'interrupted' } });
    assert.equal(f.workspace.snapshot().requests.length, 0); assert.deepEqual(f.reviewCalls, []);
  } finally { release(); f.close(); }
});

for (const goalState of ['unused', 'cleared', 'paused'] as const) test(`lost code review reply is checked against a saved baseline without another review/start (${goalState} Goal)`, async () => {
  const f = fixture();
  try {
    if (goalState !== 'unused') f.store.updateTask(f.task.id, {
      goal: goalState === 'cleared' ? null : { threadId: 'thread', objective: 'Check the paper.', status: 'paused', tokensUsed: 0, timeUsedSeconds: 0, tokenBudget: null, createdAt: 1, updatedAt: 1 },
      goalControl: { sync: 'ready', revision: 1, nativeStatus: 'idle' },
    });
    f.agent.turns = [{ id: 'older-review', status: 'completed', items: [{ type: 'enteredReviewMode', id: 'old', review: 'Previous review' }] }];
    f.agent.handler = async method => {
      if (method === 'review/start') throw new Error('transport closed');
      if (method === 'thread/goal/get') return { goal: f.store.task(f.task.id).goal ?? null };
    };
    await f.workspace.startCodeReview(f.task.id, { type: 'uncommittedChanges' }, 'review-lost');
    assert.equal(f.store.task(f.task.id).status, 'uncertain');
    await assert.rejects(f.workspace.reconcile(f.task.id), /not confirmed this code review/);
    await f.workspace.startCodeReview(f.task.id, { type: 'uncommittedChanges' }, 'review-lost');
    const output = { id: 'answer', type: 'agentMessage', text: 'Fix the missing boundary check.' };
    f.agent.turns.push({ id: 'lost-review', status: 'completed', items: [{ id: 'begin', type: 'enteredReviewMode', review: 'Uncommitted changes' }, output], startedAt: 100, completedAt: 103 });
    await f.workspace.reconcile(f.task.id);
    assert.equal(f.store.runByKey('review-lost')!.turnId, 'lost-review'); assert.equal(f.store.runByKey('review-lost')!.status, 'completed');
    assert.equal(f.store.items(f.task.id).find(item => item.type === 'assistant')?.text, output.text);
    assert.equal(f.agent.calls.filter(call => call.method === 'review/start').length, 1); assert.deepEqual(f.reviewCalls, []);
  } finally { f.close(); }
});

test('review recovery never adopts ambiguous or unloaded turns and survives Store recovery', async () => {
  const f = fixture(true);
  try {
    await f.workspace.startCodeReview(f.task.id, { type: 'uncommittedChanges' }, 'review-recover');
    f.store.recover();
    assert.equal(f.store.task(f.task.id).status, 'uncertain'); assert.equal(f.store.task(f.task.id).turnId, 'review-turn');
    assert.equal(f.store.runByKey('review-recover')!.status, 'uncertain');
    f.agent.turns = [{ id: 'review-turn', status: 'inProgress', items: [] }]; f.agent.status = 'notLoaded';
    await assert.rejects(f.workspace.reconcile(f.task.id), /not connected/);
    f.agent.status = 'active'; await f.workspace.reconcile(f.task.id);
    assert.equal(f.store.task(f.task.id).status, 'running'); assert.equal(f.agent.calls.filter(call => call.method === 'review/start').length, 1);
    f.agent.emit('disconnected', new Error('Connection closed'));
    assert.equal(f.store.task(f.task.id).status, 'uncertain'); assert.equal(f.store.task(f.task.id).turnId, 'review-turn');
    assert.equal(f.store.task(f.task.id).pendingRunId, f.store.runByKey('review-recover')!.id);
  } finally { f.close(); }
});

test('review validates branch at dispatch, reports native rejection, and cannot run beside Goal', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.workspace.startCodeReview(f.task.id, { type: 'baseBranch', branch: 'refs/heads/missing' }, 'missing-review'), /no longer available/);
    assert.equal(f.agent.calls.some(call => call.method === 'review/start'), false);
    f.store.updateTask(f.task.id, { status: 'idle', error: null });
    f.agent.handler = async method => { if (method === 'review/start') throw new RpcResponseError('Unknown method review/start', -32601); };
    await assert.rejects(f.workspace.startCodeReview(f.task.id, { type: 'uncommittedChanges' }, 'unsupported-review'), /Unknown method/);
    assert.equal(f.store.task(f.task.id).status, 'failed'); assert.equal(f.store.runByKey('unsupported-review')!.status, 'failed');
    f.store.updateTask(f.task.id, { status: 'idle', goal: { threadId: 'thread', objective: 'Verify the paper', status: 'active', tokensUsed: 0, timeUsedSeconds: 0, tokenBudget: null, createdAt: 1, updatedAt: 1 } });
    assert.throws(() => f.workspace.startCodeReview(f.task.id, { type: 'uncommittedChanges' }, 'goal-review'), /Wait for this task/);
    f.store.updateTask(f.task.id, { goal: null, agent: 'claude' });
    assert.throws(() => f.workspace.startCodeReview(f.task.id, { type: 'uncommittedChanges' }, 'foreign-review'), /only available for Codex/);
    assert.equal(f.agent.calls.some(call => call.method === 'turn/start'), false); assert.deepEqual(f.reviewCalls, []);
  } finally { f.close(); }
});
