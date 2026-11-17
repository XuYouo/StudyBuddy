import { installFakeDictationDevices } from './dictation-fixture.mjs';
import { expectComposerText } from './composer-fixture.mjs';
// Exercise the integrated React surface against disposable HTTP fixtures. No agent starts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';

fs.mkdirSync('test-results', { recursive: true });
const reference = JSON.parse(fs.readFileSync('tests/fixtures/codex-chat-reference.json', 'utf8'));
const server = Fastify();
let browser;
try {
  await server.register(staticFiles, { root: path.resolve('dist') });
  await server.listen({ host: '127.0.0.1', port: 0 });
  const origin = `http://127.0.0.1:${server.server.address().port}`;
  browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ locale: 'en-US', colorScheme: 'light', viewport: { width: 1440, height: 900 } });
  context.setDefaultTimeout(15000);
  const page = await context.newPage(), errors = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  const task = { id: 'codex-chat-task', projectId: 'paper', agent: 'codex', name: 'p-chat', title: 'Explain the eigenvalue equation', instructions: 'Preserve the notation.', worktree: '/tmp/codex-chat-fixture', threadId: 'thread', turnId: null, model: null, effort: null, status: 'interrupted', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
  task.queue = { taskId: task.id, revision: 1, paused: null, messages: [], capabilities: { compact: true, steer: false } };
  task.context = { tokens: 6400, window: 128000, breakdown: [{ id: 'input', tokens: 6400 }, { id: 'free', tokens: 121600 }] };
  const other = { ...task, id: 'other-chat-task', agent: 'claude', title: 'Check the notation', threadId: 'other-thread', context: null, queue: { taskId: 'other-chat-task', revision: 1, paused: null, messages: [], capabilities: { compact: false, steer: false } } };
  const runtime = { connected: true, authenticated: true, account: null, error: null, models: [
    { id: 'fast', name: 'Fast model', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    { id: 'deep', name: 'Deep model', isDefault: false, efforts: ['low', 'high'], defaultEffort: 'high' },
  ] };
  const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Quantum mechanics', path: task.worktree, createdAt: 1 }], tasks: [task, other], requests: [], runtime, runtimes: { codex: runtime, claude: { ...runtime } } };
  const entries = [
    { id: 'question', type: 'user', text: 'Explain the eigenvalue equation step by step.\n请保留原题的符号。' },
    { id: 'command', type: 'command', text: 'cat notes.tex', detail: 'The Hamiltonian is Hermitian.', status: 'completed' },
    { id: 'response', type: 'assistant', text: 'An eigenstate satisfies $H\\psi = E\\psi$.\n\n1. Apply the operator to the state.\n2. Compare the result with the original state.\n\nThe scalar **E** is the energy eigenvalue.' },
  ].map((entry, index) => ({ ...entry, taskId: task.id, createdAt: index + 1 }));
  const messages = [], approvals = [], pauses = [], creates = [], queueWrites = [], compactions = [];
  const dictations = []; let dictationId = 0, holdDictation, releaseDictation;
  await context.addInitScript(installFakeDictationDevices);
  let failApproval = false, holdApproval, releaseApproval;
  let failQueue = false, holdQueue, releaseQueue;
  let failMessages = false, failHistory = false, holdHistory, releaseHistory;
  let mcpMode = 'ready', holdMcp, releaseMcp, mcpReads = 0;
  await context.addInitScript(() => localStorage.setItem('papilot:task', 'codex-chat-task'));
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url()), json = data => route.fulfill({ json: data });
    if (url.pathname === '/api/state') return json(snapshot);
    if (url.pathname === '/api/runtime/codex/dictation') return json({ available: true });
    if (url.pathname === '/api/runtime/codex/dictation/sessions') return json({ id: 'dictation-' + ++dictationId, maxBytes: 1000 });
    if (url.pathname.startsWith('/api/runtime/codex/dictation/sessions/')) {
      if (url.pathname.endsWith('/cancel')) return json({});
      dictations.push({ body: route.request().postData(), headers: route.request().headers() });
      if (holdDictation) await holdDictation;
      return json({ text: 'Explain the next step.' }).catch(() => {});
    }
    if (url.pathname.endsWith('/files')) return json({ files: [{ path: 'notes.tex', label: 'notes.tex', kind: 'file' }], more: false });

    if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
    if (url.pathname === '/api/runtime/codex/mcp') {
      mcpReads++;
      if (holdMcp) await holdMcp;
      if (mcpMode === 'error') return route.fulfill({ status: 503, json: { error: 'Unable to load MCP status' } });
      return json({ servers: mcpMode === 'empty' ? [] : [{ name: 'library', enabled: true, authStatus: 'oAuth' }, { name: 'research', enabled: false, authStatus: 'notLoggedIn' }] });
    }
    if (url.pathname === '/api/note-alternatives') return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
    if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
    if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
    if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: 'test', phase: 'idle', canUpdate: false });
    if (url.pathname.endsWith('/skills')) return json({ skills: [] });
    if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
    if (url.pathname.endsWith('/git')) return json({ files: [], branch: 'main', ahead: 0, behind: 0 });
    if (url.pathname.endsWith('/manuscript')) return json({ git: { files: [] }, annotations: [], build: { status: 'idle', current: false } });
    if (url.pathname.endsWith('/items')) {
      if (holdHistory) await holdHistory;
      if (failHistory) return route.fulfill({ status: 503, json: { error: 'Conversation temporarily unavailable.' } });
      return json({ items: url.pathname.includes(other.id) ? [] : entries });
    }
    if (url.pathname === '/api/tasks' && route.request().method() === 'POST') {
      creates.push(route.request().postDataJSON());
      return route.fulfill({ status: 503, json: { error: 'Unexpected task creation captured.' } });
    }
    if (url.pathname.endsWith('/messages')) {
      messages.push({ taskId: url.pathname.split('/')[3], ...route.request().postDataJSON() });
      if (failMessages) return route.fulfill({ status: 503, json: { error: 'Message could not be sent.' } });
      return json({ ok: true });
    }
    if (url.pathname.endsWith('/compact/check')) { task.compaction.state = 'completed'; task.compaction.turnFinished = true; return json({ compaction: task.compaction }); }
    if (url.pathname.endsWith('/compact')) { compactions.push(route.request().postDataJSON()); task.compaction = { id: 'compact-1', state: 'pending', requestedAt: Date.now() }; return json({ accepted: true, ...task.compaction }); }
    if (url.pathname.includes('/queue/')) {
      const body = route.request().postDataJSON(), routePath = url.pathname.split('/queue/')[1];
      queueWrites.push({ route: routePath, ...body });
      if (holdQueue) await holdQueue;
      if (failQueue) return route.fulfill({ status: 503, json: { error: 'Queue update failed.' } });
      const [id, operation] = routePath.split('/'), row = task.queue.messages.find(message => message.id === id);
      if (operation === 'steer') { row.status = 'unconfirmed'; row.error = 'Delivery needs a check.'; task.queue.paused = 'unconfirmed'; task.queue.revision++; return route.fulfill({ status: 503, json: { error: 'Delivery needs a check.' } }); }
      if (operation === 'check') { task.queue.messages = task.queue.messages.filter(message => message.id !== id); task.queue.paused = null; }
      else if (routePath === 'resume') task.queue.paused = null;
      else if (operation === 'remove') task.queue.messages = task.queue.messages.filter(message => message.id !== id);
      else if (operation === 'edit' && row) {
        if (body.action === 'begin') { row.status = 'editing'; row.editLease = 'lease-' + row.id; }
        else { assert.equal(body.lease, row.editLease); if (body.action === 'save') row.text = body.text; row.status = 'queued'; delete row.editLease; }
      }
      task.queue.revision++; return json(task.queue);
    }
    if (url.pathname.endsWith('/model')) { Object.assign(task, route.request().postDataJSON()); return json(task); }
    if (url.pathname.endsWith('/interrupt')) { pauses.push(url.pathname.split('/')[3]); task.status = 'interrupted'; return json({ ok: true }); }
    if (url.pathname.startsWith('/api/requests/')) {
      approvals.push({ requestId: url.pathname.split('/').at(-1), ...route.request().postDataJSON() });
      if (holdApproval) await holdApproval;
      if (failApproval) return route.fulfill({ status: 503, json: { error: 'Approval could not be sent.' } });
      snapshot.requests = snapshot.requests.filter(request => request.id !== url.pathname.split('/').at(-1));
      return json({ ok: true });
    }
    unexpected.push(url.pathname);
    return route.fulfill({ status: 404, json: { error: `Unexpected fixture request: ${url.pathname}` } });
  });
  const refresh = () => page.evaluate(() => window.dispatchEvent(new Event('online')));
  const panel = page.locator('.codex-chat-panel');
  const input = page.getByRole('textbox', { name: 'Instructions for Codex', exact: true });
  const send = page.getByRole('button', { name: 'Send instructions', exact: true });
  const capture = name => page.screenshot({ path: `test-results/codex-chat-${name}.png`, animations: 'disabled' });
  const fits = async () => {
    await expect(panel).toBeVisible();
    await expect(input).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page fits viewport');
    const box = await panel.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= (page.viewportSize().width + 1), 'chat fits viewport');
    const area = await input.boundingBox();
    assert.ok(area && area.x >= box.x && area.x + area.width <= box.x + box.width + 1, 'composer stays inside chat');
  };

  holdHistory = new Promise(resolve => { releaseHistory = resolve; });
  await page.goto(origin);
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Loading conversation…', { exact: true })).toBeVisible();
  releaseHistory(); holdHistory = null;
  await expect(panel.locator('.message.assistant')).toContainText('energy eigenvalue');
  // These values are frozen measurements of the official extension, not values
  // derived from StudyBuddy's CSS. Interaction checks below complement them.
  const geometry = await panel.evaluate(element => {
    const style = selector => getComputedStyle(element.querySelector(selector));
    const bubble = style('.message.user .message-body'), editor = style('.codex-composer .composer-input');
    return { paneBackground: getComputedStyle(element).backgroundColor, fontSize: bubble.fontSize, messageLineHeight: bubble.lineHeight,
      bubbleRadius: bubble.borderTopLeftRadius, bubblePadding: bubble.padding, composerRadius: style('.codex-composer').borderTopLeftRadius,
      composerEmptyHeight: element.querySelector('.codex-composer').getBoundingClientRect().height, editorLineHeight: editor.lineHeight, editorMinHeight: editor.minHeight,
      navigationHeight: element.querySelector('.codex-navigation').getBoundingClientRect().height, footerButtonSize: element.querySelector('.send-button').getBoundingClientRect().height };
  });
  for (const [key, value] of Object.entries(geometry)) assert.equal(value, reference[key], `official measured ${key}`);
  await panel.locator('.tool-item > summary').click();
  await expect(panel.locator('.tool-item pre')).toHaveText('The Hamiltonian is Hermitian.');
  await fits();
  await capture('desktop-light');

  // Genuine footer behavior: effort slider -> model link -> plain model menu.
  const settings = panel.getByRole('button', { name: 'Models', exact: true });
  const menu = page.locator('.codex-model-menu[data-open="true"]');
  await settings.click();
  await expect(menu.getByRole('slider', { name: 'Reasoning effort', exact: true })).toBeVisible();
  await menu.locator('.codex-effort-model').click();
  await expect(menu).toHaveAttribute('role', 'menu');
  assert.equal((await menu.boundingBox()).width, reference.modelMenuWidth);
  assert.equal(await menu.evaluate(element => getComputedStyle(element).borderTopLeftRadius), reference.modelMenuRadius);
  await menu.getByRole('menuitemradio', { name: 'Deep model', exact: true }).click();
  await expect.poll(() => task.model).toBe('deep');
  await expect(menu).toHaveCount(0);
  await expect(settings).toContainText('Deep model');

  // Official slash submenus retain `/`, filter in the editor, and close on a
  // single Escape. A command never reaches the real task message endpoint.
  const commands = panel.locator('.codex-command-menu');
  await input.fill('Keep this draft. /model');
  await expect(commands.getByRole('option')).toHaveCount(1);
  await input.press('Enter');
  await expect(menu).toBeVisible();
  await expectComposerText(input, 'Keep this draft. /');
  await expect(input).toBeFocused();
  assert.equal(messages.length, 0);
  await input.press('Escape');
  await expect(menu).toHaveCount(0);
  await expectComposerText(input, 'Keep this draft. /');
  await input.fill('/model'); await input.press('Tab');
  await expect(menu).toBeVisible();
  await input.fill('/Fast');
  await expect(menu.getByRole('option')).toHaveCount(1);
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229 });
  assert.equal(task.model, 'deep');
  await expectComposerText(input, '/Fast');
  await input.press('Enter');
  await expect.poll(() => task.model).toBe('fast');
  await expectComposerText(input, '');
  await input.fill('/reasoning'); await input.press('Enter');
  await expect(menu.getByRole('option', { name: 'Light', exact: true })).toBeVisible();
  await menu.getByRole('option', { name: 'High', exact: true }).click();
  await expect.poll(() => task.effort).toBe('high');
  await expectComposerText(input, '');
  await input.fill('/status'); await send.click();
  await expect(panel.getByRole('region', { name: 'Status', exact: true })).toBeVisible();
  await expectComposerText(input, '');
  assert.equal(messages.length, 0);
  await input.press('Escape');
  await expect(panel.getByRole('region', { name: 'Status', exact: true })).toBeVisible();
  await panel.getByRole('region', { name: 'Status', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await input.fill('/');
  await expect(commands.getByRole('option')).toHaveCount(9);
  await input.press('Escape');
  await expect(commands).toHaveCount(0);
  await expectComposerText(input, '/');
  await input.fill('https://example.com/model');
  await expect(commands).toHaveCount(0);

  // MCP is a read-only, editor-filtered submenu, loaded only when opened.
  assert.equal(mcpReads, 0);
  holdMcp = new Promise(resolve => { releaseMcp = resolve; });
  await input.fill('Keep this. /mcp'); await input.press('Enter');
  await expectComposerText(input, 'Keep this. /');
  await expect(commands.getByRole('status')).toHaveText('Loading MCP status…');
  releaseMcp(); holdMcp = null;
  await expect(commands.getByRole('option')).toHaveCount(2);
  await expect(commands.getByRole('option').first()).toContainText('Authenticated (OAuth)');
  await input.fill('Keep this. /research');
  await expect(commands.getByRole('option')).toHaveCount(1);
  await expect(commands.getByRole('option')).toHaveAttribute('aria-disabled', 'true');
  await input.press('Enter');
  await expectComposerText(input, 'Keep this. /research');
  assert.equal(messages.length, 0);
  await input.press('Escape'); await expect(commands).toHaveCount(0);
  await expectComposerText(input, 'Keep this. /research');
  mcpMode = 'error';
  await input.fill('/mcp'); await input.press('Enter');
  await expect(commands.getByRole('status')).toHaveText('Unable to load MCP status');
  await input.press('Escape');
  mcpMode = 'empty';
  await input.fill('/mcp'); await input.press('Enter');
  await expect(commands.getByRole('status')).toHaveText('No MCP servers configured');
  await input.press('Escape');

  // Fast is available only when the selected Codex model advertises its tier.
  runtime.models[0].fastMode = { serviceTier: 'priority' };
  await refresh();
  await input.fill('Before /fast after');
  for (let index = 0; index < 6; index++) await input.press('ArrowLeft');
  await expect(commands.getByRole('option', { name: 'Fast', exact: true })).toBeVisible();
  await input.press('Enter');
  await expect.poll(() => task.serviceTier).toBe('priority');
  await expectComposerText(input, 'Before  after');
  await input.fill('Keep the draft. /fast'); await input.press('Enter');
  await expect.poll(() => task.serviceTier).toBe('default');
  await expectComposerText(input, 'Keep the draft. ');
  assert.equal(messages.length, 0, 'Fast changes the model configuration without sending a chat message');
  delete runtime.models[0].fastMode; await refresh();
  await input.fill('/fast'); await expect(commands.getByRole('option', { name: 'Fast', exact: true })).toHaveCount(0);
  await input.press('Escape');

  // Composition confirmation never sends; Shift+Enter remains a line break.
  await input.fill('中文输入');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229 });
  assert.equal(messages.length, 0);
  await expectComposerText(input, '中文输入');
  await input.press('End'); await input.press('Shift+Enter'); await input.press('a');
  await expectComposerText(input, '中文输入\na');
  failMessages = true;
  await send.click();
  await expect(page.getByText('Message could not be sent.', { exact: true })).toBeVisible();
  await expectComposerText(input, '中文输入\na');
  await capture('send-error');
  failMessages = false;
  await send.click();
  await expectComposerText(input, '');
  assert.equal(messages.at(-1).text, '中文输入\na');
  assert.equal(messages.at(-1).taskId, task.id);
  assert.ok(messages[0].requestKey);
  assert.equal(messages[0].requestKey, messages[1].requestKey, 'retry keeps its idempotency key');
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await input.fill('/model');
  await input.press('Escape');
  await input.press('Enter');
  await expectComposerText(input, '');
  assert.equal(messages.at(-1).text, '/model', 'Escape allows a command to be sent as literal text');

  // Switching to another provider keeps drafts attached to the task, not the UI.
  await input.fill('Unsent Codex draft');
  await page.locator(`[data-task="${other.id}"] .task-link`).click();
  const otherInput = page.getByRole('textbox', { name: 'Instructions for Claude', exact: true });
  await expectComposerText(otherInput, '');
  await otherInput.fill('/');
  await expect(commands.getByRole('option')).toHaveCount(4);
  await expect(commands.getByRole('option', { name: 'Sketch', exact: true })).toHaveCount(1);
  for (const native of ['Goal', 'Plan', 'Review', 'Fork']) await expect(commands.getByRole('option', { name: native, exact: true })).toHaveCount(0);
  await otherInput.fill('Unsent Claude draft');
  await page.locator(`[data-task="${task.id}"] .task-link`).click();
  await expectComposerText(input, 'Unsent Codex draft');

  task.status = 'running';
  await refresh();
  await expect(input).toHaveAttribute('aria-placeholder', 'Queue instructions for the next turn…');
  await send.click();
  await expectComposerText(input, '');
  assert.equal(messages.at(-1).text, 'Unsent Codex draft');
  await expect(panel.getByRole('button', { name: 'Pause task', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Pause task', exact: true }).click();
  await expect.poll(() => pauses).toEqual([task.id]);

  const once = { id: 'accept', kind: 'once' }, session = { id: 'acceptForSession', kind: 'session' }, decline = { id: 'decline', kind: 'decline' };
  const approval = { id: 'approval', taskId: task.id, method: 'item/commandExecution/requestApproval', params: { command: 'cat notes.tex', reason: 'Read the course notes.' }, approvalChoices: [once, session, { id: 'rule:2', kind: 'rule', detail: 'cat notes.tex' }, decline], createdAt: 5 };
  snapshot.requests = [approval];
  task.status = 'waiting_input'; await refresh();
  const approvalCard = panel.locator('.codex-approval');
  await expect(approvalCard.getByRole('heading', { name: 'Read the course notes.' })).toBeVisible();
  await expect(input).toHaveCount(0);
  await approvalCard.getByRole('button', { name: 'Approval options', exact: true }).click();
  const approvalMenu = page.getByRole('menu', { name: 'Approval options', exact: true });
  await expect(approvalMenu.getByRole('menuitem')).toHaveCount(2);
  await expect(approvalMenu.getByRole('menuitem', { name: 'Allow this conversation', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(approvalMenu).toBeHidden();
  assert.equal(approvals.length, 0, 'Escape closes an approval menu without denying the action');
  await expect(approvalCard.getByRole('button', { name: 'Approval options', exact: true })).toBeFocused();
  await approvalCard.getByRole('button', { name: 'Approval options', exact: true }).click();
  await approvalMenu.getByRole('menuitem', { name: 'Allow similar commands', exact: true }).click();
  await expect.poll(() => approvals.length).toBe(1);
  assert.deepEqual(approvals[0], { requestId: 'approval', choice: 'rule:2' });
  await expect(panel.locator('.request-card')).toHaveCount(0);
  await expect(input).toBeVisible();

  // IME and menu shortcuts cannot grant permission. A failed response remains retryable.
  snapshot.requests = [{ ...approval, id: 'approval-retry', approvalChoices: [once, decline], params: { ...approval.params, command: Array.from({ length: 8 }, (_, index) => `printf 'line ${index}'`).join('\n') } }];
  await refresh();
  await expect(approvalCard.getByRole('button', { name: 'Expand', exact: true })).toBeVisible();
  await approvalCard.getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(approvalCard.locator('.approval-command pre')).toHaveAttribute('data-expanded', 'true');
  await approvalCard.getByRole('button', { name: 'Collapse', exact: true }).click();
  await page.evaluate(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true })); });
  assert.equal(approvals.length, 1);
  failApproval = true;
  await approvalCard.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(approvalCard.getByRole('alert').filter({ hasText: 'Approval could not be sent.' })).toBeVisible();
  failApproval = false;
  holdApproval = new Promise(resolve => { releaseApproval = resolve; });
  await approvalCard.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(approvalCard.getByRole('button', { name: 'Submitting…', exact: true })).toBeDisabled();
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await expect.poll(() => approvals.length).toBe(3);
  releaseApproval(); holdApproval = undefined;
  await expect(approvalCard).toHaveCount(0);
  assert.deepEqual(approvals.at(-1), { requestId: 'approval-retry', choice: 'accept' });

  snapshot.requests = [{ ...approval, id: 'approval-deny', approvalChoices: [once, decline] }];
  await refresh(); await expect(approvalCard).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(approvalCard).toHaveCount(0);
  assert.deepEqual(approvals.at(-1), { requestId: 'approval-deny', choice: 'decline' });

  entries.push({ id: `${task.id}:approval-turn:file-preview`, taskId: task.id, type: 'files', text: '/tmp/codex-chat-fixture/notes.tex', status: 'inProgress', createdAt: 6, changes: [{ path: 'notes.tex', added: 1, removed: 1, diff: '@@ -1 +1 @@\n-old notation\n+new notation' }] });
  snapshot.requests = [{ ...approval, id: 'approval-files', method: 'item/fileChange/requestApproval', params: { itemId: 'file-preview' }, approvalChoices: [once, session, decline] }];
  await refresh(); await expect(approvalCard.locator('.approval-files summary')).toContainText('notes.tex');
  await approvalCard.locator('.approval-files summary').click();
  await expect(approvalCard.locator('.file-diff')).toContainText('+new notation');
  await approvalCard.getByRole('button', { name: 'Approval options', exact: true }).click();
  await approvalMenu.getByRole('menuitem', { name: 'Allow all edits', exact: true }).click();
  await expect(approvalCard).toHaveCount(0);
  assert.deepEqual(approvals.at(-1), { requestId: 'approval-files', choice: 'acceptForSession' });

  snapshot.requests = [{ ...approval, id: 'approval-permissions', method: 'item/permissions/requestApproval', params: { permissions: { network: { enabled: true } }, reason: 'Fetch the reference paper.' }, approvalChoices: [once, session, decline] }];
  await refresh(); await expect(approvalCard).toContainText('Allow Codex to connect to the internet?');
  await capture('approval-permissions-light');
  const originalChatWidth = await page.locator('.task-grid').evaluate(element => { const width = element.style.getPropertyValue('--chat-width'); element.style.setProperty('--chat-width', '538px'); return width; });
  await expect.poll(async () => Math.round((await approvalCard.boundingBox()).width)).toBe(521);
  assert.equal(await approvalCard.evaluate(element => getComputedStyle(element).borderTopLeftRadius), '25px');
  await approvalCard.screenshot({ path: 'test-results/codex-chat-approval-permissions-537-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await approvalCard.screenshot({ path: 'test-results/codex-chat-approval-permissions-537-dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('group', { name: 'Workspace view', exact: true }).getByRole('button', { name: 'Chat (reply needed)', exact: true }).click();
  await expect(approvalCard).toBeVisible();
  const mobileApprovalBox = await approvalCard.boundingBox();
  assert.ok(mobileApprovalBox.x >= 0 && mobileApprovalBox.x + mobileApprovalBox.width <= 391);
  await capture('approval-mobile-dark');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.task-grid').evaluate((element, width) => { if (width) element.style.setProperty('--chat-width', width); else element.style.removeProperty('--chat-width'); }, originalChatWidth);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await approvalCard.getByRole('button', { name: 'Approval options', exact: true }).click();
  await approvalMenu.getByRole('menuitem', { name: 'Allow this conversation', exact: true }).click();
  await expect(approvalCard).toHaveCount(0);
  assert.deepEqual(approvals.at(-1), { requestId: 'approval-permissions', choice: 'acceptForSession' });

  // Permissions describe requested paths and combine overlapping read/write grants.
  const permissionEntries = [{ path: { type: 'path', path: '/tmp/course notes' }, access: 'read' }, { path: { type: 'path', path: '/tmp/course notes' }, access: 'write' }];
  snapshot.requests = [{ ...approval, id: 'approval-filesystem', method: 'item/permissions/requestApproval', params: { permissions: { fileSystem: { entries: permissionEntries } } }, approvalChoices: [once, session, decline] }];
  await refresh();
  await expect(approvalCard.getByRole('heading')).toHaveText('Allow Codex to view and edit the contents of /tmp/course notes?');
  snapshot.requests[0].params.permissions.network = { enabled: true };
  snapshot.requests[0].params.permissions.fileSystem.entries.push({ path: { type: 'glob_pattern', pattern: '/tmp/references/*.pdf' }, access: 'read' });
  await refresh();
  await expect(approvalCard.getByRole('heading')).toHaveText('Allow Codex to connect to the internet, view and edit the contents of /tmp/course notes, and view the contents of /tmp/references/*.pdf?');
  await capture('approval-filesystem-light');
  await approvalCard.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(approvalCard).toHaveCount(0);

  snapshot.requests = [{ ...approval, id: 'approval-network-rule', params: { networkApprovalContext: { host: 'papers.example.test', protocol: 'https' } }, approvalChoices: [once, session, { id: 'network:3', kind: 'network', detail: 'papers.example.test', networkAction: 'allow' }, decline] }];
  await refresh(); await approvalCard.getByRole('button', { name: 'Always allow', exact: true }).click();
  await expect(approvalCard).toHaveCount(0);
  assert.deepEqual(approvals.at(-1), { requestId: 'approval-network-rule', choice: 'network:3' });

  // Generic providers can have several pending cards; they never share a global approval shortcut.
  snapshot.requests = ['generic-1', 'generic-2'].map(id => ({ ...approval, id, taskId: other.id, approvalChoices: [once, decline] }));
  await page.locator(`[data-task="${other.id}"] .task-link`).click();
  await expect(approvalCard).toHaveCount(2);
  const genericCount = approvals.length;
  await page.evaluate(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  assert.equal(approvals.length, genericCount);
  await approvalCard.first().getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(approvalCard).toHaveCount(1);
  assert.deepEqual(approvals.at(-1), { requestId: 'generic-1', choice: 'accept' });
  await approvalCard.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(approvalCard).toHaveCount(0);
  await page.locator(`[data-task="${task.id}"] .task-link`).click();

  // Explicit empty options must not manufacture approval buttons.
  snapshot.requests = [{ ...approval, id: 'approval-no-options', approvalChoices: [] }];
  await refresh(); await expect(approvalCard).toBeVisible();
  await expect(approvalCard.getByRole('button', { name: 'Allow once', exact: true })).toHaveCount(0);
  const approvalCount = approvals.length;
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  assert.equal(approvals.length, approvalCount);
  snapshot.requests = [];
  task.status = 'interrupted'; await refresh();

  // Queue editing uses one lease and restores the original draft on save.
  task.status = 'running';
  task.queue.messages = [{ id: 'queued-1', text: 'Check captions.', status: 'queued', editable: true }, { id: 'queued-2', text: 'Keep notation.', status: 'queued', editable: true }];
  await refresh();
  await expect(panel.locator('.codex-queue-list > li')).toHaveCount(2);
  // An edit-begin response after changing task cancels its orphan lease.
  holdQueue = new Promise(resolve => { releaseQueue = resolve; });
  await panel.getByRole('button', { name: 'Queued message actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Edit message', exact: true }).click();
  await expect.poll(() => queueWrites.length).toBe(1);
  await page.locator(`[data-task="${other.id}"] .task-link`).click();
  await expect(otherInput).toBeVisible();
  releaseQueue(); holdQueue = null;
  await expect.poll(() => queueWrites.filter(write => write.action === 'cancel').length).toBe(1);
  assert.equal(task.queue.messages[0].status, 'queued');
  await page.locator(`[data-task="${task.id}"] .task-link`).click();
  await input.fill('Original composer draft');
  await panel.getByRole('button', { name: 'Queued message actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Edit message', exact: true }).click();
  await expectComposerText(input, 'Check captions.');
  await input.fill('Check all figure captions.');
  failQueue = true;
  await panel.getByRole('button', { name: 'Save queued message', exact: true }).click();
  await expect(page.getByText('Queue update failed.', { exact: true })).toBeVisible();
  await expectComposerText(input, 'Check all figure captions.');
  failQueue = false;
  await panel.getByRole('button', { name: 'Save queued message', exact: true }).click();
  await expectComposerText(input, 'Original composer draft');
  assert.equal(task.queue.messages[0].text, 'Check all figure captions.');
  const pausesBeforeEdit = pauses.length;
  await panel.getByRole('button', { name: 'Queued message actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Edit message', exact: true }).click();
  await expectComposerText(input, 'Check all figure captions.');
  await input.press('Escape');
  await expectComposerText(input, 'Original composer draft');
  assert.equal(pauses.length, pausesBeforeEdit, 'Escape cancels the queue edit without stopping the native turn');
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await panel.getByRole('button', { name: 'Queued message actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Edit message', exact: true }).click();
  await input.fill('Unsent queue edit');
  // Recovery after server restart releases edit leases; both drafts survive.
  task.queue.messages[0].status = 'queued'; delete task.queue.messages[0].editLease; task.queue.revision++;
  await refresh();
  await expect(panel.getByText('This queued message is no longer editable. Your draft is kept.')).toBeVisible();
  await panel.getByRole('button', { name: 'Restore previous draft', exact: true }).click();
  await expectComposerText(input, 'Original composer draft');
  await panel.getByRole('button', { name: 'Swap drafts', exact: true }).click();
  await expectComposerText(input, 'Unsent queue edit');
  await panel.getByRole('button', { name: 'Remove queued message', exact: true }).last().click();
  await expect(panel.locator('.codex-queue-list > li')).toHaveCount(1);
  task.queue.paused = 'interrupted'; task.queue.revision++; task.status = 'interrupted'; await refresh();
  await panel.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(() => task.queue.paused).toBe(null);
  task.queue.capabilities.steer = true;
  task.queue.messages = [{ id: 'queued-steer', text: 'Please focus on the figure captions.', status: 'queued', editable: true, steerable: true }];
  task.status = 'running'; task.queue.revision++; await refresh();
  const messagesBeforeSteer = messages.length;
  await panel.getByRole('button', { name: 'Steer', exact: true }).click();
  await expect(panel.locator('[data-queue-id="queued-steer"]')).toHaveAttribute('data-status', 'unconfirmed');
  await expect(panel.getByRole('button', { name: 'Remove queued message', exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Resume', exact: true })).toBeDisabled();
  await capture('unconfirmed-steer');
  await panel.locator('[data-queue-id="queued-steer"]').getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(panel.locator('.codex-queue-list > li')).toHaveCount(0);
  assert.equal(messages.length, messagesBeforeSteer, 'steer does not create a second queued prompt');
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  task.status = 'interrupted'; task.queue.revision++; await refresh();
  await input.fill('/compact');
  await expect(commands.getByRole('option', { name: 'Compact context', exact: true })).toBeVisible();
  await input.press('Enter');
  await expect(panel.getByText('Compacting context…', { exact: true })).toBeVisible();
  assert.equal(compactions.length, 1);
  await expect(panel.getByText('Context compacted', { exact: true })).toHaveCount(0);
  task.compaction.state = 'unknown'; await refresh();
  await panel.locator('.codex-compaction').getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(panel.getByText('Context compacted', { exact: true })).toBeVisible();

  // Header history uses real tasks and preserves each task's unsent draft.
  await input.fill('Keep this draft while browsing history.');
  const historyTrigger = panel.getByRole('button', { name: 'History', exact: true });
  const history = page.getByRole('dialog', { name: 'History', exact: true });
  const historySearch = history.getByRole('searchbox', { name: 'Search recent chats', exact: true });
  await historyTrigger.click();
  await expect(historySearch).toBeFocused();
  await historySearch.fill('Check the notation');
  await expect(history.locator('.codex-history-item')).toHaveCount(1);
  await historySearch.press('ArrowDown');
  await expect(history.locator('.codex-history-item')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(history).toBeHidden();
  await expect(historyTrigger).toBeFocused();
  await historyTrigger.click();
  await historySearch.fill('Check the notation');
  await history.locator('.codex-history-item').click();
  await expect(history).toBeHidden();
  await expectComposerText(otherInput, 'Unsent Claude draft');
  await historyTrigger.click();
  await historySearch.fill('Explain the eigenvalue equation');
  await history.locator('.codex-history-item').click();
  await expectComposerText(input, 'Keep this draft while browsing history.');
  await historyTrigger.click();
  await input.click();
  await expect(history).toBeHidden();
  await panel.locator('.codex-navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menu', { name: 'Settings', exact: true }).getByRole('menuitem', { name: 'Keyboard shortcuts', exact: true }).click();
  const shortcuts = page.getByRole('dialog').filter({ hasText: 'Keyboard shortcuts' });
  await expect(shortcuts).toBeVisible();
  await shortcuts.getByRole('button', { name: 'Close', exact: true }).click();
  await expectComposerText(input, 'Keep this draft while browsing history.');

  // New chats use the same genuine submenu interaction and a separate draft.
  const messagesBeforeNewTask = messages.length;
  await panel.getByRole('button', { name: 'New chat', exact: true }).click();
  const newTask = page.getByRole('region', { name: 'New task', exact: true });
  const newInput = newTask.getByRole('textbox', { name: 'Describe the revision', exact: true });
  await expect(newInput).toBeVisible();
  await newInput.fill('Preserve this new draft. /model'); await newInput.press('Enter');
  await expect(menu).toBeVisible();
  await expectComposerText(newInput, 'Preserve this new draft. /');
  await menu.getByRole('option').filter({ hasText: 'Deep model' }).first().click();
  await expect(newTask.getByRole('button', { name: 'Models', exact: true })).toContainText('Deep model');
  await expectComposerText(newInput, 'Preserve this new draft. ');
  await newInput.fill('/reasoning'); await newTask.getByRole('button', { name: 'Start task', exact: true }).click();
  await expect(newTask.getByRole('heading', { name: 'Codex', exact: true })).toBeVisible();
  await expect(menu.getByRole('option', { name: 'High · Codex', exact: true })).toBeVisible();
  await capture('new-task-reasoning');
  await newInput.press('Escape');
  assert.deepEqual(creates, []);
  assert.equal(messages.length, messagesBeforeNewTask);
  await page.locator(`[data-task="${task.id}"] .task-link`).click();
  await expect(panel).toBeVisible();

  // Both desktop and narrow mobile views use the same real component tree.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await fits(); await capture('desktop-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await fits(); await capture('mobile-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await fits(); await capture('mobile-light');
  await input.fill('/');
  await expect(commands).toBeVisible();
  const commandBox = await commands.boundingBox();
  assert.ok(commandBox.x >= 0 && commandBox.x + commandBox.width <= 391, 'slash menu fits mobile');
  await capture('mobile-commands');
  await input.press('Escape');
  await input.fill('');
  await panel.getByRole('button', { name: 'Context 5% full: 6,400 of 128,000 tokens', exact: true }).click();
  const contextPanel = page.getByRole('dialog', { name: 'Context', exact: true });
  await expect(contextPanel).toBeVisible();
  await expect(contextPanel).toContainText('New input');
  const contextBox = await contextPanel.boundingBox();
  assert.ok(contextBox.x >= 0 && contextBox.x + contextBox.width <= 391, 'context details fit mobile');
  await page.keyboard.press('Escape');
  await settings.click();
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 391, 'model menu fits mobile');
  await capture('mobile-model-menu');
  await page.keyboard.press('Escape');

  failHistory = true;
  await page.reload();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Retry conversation', exact: true })).toBeVisible();
  await capture('mobile-history-error');
  failHistory = false;
  await panel.getByRole('button', { name: 'Retry conversation', exact: true }).click();
  await expect(panel.locator('.message.assistant')).toContainText('energy eigenvalue');
  await expect(panel.locator('.conversation-error')).toHaveCount(0);
  // Built application dictation: real Composer wiring and normal message API,
  // with synthetic capture devices and transport only.
  runtime.dictationAvailable = true; task.status = 'interrupted'; task.queue.messages = []; task.queue.paused = null; task.compaction = null;
  await page.setViewportSize({ width: 1440, height: 900 }); await refresh();
  await expect(panel.getByRole('button', { name: 'Dictate', exact: true })).toBeVisible();
  await input.fill('Keep @notes'); await expect(page.getByRole('option', { name: 'notes.tex', exact: true })).toBeVisible(); await input.press('Enter');
  await expect(input.locator('[data-reference-path="notes.tex"]')).toHaveCount(1); await expectComposerText(input, 'Keep [notes.tex](notes.tex) ');
  const voiceMessageCount = messages.length;
  await page.evaluate(() => window.fakeAudio.enableVisual());
  await panel.getByRole('button', { name: 'Dictate', exact: true }).click();
  await expect(panel.locator('.composer-dictation canvas')).toBeVisible(); await expect(input).toBeHidden();
  await expect.poll(() => panel.locator('canvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data].some((value,index) => index % 4 === 3 && value > 0))).toBe(true);
  await capture('dictation-recording');
  await panel.getByRole('button', { name: 'Stop dictation', exact: true }).click();
  await expectComposerText(input, 'Keep [notes.tex](notes.tex) Explain the next step.'); assert.equal(messages.length, voiceMessageCount, 'stop only inserts a draft');
  assert.equal(await input.locator('[data-reference-path="notes.tex"]').count(), 1); assert.equal(dictations.at(-1).headers['x-papilot-token'], 'fixture'); assert.equal(dictations.at(-1).headers['x-papilot-audio-type'], 'audio/webm;codecs=opus');
  failMessages = true;
  await panel.getByRole('button', { name: 'Dictate', exact: true }).click(); await panel.getByRole('button', { name: 'Transcribe and send', exact: true }).click();
  await expect(page.getByText('Message could not be sent.', { exact: true })).toBeVisible(); await expect.poll(() => messages.length).toBe(voiceMessageCount + 1);
  await expectComposerText(input, 'Keep [notes.tex](notes.tex) Explain the next step. Explain the next step.');
  const voiceMessage = messages.at(-1); assert.equal(voiceMessage.text, 'Keep [notes.tex](notes.tex) Explain the next step. Explain the next step.'); assert.deepEqual(voiceMessage.references, [{ from: 5, to: 27, path: 'notes.tex', label: 'notes.tex', kind: 'file' }]);
  failMessages = false; await send.click(); await expectComposerText(input, ''); assert.equal(messages.at(-1).requestKey, voiceMessage.requestKey, 'failed send retains normal idempotency');
  await panel.getByRole('button', { name: 'New chat', exact: true }).click();
  const voiceNewInput = page.getByRole('textbox', { name: 'Describe the revision', exact: true }), newComposer = page.locator('.new-task-panel');
  await voiceNewInput.fill('New task draft'); await newComposer.getByRole('button', { name: 'Dictate', exact: true }).click();
  await newComposer.getByRole('button', { name: 'Stop dictation', exact: true }).click(); await expectComposerText(voiceNewInput, 'New task draft Explain the next step.');
  holdDictation = new Promise(resolve => { releaseDictation = resolve; });
  await newComposer.getByRole('button', { name: 'Dictate', exact: true }).click(); await newComposer.getByRole('button', { name: 'Transcribe and send', exact: true }).click(); await expect(newComposer.getByText('Transcribing', { exact: true })).toBeVisible();
  await page.locator('.task-link').filter({ hasText: other.title }).click(); await expect(page.getByRole('textbox', { name: 'Instructions for Claude', exact: true })).toBeVisible(); releaseDictation(); holdDictation = undefined;
  await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toHaveCount(0); assert.equal(creates.length, 0, 'late transcription cannot start a task after navigation');
  await expect.poll(() => page.evaluate(() => window.fakeAudio.tracks)).toBe(4);
  assert.deepEqual(unexpected, []);
  assert.deepEqual(creates, []);
  assert.deepEqual(errors, []);
  console.log('PASS: Codex chat styling, loading/retry, tools, models/slash commands, IME, send recovery, task/provider drafts, queue edit/recovery/pause, native compaction state, approval, and desktop/mobile themes');
} finally {
  await browser?.close();
  await server.close();
}
