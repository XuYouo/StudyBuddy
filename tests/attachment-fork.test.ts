import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Attachments } from '../src/server/attachments.ts';
import { materializeCodexGoal } from '../src/server/codex-goal-material.ts';
import { Store } from '../src/server/store.ts';
import type { Attachment, Task } from '../src/shared.ts';

function fixture(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studybuddy-attachment-fork-'));
  const store = new Store(path.join(directory, 'state.sqlite')), attachments = new Attachments(store);
  for (const id of ['paper', 'other']) store.saveProject({ id, path: path.join(directory, id), name: id, createdAt: 1 });
  for (const id of ['source', 'fork', 'child', 'unrelated', 'foreign']) {
    const task: Task = { id, projectId: id === 'foreign' ? 'other' : 'paper', name: id, title: id, titleSource: 'manual', instructions: '', worktree: directory, threadId: null, turnId: null, model: null, status: 'reviewing', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
    store.saveTask(task);
  }
  t.after(() => { attachments.close(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const saved = (id: string) => JSON.parse((store.db.prepare('SELECT data FROM attachments WHERE id=?').get(id) as { data: string }).data);
  const remove = (id: string) => { attachments.removeTask(id); store.deleteTask(id); };
  const inherit = (ids: string[], source = 'source', target = 'fork') => store.transaction(() => attachments.inherit('paper', ids, source, target));
  return { store, attachments, directory, saved, remove, inherit };
}

test('forks retain the same immutable attachment paths through chained ownership and source deletion', async t => {
  const f = fixture(t), bytes = Buffer.from([0, 255, 128, 42]);
  const file = await f.attachments.upload('paper', 'data.bin', bytes), originalPath = f.attachments.path(file);
  f.attachments.claim('paper', [file.id], 'source');
  assert.deepEqual(f.inherit([file.id]), [file]);
  f.inherit([file.id]);
  f.inherit([file.id], 'fork', 'child');
  assert.deepEqual(f.saved(file.id).sharedWith, ['fork', 'child'], 'retry does not add reference counts twice');
  f.attachments.claim('paper', [file.id], 'fork');
  assert.equal(f.saved(file.id).taskId, 'source', 'sending a shared attachment does not replace its original owner');
  for (const owner of ['source', 'fork', 'child']) assert.deepEqual(f.attachments.resolve('paper', [file.id], owner), [file]);
  assert.throws(() => f.attachments.resolve('paper', [file.id], 'unrelated'), /not available/);
  f.attachments.discard('paper', file.id);
  assert.deepEqual(fs.readFileSync(originalPath), bytes, 'late draft discard cannot delete shared history');
  f.remove('source');
  assert.equal(f.saved(file.id).taskId, 'fork');
  assert.deepEqual(f.attachments.get('paper', file.id), file);
  assert.equal(f.attachments.path(f.attachments.get('paper', file.id)), originalPath);
  f.remove('fork');
  assert.equal(f.saved(file.id).taskId, 'child');
  assert.deepEqual(fs.readFileSync(originalPath), bytes);
  const reopened = new Store(path.join(f.directory, 'state.sqlite'));
  try { assert.deepEqual(new Attachments(reopened).resolve('paper', [file.id], 'child'), [file]); }
  finally { reopened.close(); }
  f.remove('child');
  assert.equal(fs.existsSync(originalPath), false);
  assert.throws(() => f.attachments.get('paper', file.id), /not found/);
});

test('removing a fork first preserves the original and unrelated drafts', async t => {
  const f = fixture(t), file = await f.attachments.upload('paper', 'source.txt', Buffer.from('source'));
  const draft = await f.attachments.upload('paper', 'draft.txt', Buffer.from('draft'));
  f.attachments.claim('paper', [file.id], 'source'); f.inherit([file.id]);
  f.remove('fork');
  assert.equal(f.saved(file.id).taskId, 'source'); assert.equal(f.saved(file.id).sharedWith, undefined);
  assert.deepEqual(f.attachments.resolve('paper', [file.id], 'source'), [file]);
  f.remove('source');
  assert.equal(fs.existsSync(f.attachments.path(draft)), true);
  f.attachments.discard('paper', draft.id);
  assert.equal(fs.existsSync(f.attachments.path(draft)), false);
});

test('inheritance rejects cross-project owners, unclaimed drafts, unrelated files and missing bytes before changing ownership', async t => {
  const f = fixture(t);
  const owned = await f.attachments.upload('paper', 'owned.txt', Buffer.from('owned'));
  const draft = await f.attachments.upload('paper', 'draft.txt', Buffer.from('draft'));
  const unrelated = await f.attachments.upload('paper', 'other.txt', Buffer.from('other'));
  f.attachments.claim('paper', [owned.id], 'source'); f.attachments.claim('paper', [unrelated.id], 'unrelated');
  assert.throws(() => f.inherit([owned.id, draft.id]), /not available/);
  assert.throws(() => f.inherit([owned.id, unrelated.id]), /not available/);
  assert.throws(() => f.inherit([owned.id], 'source', 'foreign'), /not available/);
  assert.throws(() => f.inherit([owned.id], 'foreign', 'fork'), /not available/);
  assert.throws(() => f.attachments.inherit('other', [owned.id], 'source', 'foreign'), /not available/);
  assert.throws(() => f.inherit([owned.id, '../../invalid']), /valid attachments/);
  assert.equal(f.saved(owned.id).sharedWith, undefined);
  fs.rmSync(f.attachments.path(owned));
  assert.throws(() => f.inherit([owned.id]), /Attachment is missing/);
  assert.equal(f.saved(owned.id).sharedWith, undefined);
});

test('a whole-history inheritance can exceed one message limit and rolls back with the task transaction', async t => {
  const f = fixture(t), files: Attachment[] = [];
  for (let index = 0; index < 12; index++) {
    const file = await f.attachments.upload('paper', `${index}.txt`, Buffer.from(String(index)));
    f.attachments.claim('paper', [file.id], 'source'); files.push(file);
  }
  assert.throws(() => f.store.transaction(() => { f.attachments.inherit('paper', files.map(file => file.id), 'source', 'fork'); throw new Error('rollback'); }), /rollback/);
  for (const file of files) assert.equal(f.saved(file.id).sharedWith, undefined);
  assert.deepEqual(f.inherit(files.map(file => file.id)), files);
  f.remove('source');
  for (const file of files) assert.deepEqual(f.attachments.resolve('paper', [file.id], 'fork'), [file]);
  f.remove('fork');
  for (const file of files) assert.equal(fs.existsSync(f.attachments.path(file)), false);
});

test('restart copies keep independent IDs and draft ownership when the source is itself a fork', async t => {
  const f = fixture(t), bytes = Buffer.from('keep independently');
  const original = await f.attachments.upload('paper', 'reference.txt', bytes);
  f.attachments.claim('paper', [original.id], 'source'); f.inherit([original.id]);
  const [copy] = await f.attachments.copy('paper', [original.id], 'fork');
  assert.notEqual(copy.id, original.id); assert.notEqual(f.attachments.path(copy), f.attachments.path(original));
  assert.equal(f.saved(copy.id).taskId, undefined); assert.equal(f.saved(copy.id).sharedWith, undefined);
  f.attachments.claim('paper', [copy.id], 'child');
  f.remove('source'); f.remove('fork');
  assert.equal(fs.existsSync(f.attachments.path(original)), false);
  assert.deepEqual(fs.readFileSync(f.attachments.path(copy)), bytes);
  f.remove('child'); assert.equal(fs.existsSync(f.attachments.path(copy)), false);
});

test('file-backed goals stay outside the worktree and retain exact paths until the last fork is removed', async t => {
  const f = fixture(t), operation = randomUUID(), directory = f.attachments.materialDirectory(operation);
  assert.equal(path.dirname(path.dirname(directory)), path.join(f.directory, 'attachments'));
  const material = await materializeCodexGoal({ objective: 'x'.repeat(4001), directory });
  f.attachments.retainMaterial('source', directory);
  f.attachments.retainMaterial('source', directory);
  f.store.transaction(() => { f.attachments.inheritMaterials('source', 'fork'); f.attachments.inheritMaterials('fork', 'child'); });
  f.attachments.inheritMaterials('source', 'fork');
  assert.deepEqual(f.store.preference<any>('attachment-material:' + operation).owners, ['source', 'fork', 'child']);
  assert.throws(() => f.attachments.inheritMaterials('source', 'foreign'), /not available/);
  assert.throws(() => f.attachments.retainMaterial('unrelated', directory), /not available/);
  f.remove('source');
  assert.equal(fs.readFileSync(path.join(directory, 'goal-objective.md'), 'utf8'), 'x'.repeat(4001));
  assert.match(material.objective, new RegExp(operation));
  f.remove('fork');
  const reopened = new Store(path.join(f.directory, 'state.sqlite'));
  try {
    new Attachments(reopened).inheritMaterials('child', 'unrelated');
    assert.deepEqual(reopened.preference<any>('attachment-material:' + operation).owners, ['child', 'unrelated']);
  } finally { reopened.close(); }
  f.remove('child'); assert.equal(fs.existsSync(directory), true);
  f.remove('unrelated'); assert.equal(fs.existsSync(directory), false);
  assert.equal(f.store.preference('attachment-material:' + operation), undefined);
});

test('rejected goal material may be disposed only after its last owner is released', async t => {
  const f = fixture(t), directory = f.attachments.materialDirectory(randomUUID());
  const material = await materializeCodexGoal({ objective: 'x'.repeat(4001), directory });
  f.attachments.retainMaterial('source', directory); f.attachments.inheritMaterials('source', 'fork');
  assert.equal(f.attachments.releaseMaterial('unrelated', directory), false);
  assert.equal(f.attachments.releaseMaterial('source', directory), false);
  assert.equal(fs.existsSync(directory), true);
  assert.equal(f.attachments.releaseMaterial('fork', directory), true);
  await material.dispose(); assert.equal(fs.existsSync(directory), false);
  assert.equal(f.attachments.releaseMaterial('fork', directory), true, 'cleanup retry is idempotent');
});

test('material ownership rejects external paths and symlink directories without deleting their targets', async t => {
  const f = fixture(t), id = randomUUID(), directory = f.attachments.materialDirectory(id), outside = path.join(f.directory, 'outside');
  fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  assert.throws(() => f.attachments.materialDirectory('../outside'), /Invalid goal attachment directory/);
  assert.throws(() => f.attachments.retainMaterial('source', outside), /Invalid goal attachment directory/);
  fs.symlinkSync(outside, directory, 'dir');
  assert.throws(() => f.attachments.retainMaterial('source', directory), /Invalid goal attachment directory/);
  assert.throws(() => f.attachments.releaseMaterial('source', directory), /Invalid goal attachment directory/);
  fs.unlinkSync(directory); fs.mkdirSync(directory);
  // Nested symlinks are unlinked by rm, never traversed.
  fs.symlinkSync(outside, path.join(directory, 'nested'), 'dir'); f.attachments.retainMaterial('source', directory);
  f.remove('source'); assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
  fs.rmdirSync(path.dirname(directory)); fs.symlinkSync(outside, path.dirname(directory), 'dir');
  assert.throws(() => f.attachments.materialDirectory(randomUUID()), /Invalid goal attachment directory/);
  assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
});

test('failed goal claims return only unused newly claimed files to drafts', async t => {
  const f = fixture(t);
  const draft = await f.attachments.upload('paper', 'draft.txt', Buffer.from('draft'));
  const history = await f.attachments.upload('paper', 'history.txt', Buffer.from('history'));
  const goal = await f.attachments.upload('paper', 'goal.txt', Buffer.from('goal'));
  assert.deepEqual(f.attachments.claim('paper', [draft.id, history.id, goal.id], 'source'), [draft.id, history.id, goal.id]);
  assert.deepEqual(f.attachments.claim('paper', [history.id], 'source'), []);
  f.store.saveItem({ id: 'message', taskId: 'source', type: 'user', text: '', createdAt: 1, meta: { attachments: [history] } });
  f.store.savePreference('goal-operation:source:pending', { state: 'unknown', operation: { attachments: [goal.id] } });
  f.store.savePreference('goal-operation:source:rejected', { state: 'failed', operation: { attachments: [draft.id, history.id, goal.id] } });
  assert.deepEqual(f.attachments.releaseClaims('source', [draft.id, history.id, goal.id]), [draft.id]);
  assert.equal(f.saved(draft.id).taskId, undefined);
  assert.equal(f.saved(history.id).taskId, 'source'); assert.equal(f.saved(goal.id).taskId, 'source');
  f.attachments.discard('paper', draft.id); assert.equal(fs.existsSync(f.attachments.path(draft)), false);
  f.store.savePreference('goal-operation:source:pending', { state: 'failed', operation: { attachments: [goal.id] } });
  f.inherit([goal.id]); assert.deepEqual(f.attachments.releaseClaims('source', [goal.id]), [], 'fork history retains an original goal claim');
  f.remove('fork'); assert.deepEqual(f.attachments.releaseClaims('source', [goal.id]), [goal.id]);
});
