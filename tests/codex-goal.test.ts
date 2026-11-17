import assert from 'node:assert/strict';
import test from 'node:test';
import { goalStatusAction, goalTime, goalUsageKind } from '../src/codex-goal.ts';

test('goal toggle matches native resumable states, never restarting an exhausted or completed goal', () => {
  assert.equal(goalStatusAction('active'), 'pause');
  for (const status of ['paused', 'blocked', 'usageLimited'] as const) assert.equal(goalStatusAction(status), 'resume');
  for (const status of ['budgetLimited', 'complete'] as const) assert.equal(goalStatusAction(status), null);
});

test('goal summary uses budget accounting only for pursuing and budget-limited goals', () => {
  for (const status of ['active', 'budgetLimited'] as const) {
    assert.equal(goalUsageKind({ status, tokenBudget: 0 }), 'tokens');
    assert.equal(goalUsageKind({ status, tokenBudget: 1000 }), 'tokens');
    assert.equal(goalUsageKind({ status, tokenBudget: null }), 'time');
  }
  for (const status of ['paused', 'blocked', 'usageLimited', 'complete'] as const) assert.equal(goalUsageKind({ status, tokenBudget: 1000 }), 'time');
});

test('goal duration displays native whole seconds without rounding up or dropping larger units', () => {
  assert.equal(goalTime(-1), '0s');
  assert.equal(goalTime(59.9), '59s');
  assert.equal(goalTime(60), '1m');
  assert.equal(goalTime(65), '1m 5s');
  assert.equal(goalTime(3601), '1h 1s');
  assert.equal(goalTime(90061), '1d 1h 1m 1s');
  assert.equal(goalTime(65, 'zh-CN'), '1分钟 5秒');
});
