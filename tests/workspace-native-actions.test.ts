import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Fixture } from '../engine/tests/ts/helpers.ts';
import { createServer } from '../engine/src/server.ts';
import { Workspace } from '../src/server/workspace.ts';
import { Store } from '../src/server/store.ts';
import type { Codex } from '../src/server/codex.ts';
import type { Task } from '../src/shared.ts';

class NativeAgent extends EventEmitter {
  ready = true;
  calls: { method: string; params: any }[] = [];
  threads = new Map<string, any>();
  loseFork = false;
  candidates: any[] = [];
  taskPermissionConfig = async () => ({ thread: { sandbox: 'workspace-write' }, turn: { approvalPolicy: 'on-request', sandboxPolicy: { type: 'workspaceWrite' } } });
  async request(method: string, params: any): Promise<any> {
    this.calls.push({ method, params });
    if (method === 'config/read') return { config: { approvals_reviewer: 'user' } };
    if (method === 'thread/start') {
      const thread = { id: randomUUID(), cwd: params.cwd, status: { type: 'idle' }, turns: [] };
      this.threads.set(thread.id, thread); return { thread };
    }
    if (method === 'thread/resume' || method === 'thread/read') return { thread: this.threads.get(params.threadId) };
    if (method === 'review/start') return { reviewThreadId: params.threadId, turn: { id: randomUUID(), status: 'inProgress', items: [] } };
    if (method === 'thread/fork') {
      const thread = { id: randomUUID(), cwd: params.cwd, forkedFromId: params.threadId, ephemeral: false, parentThreadId: null, status: { type: 'idle' }, turns: [] };
      this.threads.set(thread.id, thread); this.candidates.push(thread);
      if (this.loseFork) throw new Error('Lost fork reply');
      return { thread };
    }
    if (method === 'thread/list') return { data: params.archived ? this.candidates : [], nextCursor: null };
    return {};
  }
  close() { this.ready = false; }
  reject() {}
  respond() {}
}
async function fixture() {
  const files = new Fixture(), engine = files.app(), server = createServer(engine);
  const store = new Store(':memory:'), agent = new NativeAgent(), engineCalls: string[] = [];
  async function request<T>(method: 'GET' | 'POST', url: string, payload?: any): Promise<T> {
    engineCalls.push(method + ' ' + url);
    const response = await server.inject({ method, url, ...(payload === undefined ? {} : { payload }), headers: { host: '127.0.0.1:9', origin: engine.url, 'x-review-token': engine.csrf } });
    const body = response.json();
    if (response.statusCode >= 400) throw new Error(body.error || 'Engine request failed');
    return body;
  }
  const workspace = new Workspace(store, agent as unknown as Codex, async () => ({ url: engine.url, token: engine.csrf, get: <T>(url: string) => request<T>('GET', url), post: <T>(url: string, body?: any) => request<T>('POST', url, body) }));
  store.saveProject({ id: 'project', name: 'Fixture', path: files.root, createdAt: 1 });
  workspace.runtime.connected = true; workspace.runtime.authenticated = true;
  workspace.runtime.models = [{ id: 'model', name: 'Model', efforts: ['high'], defaultEffort: 'high', isDefault: true }];
  const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  async function source() {
    const id = randomUUID(), name = 'p-' + id;
    const copy = await request<{ worktree: string }>('POST', '/api/tasks', { name, title: 'Original chat', deferred: true });
    const task: Task = { id, name, projectId: 'project', title: 'Original chat', instructions: 'Original instructions', worktree: copy.worktree, deferred: true, threadId: 'source-thread', turnId: null, agent: 'codex', model: 'model', effort: 'high', permissions: 'workspace', status: 'idle', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
    store.saveTask(task);
    agent.threads.set(task.threadId!, { id: task.threadId, cwd: task.worktree, status: { type: 'idle' }, turns: [{ id: 'original-turn', status: 'completed', items: [] }] });
    const runId = randomUUID();
    store.saveRun({ id: runId, taskId: id, requestKey: 'original', prompt: 'Original question', turnId: 'original-turn', status: 'completed', createdAt: 1, startedAt: 2, finishedAt: 3, durationMs: 1, reviewRound: null });
    const file = await workspace.attachments.upload('project', 'context.txt', Buffer.from('context retained by the native thread'));
    workspace.attachments.claim('project', [file.id], id);
    store.saveItem({ id: runId, taskId: id, type: 'user', text: 'Original question', createdAt: 1, meta: { attachments: [file] } });
    store.saveItem({ id: `${id}:original-turn:answer`, taskId: id, type: 'assistant', text: 'Original answer', createdAt: 2 });
    const material = workspace.attachments.materialDirectory(randomUUID()); fs.mkdirSync(material); fs.writeFileSync(path.join(material, 'goal-objective.md'), 'Retained goal text');
    workspace.attachments.retainMaterial(id, material);
    files.write('paper/main.tex', files.read('paper/main.tex', task.worktree) + '\n% source chat change\n', task.worktree);
    return { task, file, material, runId };
  }
  async function settle(id: string) { await (workspace as any).preparing.get(id); return store.task(id); }
  async function close() { workspace.close(); store.close(); await server.close(); await files.close(); }
  return { files, store, workspace, agent, engineCalls, git, source, settle, close };
}

test('new-chat code review uses the real engine worktree and preserves uncommitted changes for review/start', async () => {
  const f = await fixture();
  try {
    f.files.write('paper/main.tex', f.files.read('paper/main.tex') + '\n% pending manuscript edit\n');
    const before = f.git(f.files.root, 'status', '--porcelain=v1'), head = f.git(f.files.root, 'rev-parse', 'HEAD');
    const id = randomUUID();
    const task = f.workspace.createCodeReviewTask('project', { id, target: { type: 'uncommittedChanges' } });
    assert.equal(task.status, 'preparing');
    const ready = await f.settle(id);
    assert.equal(ready.status, 'running');
    assert.notEqual(ready.worktree, f.files.root);
    assert.equal(f.git(ready.worktree, 'rev-parse', 'HEAD'), head);
    assert.match(f.git(ready.worktree, 'diff', 'HEAD'), /pending manuscript edit/);
    assert.equal(f.git(f.files.root, 'status', '--porcelain=v1'), before);
    assert.equal(f.agent.calls.filter(call => call.method === 'review/start').length, 1);
    assert.equal(f.agent.calls.some(call => call.method === 'turn/start'), false);
    assert.equal(f.store.items(id).some(item => item.type === 'user'), false);
    f.workspace.createCodeReviewTask('project', { id, target: { type: 'uncommittedChanges' } });
    assert.equal(f.agent.calls.filter(call => call.method === 'review/start').length, 1);
    assert.throws(() => f.workspace.createCodeReviewTask('project', { id: id.toUpperCase(), target: { type: 'uncommittedChanges' } }), /Invalid task ID/);
    assert.ok(f.engineCalls.every(route => !/publish|rounds/.test(route)));
  } finally { await f.close(); }
});

test('fork preserves native history, turn grouping, source bytes and durable attachment ownership without resending a question', async () => {
  const f = await fixture();
  try {
    const original = await f.source(), source = original.task;
    const before = f.git(source.worktree, 'status', '--porcelain=v1'), id = randomUUID();
    f.workspace.forkTask(source.id, id);
    const fork = await f.settle(id), call = f.agent.calls.find(call => call.method === 'thread/fork')!;
    assert.equal(fork.status, 'idle'); assert.equal(fork.fork?.stage, 'complete');
    assert.equal(call.params.threadId, source.threadId); assert.equal(call.params.lastTurnId, 'original-turn');
    assert.equal(call.params.cwd, fork.worktree); assert.equal(call.params.sandbox, 'workspace-write');
    assert.equal(call.params.approvalsReviewer, 'user'); assert.equal(typeof call.params.developerInstructions, 'string');
    assert.equal(f.files.read('paper/main.tex', fork.worktree), f.files.read('paper/main.tex', source.worktree));
    assert.equal(f.git(source.worktree, 'status', '--porcelain=v1'), before);
    assert.match(f.git(fork.worktree, 'diff', 'HEAD'), /source chat change/);
    assert.ok(f.store.item(id, `${id}:original-turn:answer`));
    assert.equal(f.workspace.snapshot().tasks.find(task => task.id === id)?.chatTurns?.[0].id, 'original-turn');
    assert.equal(f.store.runs().filter(run => run.taskId === id).length, 1);
    assert.equal(f.agent.calls.some(call => call.method === 'turn/start'), false);
    f.workspace.forkTask(source.id, id);
    assert.equal(f.agent.calls.filter(call => call.method === 'thread/fork').length, 1);
    await f.workspace.deleteTask(source.id);
    assert.ok(fs.existsSync(f.workspace.attachments.path(original.file)));
    assert.ok(fs.existsSync(path.join(original.material, 'goal-objective.md')));
    assert.deepEqual(f.workspace.attachments.resolve('project', [original.file.id], id), [original.file]);
    await f.workspace.deleteTask(id);
    assert.equal(fs.existsSync(f.workspace.attachments.path(original.file)), false);
    assert.equal(fs.existsSync(original.material), false);
  } finally { await f.close(); }
});

test('lost fork replies reconcile an exact native child and never submit a second fork', async () => {
  const f = await fixture();
  try {
    const { task } = await f.source(), id = randomUUID(); f.agent.loseFork = true;
    f.workspace.forkTask(task.id, id);
    assert.equal((await f.settle(id)).status, 'uncertain');
    f.workspace.forkTask(task.id, id);
    assert.equal(f.agent.calls.filter(call => call.method === 'thread/fork').length, 1);
    const native = f.agent.candidates[0]; f.agent.candidates = [];
    await assert.rejects(f.workspace.checkFork(id), /unique forked chat/);
    f.agent.candidates = [native, { ...native, id: 'ambiguous' }];
    await assert.rejects(f.workspace.checkFork(id), /unique forked chat/);
    f.agent.candidates = [native, { ...native, id: 'unrelated', cwd: f.files.root }];
    const ready = await f.workspace.checkFork(id);
    assert.equal(ready.threadId, native.id); assert.equal(ready.status, 'idle');
    assert.equal((f.workspace as any).loaded.has(native.id), false);
    assert.equal(f.agent.calls.filter(call => call.method === 'thread/fork').length, 1);
    const lists = f.agent.calls.filter(call => call.method === 'thread/list');
    assert.ok(lists.every(call => call.params.cwd === ready.worktree && call.params.sourceKinds.includes('appServer') && call.params.modelProviders.length === 0));
    assert.ok(lists.some(call => call.params.archived));
  } finally { await f.close(); }
});

test('persisted fork preparation holds source writes and messages across host restart', async () => {
  const f = await fixture();
  try {
    const { task } = await f.source(), id = randomUUID();
    f.store.saveTask({ ...task, id, name: 'p-' + id, threadId: null, worktree: '', status: 'failed', preparation: {}, fork: { taskId: task.id, sourceThreadId: task.threadId!, operationId: randomUUID(), stage: 'copy' } });
    await assert.rejects(f.workspace.reviewWrite(task.id, true, async () => assert.fail('source write entered')), /finish copying/);
    await assert.rejects(f.workspace.enqueue(task.id, 'Another instruction', 'blocked'), /restart/);
    await assert.rejects(f.workspace.deleteTask(task.id), /restart/);
    assert.throws(() => f.workspace.forkTask(task.id, randomUUID()), /Wait for this task/);
    assert.equal(f.agent.calls.some(call => call.method === 'turn/start'), false);
  } finally { await f.close(); }
});
