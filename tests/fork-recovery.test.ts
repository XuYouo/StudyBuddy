import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/server/workspace.ts';
import { Store } from '../src/server/store.ts';
import type { Codex } from '../src/server/codex.ts';
import type { Task } from '../src/shared.ts';

class Agent extends EventEmitter {
  ready = true;
  calls: { method: string; params: any }[] = [];
  handler: (params: any) => Promise<any> = async () => ({ data: [] });
  async request(method: string, params: any) {
    this.calls.push({ method, params });
    if (method === 'thread/list') return this.handler(params);
    if (method === 'thread/resume') return { thread: { id: params.threadId } };
    throw new Error('Unexpected RPC: ' + method);
  }
  close() {} respond() {} reject() {}
}
function fixture(t: TestContext) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'studybuddy-fork-recovery-')), store = new Store(':memory:'), agent = new Agent();
  const workspace = new Workspace(store, agent as unknown as Codex, async () => ({ url: '', token: '', get: async <T>() => ({} as T), post: async <T>() => ({} as T) }));
  const task: Task = { id: 'fork-task', projectId: 'project', name: 'fork-task', title: 'Fork', instructions: '', worktree: folder, threadId: null, turnId: null, model: null, status: 'uncertain', preparation: { submitted: true }, createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null, fork: { taskId: 'source', sourceThreadId: 'source-thread', operationId: randomUUID(), stage: 'unknown' } };
  store.saveProject({ id: 'project', path: folder, name: 'Project', createdAt: 1 }); store.saveTask(task);
  const thread = { id: 'recovered-thread', forkedFromId: 'source-thread', cwd: folder, source: 'appServer', modelProvider: 'previous-provider' };
  workspace.runtime.connected = true; workspace.runtime.authenticated = true;
  t.after(() => { workspace.close(); store.close(); fs.rmSync(folder, { recursive: true, force: true }); });
  return { store, agent, workspace, task, thread };
}

test('fork reconciliation searches all providers, source kinds, pages and archived history then resumes before use', async t => {
  const f = fixture(t);
  f.agent.handler = async params => {
    assert.deepEqual(params.modelProviders, []);
    assert.deepEqual(params.sourceKinds, ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown']);
    if (!params.archived) return { data: [{ ...f.thread, cwd: '/different' }, { ...f.thread, id: 'child', parentThreadId: 'another' }, { ...f.thread, id: 'ephemeral', ephemeral: true }] };
    if (!params.cursor) return { data: [], nextCursor: 'page2' };
    return { data: [f.thread] };
  };
  const result = await f.workspace.checkFork(f.task.id);
  assert.equal(result.threadId, f.thread.id); assert.equal(result.fork?.stage, 'complete'); assert.equal(result.preparation, null);
  assert.equal(f.agent.calls.filter(call => call.method === 'thread/list').length, 3);
  assert.equal(f.agent.calls.some(call => call.method === 'thread/fork'), false);
  await (f.workspace as any).ensureTaskThread(result, () => true, undefined, {});
  assert.equal(f.agent.calls.filter(call => call.method === 'thread/resume').length, 1, 'history metadata alone does not mean this server loaded the thread');
});

test('missing, ambiguous and malformed history remain uncertain without replaying fork', async t => {
  const f = fixture(t);
  for (const response of [{ data: [] }, { data: [f.thread, { ...f.thread, id: 'duplicate' }] }, { data: [f.thread], nextCursor: 0 }, { data: [f.thread], nextCursor: 'loop' }]) {
    f.agent.handler = async () => response;
    await assert.rejects(f.workspace.checkFork(f.task.id), /unique forked chat|could not confirm/);
    assert.equal(f.store.task(f.task.id).threadId, null);
    assert.equal(f.store.task(f.task.id).fork?.stage, 'unknown');
  }
  assert.equal(f.agent.calls.some(call => call.method === 'thread/fork'), false);
});

for (const mutation of ['deleted', 'deleting', 'epoch', 'operation', 'cwd'] as const) test(`late fork list reply cannot bind after ${mutation} changes`, async t => {
  const f = fixture(t);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  f.agent.handler = async () => { started(); await gate; return { data: [f.thread] }; };
  const request = f.workspace.checkFork(f.task.id); await entered;
  if (mutation === 'deleted') f.store.deleteTask(f.task.id);
  if (mutation === 'deleting') f.store.updateTask(f.task.id, { status: 'deleting' });
  if (mutation === 'epoch') (f.workspace as any).connectionEpochs.set('codex', 1);
  if (mutation === 'operation') f.store.updateTask(f.task.id, { fork: { ...f.task.fork!, operationId: randomUUID() } });
  if (mutation === 'cwd') f.store.updateTask(f.task.id, { worktree: f.task.worktree + '-other' });
  release(); await assert.rejects(request, /no longer active/);
  assert.equal(f.store.findTask(f.task.id)?.threadId || null, null);
  assert.equal(f.agent.calls.filter(call => call.method === 'thread/list').length, 1);
});
