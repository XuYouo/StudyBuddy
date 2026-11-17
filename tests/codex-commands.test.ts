import test from 'node:test';
import assert from 'node:assert/strict';
import { commandScore, filterCommands, hasComposerDraft, removeSlashQuery, slashQuery } from '../src/web/codex-commands.ts';

test('slash commands match at the caret and remove only their own query', () => {
  const text = 'Keep this paragraph.\n/model and the following text.';
  const caret = text.indexOf(' and');
  const match = slashQuery(text, caret);
  assert.deepEqual(match, { from: 21, to: caret, query: 'model' });
  assert.deepEqual(removeSlashQuery(text, match!), { text: 'Keep this paragraph.\n and the following text.', caret: 21 });
  assert.equal(slashQuery('Review /reasoning effort', 24)?.query, 'reasoning effort');
  assert.equal(slashQuery('/模型', 3)?.query, '模型');
});

test('slash menu excludes URLs, selections, invalid carets and fenced code', () => {
  for (const text of ['https://example.com/model', '//example.com/model', 'Read https://example.com/model', '```ts\n/model', '~~~text\n/model', '````md\n```\n/model']) {
    assert.equal(slashQuery(text, text.length), null, text);
  }
  assert.equal(slashQuery('/model', 2, 6), null);
  assert.equal(slashQuery('/model', -1), null);
  assert.equal(slashQuery('/model', 8), null);
  assert.equal(slashQuery('```\ncode\n```\n/model', 19)?.query, 'model');
  assert.equal(slashQuery('~~~text\ncode\n~~~\n/status', 24)?.query, 'status');
});

test('command ranking supports ids, translated titles and aliases without capturing unmatched skills', () => {
  const commands = [
    { id: 'reasoning', title: '推理强度' },
    { id: 'model', title: '模型', searchAliases: ['Models'] },
    { id: 'status', title: '上下文' },
  ];
  assert.deepEqual(filterCommands(commands, 'model').map(command => command.id), ['model']);
  assert.deepEqual(filterCommands(commands, '模型').map(command => command.id), ['model']);
  assert.deepEqual(filterCommands(commands, 'rsn').map(command => command.id), ['reasoning']);
  assert.deepEqual(filterCommands(commands, 'proofread'), []);
  assert.deepEqual(filterCommands(commands, 'ai-review'), []);
  assert.ok(commandScore('model', 'model') > commandScore('models', 'model'));
  assert.ok(commandScore('models', 'model') > commandScore('my model', 'model'));
});

test('disabled and empty-draft-only commands are gated without duplicate registry entries', () => {
  const commands = [
    { id: 'model', title: 'Old model' }, { id: 'model', title: 'Models' },
    { id: 'status', title: 'Context', enabled: false },
    { id: 'compact', title: 'Compact', requiresEmptyComposer: true },
  ];
  assert.deepEqual(filterCommands(commands, '', 'Draft /').map(command => command.id), ['model']);
  assert.equal(filterCommands(commands, 'model')[0].title, 'Models');
  assert.ok(filterCommands(commands, '', '/').some(command => command.id === 'compact'));
  assert.equal(hasComposerDraft(' /model '), false);
  assert.equal(hasComposerDraft('Keep this\n/model'), true);
});
