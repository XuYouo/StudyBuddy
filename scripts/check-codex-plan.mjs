// Exercise native Plan interactions on disposable HTTP data. No model or app-server starts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';
import { expectComposerText } from './composer-fixture.mjs';
const server = Fastify(); let browser;
try {
  await server.register(staticFiles, { root: path.resolve('dist') });
  await server.listen({ host: '127.0.0.1', port: 0 });
  const origin = `http://127.0.0.1:${server.server.address().port}`;
  browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); context.setDefaultTimeout(15000);
  const task = { id: 'plan-task', projectId: 'paper', agent: 'codex', name: 'p-plan', title: 'Plan the manuscript revision', instructions: 'Preserve notation.', worktree: '/tmp/plan-fixture', threadId: 'thread', turnId: null, model: 'model', effort: 'medium', status: 'interrupted', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
  const other = { ...task, id: 'other-task', agent: 'kimi', title: 'Other provider', threadId: 'other-thread' };
  const runtime = { connected: true, authenticated: true, account: null, error: null, models: [{ id: 'model', name: 'Fixture model', isDefault: true, efforts: ['medium'], defaultEffort: 'medium' }], collaborationModes: [{ name: 'Plan', mode: 'plan', model: null, reasoningEffort: null }, { name: 'Default', mode: 'default', model: null, reasoningEffort: null }] };
  const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Paper', path: task.worktree, createdAt: 1 }], tasks: [task, other], requests: [], runtime, runtimes: { codex: runtime, kimi: { ...runtime, collaborationModes: [] } } };
  const entries = [], modes = [], decisions = [], answers = [], pauses = [], creates = [], messages = [], goals = [], reviews = [], forks = [], errors = [], unexpected = [];
  let skills = [], failDecision = false, failAnswer = false, failGoal = false, failReview = false, failBranches = false, failFork = false;
  let forkGate, reviewGate;
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => { localStorage.setItem('papilot:task', 'plan-task'); localStorage.setItem('papilot:effort:codex', 'medium'); });
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url()), json = value => route.fulfill({ json: value }), body = () => route.request().postDataJSON();
    if (url.pathname === '/api/state') return json(snapshot);
    if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
    if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
    if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: 'test', phase: 'idle', canUpdate: false });
    if (url.pathname === '/api/note-alternatives') return json({ noteAlternatives: false, noteAlternativeRange: 'few' });
    if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
    if (url.pathname.endsWith('/skills')) return json({ skills });
    if (url.pathname.endsWith('/items')) return json({ items: entries });
    if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
    if (url.pathname.endsWith('/git')) return json({ files: [], branch: 'main', ahead: 0, behind: 0 });
    if (url.pathname.endsWith('/manuscript')) return json({ git: { files: [] }, annotations: [], build: { status: 'idle', current: false } });
    if (url.pathname.endsWith('/goal/check')) { task.goalControl = { ...task.goalControl, sync: 'ready', error: undefined, resumeRequired: false }; return json(task); }
    if (url.pathname.endsWith('/goal')) {
      if (route.request().method() === 'GET') return json(task);
      const request = body(); goals.push(request);
      if (failGoal) return route.fulfill({ status: 503, json: { error: 'Goal request could not be sent.' } });
      if (request.expectedRevision !== (task.goalControl?.revision || 0)) return route.fulfill({ status: 409, json: { error: 'The goal changed. Reopen the editor before saving.' } });
      if (request.action === 'clear') task.goal = null;
      else if (request.action === 'set') task.goal = { threadId: task.threadId, objective: request.objective, status: 'active', tokenBudget: null, tokensUsed: 12, timeUsedSeconds: 5, createdAt: task.goal?.createdAt || 1, updatedAt: Date.now() };
      else task.goal = { ...task.goal, status: request.action === 'pause' ? 'paused' : 'active' };
      task.goalControl = { revision: request.expectedRevision + 1, sync: 'ready', nativeStatus: 'idle' }; task.status = 'interrupted'; task.updatedAt++; return json(task);
    }
    if (url.pathname.endsWith('/code-review')) {
      if (route.request().method() === 'GET') return failBranches ? route.fulfill({ status: 503, json: { error: 'Unable to load branches' } }) : json({ current: 'main', branches: [{ name: 'main', ref: 'refs/heads/main' }] });
      const request = body(); reviews.push({ url: url.pathname, ...request });
      if (failReview) return route.fulfill({ status: 503, json: { error: 'Review request could not be sent.' } });
      if (url.pathname.includes('/projects/') && reviewGate) await reviewGate;
      if (url.pathname.includes('/projects/')) { const created = { ...task, id: request.id, title: 'Native code review', status: 'interrupted', goal: null, collaborationMode: undefined }; snapshot.tasks.push(created); return json(created); }
      task.status = 'running'; task.updatedAt++; return json(task);
    }
    if (url.pathname.endsWith('/fork')) {
      forks.push(body()); if (failFork) return route.fulfill({ status: 503, json: { error: 'Fork request could not be sent.' } });
      if (forkGate) await forkGate;
      const created = { ...task, id: body().id, title: 'Forked chat', threadId: 'forked-thread', goal: null }; snapshot.tasks.push(created); return json(created);
    }
    if (url.pathname.endsWith('/collaboration')) { modes.push(body()); task.collaborationMode = body().mode; if (body().mode === 'default') task.pendingPlan = null; return json(task); }
    if (url.pathname.endsWith('/plan')) {
      decisions.push(body());
      if (failDecision) return route.fulfill({ status: 503, json: { error: 'Plan response could not be sent.' } });
      assert.equal(body().turnId, task.pendingPlan.turnId);
      if (['implement', 'dismiss'].includes(body().action)) task.collaborationMode = 'default';
      task.pendingPlan = null; return json({ ok: true });
    }
    if (url.pathname.startsWith('/api/requests/')) { answers.push(body()); if (failAnswer) return route.fulfill({ status: 503, json: { error: 'Answer could not be sent.' } }); snapshot.requests = []; return json({ ok: true }); }
    if (url.pathname.endsWith('/interrupt')) { pauses.push(body()); task.status = 'interrupted'; snapshot.requests = []; return json({ ok: true }); }
    if (url.pathname.endsWith('/messages')) { messages.push(body()); return json({ ok: true }); }
    if (url.pathname === '/api/tasks') { creates.push(body()); return route.fulfill({ status: 503, json: { error: 'Creation fixture captured.' } }); }
    unexpected.push(url.pathname); return route.fulfill({ status: 404, json: { error: 'Unexpected fixture route' } });
  });
  await page.goto(origin);
  const panel = page.locator('.activity-panel'), input = page.getByRole('textbox', { name: 'Instructions for Codex', exact: true });
  await expect(input).toBeVisible();
  await input.fill('Keep this. /plan'); await input.press('Enter');
  await expect.poll(() => modes.at(-1)?.mode).toBe('plan');
  await expectComposerText(input, 'Keep this. ');
  await expect(panel.getByRole('button', { name: 'Plan', exact: true })).toBeVisible();
  assert.equal(messages.length, 0);
  await page.reload(); await expect(panel.getByRole('button', { name: 'Plan', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect.poll(() => modes.at(-1)?.mode).toBe('default');
  skills = [{ id: 'plan-skill', name: 'plan', source: 'paper', description: 'Plan carefully.', content: 'Use this planning skill.', icon: 'sparkles' }];
  await page.reload(); await input.fill('Preserve wording. /plan'); await input.press('Enter');
  await expectComposerText(input, 'Preserve wording. ');
  await expect(page.getByRole('button', { name: 'Remove the plan skill', exact: true })).toBeVisible();
  assert.equal(modes.length, 2, 'plan skill takes precedence over changing collaboration mode');
  await page.getByRole('button', { name: 'Remove the plan skill', exact: true }).click(); skills = [];
  const planText = '# Proposed revision\n\n1. Read the manuscript.\n2. Keep the theorem unchanged.';
  async function completedPlan(turn = 'plan-1') {
    task.collaborationMode = 'plan'; task.status = 'interrupted'; task.pendingPlan = { turnId: turn, itemId: `plan-${turn}`, text: planText };
    entries.splice(0, entries.length, { id: task.pendingPlan.itemId, taskId: task.id, type: 'plan', text: planText, createdAt: 1, status: 'completed' });
    await page.reload(); await expect(page.getByRole('heading', { name: 'Implement this plan?', exact: true })).toBeVisible();
  }
  await completedPlan();
  await expect(input).toBeHidden();
  const planView = page.locator('.codex-native-plan');
  await planView.getByRole('button', { name: 'Expand plan', exact: true }).click();
  await expect(planView).toHaveAttribute('data-expanded', 'true');
  await planView.getByRole('button', { name: 'Open ↗', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan', exact: true });
  await dialog.getByRole('textbox', { name: 'Edit plan', exact: true }).fill('# Edited revision\nPreserve every equation.');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload(); await expect(planView).toContainText('Preserve every equation.');
  failDecision = true;
  await page.getByRole('radio', { name: 'Yes, implement this plan', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Plan response could not be sent.');
  const failed = decisions.at(-1); assert.equal(failed.action, 'implement'); assert.equal(failed.text, '# Edited revision\nPreserve every equation.'); assert.ok(failed.requestKey);
  failDecision = false; await page.getByRole('radio', { name: 'Yes, implement this plan', exact: true }).click();
  await expect(input).toBeVisible(); assert.equal(decisions.at(-1).requestKey, failed.requestKey); assert.equal(task.collaborationMode, 'default');
  await expectComposerText(input, 'Preserve wording. ');
  await completedPlan('feedback');
  let free = page.getByRole('textbox', { name: 'No, and tell ChatGPT what to do differently' });
  await free.fill('Add a validation step.');
  await free.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
  assert.equal(decisions.length, 2); await expectComposerText(free, 'Add a validation step.');
  await free.press('Enter'); await expect(input).toBeVisible(); assert.equal(decisions.at(-1).action, 'feedback'); assert.equal(decisions.at(-1).text, 'Add a validation step.'); assert.equal(task.collaborationMode, 'plan');
  await completedPlan('literal-option'); await page.getByRole('textbox', { name: 'No, and tell ChatGPT what to do differently' }).fill('Yes, implement this plan'); await page.getByRole('button', { name: 'Submit', exact: true }).click(); await expect(input).toBeVisible(); assert.equal(decisions.at(-1).action, 'feedback', 'freeform stays feedback even when its text equals the affirmative label');
  await completedPlan('skip'); await page.getByRole('button', { name: 'Skip', exact: true }).click(); await expect(input).toBeVisible(); assert.equal(task.collaborationMode, 'plan'); assert.equal(decisions.at(-1).action, 'skip');
  await completedPlan('escape'); await page.keyboard.press('Escape'); await expect(input).toBeVisible(); assert.equal(task.collaborationMode, 'default'); assert.equal(decisions.at(-1).action, 'dismiss');
  task.collaborationMode = 'plan'; task.status = 'waiting_input';
  const request = { id: 'question', taskId: task.id, method: 'item/tool/requestUserInput', createdAt: 1, params: { questions: [
    { id: 'scope', question: 'Which sections?', isOther: false, options: [{ label: 'Introduction (Recommended)', description: 'Keep it focused.' }, { label: 'All sections', description: 'Review everything.' }] },
    { id: 'style', question: 'Which style?', isOther: true, options: [{ label: 'Concise' }, { label: 'Detailed' }] },
  ] } };
  snapshot.requests = [request]; await page.reload();
  await expect(page.getByRole('heading', { name: 'Which sections?', exact: true })).toBeVisible();
  assert.equal(await page.locator('.codex-question-card').getByRole('textbox').count(), 0);
  await page.getByRole('radio', { name: 'All sections', exact: true }).click();
  await page.locator('.task-link').filter({ hasText: 'Other provider' }).click();
  await page.locator('.task-link').filter({ hasText: 'Plan the manuscript revision' }).click();
  await expect(page.getByRole('radio', { name: 'All sections', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Introduction (Recommended)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Which style?', exact: true })).toBeVisible(); assert.equal(answers.length, 0);
  await page.getByRole('button', { name: 'Previous question', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Introduction (Recommended)', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  free = page.getByRole('textbox', { name: 'No, and tell ChatGPT what to do differently' }); await free.fill('Explain the assumptions.');
  failAnswer = true; await free.press('Enter'); await expect(page.getByRole('alert')).toContainText('Answer could not be sent.');
  failAnswer = false; await free.press('Enter'); await expect(input).toBeVisible();
  assert.deepEqual(answers.at(-1), { answers: { scope: 'Introduction (Recommended)', style: 'Explain the assumptions.' }, skipped: [] });
  snapshot.requests = [{ ...request, id: 'skip-question' }]; await page.reload();
  await page.getByRole('button', { name: 'Skip', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Which style?', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Concise', exact: true }).click(); await expect(input).toBeVisible();
  assert.deepEqual(answers.at(-1), { answers: { scope: '', style: 'Concise' }, skipped: ['scope'] });
  snapshot.requests = [{ ...request, id: 'cancel-question' }]; await page.reload(); await expect(page.getByRole('heading', { name: 'Which sections?' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(input).toBeVisible(); assert.equal(pauses.length, 1); assert.equal(task.collaborationMode, 'plan');
  await completedPlan('mobile'); await page.setViewportSize({ width: 390, height: 844 });
  const chat = page.getByRole('group', { name: 'Workspace view', exact: true }).getByRole('button', { name: 'Chat', exact: true }); await expect(chat).toBeVisible(); await chat.click(); await expect(chat).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))); });
  await expect(page.locator('.codex-question-card')).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  fs.mkdirSync('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/codex-plan-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.screenshot({ path: 'test-results/codex-plan-desktop.png', fullPage: true, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: 'test-results/codex-plan-dark.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click(); await expect(input).toBeVisible();
  await panel.getByRole('button', { name: 'New chat', exact: true }).click();
  const newInput = page.getByRole('textbox', { name: 'Describe the revision', exact: true }); await newInput.fill('/plan'); await newInput.press('Enter');
  await newInput.fill('Plan the new task.'); await page.getByRole('button', { name: 'Start task', exact: true }).click();
  await expect.poll(() => creates.length).toBe(1); assert.equal(creates[0].collaborationMode, 'plan'); assert.equal(creates[0].instructions, 'Plan the new task.');
  // Host Goal routing: mode selection, revision-safe edits and reconciliation.
  runtime.goalAvailable = true; task.collaborationMode = 'plan'; task.pendingPlan = null; task.status = 'interrupted';
  await page.evaluate(() => localStorage.setItem('papilot:task', 'plan-task')); await page.reload();
  await input.fill('Keep pursuing this. /goal'); await input.press('Enter');
  await expect.poll(() => task.collaborationMode).toBe('default');
  await expectComposerText(input, 'Keep pursuing this. '); await expect(panel.locator('.codex-goal-mode')).toBeVisible();
  await panel.getByRole('button', { name: 'Send instructions', exact: true }).click();
  await expect.poll(() => goals.length).toBe(1); assert.equal(goals[0].objective, 'Keep pursuing this. '); assert.equal(goals[0].expectedRevision, 0); assert.equal(goals[0].appendTranscriptItem, true);
  await expectComposerText(input, ''); await expect(panel.getByText('Pursuing goal', { exact: true })).toBeVisible();
  await input.fill('/fork'); await expect(page.getByRole('option', { name: 'Fork chat', exact: true })).toHaveCount(0); await input.press('Escape'); await input.fill('');
  await panel.getByRole('button', { name: 'Pause goal', exact: true }).click();
  await expect(panel.getByText('Paused goal', { exact: true })).toBeVisible(); assert.deepEqual(Object.keys(goals.at(-1)).sort(), ['action', 'expectedRevision', 'requestKey']);
  await panel.getByRole('button', { name: 'Edit goal', exact: true }).click();
  const goalDialog = page.getByRole('dialog', { name: 'Edit goal', exact: true }), goalInput = goalDialog.getByRole('textbox', { name: 'Goal', exact: true });
  await goalInput.fill('Keep my unsaved edit.'); const editRevision = task.goalControl.revision;
  task.goal = { ...task.goal, objective: 'Changed elsewhere.' }; task.goalControl = { ...task.goalControl, revision: editRevision + 1 }; task.updatedAt++;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(panel.locator('.codex-goal-objective')).toContainText('Changed elsewhere.');
  await goalDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(goalDialog.getByRole('alert')).toContainText('The goal changed.'); await expect(goalInput).toHaveValue('Keep my unsaved edit.');
  assert.equal(goals.at(-1).expectedRevision, editRevision, 'editor keeps the revision that supplied its draft'); assert.equal(goals.at(-1).appendTranscriptItem, false); assert.equal(task.goal.objective, 'Changed elsewhere.');
  await goalDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await panel.getByRole('button', { name: 'Edit goal', exact: true }).click(); await goalInput.fill('Updated objective.');
  failGoal = true; await goalDialog.getByRole('button', { name: 'Save', exact: true }).click(); await expect(goalDialog.getByRole('alert')).toContainText('Goal request could not be sent.'); const failedGoal = goals.at(-1);
  failGoal = false; await goalDialog.getByRole('button', { name: 'Save', exact: true }).click(); await expect(goalDialog).toHaveCount(0); assert.equal(goals.at(-1).requestKey, failedGoal.requestKey); assert.equal(goals.at(-1).appendTranscriptItem, false);
  task.goalControl = { ...task.goalControl, sync: 'unknown', error: 'Goal state is unknown.' }; await page.reload();
  await expect(panel.getByRole('button', { name: 'Edit goal', exact: true })).toBeDisabled(); await expect(panel.getByRole('button', { name: 'Pause goal', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Check status', exact: true }).click(); await expect(panel.getByRole('button', { name: 'Pause goal', exact: true })).toBeEnabled();
  task.goalControl = { ...task.goalControl, sync: 'unknown', resumeRequired: true }; task.status = 'uncertain'; await page.reload();
  await expect(panel.getByRole('button', { name: 'Edit goal', exact: true })).toBeDisabled(); await expect(panel.getByRole('button', { name: 'Clear goal', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Resume goal', exact: true }).click(); await expect.poll(() => goals.at(-1).action).toBe('resume');
  await input.fill('/goal'); await input.press('Enter'); await input.fill('A replacement objective.'); await panel.getByRole('button', { name: 'Send instructions', exact: true }).click();
  const replacement = page.getByRole('dialog', { name: 'Replace current goal?', exact: true }); await expect(replacement).toBeVisible();
  const beforeCancel = goals.length; await replacement.getByRole('button', { name: 'Cancel', exact: true }).click(); assert.equal(goals.length, beforeCancel); await expectComposerText(input, 'A replacement objective.');
  await panel.getByRole('button', { name: 'Send instructions', exact: true }).click(); await replacement.getByRole('button', { name: 'Replace goal', exact: true }).click();
  await expect(replacement).toHaveCount(0); await expectComposerText(input, ''); assert.equal(goals.at(-1).objective, 'A replacement objective.');
  await page.screenshot({ path: 'test-results/codex-goal-host.png', fullPage: true, animations: 'disabled' });
  await panel.getByRole('button', { name: 'Clear goal', exact: true }).click(); await expect(panel.locator('.codex-goal')).toHaveCount(0);

  // Real endpoint families, exact review targets and stable retry identities.
  const reviewMenu = page.getByRole('dialog', { name: 'Code review', exact: true });
  await input.fill('Keep this draft. /review'); await expect(page.getByRole('option', { name: 'Code review', exact: true })).toHaveCount(0);
  failBranches = true; await input.fill('/review'); await input.press('Enter'); await expect(reviewMenu.getByRole('alert')).toContainText('Unable to load branches');
  failBranches = false; await reviewMenu.getByRole('button', { name: 'Retry', exact: true }).click(); await expect(reviewMenu.getByRole('option', { name: 'main', exact: true })).toBeEnabled();
  await expectComposerText(input, '/'); await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 }); assert.equal(reviews.length, 0);
  failReview = true; await reviewMenu.getByRole('option', { name: 'main', exact: true }).click(); await expect(reviewMenu.getByRole('alert')).toContainText('Review request could not be sent.'); const failedReview = reviews.at(-1);
  failReview = false; await reviewMenu.getByRole('option', { name: 'main', exact: true }).click(); await expectComposerText(input, '');
  assert.deepEqual(reviews.at(-1).target, { type: 'baseBranch', branch: 'refs/heads/main' }); assert.equal(reviews.at(-1).requestKey, failedReview.requestKey);
  task.status = 'interrupted'; await page.reload();
  await input.fill('/fork'); await input.press('Enter'); const forkMenu = page.getByRole('dialog', { name: 'Fork chat', exact: true });
  await expect(forkMenu.getByRole('option')).toHaveCount(1); await expect(forkMenu.getByRole('option')).toContainText('Fork chat'); await expect(forkMenu.getByRole('option')).toContainText('Fork this chat in a new worktree');
  await input.press('Escape'); await expect(forkMenu).toBeHidden(); await expectComposerText(input, '/');
  await input.fill('/fork'); await input.press('Enter'); failFork = true;
  await forkMenu.getByRole('option', { name: 'Fork chat', exact: true }).click(); await expect(forkMenu.getByRole('alert')).toContainText('Fork request could not be sent.'); const failedFork = forks.at(-1);
  failFork = false; await forkMenu.getByRole('option', { name: 'Fork chat', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('papilot:task'))).toBe(failedFork.id); assert.equal(forks.at(-1).id, failedFork.id); assert.deepEqual(Object.keys(forks.at(-1)), ['id']);
  await page.evaluate(() => localStorage.setItem('papilot:task', 'plan-task')); await page.reload(); await expectComposerText(input, '');
  await panel.getByRole('button', { name: 'New chat', exact: true }).click();
  await newInput.fill('/goal'); await newInput.press('Enter'); await expect(page.locator('.new-task-panel .codex-goal-mode')).toBeVisible(); await expect(page.locator('.new-task-panel').getByRole('button', { name: 'Plan', exact: true })).toHaveCount(0);
  await newInput.fill('Pursue this new objective.'); await page.getByRole('button', { name: 'Start task', exact: true }).click(); await expect.poll(() => creates.length).toBe(2);
  assert.deepEqual(creates.at(-1).goal, {}); assert.equal(creates.at(-1).collaborationMode, undefined); assert.equal(creates.at(-1).instructions, 'Pursue this new objective.');
  await page.locator('.new-task-panel .codex-goal-mode').click();
  await newInput.fill('/review'); await newInput.press('Enter'); await expect(reviewMenu.getByRole('option', { name: 'Review uncommitted changes', exact: true })).toBeEnabled();
  failReview = true; await reviewMenu.getByRole('option', { name: 'Review uncommitted changes', exact: true }).click(); await expect(reviewMenu.getByRole('alert')).toContainText('Review request could not be sent.'); const newReview = reviews.at(-1);
  failReview = false; await reviewMenu.getByRole('option', { name: 'Review uncommitted changes', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('papilot:task'))).toBe(newReview.id);
  assert.equal(reviews.at(-1).url, '/api/projects/paper/code-review'); assert.deepEqual(reviews.at(-1).target, { type: 'uncommittedChanges' }); assert.equal(reviews.at(-1).id, newReview.id); assert.equal(reviews.at(-1).model, 'model'); assert.equal(reviews.at(-1).effort, 'medium');

  // A late native action remains in history without taking navigation away
  // from the task the author selected while its HTTP reply was pending.
  const switchTask = id => page.locator(`[data-task="${id}"] .task-link`).click();
  await switchTask(task.id); await expect(input).toBeVisible();
  let releaseFork; forkGate = new Promise(resolve => { releaseFork = resolve; });
  await input.fill('/fork'); await input.press('Enter');
  const forkCount = forks.length;
  await forkMenu.getByRole('option', { name: 'Fork chat', exact: true }).click(); await expect.poll(() => forks.length).toBe(forkCount + 1);
  const delayedFork = forks.at(-1).id;
  await switchTask(other.id);
  const otherInput = page.locator('.activity-panel').getByRole('textbox');
  await otherInput.fill('Keep this other task draft.');
  const forkReply = page.waitForResponse(response => response.url().endsWith(`/tasks/${task.id}/fork`) && response.request().method() === 'POST');
  releaseFork(); await forkReply; forkGate = undefined;
  await expect(page.locator(`[data-task="${delayedFork}"] .task-link`)).toBeVisible();
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:task')), other.id);
  await expectComposerText(otherInput, 'Keep this other task draft.');

  await switchTask(task.id); await panel.getByRole('button', { name: 'New chat', exact: true }).click();
  let releaseReview; reviewGate = new Promise(resolve => { releaseReview = resolve; });
  await newInput.fill('/review'); await newInput.press('Enter');
  const reviewCount = reviews.length;
  await reviewMenu.getByRole('option', { name: 'Review uncommitted changes', exact: true }).click(); await expect.poll(() => reviews.length).toBe(reviewCount + 1);
  const delayedReview = reviews.at(-1).id;
  await switchTask(other.id); await expectComposerText(otherInput, 'Keep this other task draft.');
  const reviewReply = page.waitForResponse(response => response.url().endsWith('/projects/paper/code-review') && response.request().method() === 'POST');
  releaseReview(); await reviewReply; reviewGate = undefined;
  await expect(page.locator(`[data-task="${delayedReview}"] .task-link`)).toBeVisible();
  assert.equal(await page.evaluate(() => localStorage.getItem('papilot:task')), other.id);
  await expectComposerText(otherInput, 'Keep this other task draft.');

  assert.deepEqual(messages, []); assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log('PASS: native Plan mode, skill precedence, persisted edits, implementation retry, feedback, Skip/Escape, question wizard/IME, mobile/new-task payloads; Goal host revision/retry/reconcile; native Review/Fork endpoints and retry identities');
} finally { await browser?.close(); await server.close(); }
