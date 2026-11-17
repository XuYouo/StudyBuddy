// Build only the independent goal fixture; never replace the application dist.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';

const output = await fs.mkdtemp(path.join(os.tmpdir(), 'studybuddy-goal-ui-')), server = Fastify();
let browser;
try {
  await build({ configFile: false, plugins: [react()], publicDir: false, logLevel: 'error', build: { outDir: output, rollupOptions: { input: path.resolve('tests/fixtures/codex-goal.html') } } });
  await server.register(staticFiles, { root: output }); await server.listen({ host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 900, height: 800 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.server.address().port}/tests/fixtures/codex-goal.html`);
  await expect(page.getByText('Pursuing goal')).toBeVisible();
  await expect(page.locator('.codex-goal-usage')).toHaveText('1.5K / 4K');
  assert.equal(await page.locator('.codex-goal').evaluate(element => element.getBoundingClientRect().height), 33, 'official single-line Goal rail geometry');
  assert.equal(await page.locator('.codex-goal').getByRole('button', { name: 'Clear goal', exact: true }).evaluate(element => element.getBoundingClientRect().width), 24);
  await page.getByRole('button', { name: 'Edit goal', exact: true }).click();
  const dialog = page.getByRole('dialog'), input = dialog.getByRole('textbox', { name: 'Goal', exact: true });
  await expect(input).toBeFocused(); await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await input.fill('  Revised objective\nwith another line.  ');
  await page.evaluate(() => window.fixture.update({ tokensUsed: 2000, updatedAt: 3 }));
  await expect(input).toHaveValue('  Revised objective\nwith another line.  ');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true, isComposing: true });
  assert.equal(await page.evaluate(() => window.fixture.calls.length), 0, 'IME Enter does not submit');
  await page.evaluate(() => { window.fixture.hold = true; window.fixture.fail = true; });
  await input.press('Control+Enter');
  await expect(dialog.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await dialog.locator('form').evaluate(form => { form.requestSubmit(); });
  assert.equal(await page.evaluate(() => window.fixture.calls.length), 1, 'pending saves do not double submit');
  await page.evaluate(() => window.fixture.release());
  await expect(dialog.getByRole('alert')).toHaveText('Fixture request failed');
  await expect(input).toHaveValue('  Revised objective\nwith another line.  ');
  await page.evaluate(() => { window.fixture.hold = false; window.fixture.fail = false; });
  await input.press('Control+Enter'); await expect(dialog).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.fixture.calls.at(-1).objective), 'Revised objective\nwith another line.');
  await page.getByRole('button', { name: 'Pause goal', exact: true }).click();
  await expect(page.getByText('Paused goal')).toBeVisible(); await expect(page.locator('.codex-goal-usage')).toHaveText('1m 5s');
  await page.getByRole('button', { name: 'Resume goal', exact: true }).click();
  await expect(page.getByText('Pursuing goal')).toBeVisible(); await expect(dialog).toHaveCount(0);
  for (const status of ['budgetLimited', 'complete']) { await page.evaluate(status => window.fixture.update({ status }), status); await expect(page.getByRole('button', { name: 'Resume goal', exact: true })).toHaveCount(0); }
  await page.evaluate(() => window.fixture.update({ status: 'blocked' })); await expect(page.getByRole('button', { name: 'Resume goal', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit goal', exact: true }).click(); await input.fill('Task A draft');
  await page.evaluate(() => { window.fixture.hold = true; window.fixture.fail = true; }); await input.press('Control+Enter');
  await page.evaluate(() => window.fixture.update({ threadId: 'other', objective: 'Task B goal' })); await expect(dialog).toHaveCount(0);
  await page.evaluate(() => window.fixture.release()); await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => { window.fixture.hold = false; window.fixture.fail = false; window.fixture.replace('Replacement objective'); });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Replace goal', exact: true }).click(); await expect(dialog).toHaveCount(0);
  assert.deepEqual(await page.evaluate(() => window.fixture.calls.at(-1)), { action: 'replace', objective: 'Replacement objective' });
  await fs.mkdir('test-results', { recursive: true });
  // The explicit Close action discards only the editor draft; it cannot update the goal.
  await page.getByRole('button', { name: 'Edit goal', exact: true }).click();
  await input.fill('Discarded editor text');
  const callsBeforeClose = await page.evaluate(() => window.fixture.calls.length);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.fixture.calls.length), callsBeforeClose);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.body.style.background = theme === 'dark' ? '#181818' : '#f8f8f8'; }, theme);
    await page.setViewportSize({ width: 900, height: 800 }); await page.screenshot({ path: `test-results/codex-goal-${theme}.png` });
    await page.getByRole('button', { name: 'Edit goal', exact: true }).click(); await page.screenshot({ path: `test-results/codex-goal-editor-${theme}.png` }); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width: 290, height: 794 });
    assert.equal(await page.locator('.codex-goal').evaluate(element => element.getBoundingClientRect().height), 33, 'narrow desktop matches the single-line official rail');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'narrow rail does not overflow');
    await page.getByRole('button', { name: 'Edit goal', exact: true }).click();
    const measured = await dialog.evaluate(element => {
      const input = element.querySelector('textarea'), title = element.querySelector('h2'), save = element.querySelector('[type=submit]');
      return { width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, radius: getComputedStyle(element).borderRadius, inputFont: getComputedStyle(input).fontSize, inputHeight: input.getBoundingClientRect().height, titleHeight: title.getBoundingClientRect().height, buttonHeight: save.getBoundingClientRect().height };
    });
    assert.ok(Math.abs(measured.width - 266.8) < .1, JSON.stringify(measured));
    assert.ok(Math.abs(measured.height - 392) < 1, JSON.stringify(measured));
    assert.deepEqual([measured.radius, measured.inputFont, measured.titleHeight, measured.buttonHeight], ['25px', '12px', 28, 28]);
    await page.screenshot({ path: `test-results/codex-goal-editor-mobile-${theme}.png` });
    assert.equal(await dialog.evaluate(element => element.getBoundingClientRect().right <= innerWidth), true);
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  }
  assert.deepEqual(errors, []); console.log('Goal UI: native-state actions, pending/error/retry, IME, task switch, replacement, light/dark and narrow layout passed.');
} finally { await browser?.close(); await server.close(); await fs.rm(output, { recursive: true, force: true }); }
