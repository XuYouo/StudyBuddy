import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CodeReviewBranch, CodeReviewBranches, CodeReviewTarget } from '../code-review.ts';

const exec = promisify(execFile);
const git = async (root: string, args: string[]) => (await exec('git', args, {
  cwd: root, timeout: 15_000, maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
})).stdout.trim();

// Names are for display. Full refs prevent a same-named tag from changing the
// review target and are validated again immediately before review/start.
export async function codeReviewBranches(root: string): Promise<CodeReviewBranches> {
  try {
    const [refs, head, remote] = await Promise.all([
      git(root, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%00%(symref)', 'refs/heads', 'refs/remotes']),
      git(root, ['symbolic-ref', '--quiet', 'HEAD']).catch(error => {
        if (error.code === 1) return ''; // Detached HEAD is a valid checkout.
        throw error;
      }),
      git(root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']).catch(error => {
        if (error.code === 1) return '';
        throw error;
      }),
    ]);
    const candidates: CodeReviewBranch[] = refs.split('\n').filter(Boolean).flatMap(line => {
      const [ref, symbolic] = line.split('\0');
      return symbolic || ref === head ? [] : [{ ref, name: ref.replace(/^refs\/(?:heads|remotes)\//, '') }];
    });
    const preferred = remote && (candidates.find(branch => branch.ref === remote.replace(/^refs\/remotes\/origin\//, 'refs/heads/')) || candidates.find(branch => branch.ref === remote))
      || candidates.find(branch => branch.ref === 'refs/heads/main') || candidates.find(branch => branch.ref === 'refs/heads/master');
    return { current: head ? head.replace(/^refs\/heads\//, '') : null, branches: preferred ? [preferred, ...candidates.filter(branch => branch !== preferred)] : candidates };
  } catch { throw new Error('Unable to load branches'); }
}

export function parseCodeReviewTarget(value: unknown): CodeReviewTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a code review target.');
  const target = value as Record<string, unknown>;
  if (target.type === 'uncommittedChanges' && Object.keys(target).length === 1) return { type: 'uncommittedChanges' };
  if (target.type !== 'baseBranch' || typeof target.branch !== 'string' || Object.keys(target).some(key => key !== 'type' && key !== 'branch')) throw new Error('Choose a code review target.');
  if (!/^refs\/(heads|remotes)\/.+/.test(target.branch)) throw new Error('This branch is no longer available. Choose another branch.');
  return { type: 'baseBranch', branch: target.branch };
}

export async function codeReviewTarget(root: string, value: unknown): Promise<CodeReviewTarget> {
  const target = parseCodeReviewTarget(value);
  if (target.type === 'uncommittedChanges') return target;
  const { branches } = await codeReviewBranches(root);
  const branch = branches.find(branch => branch.ref === target.branch);
  if (!branch) throw new Error('This branch is no longer available. Choose another branch.');
  try { await git(root, ['rev-parse', '--verify', '--end-of-options', branch.ref + '^{commit}']); }
  catch { throw new Error('This branch is no longer available. Choose another branch.'); }
  return { type: 'baseBranch', branch: branch.ref };
}

/** Native review boundaries are hidden by the official UI. Retain them for
 * correlation; the visible report arrives as an ordinary agentMessage. */
export function nativeReviewItem(item: { type?: string; review?: unknown }) {
  return ['enteredReviewMode', 'exitedReviewMode'].includes(item.type || '') && typeof item.review === 'string'
    ? { type: 'codeReviewMarker', text: item.review } : null;
}
