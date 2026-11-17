import test from 'node:test';
import assert from 'node:assert/strict';
import { AttachmentDraft } from '../src/web/attachment-draft.ts';
import { ComposerDraft, type Message } from '../src/web/composer.ts';
import type { Attachment } from '../src/shared.ts';

const file = () => new File(['a,b\n1,2'], 'results.csv', { type: 'text/csv' });
const uploaded: Attachment = { id: 'file-1', name: 'results.csv', projectId: 'paper', size: 7, mime: 'application/octet-stream' };
function setup() {
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) || null, setItem: (key: string, value: string) => { saved.set(key, value); }, removeItem: (key: string) => { saved.delete(key); } };
  return { storage, draft: new AttachmentDraft('files', storage) };
}
test('successful uploads survive remounts; failures retain their file and can be retried', async () => {
  const { storage, draft } = setup();
  await draft.add([file()], async () => { throw new Error('Offline'); });
  assert.equal(draft.getSnapshot().blocked, true);
  assert.equal(draft.getSnapshot().entries[0].error, 'Offline');
  assert.equal(draft.getSnapshot().entries[0].file?.name, 'results.csv');
  await draft.upload(draft.getSnapshot().entries[0].key, async () => uploaded);
  assert.equal(draft.getSnapshot().blocked, false);
  assert.deepEqual(new AttachmentDraft('files', storage).getSnapshot().files, [uploaded]);
});
test('removing an upload in flight cannot restore it when its response arrives', async () => {
  const { draft } = setup();
  let finish!: (file: Attachment) => void, signal: AbortSignal | undefined;
  const uploading = draft.add([file()], async (_file, abort) => { signal = abort; return new Promise<Attachment>(resolve => { finish = resolve; }); });
  assert.equal(draft.getSnapshot().blocked, true);
  draft.remove(draft.getSnapshot().entries[0].key);
  assert.equal(signal?.aborted, true);
  finish(uploaded); await uploading;
  assert.deepEqual(draft.getSnapshot().files, []);
});
test('only sent attachments are cleared; files added for the next message stay', async () => {
  const { draft } = setup();
  await draft.add([file()], async () => uploaded);
  await draft.add([file()], async () => ({ ...uploaded, id: 'file-2' }));
  draft.clear([uploaded]);
  assert.deepEqual(draft.getSnapshot().files.map(file => file.id), ['file-2']);
});
test('attachment sends retain idempotency on retry, change identity for new files, and leave feedback separate', async () => {
  const { storage } = setup();
  let sequence = 0;
  const composer = new ComposerDraft('text', storage, () => String(++sequence)), messages: Message[] = [];
  const fail = async (message: Message) => { messages.push(message); throw new Error('Offline'); };
  await assert.rejects(composer.submit('draft', fail, undefined, ['file-1']));
  await assert.rejects(composer.submit('draft', fail, undefined, ['file-1']));
  assert.equal(messages[0].requestKey, messages[1].requestKey);
  const reopened = new ComposerDraft('text', storage, () => String(++sequence));
  await assert.rejects(reopened.submit('draft', async message => { assert.equal(message.requestKey, messages[0].requestKey); throw new Error('Still offline'); }, undefined, ['file-1']));
  await composer.submit('draft', async message => { messages.push(message); }, undefined, ['file-2']);
  assert.notEqual(messages[2].requestKey, messages[0].requestKey);
  assert.equal(messages[2].text, '');
  await composer.submit('feedback', async message => { messages.push(message); }, undefined, ['file-2']);
  assert.equal(messages[3].attachments, undefined);
});

test('upgrading restores an account-scoped file draft without replacing a current draft', () => {
  const saved = new Map<string, string>([['papilot:files:old-account:task:task-1', JSON.stringify([uploaded])]]);
  const storage = { keys: () => [...saved.keys()], getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); }, removeItem: (key: string) => { saved.delete(key); } };
  const key = 'papilot:files:task:task-1';
  assert.deepEqual(new AttachmentDraft(key, storage).getSnapshot().files, [uploaded]);
  assert.equal(saved.has('papilot:files:old-account:task:task-1'), false);
  saved.set('papilot:files:old-account:task:task-1', JSON.stringify([{ ...uploaded, id: 'older' }]));
  assert.deepEqual(new AttachmentDraft(key, storage).getSnapshot().files, [uploaded]);
  assert.equal(saved.has('papilot:files:old-account:task:task-1'), true);
});

test('saving a drawing replaces its attachment atomically and keeps the original on failure', async () => {
  const { draft, storage } = setup();
  await draft.add([file()], async () => uploaded);
  const key = draft.getSnapshot().entries[0].key;
  let finish!: (attachment: Attachment) => void;
  const save = draft.saveFile(new File(['png'], 'Sketch.png', { type: 'image/png' }), async () => new Promise<Attachment>(resolve => { finish = resolve; }), key);
  assert.equal(draft.getSnapshot().blocked, true);
  assert.deepEqual(draft.getSnapshot().files, [uploaded]);
  assert.deepEqual(new AttachmentDraft('files', storage).getSnapshot().files, [uploaded]);
  const replacement = { ...uploaded, id: 'drawing', name: 'Sketch.png', size: 3, mime: 'image/png' };
  finish(replacement);
  assert.deepEqual(await save, { key, attachment: replacement, previous: uploaded });
  assert.equal(draft.getSnapshot().blocked, false);
  await assert.rejects(draft.saveFile(file(), async () => { throw new Error('Offline'); }, key), /Offline/);
  assert.deepEqual(draft.getSnapshot().files, [replacement]);
  assert.equal(draft.getSnapshot().blocked, false, 'a failed edit does not invalidate the saved drawing');
  assert.deepEqual(new AttachmentDraft('files', storage).getSnapshot().files, [replacement]);
});

test('cancelled or removed drawing uploads never replace or restore another draft attachment', async () => {
  const { draft } = setup();
  const controller = new AbortController();
  let finish!: (attachment: Attachment) => void, uploadSignal!: AbortSignal;
  const initial = draft.saveFile(file(), async (_file, signal) => { uploadSignal = signal; return new Promise<Attachment>(resolve => { finish = resolve; }); }, undefined, controller.signal);
  controller.abort(); assert.equal(uploadSignal.aborted, true); finish(uploaded);
  await assert.rejects(initial, { name: 'AbortError' });
  assert.deepEqual(draft.getSnapshot().entries, []);
  await draft.add([file()], async () => uploaded);
  const key = draft.getSnapshot().entries[0].key;
  const replacement = draft.saveFile(file(), async () => new Promise<Attachment>(resolve => { finish = resolve; }), key);
  draft.remove(key); finish({ ...uploaded, id: 'late' });
  await assert.rejects(replacement, { name: 'AbortError' });
  assert.deepEqual(draft.getSnapshot().entries, []);
  await assert.rejects(draft.saveFile(file(), async () => uploaded, key), /no longer in the draft/);
});
