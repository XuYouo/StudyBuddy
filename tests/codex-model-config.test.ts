import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentModel } from '../src/shared.ts';
import { configurationKey, modelConfiguration, recentConfigurations } from '../src/web/codex-model-config.ts';

const model: AgentModel = { id: 'alpha', name: 'Alpha', isDefault: true, efforts: ['low', 'high'], defaultEffort: 'low', fastMode: { serviceTier: 'priority', description: 'Fast' } };

test('composer model changes retain only supported effort and service tier', () => {
  assert.deepEqual(modelConfiguration('codex', model, { effort: 'high', fast: true }), { agent: 'codex', model: 'alpha', effort: 'high', fast: true });
  assert.deepEqual(modelConfiguration('codex', model, { effort: 'ultra', fast: false }), { agent: 'codex', model: 'alpha', effort: 'low', fast: false });
  assert.deepEqual(modelConfiguration('claude', { ...model, efforts: [], defaultEffort: null }, { effort: 'high', fast: true }), { agent: 'claude', model: 'alpha', effort: '', fast: false });
  assert.equal(modelConfiguration('codex', { ...model, fastMode: undefined }, { effort: 'high', fast: true }).fast, false);
});

test('unknown models and invalid provider defaults do not invent capabilities', () => {
  assert.deepEqual(modelConfiguration('codex', undefined, { effort: 'high', fast: true }, 'custom'), { agent: 'codex', model: 'custom', effort: '', fast: false });
  assert.equal(modelConfiguration('codex', { ...model, defaultEffort: 'ultra' }, { effort: '', fast: false }).effort, '');
});

test('recent choices keep distinct model effort and tier configurations and reject malformed storage', () => {
  const low = modelConfiguration('codex', model, { effort: 'low', fast: false });
  const high = modelConfiguration('codex', model, { effort: 'high', fast: false });
  const fast = modelConfiguration('codex', model, { effort: 'high', fast: true });
  assert.notEqual(configurationKey(low), configurationKey(high));
  assert.notEqual(configurationKey(high), configurationKey(fast));
  assert.deepEqual(recentConfigurations([high, low, high, fast, { ...low, model: 'fourth' }]), [high, low, fast]);
  assert.deepEqual(recentConfigurations([null, 1, 'bad', {}, { ...low, fast: 'false' }, high]), [high]);
  assert.deepEqual(recentConfigurations({}), []);
});
