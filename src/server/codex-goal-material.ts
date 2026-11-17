import fs from 'node:fs/promises';
import path from 'node:path';
import { imageType } from './attachments.ts';

export interface CodexGoalMaterialOptions {
  objective: string;
  // The caller resolves and authorizes these paths through Attachments first.
  attachments?: { name: string; mime: string; path: string }[];
  // A fresh operation UUID from Attachments.materialDirectory(), outside the
  // publishable worktree; the caller retains ownership before sending the RPC.
  directory: string;
  assertCurrent?: () => void;
}
export interface CodexGoalMaterial {
  objective: string;
  sourceObjective: string;
  attachmentDirectory: string | null;
  dispose: () => Promise<void>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const append = (objective: string, heading: string, rows: string[]) => rows.length ? `${objective ? objective + '\n\n' : ''}${heading}\n${rows.join('\n')}` : objective;

// Mirrors the local Codex goal materializer: file-backed inputs become readable
// references, and a >4,000 Unicode-code-point objective becomes a Markdown file.
// There is no turn/start or synthetic message: the caller sends result.objective
// to thread/goal/set. Dispose only before transmission or after a definite RPC
// rejection. A lost response can mean the goal already references these files;
// keep them until reconciliation proves that operation was not applied.
export async function materializeCodexGoal({ objective, attachments = [], directory, assertCurrent = () => {} }: CodexGoalMaterialOptions): Promise<CodexGoalMaterial> {
  const target = path.resolve(directory), parent = path.dirname(target);
  if (path.basename(parent) !== '.studybuddy-goals' || !uuid.test(path.basename(target))) throw new Error('Invalid goal attachment directory.');
  let created = false;
  const dispose = async () => { if (created) { await fs.rm(target, { recursive: true, force: true }); created = false; } };
  const ensureDirectory = async () => {
    if (created) return;
    assertCurrent();
    try { await fs.mkdir(parent, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const entry = await fs.lstat(parent);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Invalid goal attachment directory.');
    assertCurrent();
    await fs.mkdir(target, { mode: 0o700 }); created = true; assertCurrent();
  };
  const write = async (name: string, bytes: Buffer) => {
    await ensureDirectory(); assertCurrent();
    const file = path.join(target, name); await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o400 }); assertCurrent(); return file;
  };
  try {
    assertCurrent();
    let text = objective.trim();
    if (!text && !attachments.length) throw new Error('Goal objective must not be empty.');
    const pasted: string[] = [], images: string[] = [];
    let textCount = 0, imageCount = 0;
    for (const attachment of attachments) {
      assertCurrent(); const bytes = await fs.readFile(attachment.path); assertCurrent();
      const mime = imageType(bytes);
      if (mime) {
        const index = ++imageCount, extension = mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length);
        const file = await write(`image-${index}.${extension}`, bytes);
        images.push(`- [Image #${index}]: ${file}`);
      } else {
        // Uploaded MIME metadata deliberately labels all ordinary files as
        // octet-stream. Inspect bytes rather than trusting names/client types.
        let decoded: string;
        try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { throw new Error('Goals support only text files and images.'); }
        if (attachment.mime === 'application/pdf' || bytes.subarray(0, 5).toString() === '%PDF-' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(decoded)) throw new Error('Goals support only text files and images.');
        const file = await write(`pasted-text-${++textCount}.txt`, bytes);
        pasted.push(`- pasted text file: ${file}. Read this file before continuing.`);
      }
    }
    text = append(text, 'Referenced pasted text files:', pasted);
    text = append(text, 'Referenced image files:', images);
    const sourceObjective = text;
    if (Array.from(text).length > 4000) {
      const file = path.join(target, 'goal-objective.md');
      const reference = `Read the Codex goal objective file at ${file} before continuing.`;
      if (Array.from(reference).length > 4000) throw new Error('Goal objective file reference is too long.');
      await write('goal-objective.md', Buffer.from(text, 'utf8')); text = reference;
    }
    assertCurrent();
    return { objective: text, sourceObjective, attachmentDirectory: created ? target : null, dispose };
  } catch (error) {
    await dispose().catch(() => {}); throw error;
  }
}
