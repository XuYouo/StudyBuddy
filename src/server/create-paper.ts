import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA } from './paths.ts';
import { prepareRepository } from './imports.ts';
import { realPath } from './real-path.ts';
import type { Project } from '../shared.ts';

// Keep the starter independent of the display name: names may contain Unicode
// or TeX commands, while this document compiles with a minimal pdfLaTeX setup.
export const NEW_PAPER_SOURCE = String.raw`\documentclass[11pt]{article}

\title{Your paper title}
\author{Your name}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
Write a short summary of your paper here.
\end{abstract}

\section{Introduction}
Start writing here. You can edit this source in StudyBuddy or ask an agent to help draft your paper.

\section{Conclusion}
Summarize your findings and next steps here.

\end{document}
`;
const ignores = '*.aux\n*.log\n*.fls\n*.fdb_latexmk\n*.synctex.gz\n*.toc\n*.out\nmain.pdf\n.DS_Store\n';
type Input = { id?: unknown; name?: unknown; parent?: unknown };
type Receipt = { id: string; name: string; parent: string; root: string; dev: number; ino: number; prepared: boolean };

export function newPaperName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) throw new Error('Enter a paper name under 120 characters.');
  const name = value.trim();
  // The name is also a directory name. Keep projects portable between native
  // Windows, WSL and Unix, including Windows device names with extensions.
  if (/[\\/<>:"|?*\x00-\x1f\x7f]/.test(name) || /[. ]$/.test(name) || name === '.' || name === '..' || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) throw new Error('Choose a paper name that is a valid folder name.');
  return name;
}
export class PaperCreations {
  private pending = new Map<string, { key: string; work: Promise<Project> }>();
  get busy() { return this.pending.size > 0; }
  constructor(private directory = DATA) {}
  defaults() { return { parent: os.homedir() }; }
  async create(input: Input, register: (root: string, name: string) => Promise<Project>) {
    if (typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.id)) throw new Error('Invalid paper creation ID.');
    const id = input.id, name = newPaperName(input.name);
    if (typeof input.parent !== 'string' || !input.parent.trim() || input.parent.length > 4000 || /[\x00-\x1f]/.test(input.parent)) throw new Error('Choose an existing folder to save the paper in.');
    const expanded = input.parent.trim().replace(/^~(?=$|[\/\\])/, os.homedir());
    if (!path.isAbsolute(expanded)) throw new Error('Enter an absolute folder path on the computer running StudyBuddy.');
    let parent: string;
    try { parent = realPath(expanded); if (!fs.statSync(parent).isDirectory()) throw new Error(); }
    catch { throw new Error('Choose an existing folder to save the paper in.'); }
    const key = JSON.stringify([name, parent]), running = this.pending.get(id);
    if (running) {
      if (running.key !== key) throw new Error('This creation request already belongs to another paper.');
      return running.work;
    }
    const work = this.prepare(id, name, parent, register);
    this.pending.set(id, { key, work });
    try { return await work; } finally { this.pending.delete(id); }
  }
  private async prepare(id: string, name: string, parent: string, register: (root: string, name: string) => Promise<Project>) {
    const folder = path.join(this.directory, 'paper-creations'), receiptFile = path.join(folder, id + '.json'), root = path.join(parent, name);
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    let receipt: Receipt;
    const save = () => { fs.writeFileSync(receiptFile + '.tmp', JSON.stringify(receipt), { mode: 0o600 }); fs.renameSync(receiptFile + '.tmp', receiptFile); };
    if (fs.existsSync(receiptFile)) {
      receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8')) as Receipt;
      if (receipt.name !== name || receipt.parent !== parent || receipt.root !== root) throw new Error('This creation request already belongs to another paper.');
      if (!owned()) throw new Error('The created folder has moved or changed. Open it as an existing paper, or choose another name.');
    } else {
      try { fs.mkdirSync(root, { mode: 0o700 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('A file or folder with this paper name already exists. Choose another name.');
        throw new Error('Could not create the paper folder. Check the save location and its permissions.');
      }
      const stat = fs.lstatSync(root);
      receipt = { id, name, parent, root, dev: stat.dev, ino: stat.ino, prepared: false };
      try { save(); } catch (error) { fs.rmdirSync(root); throw error; }
    }
    function owned() {
      try { const stat = fs.lstatSync(root); return stat.isDirectory() && !stat.isSymbolicLink() && stat.dev === receipt.dev && stat.ino === receipt.ino; } catch { return false; }
    }
    if (!receipt.prepared) {
      try {
        // A restart can resume its own partially prepared folder, but never
        // replace files. Only a receipt matching this directory allows resume.
        for (const [file, contents] of [['main.tex', NEW_PAPER_SOURCE], ['.gitignore', ignores]]) {
          try { fs.writeFileSync(path.join(root, file), contents, { flag: 'wx', mode: 0o600 }); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        }
        await prepareRepository(root, 'Create paper in StudyBuddy');
        receipt.prepared = true; save();
      } catch (error) {
        // Directory ownership does not imply ownership of everything inside:
        // the author may have edited a file after an interrupted attempt. Only
        // undo untouched starter files before Git initialized; keep all other
        // partial repositories and the receipt so retry resumes them in place.
        let removed = false;
        if (owned()) {
          const entries = fs.readdirSync(root);
          const templates = new Map([['main.tex', NEW_PAPER_SOURCE], ['.gitignore', ignores]]);
          const untouched = entries.every(file => {
            const expected = templates.get(file), target = path.join(root, file);
            return expected !== undefined && fs.lstatSync(target).isFile() && fs.readFileSync(target, 'utf8') === expected;
          });
          if (untouched) {
            for (const file of entries) fs.unlinkSync(path.join(root, file));
            fs.rmdirSync(root); fs.rmSync(receiptFile, { force: true }); removed = true;
          }
        }
        const missingGit = (error as NodeJS.ErrnoException).code === 'ENOENT' && (error as NodeJS.ErrnoException).syscall?.includes('spawn');
        if (removed && missingGit) throw new Error('Install Git on the computer running StudyBuddy, then retry creating the paper.');
        const message = missingGit
          ? 'Install Git on the computer running StudyBuddy, then retry creating the paper.' : (error as Error).message;
        throw new Error(removed ? message : `${message} Paper files were kept at ${root}. Retry creation to continue.`);
      }
    }
    // Keep the prepared receipt on registration failure, a lost response or a
    // server restart. Retrying registers this same repository without rewriting
    // the author's source, and addProject returns an existing registration.
    return register(root, name);
  }
}
