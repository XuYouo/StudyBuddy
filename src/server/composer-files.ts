import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ComposerFile, ComposerReference } from '../shared.ts';
import { referenceText } from '../composer-reference.ts';
import { realPath } from './real-path.ts';

const execute = promisify(execFile);
// Bound the native index output and the autocomplete response independently.
// A large repository fails explicitly; no partial index masquerades as complete.
const MAX_INDEX_BYTES = 16 * 1024 * 1024, RESULT_LIMIT = 60;
const indexing = new Map<string, Promise<string[]>>();
const inside = (base: string, target: string) => target === base || target.startsWith(base + path.sep);
const relative = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && !/[\\\0\r\n]/.test(value) && !/^(?:\/|[a-z][a-z\d+.-]*:)/i.test(value)
  && value.replace(/\/$/, '').split('/').every(part => part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git');
function rootPath(root: string): string {
  if (!root) throw new Error('Unable to search project files.');
  try { const base = realPath(root); if (fs.statSync(base).isDirectory()) return base; } catch { /* Report no host details. */ }
  throw new Error('Unable to search project files.');
}
function entry(base: string, file: string): ComposerFile | undefined {
  if (!relative(file)) return;
  try {
    const target = realPath(path.join(base, file));
    if (!inside(base, target) || path.relative(base, target).split(path.sep).some(part => part.toLowerCase() === '.git')) return;
    const stat = fs.statSync(target), kind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : undefined;
    if (!kind) return;
    const name = file.replace(/\/$/, '');
    return { path: name + (kind === 'directory' ? '/' : ''), label: path.posix.basename(name), kind };
  } catch { return; }
}
function score(file: ComposerFile, query: string): number | undefined {
  if (!query) return 0;
  const value = file.path.toLocaleLowerCase(), name = file.label.toLocaleLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (value.startsWith(query)) return 2;
  const contiguous = value.indexOf(query);
  if (contiguous >= 0) return 3 + contiguous / (value.length + 1);
  let cursor = 0, skipped = 0;
  for (const character of query) {
    const found = value.indexOf(character, cursor);
    if (found < 0) return;
    skipped += found - cursor; cursor = found + character.length;
  }
  return 5 + skipped / (value.length + 1);
}
export async function composerFiles(root: string, query: unknown = ''): Promise<{ files: ComposerFile[]; more: boolean }> {
  if (typeof query !== 'string' || /[\0\r\n]/.test(query)) throw new Error('Invalid file search query.');
  const base = rootPath(root);
  let pending = indexing.get(base);
  if (!pending) {
    pending = execute('git', ['-C', base, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { maxBuffer: MAX_INDEX_BYTES, timeout: 20000 })
      .then(({ stdout }) => stdout.split('\0').filter(Boolean)).catch(() => { throw new Error('Unable to search project files.'); });
    indexing.set(base, pending);
    void pending.finally(() => { if (indexing.get(base) === pending) indexing.delete(base); }).catch(() => undefined);
  }
  const paths = new Set<string>();
  for (const file of await pending) {
    paths.add(file);
    for (let parent = path.posix.dirname(file); parent !== '.' && parent !== '/'; parent = path.posix.dirname(parent)) paths.add(parent + '/');
  }
  const normalized = query.toLocaleLowerCase(), matches: { file: ComposerFile; score: number }[] = [];
  for (const file of paths) {
    if (!relative(file)) continue;
    const candidate: ComposerFile = { path: file, label: path.posix.basename(file.replace(/\/$/, '')), kind: file.endsWith('/') ? 'directory' : 'file' };
    const rank = score(candidate, normalized);
    if (rank !== undefined) matches.push({ file: candidate, score: rank });
  }
  matches.sort((a, b) => a.score - b.score || a.file.path.localeCompare(b.file.path));
  const results = new Map<string, ComposerFile>();
  // Resolve only matching candidates until one page plus its continuation is
  // known. Never follow an escaping symlink merely to populate autocomplete.
  for (const match of matches) {
    const found = entry(base, match.file.path);
    if (found) results.set(found.path, found);
    if (results.size > RESULT_LIMIT) break;
  }
  return { files: [...results.values()].slice(0, RESULT_LIMIT), more: results.size > RESULT_LIMIT };
}

export function validateComposerReferences(root: string, text: string, value: unknown): ComposerReference[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error('Invalid file reference.');
  if (!value.length) return [];
  const base = rootPath(root), result: ComposerReference[] = [];
  let end = 0;
  for (const reference of value) {
    if (!reference || typeof reference !== 'object' || !Number.isSafeInteger(reference.from) || !Number.isSafeInteger(reference.to)
      || reference.from < end || reference.to <= reference.from || reference.to > text.length || !relative(reference.path)
      || typeof reference.label !== 'string' || !reference.label || /[\r\n\0]/.test(reference.label)
      || !['file', 'directory'].includes(reference.kind)) throw new Error('Invalid file reference.');
    const { from, to, path: file, label, kind } = reference;
    if (text.slice(from, to) !== referenceText({ path: file, label, kind })) throw new Error('Invalid file reference.');
    const found = entry(base, file);
    if (!found || found.kind !== kind || found.path !== file) throw new Error('A referenced file is unavailable or outside this project.');
    result.push({ from, to, path: file, label, kind }); end = to;
  }
  return result;
}
