import fs from 'node:fs';
import path from 'node:path';

// Inspect only the selected execution directory. In particular, lstat protects
// existing directories and broken/outside symlinks without reading their target.
export function initInstructionsStatus(root: string): { exists: boolean } {
  try {
    if (!root || !path.isAbsolute(root) || path.resolve(root) === path.parse(root).root || !fs.statSync(root).isDirectory()) throw new Error();
    return { exists: fs.lstatSync(path.join(root, 'AGENTS.md'), { throwIfNoEntry: false }) !== undefined };
  } catch {
    // An inaccessible or missing execution directory is not an absent guide.
    throw new Error('Unable to check AGENTS.md.');
  }
}
