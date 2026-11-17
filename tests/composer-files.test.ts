import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { composerFiles, validateComposerReferences } from '../src/server/composer-files.ts';
import { referenceText } from '../src/composer-reference.ts';
import type { ComposerReference } from '../src/shared.ts';

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'studybuddy-mentions-')), root = path.join(base, 'paper');
  fs.mkdirSync(root); execFileSync('git', ['init', '-q', root]);
  const write = (file: string, text = 'Paper content.') => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  return { base, root, write, close() { fs.rmSync(base, { recursive: true, force: true }); } };
}

test('file mentions search tracked and untracked names, derive directories, and obey Git ignores and root boundaries', async () => {
  const f = fixture();
  try {
    f.write('main.tex'); f.write('sections/introduction.tex'); f.write('.gitignore', 'ignored/\n');
    execFileSync('git', ['-C', f.root, 'add', '.']);
    f.write('draft/new chapter.tex'); f.write('ignored/secret.tex');
    fs.writeFileSync(path.join(f.base, 'outside-secret.tex'), 'Outside content.');
    fs.symlinkSync(path.join(f.base, 'outside-secret.tex'), path.join(f.root, 'escaping.tex'));
    fs.symlinkSync(f.base, path.join(f.root, 'escaping-dir'));
    fs.symlinkSync(path.join(f.root, '.git/config'), path.join(f.root, 'metadata-link'));
    fs.symlinkSync(path.join(f.root, '.git'), path.join(f.root, 'metadata-directory'));
    f.write('deleted.tex'); execFileSync('git', ['-C', f.root, 'add', 'deleted.tex']); fs.unlinkSync(path.join(f.root, 'deleted.tex'));
    const all = await composerFiles(f.root);
    assert.equal(all.more, false);
    assert.ok(all.files.some(file => file.path === 'draft/new chapter.tex' && file.kind === 'file'));
    assert.ok(all.files.some(file => file.path === 'sections/' && file.label === 'sections' && file.kind === 'directory'));
    assert.ok(all.files.some(file => file.path === 'main.tex'));
    assert.ok(all.files.every(file => !/ignored|escaping|deleted|outside|metadata|^\.git\//.test(file.path)));
    for (const [name, kind] of [['metadata-link', 'file'], ['metadata-directory/', 'directory']] as const) {
      const file = { path: name, label: name.replace(/\/$/, ''), kind }, text = referenceText(file);
      assert.throws(() => validateComposerReferences(f.root, text, [{ ...file, from: 0, to: text.length }]), /outside this project/);
    }
    assert.deepEqual((await composerFiles(f.root, 'sintro')).files.map(file => file.path), ['sections/introduction.tex']);
    assert.deepEqual((await composerFiles(f.root, 'new chapter')).files.map(file => file.path), ['draft/new chapter.tex']);
    assert.deepEqual(await composerFiles(f.root, '../outside'), { files: [], more: false });
  } finally { f.close(); }
});

test('file mention autocomplete bounds the response and signals further matches without truncating paths', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 75; i++) f.write(`chapter-${String(i).padStart(3, '0')}.tex`);
    const page = await composerFiles(f.root, 'chapter');
    assert.equal(page.files.length, 60); assert.equal(page.more, true);
    assert.equal((await composerFiles(f.root, 'chapter-074')).files[0].path, 'chapter-074.tex');
    await assert.rejects(composerFiles(f.root, ['chapter']), /Invalid file search query/);
    await assert.rejects(composerFiles(''), /Unable to search/);
    await assert.rejects(composerFiles(f.base), /Unable to search/, 'a directory outside the selected repository is not silently walked');
  } finally { f.close(); }
});

test('file reference validation preserves exact UTF-16 Markdown spans and rejects mismatches or escaping paths', () => {
  const f = fixture();
  try {
    f.write('chapters/a](b).tex');
    const file = { path: 'chapters/a](b).tex', label: 'a](b).tex', kind: 'file' as const };
    const before = '  🙂 Review ', token = referenceText(file), text = before + token + ' please.  ';
    const reference: ComposerReference = { ...file, from: before.length, to: before.length + token.length };
    assert.deepEqual(validateComposerReferences(f.root, text, [reference]), [reference]);
    assert.equal(text.slice(reference.from, reference.to), token);
    for (const value of [null, {}, [reference, reference], [{ ...reference, from: reference.from - 1 }], [{ ...reference, to: reference.to + 1 }], [{ ...reference, path: '../outside.tex' }], [{ ...reference, path: '/etc/passwd' }], [{ ...reference, path: 'C:/outside' }]]) {
      assert.throws(() => validateComposerReferences(f.root, text, value), /Invalid file reference/);
    }
    assert.deepEqual(validateComposerReferences('', 'plain text', []), []);
    assert.equal(validateComposerReferences('', 'ordinary [link](somewhere)', undefined), undefined);
    fs.writeFileSync(path.join(f.base, 'outside.tex'), 'Outside.');
    fs.symlinkSync(path.join(f.base, 'outside.tex'), path.join(f.root, 'linked.tex'));
    const escaping = { path: 'linked.tex', label: 'linked.tex', kind: 'file' as const }, link = referenceText(escaping);
    assert.throws(() => validateComposerReferences(f.root, link, [{ ...escaping, from: 0, to: link.length }]), /outside this project/);
    const directory = { path: 'chapters/', label: 'chapters', kind: 'directory' as const }, dir = referenceText(directory);
    assert.deepEqual(validateComposerReferences(f.root, dir, [{ ...directory, from: 0, to: dir.length }]), [{ ...directory, from: 0, to: dir.length }]);
  } finally { f.close(); }
});
