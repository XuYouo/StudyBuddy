import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initInstructionsStatus } from '../src/server/init-instructions.ts';

test('/init preflight detects every existing AGENTS.md entry without following links or obeying Git ignores', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'studybuddy-init-')), root = path.join(base, 'paper'), guide = path.join(root, 'AGENTS.md');
  fs.mkdirSync(root);
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), 'AGENTS.md\n');
    assert.deepEqual(initInstructionsStatus(root), { exists: false });
    fs.writeFileSync(guide, 'Existing instructions.');
    assert.deepEqual(initInstructionsStatus(root), { exists: true });
    assert.equal(fs.readFileSync(guide, 'utf8'), 'Existing instructions.');
    fs.unlinkSync(guide); fs.mkdirSync(guide);
    assert.deepEqual(initInstructionsStatus(root), { exists: true });
    fs.rmdirSync(guide);
    const outside = path.join(base, 'outside.md');
    fs.writeFileSync(outside, 'Outside instructions.');
    fs.symlinkSync(outside, guide);
    assert.deepEqual(initInstructionsStatus(root), { exists: true });
    fs.unlinkSync(outside);
    assert.deepEqual(initInstructionsStatus(root), { exists: true }, 'a broken link also prevents generation');
    assert.equal(fs.readlinkSync(guide), outside, 'the preflight never replaces the link');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('/init preflight fails closed for an unavailable or invalid execution directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studybuddy-init-errors-'));
  try {
    const file = path.join(root, 'file'); fs.writeFileSync(file, 'not a directory');
    for (const cwd of ['', '.', path.parse(root).root, path.join(root, 'missing'), file]) assert.throws(() => initInstructionsStatus(cwd), /Unable to check AGENTS.md/);
    const denied = Object.assign(new Error('private path and details'), { code: 'EACCES' });
    const read = t.mock.method(fs, 'lstatSync', () => { throw denied; });
    assert.throws(() => initInstructionsStatus(root), { message: 'Unable to check AGENTS.md.' });
    read.mock.restore();
    assert.deepEqual(initInstructionsStatus(root), { exists: false }, 'a successful retry can inspect the same directory');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
