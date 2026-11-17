import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { materializeCodexGoal } from '../src/server/codex-goal-material.ts';

async function fixture(run: (root: string, directory: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studybuddy-goal-material-'));
  try { await run(root, path.join(root, '.studybuddy-goals', randomUUID())); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
test('ordinary objective preserves Markdown references and does not create directories', () => fixture(async (root, directory) => {
  const result = await materializeCodexGoal({ objective: '  Finish [论文.tex](src/论文.tex)\nwithout changing its notation.  ', directory });
  assert.equal(result.objective, 'Finish [论文.tex](src/论文.tex)\nwithout changing its notation.');
  assert.equal(result.attachmentDirectory, null); assert.deepEqual(await fs.readdir(root), []); await result.dispose();
}));
test('4000 counts Unicode code points and longer goals use the exact official file reference', () => fixture(async (root, directory) => {
  const threshold = '😀'.repeat(4000);
  assert.equal((await materializeCodexGoal({ objective: threshold, directory })).objective, threshold);
  assert.deepEqual(await fs.readdir(root), []);
  const objective = threshold + '终';
  const result = await materializeCodexGoal({ objective, directory });
  assert.equal(result.objective, `Read the Codex goal objective file at ${path.join(directory, 'goal-objective.md')} before continuing.`);
  assert.equal(await fs.readFile(path.join(directory, 'goal-objective.md'), 'utf8'), objective);
  assert.equal(result.sourceObjective, objective);
  await result.dispose(); await result.dispose(); assert.deepEqual(await fs.readdir(path.dirname(directory)), []);
}));
test('text and image bytes become independent copies with exact local goal headings', () => fixture(async (root, directory) => {
  const textPath = path.join(root, 'notes.md'), imagePath = path.join(root, 'image.png');
  const text = Buffer.from('Read α and 中文.\n'), image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]);
  await fs.writeFile(textPath, text); await fs.writeFile(imagePath, image);
  const result = await materializeCodexGoal({ objective: 'Describe the image.', attachments: [{ name: 'notes.md', mime: 'application/octet-stream', path: textPath }, { name: 'wrong-extension.txt', mime: 'image/png', path: imagePath }], directory });
  assert.equal(result.objective, `Describe the image.\n\nReferenced pasted text files:\n- pasted text file: ${path.join(directory, 'pasted-text-1.txt')}. Read this file before continuing.\n\nReferenced image files:\n- [Image #1]: ${path.join(directory, 'image-1.png')}`);
  await fs.rm(textPath); await fs.rm(imagePath);
  assert.deepEqual(await fs.readFile(path.join(directory, 'pasted-text-1.txt')), text); assert.deepEqual(await fs.readFile(path.join(directory, 'image-1.png')), image);
  await result.dispose();
}));
test('unsupported binary and stale requests clean only the current operation', () => fixture(async (root, directory) => {
  const text = path.join(root, 'notes'), binary = path.join(root, 'binary'); await fs.writeFile(text, 'valid'); await fs.writeFile(binary, Buffer.from([0, 255, 1]));
  const previous = path.join(root, '.studybuddy-goals', randomUUID()); await fs.mkdir(previous, { recursive: true }); await fs.writeFile(path.join(previous, 'keep'), 'old goal');
  await assert.rejects(materializeCodexGoal({ objective: 'Goal', attachments: [{ name: 'notes', mime: 'text/plain', path: text }, { name: 'bad', mime: 'text/plain', path: binary }], directory }), /only text files and images/);
  assert.deepEqual(await fs.readdir(path.dirname(directory)), [path.basename(previous)]);
  await assert.rejects(materializeCodexGoal({ objective: 'long'.repeat(2000), directory, assertCurrent: () => { if (requireExists(directory)) throw new Error('stale'); } }), /stale/);
  assert.equal(await fs.readFile(path.join(previous, 'keep'), 'utf8'), 'old goal'); assert.deepEqual(await fs.readdir(path.dirname(directory)), [path.basename(previous)]);
}));
test('existing operation and symlink parent are never overwritten or removed', () => fixture(async (root, directory) => {
  await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, 'keep'), 'existing');
  await assert.rejects(materializeCodexGoal({ objective: 'x'.repeat(4001), directory }), /EEXIST/); assert.equal(await fs.readFile(path.join(directory, 'keep'), 'utf8'), 'existing');
  const otherRoot = path.join(root, 'other'); await fs.mkdir(otherRoot); await fs.symlink(path.dirname(directory), path.join(otherRoot, '.studybuddy-goals'));
  await assert.rejects(materializeCodexGoal({ objective: 'x'.repeat(4001), directory: path.join(otherRoot, '.studybuddy-goals', randomUUID()) }), /Invalid goal attachment directory/);
  assert.equal(await fs.readFile(path.join(directory, 'keep'), 'utf8'), 'existing');
}));

import { existsSync as requireExists } from 'node:fs';
