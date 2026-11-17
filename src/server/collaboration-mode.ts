import type { CollaborationPreset, RuntimeStatus, Task } from '../shared.ts';

export function collaborationPresets(value: unknown): CollaborationPreset[] {
  if (!Array.isArray(value)) return [];
  const found = new Set<string>();
  return value.flatMap(entry => {
    if (!entry || !['plan', 'default'].includes(entry.mode) || found.has(entry.mode)) return [];
    found.add(entry.mode);
    return [{ mode: entry.mode, name: typeof entry.name === 'string' ? entry.name : entry.mode, model: typeof entry.model === 'string' ? entry.model : null, reasoningEffort: typeof entry.reasoning_effort === 'string' ? entry.reasoning_effort : null }];
  });
}

export function validateCollaborationMode(value: unknown, runtime: RuntimeStatus, agent: string, review: boolean): Task['collaborationMode'] {
  if (value === undefined) return;
  if (!['plan', 'default'].includes(value as string)) throw new Error('Invalid collaboration mode.');
  if (agent !== 'codex' || review || !runtime.collaborationModes?.some(mode => mode.mode === 'plan')) throw new Error('Plan mode is not available for this task.');
  return value as NonNullable<Task['collaborationMode']>;
}

export function collaborationPayload(mode: Task['collaborationMode'], model: string | null, effort: string | null | undefined) {
  if (!mode) return {};
  if (!model) throw new Error('Choose a model before using Plan mode.');
  // null selects Codex's own mode instructions. Never replace them with a
  // client prompt or carry model/effort values from a stale preset.
  return { collaborationMode: { mode, settings: { model, reasoning_effort: effort || null, developer_instructions: null } } };
}
