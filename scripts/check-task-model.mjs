import { expectComposerText } from './composer-fixture.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { selectOption, selectedValue } from './select.mjs';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const task = { id: 'fixture-task', projectId: 'paper', agent: 'codex', name: 'p-task', title: 'Revise the introduction', instructions: 'Keep the meaning.', worktree: '/tmp/paper', threadId: 'thread', turnId: 'turn', model: null, effort: null, status: 'running', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
const runtime = { connected: true, authenticated: true, account: null, error: null, models: [
  { id: 'fast-model', name: 'Fast model', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  { id: 'deep-model', name: 'Deep model', isDefault: false, efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high', fastMode: { serviceTier: 'priority', description: 'Faster responses' } },
] };
const snapshot = { version: 'test', csrf: 'test', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper', createdAt: 1 }], tasks: [task], requests: [], runtime, runtimes: { codex: runtime, claude: { ...runtime, models: [{ id: 'opus', name: 'Opus', isDefault: true, efforts: ['low', 'high'], defaultEffort: 'high' }] } } };
const modelChanges = [], messages = [];
let modelFailure = false, holdModel, releaseModel;
await context.addInitScript(() => {
  localStorage.setItem('papilot:task', 'fixture-task');
  localStorage.setItem('papilot:recent-models', JSON.stringify([{ agent: 'claude', model: 'opus' }]));
});
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), json = data => route.fulfill({ json: data });
  if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
  if (url.pathname === '/api/state') return json(snapshot);
  if (url.pathname === '/api/note-alternatives') return route.fulfill({ json: { noteAlternatives: true, noteAlternativeRange: 'few' } });
  if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
  if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: 'test', phase: 'idle', canUpdate: false });
  if (url.pathname.endsWith('/skills')) return json({ skills: [] });
  if (url.pathname.endsWith('/items')) return json({ items: [] });
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  if (url.pathname.endsWith('/git')) return json({ files: [], branch: 'main', ahead: 0, behind: 0 });
  if (url.pathname.endsWith('/manuscript')) return json({ git: { files: [] }, annotations: [], build: { status: 'building', current: false } });
  if (url.pathname.endsWith('/model')) {
    const body = route.request().postDataJSON(); modelChanges.push(body);
    if (holdModel) await holdModel;
    if (modelFailure) return route.fulfill({ status: 503, json: { error: 'Model settings could not be saved.' } });
    Object.assign(task, body, { model: body.model || null, effort: body.effort || null });
    return json(task);
  }
  if (url.pathname.endsWith('/messages')) { messages.push(route.request().postDataJSON()); return json({ ok: true }); }
  throw new Error(`Unexpected fixture request: ${url.pathname}`);
});

try {
  await page.goto(origin);
  await page.getByRole('textbox', { name: 'Instructions for Codex' }).fill('Continue with these settings.');
  const taskSettings = page.locator('.activity-panel .codex-model-trigger');
  const taskModelMenu = page.locator('.codex-model-menu[data-open="true"]');
  const taskEffort = taskModelMenu.getByRole('slider', { name: 'Reasoning effort', exact: true });
  const openEffort = async () => { if (!await taskModelMenu.isVisible()) await taskSettings.click(); await expect(taskEffort).toBeVisible(); };
  const openModels = async () => { await openEffort(); await taskModelMenu.locator('.codex-effort-model').click(); };
  await expect(taskSettings).toContainText('Fast model');
  await expect(taskSettings).toContainText('Medium');
  await openModels();
  assert.ok((await taskModelMenu.getByRole('menuitemradio').allTextContents()).every(name => !/Opus/.test(name)), 'recent choices cannot switch the task agent');
  await taskModelMenu.getByRole('menuitemradio', { name: 'Deep model', exact: true }).click();
  await expect.poll(() => task.model).toBe('deep-model');
  await openEffort();
  await taskEffort.press('End');
  await expect.poll(() => task.effort).toBe('xhigh');
  await expect(taskSettings).toContainText('Extra High');
  await taskModelMenu.locator('.codex-effort-model').click();
  await taskModelMenu.getByRole('button', { name: /Fast mode/ }).click();
  await taskModelMenu.getByRole('menuitemradio', { name: 'Fast', exact: true }).click();
  await expect.poll(() => task.serviceTier).toBe('priority');
  await openModels();
  await taskModelMenu.getByRole('menuitemradio', { name: 'Fast model', exact: true }).click();
  await expect.poll(() => task.model).toBe('fast-model');
  await expect(taskSettings).toContainText('Medium');
  assert.equal(task.effort, 'medium', 'incompatible Extra High resets to the advertised model default');
  assert.equal(task.serviceTier, 'default');
  await page.reload();
  await expect(taskSettings).toContainText('Fast model');
  await openEffort();
  await expect(taskEffort).toHaveAttribute('aria-valuetext', 'Medium');
  runtime.models[0].isDefault = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(taskSettings, 'an existing task keeps its explicit selection when the host default is unknown').toContainText('Fast model');
  await taskModelMenu.locator('.codex-effort-model').click();
  await expect(taskModelMenu.getByRole('menuitemradio', { name: 'Default model', exact: true })).toHaveCount(0);
  await taskModelMenu.press('Escape');
  runtime.models[0].isDefault = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  // Rapid changes are saved in order; instructions wait for their settings.
  await openEffort();
  holdModel = new Promise(resolve => { releaseModel = resolve; });
  await taskEffort.press('End');
  await taskEffort.press('Home');
  await expect(taskSettings).toContainText('Light');
  await expect(page.getByRole('button', { name: 'Send instructions', exact: true })).toBeDisabled();
  releaseModel(); holdModel = null;
  await expect.poll(() => task.effort).toBe('low');
  modelFailure = true;
  await taskEffort.press('End');
  await page.getByText('Model settings could not be saved.', { exact: true }).waitFor();
  await expect(taskSettings).toContainText('Light');
  modelFailure = false;
  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/task-model-desktop.png' });
  await taskModelMenu.press('Escape');
  const draft = page.getByRole('textbox', { name: 'Instructions for Codex' });
  await draft.fill('Keep this draft. /model');
  await draft.press('Enter');
  await expect(taskModelMenu).toHaveAttribute('data-slash', 'true');
  await expectComposerText(draft, 'Keep this draft. /');
  await draft.fill('Keep this draft. /opus');
  await expect(taskModelMenu.getByRole('option')).toHaveCount(0);
  await draft.press('Enter');
  assert.equal(messages.length, 0, 'an unmatched submenu filter never sends as chat');
  await draft.press('Escape');
  await expect(taskModelMenu).not.toBeVisible();
  await expectComposerText(draft, 'Keep this draft. /opus');
  // Controlled draft updates and snapshot refreshes must not be replaced by
  // the slash prefix when the submenu filters or IME confirms composition.
  for (let attempt = 0; attempt < 6; attempt++) {
    await draft.fill('保留草稿 /model'); await draft.press('Enter');
    await draft.fill('保留草稿 /Deep');
    await expect(taskModelMenu.getByRole('option')).toHaveCount(1);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await draft.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
    await draft.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229 });
    await expectComposerText(draft, '保留草稿 /Deep');
    assert.equal(task.model, 'fast-model'); assert.equal(messages.length, 0);
    await draft.press('Escape'); await expect(taskModelMenu).not.toBeVisible();
    await expectComposerText(draft, '保留草稿 /Deep');
  }
  await draft.fill('Continue with these settings.');
  await page.getByRole('button', { name: 'Send instructions', exact: true }).click();
  assert.equal(messages.length, 1);
  assert.equal(task.status, 'running'); assert.equal(task.threadId, 'thread'); assert.equal(task.turnId, 'turn');
  assert.ok(modelChanges.every(change => !('agent' in change)));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await openEffort();
  const box = await taskModelMenu.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390);
  await page.screenshot({ path: 'test-results/task-model-mobile.png' });
  await taskModelMenu.press('Escape');
  Object.assign(runtime, { connected: false, authenticated: false, error: null });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const connection = page.locator('.composer-wrap > .agent-connection');
  await expect(connection).toHaveAttribute('data-state', 'connecting');
  await expect(connection.getByRole('status')).toContainText('Connecting to Codex');
  assert.equal(await connection.locator('.agent-connection-message > svg').count(), 0, 'Normal startup has no warning icon');
  assert.equal(await connection.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'Normal startup has no warning card background');
  await page.screenshot({ path: 'test-results/agent-connecting-mobile.png' });
  Object.assign(runtime, { error: 'Connection refused: The agent did not respond.' });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(connection).toHaveAttribute('data-state', 'error');
  await expect(connection.getByRole('button', { name: 'Reconnect', exact: true })).toBeEnabled();
  await connection.getByText('Connection details', { exact: true }).click();
  await expect(connection.getByText(runtime.error, { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/agent-connection-error-mobile.png' });
  Object.assign(runtime, { connected: true, authenticated: false, error: null });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(connection.getByRole('status')).toHaveText('Sign-in required');
  // A running agent that lost its sign-in offers Refresh, which loads the host's current one.
  await expect(connection.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await expect(connection.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0);
  Object.assign(runtime, { error: 'Codex sign-in expired. Select Refresh to load the current sign-in on the StudyBuddy host. If it is still signed out, run studybuddy codex login there first.' });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(connection.getByRole('status')).toHaveText('Codex sign-in expired');
  await expect(connection.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'test-results/agent-sign-in-expired-mobile.png' });
  Object.assign(runtime, { connected: true, authenticated: true, error: null });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(connection).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log('PASS: Task model and effort stay editable within the same agent, persist, serialize changes, recover from save failures and fit mobile');

  // Fresh browser: no saved model. The default resolved from host configuration
  // is the second model, not the first/catalog-recommended one.
  const fresh = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
  const composer = await fresh.newPage(), creates = [];
  composer.on('pageerror', error => errors.push(error.message));
  const defaults = structuredClone(snapshot);
  defaults.tasks = [];
  defaults.runtime.models[0].isDefault = false;
  defaults.runtime.models[1].isDefault = true;
  defaults.runtimes.codex = defaults.runtime;
  await composer.route('**/api/**', async route => {
    const url = new URL(route.request().url()), json = data => route.fulfill({ json: data });
    if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
    if (url.pathname === '/api/state') return json(defaults);
    if (url.pathname === '/api/note-alternatives') return route.fulfill({ json: { noteAlternatives: true, noteAlternativeRange: 'few' } });
    if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
    if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
    if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: 'test', phase: 'idle', canUpdate: false });
    if (url.pathname.endsWith('/skills')) return json({ skills: [] });
    if (url.pathname.endsWith('/manuscript')) return json({ git: { files: [] }, annotations: [], build: { status: 'building', current: false } });
    if (url.pathname === '/api/tasks' && route.request().method() === 'POST') {
      creates.push(route.request().postDataJSON());
      // Keep the draft open so settings can be exercised without running an agent.
      return route.fulfill({ status: 503, json: { error: 'Test submission captured.' } });
    }
    throw new Error(`Unexpected default-model request: ${url.pathname}`);
  });
  await composer.goto(origin);
  const modelName = composer.locator('.new-task-panel .codex-model-trigger > span:first-child');
  await expect(modelName).toHaveText('Deep model');
  const settings = composer.getByRole('dialog', { name: 'Settings', exact: true });
  const defaultModel = settings.getByRole('combobox', { name: 'Default model', exact: true });
  await composer.locator('.settings-link').click();
  assert.equal(await selectedValue(defaultModel), JSON.stringify(['codex', '']));
  await expect(defaultModel).toHaveText('Codex · Deep model · Default');
  await composer.keyboard.press('Escape');
  await composer.getByRole('textbox', { name: 'Describe the revision' }).fill('Revise the introduction.');
  const submit = async (model, agent = 'codex') => {
    const before = creates.length;
    await composer.getByRole('button', { name: 'Start task', exact: true }).click();
    await expect.poll(() => creates.length).toBe(before + 1);
    assert.equal(creates.at(-1).model, model);
    assert.equal(creates.at(-1).agent, agent);
    await expect(composer.getByRole('button', { name: 'Start task', exact: true })).toBeEnabled();
  };
  await submit('deep-model');
  // Explicit choices win; resetting to the default restores the resolved model.
  await composer.locator('.settings-link').click();
  await selectOption(defaultModel, JSON.stringify(['codex', 'fast-model']));
  await composer.keyboard.press('Escape');
  await expect(modelName).toHaveText('Fast model');
  await submit('fast-model');
  await composer.locator('.settings-link').click();
  await selectOption(defaultModel, JSON.stringify(['codex', '']));
  await expect(defaultModel).toHaveText('Codex · Deep model · Default');
  await composer.keyboard.press('Escape');
  await expect(modelName).toHaveText('Deep model');
  await submit('deep-model');
  // A failed config read leaves the default unknown; don't label either model.
  defaults.runtime.models[1].isDefault = false;
  await composer.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(modelName).toHaveText('Default model');
  await composer.locator('.new-task-panel .codex-model-trigger').click();
  const unknown = composer.locator('.codex-model-menu[data-open="true"]');
  await expect(unknown.getByRole('menuitemradio', { name: 'Default model · Codex', exact: true })).toHaveAttribute('aria-checked', 'true');
  await composer.keyboard.press('Escape');
  await composer.locator('.settings-link').click();
  await expect(defaultModel).toHaveText('Codex · Default model');
  await composer.keyboard.press('Escape');
  await submit('');
  // Every other agent uses the same resolution in Settings, the composer and
  // task creation, even when its default isn't the first catalog entry.
  for (const [agent, label, model, name] of [
    ['claude', 'Claude', 'haiku', 'Haiku'], ['cursor', 'Cursor', 'auto', 'Auto'],
    ['kimi', 'Kimi', 'kimi/k3', 'K3'], ['copilot', 'Copilot', 'copilot-model', 'Copilot model'],
    ['grok', 'Grok', 'grok-model', 'Grok model'], ['qwen', 'Qwen', 'qwen-model', 'Qwen model'],
    ['deepseek', 'DeepSeek', 'deepseek-model', 'DeepSeek model'], ['opencode', 'OpenCode', 'opencode-model', 'OpenCode model'],
    ['antigravity', 'Antigravity', 'gemini-model', 'Gemini model'], ['glm', 'GLM', 'glm-model', 'GLM model'],
  ]) {
    const alternate = `other-${agent}`;
    defaults.runtimes[agent] = { connected: true, authenticated: true, account: null, error: null, models: [
      { id: alternate, name: 'Other model', isDefault: false, efforts: agent === 'opencode' ? ['medium', 'high', 'max'] : [], defaultEffort: null },
      { id: model, name, isDefault: true, efforts: [], defaultEffort: null },
    ] };
    await composer.evaluate(() => window.dispatchEvent(new Event('online')));
    await composer.locator('.settings-link').click();
    await selectOption(defaultModel, JSON.stringify([agent, '']));
    await expect(defaultModel).toHaveText(`${label} · ${name} · Default`);
    await composer.keyboard.press('Escape');
    await expect(modelName).toHaveText(name);
    await submit(model, agent);
    await composer.locator('.settings-link').click();
    await selectOption(defaultModel, JSON.stringify([agent, alternate]));
    await composer.keyboard.press('Escape');
    await expect(modelName).toHaveText('Other model');
    if (agent === 'opencode') {
      await composer.locator('.new-task-panel .codex-model-trigger').click();
      const picker = composer.locator('.codex-model-menu[data-open="true"]');
      await picker.getByRole('slider', { name: 'Reasoning effort', exact: true }).press('End');
      await expect(picker.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Max');
      fs.mkdirSync('test-results', { recursive: true });
      await composer.screenshot({ path: 'test-results/opencode-effort.png' });
      await composer.keyboard.press('Escape');
      await composer.reload();
      await expect(modelName).toHaveText('Other model');
      await expect(composer.locator('.new-task-panel .codex-model-trigger')).toContainText('Max');
      await composer.getByRole('textbox', { name: 'Describe the revision' }).fill('Revise the introduction.');
    }
    await submit(alternate, agent);
    if (agent === 'opencode') assert.equal(creates.at(-1).effort, 'max', 'non-default OpenCode effort survives reload and task submission');
  }
  assert.deepEqual(errors, []);
  await fresh.close();
  console.log('PASS: Configured defaults agree across composer, Settings and submitted models; explicit choices, reset and unknown defaults remain consistent');
} finally {
  releaseModel?.();
  await browser.close(); await server.close();
}
