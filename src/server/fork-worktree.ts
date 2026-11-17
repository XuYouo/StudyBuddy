import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { Repo } from '../../engine/src/core/git.ts';
import { GENERATED } from '../../engine/src/core/tasks.ts';

export interface ForkSourceSnapshot { sourceRoot: string; commonDir: string; head: string; snapshot: string }
type Entry = { mode: string; oid: string };
type Operation = { file: string; before: Entry | null; after: Entry | null };
type Journal = { version: 1; operationId: string; taskName: string; targetRoot: string; source: ForkSourceSnapshot; base: string; operations: Operation[]; done: number; pending: boolean; stage: 'files' | 'head' | 'index' | 'complete' };
export interface InheritForkOptions {
  source: ForkSourceSnapshot; targetRoot: string; taskName: string; operationId: string;
  assertCurrent?: () => void;
  onProgress?: (state: { stage: Journal['stage']; files: number; total: number }) => void | Promise<void>;
}
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const oidPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const active = new Map<string, Promise<{ base: string; head: string; snapshot: string }>>();
const equals = (a: Entry | null | undefined, b: Entry | null | undefined) => (!a && !b) || Boolean(a && b && a.mode === b.mode && a.oid === b.oid);
const common = async (repo: Repo) => fs.realpath(path.resolve(repo.root, await repo.textAsync(['rev-parse', '--git-common-dir'])));
function validPath(file: string) { return file && !path.isAbsolute(file) && !file.split('/').some(part => !part || part === '..' || part === '.' || part.toLowerCase() === '.git') && !file.includes('\\'); }
const blobId = (bytes: Buffer, algorithm: string) => createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

export async function captureForkSource(root: string): Promise<ForkSourceSnapshot> {
  const sourceRoot = await fs.realpath(root), repo = new Repo(sourceRoot);
  if (await fs.realpath(await repo.textAsync(['rev-parse', '--show-toplevel'])) !== sourceRoot) throw new Error('Select the root of the source worktree.');
  const head = await repo.revAsync('HEAD'), snapshot = await repo.snapshotAsync([''], GENERATED);
  if (head !== await repo.revAsync('HEAD')) throw new Error('The source changed while preparing the fork. Retry after it stops.');
  return { sourceRoot, commonDir: await common(repo), head, snapshot };
}

async function tree(repo: Repo, revision: string): Promise<Map<string, Entry>> {
  const result = new Map<string, Entry>();
  for (const row of (await repo.runAsync(['ls-tree', '-r', '-z', revision])).toString().split('\0').filter(Boolean)) {
    const tab = row.indexOf('\t'), [mode, kind, oid] = row.slice(0, tab).split(' '), file = row.slice(tab + 1);
    if (!validPath(file) || kind !== 'blob' || !['100644', '100755', '120000'].includes(mode)) throw new Error('Forking this worktree requires unsupported Git entries.');
    result.set(file, { mode, oid });
  }
  return result;
}

async function disk(root: string, algorithm: string, executable: boolean, ignored = ''): Promise<Map<string, Entry>> {
  const result = new Map<string, Entry>();
  async function walk(folder: string, prefix = '') {
    for (const name of await fs.readdir(folder)) {
      if (!prefix && name === '.git') continue;
      const file = prefix + name; if (file === ignored) continue;
      const absolute = path.join(folder, name), stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) result.set(file, { mode: '120000', oid: blobId(Buffer.from(await fs.readlink(absolute)), algorithm) });
      else if (stat.isDirectory()) await walk(absolute, file + '/');
      else if (stat.isFile()) result.set(file, { mode: executable && (stat.mode & 0o111) ? '100755' : '100644', oid: blobId(await fs.readFile(absolute), algorithm) });
      else throw new Error('The fork destination contains an unsupported file.');
    }
  }
  await walk(root); return result;
}
function assertTree(actual: Map<string, Entry>, expected: Map<string, Entry>, alternate?: Operation) {
  for (const file of new Set([...actual.keys(), ...expected.keys()])) {
    const found = actual.get(file), wanted = expected.get(file);
    if (!equals(found, wanted) && !(alternate?.file === file && equals(found, alternate.after))) throw new Error('The fork destination changed. Its files were not overwritten.');
  }
}
async function indexTree(repo: Repo): Promise<string> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'studybuddy-fork-index-'));
  try {
    const index = path.join(folder, 'index');
    await fs.copyFile(path.resolve(repo.root, await repo.textAsync(['rev-parse', '--git-path', 'index'])), index);
    return await repo.textAsync(['write-tree'], { env: { ...process.env, GIT_INDEX_FILE: index } });
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
}
async function setIndex(repo: Repo, before: string, after: string, revision: string) {
  const index = path.resolve(repo.root, await repo.textAsync(['rev-parse', '--git-path', 'index']));
  const lock = await fs.open(index + '.lock', 'wx', 0o600);
  let folder: string | undefined;
  try {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'studybuddy-fork-index-'));
    const current = await indexTree(repo);
    if (current !== before && current !== after) throw new Error('The fork destination index changed. Its staged files were not overwritten.');
    const temporary = path.join(folder, 'index');
    await repo.runAsync(['read-tree', revision], { env: { ...process.env, GIT_INDEX_FILE: temporary } });
    await lock.writeFile(await fs.readFile(temporary)); await lock.sync(); await lock.close(); await fs.rename(index + '.lock', index);
  } finally { await lock.close().catch(() => {}); await fs.rm(index + '.lock', { force: true }); if (folder) await fs.rm(folder, { recursive: true, force: true }); }
}
async function parents(root: string, file: string) {
  let folder = root;
  for (const part of file.split('/').slice(0, -1)) {
    folder = path.join(folder, part);
    try { await fs.mkdir(folder); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = await fs.lstat(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The fork destination changed. Its files were not overwritten.');
  }
}

// Call only with the destination returned by the engine's public task-create
// endpoint. Its base ref and review database are deliberately left untouched.
// All changes are confined to this fresh detached worktree and its own Git dir.
export function inheritForkWorktree(options: InheritForkOptions) {
  const key = path.resolve(options.targetRoot) + ':' + options.operationId;
  const running = active.get(key); if (running) return running;
  const result = inherit(options).finally(() => active.delete(key)); active.set(key, result); return result;
}
async function inherit({ source, targetRoot, taskName, operationId, assertCurrent = () => {}, onProgress }: InheritForkOptions) {
  if (!idPattern.test(operationId) || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(taskName) || !oidPattern.test(source.head) || !oidPattern.test(source.snapshot)) throw new Error('Invalid fork operation.');
  const target = await fs.realpath(targetRoot), repo = new Repo(target), sourceRepo = new Repo(source.sourceRoot);
  const targetGit = await fs.realpath(await repo.textAsync(['rev-parse', '--absolute-git-dir']));
  if (path.basename(target) !== taskName || targetGit === source.commonDir || !targetGit.startsWith(path.join(source.commonDir, 'worktrees') + path.sep)
      || target === await fs.realpath(source.sourceRoot) || targetGit === await fs.realpath(await sourceRepo.textAsync(['rev-parse', '--absolute-git-dir']))
      || await common(repo) !== source.commonDir || await common(sourceRepo) !== source.commonDir
      || await fs.realpath(await repo.textAsync(['rev-parse', '--show-toplevel'])) !== target
      || (await repo.runAsync(['symbolic-ref', '-q', 'HEAD'], { check: false })).length) throw new Error('Forking requires a separate detached worktree in the same repository.');
  const base = await repo.revAsync(`refs/papilot/${taskName}/base`), desired = await tree(repo, source.snapshot), original = await tree(repo, base);
  const baseTree = await repo.treeIdAsync(base), headTree = await repo.treeIdAsync(source.head);
  const algorithm = base.length === 64 ? 'sha256' : 'sha1';
  const executable = (await repo.textAsync(['config', '--get', 'core.filemode'], { check: false })) !== 'false';
  if (!executable) for (const entries of [original, desired]) for (const entry of entries.values()) if (entry.mode === '100755') entry.mode = '100644';
  const expectedOperations = [...new Set([...original.keys(), ...desired.keys()])].filter(file => !equals(original.get(file), desired.get(file)))
    .map(file => ({ file, before: original.get(file) || null, after: desired.get(file) || null }))
    .sort((a, b) => Number(Boolean(a.after)) - Number(Boolean(b.after)) || (a.after ? a.file.length - b.file.length : b.file.length - a.file.length) || a.file.localeCompare(b.file));
  const folder = path.join(targetGit, 'papilot'), journalPath = path.join(folder, 'fork-worktree.json');
  let journal: Journal;
  try { journal = JSON.parse(await fs.readFile(journalPath, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    assertCurrent();
    if (await repo.revAsync('HEAD') !== base || await indexTree(repo) !== baseTree) throw new Error('The fork destination is not a fresh review worktree.');
    assertTree(await disk(target, algorithm, executable), original);
    journal = { version: 1, operationId, taskName, targetRoot: target, source, base, operations: expectedOperations, done: 0, pending: false, stage: 'files' };
    await fs.mkdir(folder, { recursive: true }); await fs.writeFile(journalPath, JSON.stringify(journal), { flag: 'wx', mode: 0o600 });
  }
  if (journal.version !== 1 || journal.operationId !== operationId || journal.taskName !== taskName || journal.targetRoot !== target || journal.base !== base || !journal.source || (['sourceRoot', 'commonDir', 'head', 'snapshot'] as const).some(key => journal.source[key] !== source[key])
      || !Array.isArray(journal.operations) || !Number.isInteger(journal.done) || journal.done < 0 || journal.done > journal.operations.length
      || journal.operations.length !== expectedOperations.length || journal.operations.some((operation, index) => operation.file !== expectedOperations[index].file || !equals(operation.before, expectedOperations[index].before) || !equals(operation.after, expectedOperations[index].after))
      || journal.stage !== 'files' && (journal.done !== journal.operations.length || journal.pending)
      || !['files', 'head', 'index', 'complete'].includes(journal.stage)) throw new Error('The fork destination belongs to another operation.');
  const save = async () => { const temporary = journalPath + '.tmp'; await fs.writeFile(temporary, JSON.stringify(journal), { mode: 0o600 }); await fs.rename(temporary, journalPath); };
  const progress = () => onProgress?.({ stage: journal.stage, files: journal.done, total: journal.operations.length });
  const ref = `refs/papilot/${taskName}/fork-input`, pinned = await repo.textAsync(['rev-parse', '--verify', '--quiet', ref], { check: false });
  if (pinned && pinned !== source.snapshot) throw new Error('The fork destination belongs to another operation.');
  if (!pinned) await repo.runAsync(['update-ref', ref, source.snapshot, '0'.repeat(base.length)]);
  const expected = new Map(original);
  for (const operation of journal.operations.slice(0, journal.done)) if (operation.after) expected.set(operation.file, operation.after); else expected.delete(operation.file);
  const tempFile = (operation: Operation) => path.posix.join(path.posix.dirname(operation.file), `.studybuddy-fork-${operationId}.tmp`);
  for (const operation of journal.operations) if (!validPath(operation.file) || original.has(tempFile(operation)) || desired.has(tempFile(operation))) throw new Error('Invalid fork operation.');
  const pending = journal.pending ? journal.operations[journal.done] : undefined;
  assertCurrent(); assertTree(await disk(target, algorithm, executable, pending ? tempFile(pending) : ''), expected, pending);
  const initialHead = await repo.revAsync('HEAD');
  if (journal.stage === 'files' ? initialHead !== base : journal.stage === 'head' ? initialHead !== base && initialHead !== source.head : initialHead !== source.head) throw new Error('The fork destination HEAD changed. It was not overwritten.');
  const initialIndex = await indexTree(repo);
  if (journal.stage === 'complete' ? initialIndex !== headTree : initialIndex !== baseTree && !(journal.stage === 'index' && initialIndex === headTree)) throw new Error('The fork destination index changed. Its staged files were not overwritten.');
  if (journal.stage === 'complete') return { base, head: source.head, snapshot: source.snapshot };
  while (journal.done < journal.operations.length) {
    const operation = journal.operations[journal.done], destination = path.join(target, operation.file), temporary = path.join(target, tempFile(operation));
    assertCurrent(); journal.pending = true; await save(); await progress();
    assertTree(await disk(target, algorithm, executable, tempFile(operation)), expected, operation);
    if (operation.after) {
      await parents(target, operation.file); await fs.rm(temporary, { force: true });
      const bytes = (await repo.blobsAsync(source.snapshot, [operation.file]))[operation.file];
      if (!bytes) throw new Error('The fork snapshot is unavailable.');
      if (operation.after.mode === '120000') await fs.symlink(bytes.toString(), temporary);
      else await fs.writeFile(temporary, bytes, { flag: 'wx', mode: operation.after.mode === '100755' ? 0o755 : 0o644 });
      try { if ((await fs.lstat(destination)).isDirectory()) await fs.rmdir(destination); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await fs.rename(temporary, destination); expected.set(operation.file, operation.after);
    } else {
      await fs.unlink(destination).catch(error => { if (error.code !== 'ENOENT') throw error; }); expected.delete(operation.file);
      let empty = path.dirname(destination);
      while (empty !== target) { try { await fs.rmdir(empty); } catch (error) { if (['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code || '')) break; if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } empty = path.dirname(empty); }
    }
    journal.pending = false; journal.done++; await save(); await progress();
  }
  assertCurrent(); assertTree(await disk(target, algorithm, executable), desired);
  journal.stage = 'head'; await save(); await progress();
  if (await repo.revAsync('HEAD') === base) await repo.runAsync(['update-ref', '--no-deref', 'HEAD', source.head, base]);
  if (await repo.revAsync('HEAD') !== source.head) throw new Error('The fork destination HEAD changed. It was not overwritten.');
  journal.stage = 'index'; await save(); await progress(); assertCurrent(); await setIndex(repo, baseTree, headTree, source.head);
  assertTree(await disk(target, algorithm, executable), desired); journal.stage = 'complete'; await save(); await progress();
  return { base, head: source.head, snapshot: source.snapshot };
}
