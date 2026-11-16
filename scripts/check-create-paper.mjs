import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium } from '../engine/node_modules/playwright/index.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const origin = `http://127.0.0.1:${server.server.address().port}`, errors = [];
fs.mkdirSync('test-results', { recursive: true });
try {
  for (const mode of ['browser', 'windows', 'wsl']) {
    const desktop = mode !== 'browser', parent = mode === 'windows' ? 'C:\\Users\\Author' : '/home/author';
    const picked = mode === 'windows' ? 'D:\\Research' : '/home/author/papers';
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
    const requests = [], state = { version: '0.10.4', csrf: 'fixture', projects: [], tasks: [], requests: [], runtime: { connected: true, authenticated: false, account: null, error: null, models: [] } };
    if (desktop) await context.addInitScript(picked => { window.papilotDesktop = { platform: 'win32', minimize() {}, maximize() {}, close() {}, chooseDirectory: async () => picked }; }, picked);
    let fail = !desktop;
    await context.route('**/api/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/projects/create-defaults') return route.fulfill({ json: { parent } });
      if (url.pathname === '/api/projects/create') {
        const body = route.request().postDataJSON(); requests.push(body);
        if (fail) return route.fulfill({ status: 400, json: { error: 'Could not create the paper folder. Check the save location and its permissions.' } });
        const project = { id: 'created-' + mode, name: body.name, path: body.parent + (mode === 'windows' ? '\\' : '/') + body.name, createdAt: 1 };
        state.projects = [project]; return route.fulfill({ json: project });
      }
      if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
      if (url.pathname === '/api/state') return route.fulfill({ json: state });
      if (url.pathname === '/api/updates') return route.fulfill({ json: { currentVersion: state.version, latestVersion: state.version, phase: 'idle' } });
      if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (url.pathname.endsWith('/skills')) return route.fulfill({ json: { skills: [] } });
      if (url.pathname.endsWith('/manuscript')) return route.fulfill({ json: { git: { branch: 'main', files: [], head: null, ahead: 0, behind: 0 }, build: { status: 'failed', error: 'latexmk not found: install TeX Live, then compile again.' }, annotations: [] } });
      if (url.pathname.endsWith('/git')) return route.fulfill({ json: { branch: 'main', files: [], head: null, ahead: 0, behind: 0 } });
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    const create = page.getByRole('button', { name: 'Create a new paper', exact: true });
    await create.click();
    let dialog = page.getByRole('dialog', { name: 'Create a new paper', exact: true });
    const name = dialog.getByRole('textbox', { name: 'Paper name', exact: true }), location = dialog.getByRole('textbox', { name: 'Save in', exact: true });
    await name.fill('研究论文');
    await page.waitForFunction(parent => document.querySelector('#create-paper-parent')?.value === parent, parent);
    if (desktop) { await dialog.getByRole('button', { name: 'Choose folder', exact: true }).click(); assert.equal(await location.inputValue(), picked); }
    else {
      await dialog.getByText('This location is on the computer running StudyBuddy.', { exact: false }).waitFor();
      await page.setViewportSize({ width: 320, height: 640 });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.screenshot({ path: 'test-results/create-paper-mobile.png', animations: 'disabled' });
      assert.ok((await location.boundingBox()).height >= 36, 'Save location remains a usable input on mobile');
      const bounds = await dialog.locator('.modal').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 321, 'Creation dialog fits a narrow phone');
    }
    await dialog.getByRole('button', { name: 'Create paper', exact: true }).click();
    if (!desktop) {
      await dialog.getByRole('alert').filter({ hasText: 'permissions' }).waitFor();
      const first = requests.at(-1);
      assert.equal(await name.inputValue(), '研究论文'); assert.equal(await location.inputValue(), parent);
      await page.reload(); await create.click();
      dialog = page.getByRole('dialog', { name: 'Create a new paper', exact: true });
      assert.equal(await dialog.getByRole('textbox', { name: 'Paper name', exact: true }).inputValue(), '研究论文');
      fail = false;
      await dialog.getByRole('button', { name: 'Create paper', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.deepEqual(requests.at(-1), first, 'Retry after reload retains the creation identity and inputs');
      await page.setViewportSize({ width: 1280, height: 800 }); await page.emulateMedia({ colorScheme: 'light' });
    } else await dialog.waitFor({ state: 'hidden' });
    assert.equal(requests.at(-1).parent, desktop ? picked : parent);
    await page.getByText('latexmk not found: install TeX Live, then compile again.', { exact: false }).first().waitFor();
    const switcher = page.getByRole('button', { name: 'Paper: 研究论文', exact: true });
    if (!(await switcher.isVisible())) await page.getByRole('button', { name: 'Show task list', exact: true }).click();
    await switcher.click();
    await page.getByRole('menuitem', { name: 'Create a new paper', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Create a new paper', exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('textbox', { name: 'Paper name', exact: true }).inputValue(), '', 'Successful creation clears the saved draft');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: Create paper from empty state and switcher, native Windows/WSL picker paths, browser host location, mobile layout, retry across reload, and workspace compilation errors');
} finally { await browser.close(); await server.close(); }
