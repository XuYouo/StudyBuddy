import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { expectComposerText } from './composer-fixture.mjs';

// Exercise the production submenu without replacing the shared app build.
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'studybuddy-review-ui-')), server = Fastify();
let browser;
try {
  await build({ configFile: false, plugins: [react()], publicDir: false, logLevel: 'error', build: { outDir: output, rollupOptions: { input: path.resolve('tests/fixtures/codex-review.html') } } });
  await server.register(staticFiles, { root: output }); await server.listen({ host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 537, height: 794 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.server.address().port}/tests/fixtures/codex-review.html`;
  await page.goto(url);
  const input = page.getByRole('textbox', { name: 'Review command' }), menu = page.locator('.codex-review-menu[data-open="true"]');
  async function open() { await input.fill('/'); await page.getByRole('button', { name: 'Open review', exact: true }).click(); await expect(menu).toBeVisible(); }
  await page.evaluate(() => { window.fixture.holdLoad = true; });
  await open();
  await expect(menu.getByText('Loading branches…')).toBeVisible();
  await page.evaluate(() => { window.fixture.holdLoad = false; window.fixture.releaseLoad(); });
  await expect(menu.getByRole('option', { name: 'main', exact: true })).toBeEnabled();
  await expect(input).toBeFocused();
  assert.equal(await page.evaluate(() => window.fixture.reads), 1, 'inline callbacks do not reload on render');
  await input.press('ArrowDown'); await input.press('ArrowDown');
  await expect(menu.getByRole('option', { selected: true })).toHaveText('research/量子');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229 });
  assert.equal(await page.evaluate(() => window.fixture.calls.length), 0, 'IME does not start review');
  await input.press('Escape'); await expect(menu).toHaveCount(0); await expectComposerText(input, '/');
  await open(); await expect(menu.getByRole('option', { name: 'main', exact: true })).toBeEnabled();
  await input.press('End'); await expect(menu.getByRole('option', { selected: true })).toHaveText('origin/release');
  await input.press('Home'); await expect(menu.getByRole('option', { selected: true })).toHaveText('Review uncommitted changes');
  await input.press('Enter'); await expect(menu).toHaveCount(0); await expectComposerText(input, '');
  assert.deepEqual(await page.evaluate(() => window.fixture.calls), [{ type: 'uncommittedChanges' }]);

  await open(); await expect(menu.getByRole('option', { name: 'main', exact: true })).toBeEnabled();
  await input.press('End'); await input.type('release');
  await expect(menu.getByRole('option')).toHaveCount(1); await expect(menu.getByRole('option')).toHaveText('origin/release');
  await page.evaluate(() => { window.fixture.hold = true; window.fixture.failReview = true; });
  await input.press('Tab'); await expect(menu.getByRole('option')).toBeDisabled();
  await input.press('Enter'); await input.press('Enter');
  assert.equal(await page.evaluate(() => window.fixture.calls.length), 2, 'pending request is submitted once');
  await page.evaluate(() => window.fixture.release());
  await expect(menu.getByRole('alert')).toHaveText('Failed to start code review'); await expectComposerText(input, '/release');
  await page.evaluate(() => { window.fixture.hold = false; window.fixture.failReview = false; });
  await input.focus(); await input.press('Enter'); await expect(menu).toHaveCount(0); await expectComposerText(input, '');
  assert.deepEqual(await page.evaluate(() => window.fixture.calls.at(-1)), { type: 'baseBranch', branch: 'refs/remotes/origin/release' });

  await page.evaluate(() => { window.fixture.failLoad = true; });
  await open(); await expect(menu.getByRole('alert')).toContainText('Unable to load branches');
  await page.evaluate(() => { window.fixture.failLoad = false; });
  await menu.getByRole('button', { name: 'Retry' }).focus(); await page.keyboard.press('Enter');
  await expect(menu.getByRole('option', { name: 'main', exact: true })).toBeEnabled();
  assert.equal(await page.evaluate(() => window.fixture.calls.length), 3, 'keyboard Retry does not review');
  await page.getByRole('button', { name: 'Outside control' }).click(); await expect(menu).toHaveCount(0);
  await open(); await expect(menu.getByRole('option', { name: 'main', exact: true })).toBeEnabled();
  await page.evaluate(() => window.fixture.disabled(true)); await expect(menu).toHaveCount(0); await expectComposerText(input, '/');
  await page.evaluate(() => window.fixture.disabled(false));
  await fs.mkdir('test-results', { recursive: true });
  for (const theme of ['light', 'dark']) for (const size of [{ name: 'desktop', width: 537, height: 794 }, { name: 'mobile', width: 390, height: 844 }]) {
    await page.setViewportSize(size); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await open(); await expect(menu.getByRole('option', { name: 'main', exact: true })).toBeEnabled();
    const box = await menu.boundingBox(), composer = await page.locator('.composer').boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height, 'menu stays in viewport');
    assert.ok(box.y + box.height <= composer.y && Math.abs(box.x - composer.x) < 1, 'menu remains anchored above editor');
    await page.screenshot({ path: `test-results/codex-review-${size.name}-${theme}.png`, animations: 'disabled' });
    await input.press('Escape');
  }
  // Old-browser path has the same position, light-dismiss and keyboard contract.
  await page.addInitScript(() => { Object.defineProperty(CSS, 'supports', { value: () => false }); Object.defineProperty(HTMLElement.prototype, 'showPopover', { value: undefined }); Object.defineProperty(HTMLElement.prototype, 'hidePopover', { value: undefined }); delete HTMLElement.prototype.popover; });
  await page.reload(); await open(); await expect(menu.getByRole('option', { name: 'main', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Outside control' }).click(); await expect(menu).toHaveCount(0);
  assert.deepEqual(errors, []); console.log('Code review submenu passed: native keyboard, IME, filter, one submit, failure/retry, focus, themes, mobile, fallback.');
} finally { await browser?.close(); await server.close(); await fs.rm(output, { recursive: true, force: true }); }
