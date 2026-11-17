import { useEffect, useRef, useState } from 'react';
import type { Attachment } from '../shared.ts';
import { CodexSketchEditor, type SketchDocument } from './codex-sketch.tsx';
import type { AttachmentDraft, UploadAttachment } from './attachment-draft.ts';

// The official composer retains vector editing state only for its live draft.
// Persisted attachments remain ordinary PNGs after reload or after submission.
const documents = new WeakMap<AttachmentDraft, Map<string, SketchDocument>>();
function sketches(draft: AttachmentDraft) {
  let values = documents.get(draft);
  if (!values) { values = new Map(); documents.set(draft, values); }
  return values;
}
type Editing = { draft: AttachmentDraft; upload: UploadAttachment; key?: string; document?: SketchDocument; session: number };

export function useComposerSketch({ draft, upload, enabled, onClose, discard }: {
  draft?: AttachmentDraft; upload?: UploadAttachment; enabled: boolean;
  onClose(): void; discard(file: Attachment): void;
}) {
  const [editing, setEditing] = useState<Editing | null>(null), sequence = useRef(0);
  const availability = useRef({ draft, enabled }); availability.current = { draft, enabled };
  useEffect(() => { setEditing(null); }, [draft]);
  useEffect(() => { if (!enabled) setEditing(null); }, [enabled]);
  useEffect(() => {
    if (!draft) return;
    const prune = () => {
      const keys = new Set(draft.getSnapshot().entries.map(entry => entry.key));
      for (const key of sketches(draft).keys()) if (!keys.has(key)) sketches(draft).delete(key);
    };
    prune(); return draft.subscribe(prune);
  }, [draft]);
  function open(key?: string) {
    if (!enabled || !draft || !upload) return;
    const document = key ? sketches(draft).get(key) : undefined;
    if (key && (!document || !draft.getSnapshot().entries.some(entry => entry.key === key && entry.attachment && !entry.uploading))) return;
    setEditing({ draft, upload, key, document, session: ++sequence.current });
  }
  function close() { setEditing(null); onClose(); }
  return {
    open: () => open(),
    canEdit: (key: string) => Boolean(enabled && draft && sketches(draft).has(key)),
    edit: (key: string) => open(key),
    editor: editing && <CodexSketchEditor key={editing.session} initialDocument={editing.document} onClose={close} onSave={async (file, document, signal) => {
      if (!availability.current.enabled || availability.current.draft !== editing.draft) throw new DOMException('Aborted', 'AbortError');
      const result = await editing.draft.saveFile(file, editing.upload, editing.key, signal);
      sketches(editing.draft).set(result.key, structuredClone(document));
      if (result.previous) discard(result.previous);
    }}/>,
  };
}
