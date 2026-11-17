import { expectComposerText, readComposerText } from './composer-fixture.mjs';
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
  const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Quantum mechanics', path: task.worktree, createdAt: 1 }, { id: 'other-paper', name: 'Other paper', path: '/tmp/other-paper', createdAt: 1 }, { id: 'fresh-paper', name: 'Fresh paper', path: '/tmp/fresh-paper', createdAt: 1 }], tasks: [task, other], requests: [], runtime, runtimes: { codex: runtime, claude: { ...runtime } } };
  const entries = [
    { id: 'question', type: 'user', text: 'Explain the eigenvalue equation step by step.\n请保留原题的符号。' },
    { id: 'command', type: 'command', text: 'cat notes.tex', detail: 'The Hamiltonian is Hermitian.', status: 'completed' },
    { id: 'response', type: 'assistant', text: 'An eigenstate satisfies $H\\psi = E\\psi$.\n\n1. Apply the operator to the state.\n2. Compare the result with the original state.\n\nThe scalar **E** is the energy eigenvalue.' },
  ].map((entry, index) => ({ ...entry, taskId: task.id, createdAt: index + 1 }));
  const sourceReads = [];
  const messages = [], approvals = [], pauses = [], creates = [], queueWrites = [], compactions = [];
  let failApproval = false, holdApproval, releaseApproval;
  let failQueue = false, holdQueue, releaseQueue;
  let failMessages = false, failHistory = false, holdHistory, releaseHistory;
  let initMode = 'exists';
  const initReads = [];
  let mcpMode = 'ready', holdMcp, releaseMcp, mcpReads = 0;
  await context.addInitScript(() => localStorage.setItem('papilot:task', 'codex-chat-task'));
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url()), json = data => route.fulfill({ json: data });
    if (url.pathname === '/api/state') return json(snapshot);
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
    if (url.pathname.endsWith('/init') && route.request().method() === 'GET') {
      initReads.push(url.pathname);
      if (initMode === 'error') return route.fulfill({status:503,json:{error:'Initialization preflight unavailable.'}});
      return json({exists:initMode === 'exists'});
    }
    if (url.pathname.endsWith('/source')) {
      sourceReads.push(url.pathname);
      return json({file:url.searchParams.get('file'),revision:'a'.repeat(64),text:'Reference fixture source.\n',base:null,passage:[0,1],focus:[0,1],drifted:false,round:1});
    }
    if (url.pathname.endsWith('/files')) {
      const query = url.searchParams.get('query') || '';
      if (query === 'failure') return route.fulfill({status:503,json:{error:'Search unavailable'}});
      const files = [
        {path:'paper.tex',label:'paper.tex',kind:'file'},
        {path:'chapters/文 [a](b).tex',label:'文 [a](b).tex',kind:'file'},
        {path:'chapters/',label:'chapters',kind:'directory'}
      ];
      return json({files:files.filter(file=>file.path.includes(query)),more:false});
    }
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
      const message = messages.at(-1);
      entries.push({ id: `submitted-${messages.length}`, type: 'user', taskId: message.taskId, createdAt: Date.now(), text: message.text, meta: { references: message.references } });
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
        else { assert.equal(body.lease, row.editLease); if (body.action === 'save') { row.text = body.text; row.references = body.references; } row.status = 'queued'; delete row.editLease; }
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
  await context.grantPermissions(['clipboard-read','clipboard-write'], {origin});
  await page.goto(origin);
  const input = page.getByRole('textbox', {name:'Instructions for Codex',exact:true});
  await expect(input).toBeVisible();
  const menu = page.getByRole('listbox',{name:'Files and folders'});
  const send = page.getByRole('button',{name:'Send instructions',exact:true});
  await input.fill('alpha'); await input.press('End'); await input.press('Shift+Enter'); await page.waitForTimeout(550); await input.pressSequentially('beta');
  await expectComposerText(input,'alpha\nbeta');
  await input.press('ControlOrMeta+z');
  await expectComposerText(input,'alpha\n');
  await input.fill('检查 🧪 @文');
  await expect(menu.getByRole('option')).toHaveCount(1);
  await input.press('Enter');
  const chip = input.locator('[data-reference-path]');
  await expect(chip).toHaveText('文 [a](b).tex');
  await expect(chip).toHaveAttribute('contenteditable','false');
  await expect(chip).toHaveAttribute('data-reference-path','chapters/文 [a](b).tex');
  await expect(chip).toHaveAttribute('data-reference-kind','file');
  const token = '[文 \\[a\\]\\(b).tex](chapters/文 [a](b\\).tex)';
  const expected = '检查 🧪 ' + token + ' ';
  await expectComposerText(input,expected);
  await input.press('Backspace'); await expect(chip).toHaveCount(1);
  await input.press('Backspace'); await expect(chip).toHaveCount(0);
  await input.press('ControlOrMeta+z'); await expect(chip).toHaveCount(1);
  await expectComposerText(input,expected);
  // Native rich clipboard preserves the atomic node and the external plain-text token.
  await input.press('ControlOrMeta+a'); await input.press('ControlOrMeta+c');
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),expected);
  await input.fill(''); await input.press('ControlOrMeta+v');
  await expect(chip).toHaveCount(1); await expectComposerText(input,expected);
  await page.reload(); await expect(input).toBeVisible(); await expect(chip).toHaveCount(1);
  await chip.click(); await expect.poll(()=>sourceReads.length).toBe(1);
  await expect(page.locator('.source-panel-editor')).toContainText('Reference fixture source.');
  await page.getByRole('tab',{name:'Chat',exact:true}).click(); await expect(input).toBeVisible();
  const history = page.getByRole('dialog',{name:'History',exact:true});
  await page.locator('.codex-chat-panel').getByRole('button',{name:'History',exact:true}).click();
  await history.getByRole('searchbox').fill('Check the notation'); await history.locator('.codex-history-item').click();
  await page.getByRole('textbox',{name:'Instructions for Claude',exact:true}).fill('Other task draft');
  await page.locator('.codex-chat-panel').getByRole('button',{name:'History',exact:true}).click();
  await history.getByRole('searchbox').fill('Explain the eigenvalue equation'); await history.locator('.codex-history-item').click();
  await expect(chip).toHaveCount(1);
  await expectComposerText(input,expected);
  failMessages = true; await send.click(); await expect.poll(()=>messages.length).toBe(1);
  assert.equal(messages[0].text,expected);
  assert.deepEqual(messages[0].references,[{from:6,to:expected.length-1,path:'chapters/文 [a](b).tex',label:'文 [a](b).tex',kind:'file'}]);
  await expect(chip).toHaveCount(1); failMessages = false; await expect(send).toBeEnabled(); await send.click();
  await expect.poll(()=>messages.length).toBe(2); assert.deepEqual(messages[1],messages[0]); await expectComposerText(input,'');
  const submitted = page.locator('.message.user .message-body').filter({has:page.getByRole('button',{name:'文 [a](b).tex',exact:true})});
  await expect(submitted).toHaveCount(1);
  assert.equal(await submitted.textContent(),'检查 🧪 文 [a](b).tex ');
  await expect(submitted.locator('svg')).toHaveAttribute('width','10');
  await page.reload(); await expect(submitted).toHaveCount(1);
  assert.equal(await submitted.textContent(),'检查 🧪 文 [a](b).tex ');
  await input.fill('@failure'); await expect(menu).toContainText('Unable to search files');
  await input.fill('@paper'); await expect(menu.getByRole('option')).toHaveCount(1);
  await input.dispatchEvent('compositionstart'); await input.dispatchEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true});
  await expectComposerText(input,'@paper'); assert.equal(messages.length,2);
  await input.dispatchEvent('compositionend'); await input.press('Escape'); await expect(menu).toHaveCount(0); await expectComposerText(input,'@paper');
  await input.fill('@missing'); await expect(menu).toContainText('No matching files'); await input.press('Enter'); assert.equal(messages.length,2);
  await input.fill('@chapters /model');
  await expect(menu).toBeVisible(); await expect(page.getByRole('listbox')).toHaveCount(1);
  await input.press('Enter'); await expectComposerText(input,'@chapters /model'); assert.equal(messages.length,2);
  await input.fill('@chapters'); await expect(menu.getByRole('option')).toHaveCount(2); await menu.getByRole('option').filter({hasText:'chapterschapters/'}).click();
  await expect(input.locator('[data-reference-kind=directory]')).toHaveCount(1);
  await expect(input.locator('[data-reference-kind=directory]')).not.toHaveAttribute('role','link');
  await expectComposerText(input,'[chapters](chapters/) ');
  // Queue save/cancel/recovery keeps the original and edited document metadata apart.
  const directoryText = '[chapters](chapters/) ';
  const queuedReference = {from:0,to:'[paper.tex](paper.tex)'.length,path:'paper.tex',label:'paper.tex',kind:'file'};
  task.status = 'running'; task.queue.messages = [{id:'rich-queue',text:'[paper.tex](paper.tex) ',references:[queuedReference],status:'queued',editable:true}]; task.queue.revision++;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  const editQueue = async () => { await page.getByRole('button',{name:'Queued message actions',exact:true}).click(); await page.getByRole('menuitem',{name:'Edit message',exact:true}).click(); };
  await editQueue(); await expect(input.locator('[data-reference-path="paper.tex"]')).toHaveCount(1);
  await input.press('End'); await input.pressSequentially('updated');
  await page.getByRole('button',{name:'Save queued message',exact:true}).click();
  await expectComposerText(input,directoryText); await expect(input.locator('[data-reference-kind=directory]')).toHaveCount(1);
  const savedQueue = queueWrites.find(write=>write.action==='save');
  assert.equal(savedQueue.text,'[paper.tex](paper.tex) updated'); assert.deepEqual(savedQueue.references,[queuedReference]);
  await editQueue(); await page.getByRole('button',{name:'Cancel editing',exact:true}).click(); await expectComposerText(input,directoryText);
  await editQueue(); task.queue.messages[0].status='queued'; delete task.queue.messages[0].editLease; task.queue.revision++;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByRole('button',{name:'Restore previous draft',exact:true}).click(); await expect(input.locator('[data-reference-kind=directory]')).toHaveCount(1);
  await page.getByRole('button',{name:'Swap drafts',exact:true}).click(); await expect(input.locator('[data-reference-path="paper.tex"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Swap drafts',exact:true}).click(); await expectComposerText(input,directoryText);
  task.queue.messages=[]; task.queue.revision++; task.status='interrupted'; await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  // Project A -> B -> A must restore both the text and its original file authority.
  await page.locator('.codex-chat-panel').getByRole('button',{name:'New chat',exact:true}).click();
  const newInput = page.getByRole('textbox',{name:'Describe the revision',exact:true});
  await newInput.fill('@paper'); await expect(menu.getByRole('option')).toHaveCount(1); await newInput.press('Enter');
  await expect(newInput.locator('[data-reference-path="paper.tex"]')).toHaveCount(1);
  await newInput.locator('[data-reference-path="paper.tex"]').click(); await expect.poll(()=>sourceReads.length).toBe(2);
  assert.equal(sourceReads[1],'/api/projects/paper/manuscript/source');
  await page.getByRole('button',{name:'Paper: Quantum mechanics',exact:true}).click(); await page.getByRole('menuitemradio',{name:'Other paper',exact:true}).click();
  await expectComposerText(newInput,''); await newInput.press('ControlOrMeta+z'); await expectComposerText(newInput,''); await expect(newInput.locator('[data-reference-path]')).toHaveCount(0); await newInput.fill('Other project draft');
  await page.getByRole('button',{name:'Paper: Other paper',exact:true}).click(); await page.getByRole('menuitemradio',{name:'Quantum mechanics',exact:true}).click();
  await expectComposerText(newInput,'[paper.tex](paper.tex) '); await expect(newInput.locator('[data-reference-path="paper.tex"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Start task',exact:true}).click(); await expect.poll(()=>creates.length).toBe(1);
  assert.equal(creates[0].projectId,'paper'); assert.equal(creates[0].instructions,'[paper.tex](paper.tex) '); assert.deepEqual(creates[0].references,[queuedReference]);
  await newInput.fill('Reloaded project A draft'); await page.reload(); await expect(input).toBeVisible();
  await page.locator('.codex-chat-panel').getByRole('button',{name:'New chat',exact:true}).click();
  await expectComposerText(newInput,'Reloaded project A draft');
  await page.getByRole('button',{name:'Paper: Quantum mechanics',exact:true}).click(); await page.getByRole('menuitemradio',{name:'Fresh paper',exact:true}).click();
  await expectComposerText(newInput,''); await newInput.press('ControlOrMeta+z'); await expectComposerText(newInput,'');
  await newInput.fill('Fresh project draft');
  await page.getByRole('button',{name:'Paper: Fresh paper',exact:true}).click(); await page.getByRole('menuitemradio',{name:'Quantum mechanics',exact:true}).click();
  await expectComposerText(newInput,'Reloaded project A draft');
  await page.locator(`[data-task="${task.id}"] .task-link`).click(); await expectComposerText(input,directoryText);
  await expect(page.locator('.codex-queue-list > li')).toHaveCount(0); await expect(page.locator('.working')).toHaveCount(0);
  // Submitted references use the saved spans only; ordinary Markdown and bad
  // metadata stay literal, with Unicode offsets and line breaks unchanged.
  const prefix = 'Before\n', suffix = '\n[literal](paper.tex)';
  entries.push({id:'multiline-reference',type:'user',taskId:task.id,createdAt:Date.now(),text:prefix+expected+suffix,meta:{references:messages[1].references.map(reference=>({...reference,from:reference.from+prefix.length,to:reference.to+prefix.length}))}});
  entries.push({id:'invalid-reference',type:'user',taskId:task.id,createdAt:Date.now()+1,text:'Invalid [paper.tex](paper.tex)',meta:{references:[{from:8,to:29,path:'other.tex',label:'paper.tex',kind:'file'}]}});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  const multiline = page.locator('.message.user .message-body').filter({hasText:'Before'});
  await expect(multiline).toHaveCount(1);
  assert.equal(await multiline.textContent(),'Before\n检查 🧪 文 [a](b).tex \n[literal](paper.tex)');
  await expect(multiline.locator('.message-file-reference')).toHaveCount(1);
  const invalid = page.locator('.message.user .message-body').filter({hasText:'Invalid [paper.tex](paper.tex)'});
  await expect(invalid).toHaveCount(1); await expect(invalid.locator('.message-file-reference')).toHaveCount(0);
  const readsBefore = sourceReads.length;
  await multiline.getByRole('button',{name:'文 [a](b).tex',exact:true}).click();
  await expect.poll(()=>sourceReads.length).toBe(readsBefore+1);
  assert.equal(sourceReads.at(-1),`/api/tasks/${task.id}/source`);
  await expect(page.locator('.source-panel-editor')).toContainText('Reference fixture source.');
  await page.getByRole('tab',{name:'Chat',exact:true}).click(); await expect(input).toBeVisible();
  await input.fill('@文'); await expect(menu.getByRole('option')).toHaveCount(1); await input.press('Enter');
  await expect(input.locator('[data-reference-path] svg')).toHaveAttribute('width','10');
  for (const close of await page.locator('.toast button').all()) await close.click();
  for (const colorScheme of ['light','dark']) {
    await page.emulateMedia({colorScheme});
    for (const [name,width,height] of [['desktop',1440,900],['mobile',390,844]]) {
      await page.setViewportSize({width,height});
      if (name === 'mobile') await page.getByRole('group',{name:'Workspace view'}).getByRole('button',{name:'Chat',exact:true}).click();
      await expect(input).toBeVisible();
      await page.screenshot({path:`test-results/composer-editor-${name}-${colorScheme}.png`,animations:'disabled'});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
  }
  await page.setViewportSize({width:1440,height:900});
  const initOption = page.getByRole('option',{name:'Init',exact:true});
  const assertInitPrompt = text => {
    assert.ok(text.startsWith('Generate a file named AGENTS.md that serves as a contributor guide for this repository.\n'));
    assert.ok(text.includes('- Title the document "Repository Guidelines".'));
    assert.ok(text.includes('- Keep the document concise. 200-400 words is optimal.'));
    assert.ok(text.includes('Commit & Pull Request Guidelines\n'));
    assert.ok(text.endsWith('(Optional) Add other sections if relevant, such as Security & Configuration Tips, Architecture Overview, or Agent-Specific Instructions.'));
  };
  await input.fill('Keep this draft. /init'); await expect(initOption).toHaveCount(0); await input.press('Escape');
  const messagesBeforeInit = messages.length;
  await input.fill('/init'); await expect(initOption).toBeVisible(); await input.press('Enter');
  await expect(page.getByRole('status').filter({hasText:'AGENTS.md already exists here. Skipping /init to avoid overwriting it'})).toBeVisible();
  assert.equal(initReads.at(-1),`/api/tasks/${task.id}/init`); assert.equal(messages.length,messagesBeforeInit);
  await expectComposerText(input,'');
  initMode = 'error'; await input.fill('/init'); await expect(initOption).toBeVisible(); await input.press('Enter');
  await expect(page.getByRole('alert').filter({hasText:'Initialization preflight unavailable.'})).toBeVisible();
  assert.equal(messages.length,messagesBeforeInit);
  initMode = 'absent'; failMessages = true;
  await input.fill('/init'); await expect(initOption).toBeVisible(); await input.press('Enter');
  await expect.poll(()=>messages.length).toBe(messagesBeforeInit+1);
  const initializationMessage = messages.at(-1); assertInitPrompt(initializationMessage.text);
  assert.equal(initializationMessage.references,undefined); assert.equal(initializationMessage.attachments,undefined); assert.ok(initializationMessage.requestKey);
  await expectComposerText(input,initializationMessage.text+'\n'); await expect(send).toBeEnabled();
  failMessages = false; await send.click(); await expect.poll(()=>messages.length).toBe(messagesBeforeInit+2);
  assert.deepEqual(messages.at(-1),initializationMessage); await expectComposerText(input,'');
  task.status='running'; await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button',{name:'Pause task',exact:true})).toBeVisible();
  await input.fill('/init'); await expect(initOption).toHaveCount(0); await input.press('Escape');
  task.status='interrupted'; await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.locator(`[data-task="${other.id}"] .task-link`).click();
  const claudeInput = page.getByRole('textbox',{name:'Instructions for Claude',exact:true});
  await claudeInput.fill('/init'); await expect(initOption).toHaveCount(0); await claudeInput.press('Escape');
  await page.locator(`[data-task="${task.id}"] .task-link`).click();
  await page.locator('.codex-chat-panel').getByRole('button',{name:'New chat',exact:true}).click();
  initMode='exists'; await newInput.fill('/init'); await expect(initOption).toBeVisible(); await newInput.press('Enter');
  await expect(page.getByRole('status').filter({hasText:'AGENTS.md already exists here. Skipping /init to avoid overwriting it'})).toBeVisible();
  assert.equal(initReads.at(-1),'/api/projects/paper/init'); assert.equal(creates.length,1);
  initMode='absent'; await newInput.fill('/init'); await expect(initOption).toBeVisible(); await newInput.press('Enter');
  await expect.poll(()=>creates.length).toBe(2); const initializationTask=creates.at(-1);
  assert.equal(initializationTask.projectId,'paper'); assertInitPrompt(initializationTask.instructions);
  assert.equal(initializationTask.references,undefined); assert.equal(initializationTask.attachments,undefined); assert.ok(initializationTask.id);
  await expectComposerText(newInput,initializationTask.instructions+'\n');
  const startTask=page.getByRole('button',{name:'Start task',exact:true}); await expect(startTask).toBeEnabled(); await startTask.click();
  await expect.poll(()=>creates.length).toBe(3); assert.deepEqual(creates.at(-1),initializationTask);
  assert.deepEqual(errors,[]); assert.deepEqual(unexpected,[]);
  console.log('Composer editor passed: atomic mentions, native clipboard, Unicode payloads, retry, submitted spans and reload, IME, undo, queue recovery, task/project isolation, source opening, init preflight/submission and desktop/mobile themes.');
} finally { await browser?.close(); await server.close(); }
