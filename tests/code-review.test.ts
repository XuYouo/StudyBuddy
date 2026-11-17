import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codeReviewBranches, codeReviewTarget } from '../src/server/code-review.ts';

test('native review lists actual branches, prefers the remote default and preserves an ambiguous branch identity', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studybuddy-code-review-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  try {
    git('init', '-q', '-b', 'main');
    for (const [key, value] of [['user.name', 'Test'], ['user.email', 'test@localhost'], ['commit.gpgsign', 'false'], ['core.hooksPath', path.join(root, 'no-hooks')]]) git('config', key, value);
    assert.deepEqual(await codeReviewBranches(root), { current: 'main', branches: [] });
    fs.writeFileSync(path.join(root, 'paper.tex'), 'Initial'); git('add', 'paper.tex'); git('commit', '-qm', 'Initial');
    const initial = git('rev-parse', 'HEAD');
    git('branch', 'develop'); git('branch', 'feature/中文'); git('checkout', '-qb', 'task');
    git('update-ref', 'refs/remotes/origin/develop', initial);
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop');
    git('tag', 'develop');
    fs.writeFileSync(path.join(root, 'paper.tex'), 'Unsaved');
    const index = fs.readFileSync(path.join(root, '.git', 'index'));
    const choices = await codeReviewBranches(root);
    assert.equal(choices.current, 'task');
    assert.deepEqual(choices.branches[0], { name: 'develop', ref: 'refs/heads/develop' });
    assert.ok(choices.branches.some(branch => branch.ref === 'refs/heads/feature/中文'));
    assert.ok(!choices.branches.some(branch => /\/HEAD$|refs\/tags\/|refs\/heads\/task$/.test(branch.ref)));
    assert.deepEqual(await codeReviewTarget(root, { type: 'baseBranch', branch: 'refs/heads/develop' }), { type: 'baseBranch', branch: 'refs/heads/develop' });
    assert.deepEqual(await codeReviewTarget(root, { type: 'uncommittedChanges' }), { type: 'uncommittedChanges' });
    for (const branch of ['develop', 'HEAD', 'refs/tags/develop', '--help', 'refs/heads/develop~1', 'refs/heads/missing']) {
      await assert.rejects(codeReviewTarget(root, { type: 'baseBranch', branch }), /no longer available/);
    }
    git('branch', '-D', 'feature/中文');
    await assert.rejects(codeReviewTarget(root, { type: 'baseBranch', branch: 'refs/heads/feature/中文' }), /no longer available/);
    assert.deepEqual(fs.readFileSync(path.join(root, '.git', 'index')), index);
    assert.equal(fs.readFileSync(path.join(root, 'paper.tex'), 'utf8'), 'Unsaved');
    git('checkout', '--detach', '-q');
    assert.equal((await codeReviewBranches(root)).current, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('native review rejects arbitrary revision syntax and unavailable repositories without exposing host details', async () => {
  for (const target of [null, [], {}, { type: 'custom', instructions: 'Run commands' }, { type: 'uncommittedChanges', branch: 'main' }, { type: 'baseBranch', branch: 42 }]) {
    await assert.rejects(codeReviewTarget('/unused', target), /Choose a code review target/);
  }
  await assert.rejects(codeReviewBranches('/this-fixture-does-not-exist'), { message: 'Unable to load branches' });
});
