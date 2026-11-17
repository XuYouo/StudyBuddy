import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Repo } from '../engine/src/core/git.ts';
import { captureForkSource, inheritForkWorktree } from '../src/server/fork-worktree.ts';

async function fixture(run: (value: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const value = await setup(); try { await run(value); } finally { await fs.rm(value.root, { recursive: true, force: true }); }
}
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studybuddy-fork-')), paper = path.join(root, 'paper'), source = path.join(root, 'source'), target = path.join(root, 'fork-task');
  await fs.mkdir(paper); const main = new Repo(paper); main.run(['init', '-q']);
  const write = async (folder: string, file: string, data: string | Buffer) => { await fs.mkdir(path.dirname(path.join(folder, file)), { recursive: true }); await fs.writeFile(path.join(folder, file), data); };
  for (const [name, data] of Object.entries({ 'main.tex': 'original\n', 'delete.txt': 'delete me', 'binary.bin': 'old binary', '.gitignore': '*.ignored\n', 'directory/child.txt': 'old', 'to-directory': 'old file', 'run.sh': '#!/bin/sh\necho old\n' })) await write(paper, name, data);
  if (process.platform !== 'win32') await fs.symlink('main.tex', path.join(paper, 'link'));
  main.run(['add', '-A']); main.run(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Initial']);
  const head = main.rev('HEAD'); main.run(['worktree', 'add', '--detach', source, head]);
  await write(source, 'main.tex', 'staged source\n'); const sourceRepo = new Repo(source); sourceRepo.run(['add', 'main.tex']);
  await write(source, 'main.tex', 'working source\n'); await fs.unlink(path.join(source, 'delete.txt'));
  await write(source, 'binary.bin', Buffer.from([0, 1, 255, 128, 0, 24])); await write(source, 'new/nested.txt', 'untracked');
  await write(source, 'generated.aux', 'excluded output'); await write(source, 'private.ignored', 'excluded ignored');
  await fs.rm(path.join(source, 'directory'), { recursive: true }); await write(source, 'directory', 'directory became a file');
  await fs.unlink(path.join(source, 'to-directory')); await write(source, 'to-directory/child.txt', 'file became a directory');
  if (process.platform !== 'win32') { await fs.unlink(path.join(source, 'link')); await fs.symlink('new/nested.txt', path.join(source, 'link')); await fs.chmod(path.join(source, 'run.sh'), 0o755); }
  await write(paper, 'main.tex', 'new accepted manuscript\n'); await write(paper, 'accepted-only.txt', 'author addition');
  const base = await main.snapshotAsync(['']); main.run(['worktree', 'add', '--detach', target, base]); main.updateRef('refs/papilot/fork-task/base', base);
  const sourceIndexPath = path.resolve(source, sourceRepo.text(['rev-parse', '--git-path', 'index']));
  const sourceIndex = await fs.readFile(sourceIndexPath), snapshot = await captureForkSource(source);
  const options = { source: snapshot, targetRoot: target, taskName: 'fork-task', operationId: randomUUID() };
  return { root, paper, source, target, main, sourceRepo, head, base, sourceIndex, sourceIndexPath, snapshot, options, write };
}

test('fork inherits all editable source bytes and original HEAD while preserving engine baseline and source index', () => fixture(async f => {
  const result = await inheritForkWorktree(f.options), target = new Repo(f.target);
  assert.deepEqual(result, { base: f.base, head: f.head, snapshot: f.snapshot.snapshot });
  assert.equal(target.rev('HEAD'), f.head); assert.equal(target.text(['write-tree']), target.treeId(f.head));
  assert.equal(target.rev('refs/papilot/fork-task/base'), f.base); assert.equal(target.rev('refs/papilot/fork-task/fork-input'), f.snapshot.snapshot);
  assert.equal(await fs.readFile(path.join(f.target, 'main.tex'), 'utf8'), 'working source\n');
  assert.equal(await fs.readFile(path.join(f.target, 'new/nested.txt'), 'utf8'), 'untracked');
  assert.deepEqual(await fs.readFile(path.join(f.target, 'binary.bin')), Buffer.from([0, 1, 255, 128, 0, 24]));
  assert.equal(await fs.readFile(path.join(f.target, 'directory'), 'utf8'), 'directory became a file');
  assert.equal(await fs.readFile(path.join(f.target, 'to-directory/child.txt'), 'utf8'), 'file became a directory');
  for (const name of ['delete.txt', 'generated.aux', 'private.ignored', 'accepted-only.txt']) await assert.rejects(fs.stat(path.join(f.target, name)), { code: 'ENOENT' });
  if (process.platform !== 'win32') { assert.equal(await fs.readlink(path.join(f.target, 'link')), 'new/nested.txt'); assert.ok((await fs.stat(path.join(f.target, 'run.sh'))).mode & 0o111); }
  assert.match(target.text(['diff', 'HEAD', '--', 'main.tex']), /working source/);
  assert.equal(target.text(['diff', '--cached', '--name-only']), '');
  assert.deepEqual(await fs.readFile(f.sourceIndexPath), f.sourceIndex);
  assert.equal(await fs.readFile(path.join(f.source, 'main.tex'), 'utf8'), 'working source\n');
  assert.equal(f.sourceRepo.rev('HEAD'), f.head);
  assert.deepEqual(await inheritForkWorktree(f.options), result, 'completed recovery is idempotent');
}));

test('nonfresh destinations reject worktree, ignored and staged changes without overwriting them', async () => {
  for (const mode of ['file', 'ignored', 'index']) await fixture(async f => {
    const target = new Repo(f.target);
    if (mode === 'ignored') await f.write(f.target, 'private.ignored', 'do not overwrite');
    else { await f.write(f.target, 'main.tex', 'do not overwrite'); if (mode === 'index') target.run(['add', 'main.tex']); }
    await assert.rejects(inheritForkWorktree(f.options), /not a fresh|destination changed/);
    assert.equal(await fs.readFile(path.join(f.target, mode === 'ignored' ? 'private.ignored' : 'main.tex'), 'utf8'), 'do not overwrite');
    assert.equal(target.rev('HEAD'), f.base);
  });
});

test('journal resumes each filesystem/HEAD/index boundary without repeating completed changes', async () => {
  for (const stage of ['before-file', 'after-file', 'head', 'index', 'complete']) await fixture(async f => {
    let interrupted = false;
    await assert.rejects(inheritForkWorktree({ ...f.options, onProgress(state) {
      const matches = stage === 'before-file' ? state.stage === 'files' && state.files === 0 : stage === 'after-file' ? state.stage === 'files' && state.files === 1 : state.stage === stage;
      if (!interrupted && matches) { interrupted = true; throw new Error('simulated process exit'); }
    } }), /simulated process exit/);
    assert.ok(interrupted); await inheritForkWorktree(f.options);
    assert.equal(new Repo(f.target).rev('HEAD'), f.head);
    assert.equal(await fs.readFile(path.join(f.target, 'main.tex'), 'utf8'), 'working source\n');
    assert.deepEqual(await fs.readFile(f.sourceIndexPath), f.sourceIndex);
  });
});

test('recovery refuses user changes after an interruption or after completion', async () => {
  for (const completed of [false, true]) await fixture(async f => {
    if (completed) await inheritForkWorktree(f.options);
    else await assert.rejects(inheritForkWorktree({ ...f.options, onProgress(state) { if (state.stage === 'head') throw new Error('stop'); } }), /stop/);
    await f.write(f.target, 'main.tex', 'later user edit');
    await assert.rejects(inheritForkWorktree(f.options), /destination changed/);
    assert.equal(await fs.readFile(path.join(f.target, 'main.tex'), 'utf8'), 'later user edit');
  });
});

test('same source worktree and another repository are rejected', () => fixture(async f => {
  await assert.rejects(inheritForkWorktree({ ...f.options, targetRoot: f.source }), /separate detached worktree/);
  const other = path.join(f.root, 'other'); await fs.mkdir(other); const repo = new Repo(other); repo.run(['init', '-q']);
  await fs.writeFile(path.join(other, 'file'), 'other'); repo.run(['add', '.']); repo.run(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Other']); repo.run(['checkout', '--detach']);
  await assert.rejects(inheritForkWorktree({ ...f.options, targetRoot: other }), /separate detached worktree/);
}));

test('failure to allocate an index temporary directory releases the exclusive index lock', t => fixture(async f => {
  const allocate = fs.mkdtemp.bind(fs), failure = Object.assign(new Error('temporary disk full'), { code: 'ENOSPC' });
  let failNext = false;
  t.mock.method(fs, 'mkdtemp', async (...args: Parameters<typeof fs.mkdtemp>) => { if (failNext) { failNext = false; throw failure; } return allocate(...args); });
  await assert.rejects(inheritForkWorktree({ ...f.options, onProgress(state) { if (state.stage === 'index') failNext = true; } }), error => error === failure);
  const repo = new Repo(f.target), index = path.resolve(f.target, repo.text(['rev-parse', '--git-path', 'index']));
  await assert.rejects(fs.stat(index + '.lock'), { code: 'ENOENT' });
  await inheritForkWorktree(f.options);
  assert.equal(repo.rev('HEAD'), f.head);
  assert.deepEqual(await fs.readFile(f.sourceIndexPath), f.sourceIndex);
}));
