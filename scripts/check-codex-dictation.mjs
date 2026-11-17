import { installFakeDictationDevices } from './dictation-fixture.mjs';
// Only deterministic fake devices and fake transport. Never requests a microphone.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { readComposerText, expectComposerText, composerCaretAtStart } from './composer-fixture.mjs';
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'studybuddy-dictation-ui-')), server = Fastify();
let browser;
try {
  await build({ configFile: false, plugins: [react()], publicDir: false, logLevel: 'error', build: { outDir: output, rollupOptions: { input: path.resolve('tests/fixtures/codex-dictation.html') } } });
  await server.register(staticFiles, { root: output }); await server.listen({ host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 900, height: 720 } }), errors = [], calls = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(installFakeDictationDevices);
  let fail = false, hold = false, holdStart = false, release, releaseStart, available = true, maxBytes = 1000, next = 0;
  await page.route('**/api/runtime/codex/dictation**', async route => {
    const request = route.request(), url = new URL(request.url()).pathname;
    calls.push({ url, method: request.method(), body: request.postData(), headers: request.headers() });
    const respond = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
    if (url.endsWith('/dictation')) return respond({ available });
    if (url.endsWith('/sessions')) { if (holdStart) await new Promise(resolve => { releaseStart = resolve; }); return respond({ id: 'session-' + ++next, maxBytes }); }
    if (url.endsWith('/cancel')) return respond({});
    if (url.endsWith('/transcribe')) { if (hold) await new Promise(resolve => { release = resolve; }); return fail ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture workspace does not allow dictation.' }) }).catch(() => {}) : respond({ text: 'Dictated words.' }); }
    throw new Error('Unexpected API ' + url);
  });
  const url = `http://127.0.0.1:${server.server.address().port}/tests/fixtures/codex-dictation.html`, input = page.getByRole('textbox', { name: 'Draft' });
  const transcriptions = () => calls.filter(call => call.url.endsWith('/transcribe'));
  const dictate = () => page.getByRole('button', { name: 'Dictate', exact: true }).click();
  const stop = () => page.getByRole('button', { name: 'Stop dictation', exact: true }).click();
  const reload = async () => { await page.goto(url); await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toBeVisible(); };
  await reload(); assert.equal(await page.evaluate(() => window.fakeAudio.starts), 0);
  await input.pressSequentially('Keep this '); await page.evaluate(() => window.fixture.insertReference()); const original = await readComposerText(input);
  await dictate(); await expect(page.getByText('Recording…', { exact: true })).toBeVisible(); await expect(input).toBeHidden();
  await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Transcribe and send', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(page.getByRole('button', { name: 'Cancel dictation', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeFocused();
  await page.locator('.composer-dictation').dispatchEvent('keydown', { key: 'Escape', isComposing: true, keyCode: 229 }); assert.equal(transcriptions().length, 0);
  await page.keyboard.press('Enter'); await expectComposerText(input, original + 'Dictated words.'); await expect(input).toBeFocused();
  assert.equal(await input.locator('[data-reference-path="main.tex"]').count(), 1); assert.equal((await page.evaluate(() => window.fixture.getDocument())).references.length, 1);
  assert.equal(transcriptions().length, 1); assert.equal(transcriptions()[0].headers['x-papilot-token'], 'fixture-csrf'); assert.equal(transcriptions()[0].headers['x-papilot-audio-type'], 'audio/webm;codecs=opus'); assert.equal(transcriptions()[0].body, 'recorded-audiofinal-audio');
  await input.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z'); await expectComposerText(input, original);
  // Stop twice while the transport waits must produce just one request.
  hold = true; await dictate(); await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeFocused(); await page.keyboard.press('Escape'); await expect.poll(() => transcriptions().length).toBe(2);
  await expect(page.getByRole('button', { name: 'Cancel transcription', exact: true })).toBeFocused();
  await page.locator('.composer-dictation').dispatchEvent('keydown', { key: 'Escape', repeat: true }); assert.equal(transcriptions().length, 2);
  await page.getByRole('button', { name: 'Switch task' }).click(); await page.evaluate(() => window.fixture.setDocument({ text: 'Task B draft', references: [] })); release(); hold = false;
  await expectComposerText(input, 'Task B draft'); await expect(page.locator('.composer-dictation')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Switch task' })).toBeFocused(); assert.equal(await page.evaluate(() => window.fakeAudio.tracks), 2);
  // Starting controls own focus even while the server creates the lease.
  await reload(); holdStart = true; await dictate(); await expect(page.getByText('Starting dictation…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel dictation', exact: true })).toBeFocused(); await page.keyboard.press('Escape');
  releaseStart(); holdStart = false; await expect(page.locator('.composer-dictation')).toHaveCount(0); await expect(input).toBeFocused();
  assert.equal(await page.evaluate(() => window.fakeAudio.requests), 0);
  // Late microphone permission must stop the returned tracks, never record.
  await reload(); await page.evaluate(() => { window.fakeAudio.permission = 'hold'; }); await dictate();
  await expect(page.getByText('Starting dictation…')).toBeVisible(); await page.getByRole('button', { name: 'Cancel dictation', exact: true }).click(); await page.evaluate(() => window.fakeAudio.release());
  await expect.poll(() => page.evaluate(() => window.fakeAudio.tracks)).toBe(1); assert.equal(await page.evaluate(() => window.fakeAudio.starts), 0);
  await page.evaluate(() => { window.fakeAudio.permission = 'deny'; }); await dictate(); await expect(page.getByRole('alert')).toContainText('Microphone access was denied');
  await expect(page.getByRole('button', { name: 'Cancel dictation', exact: true })).toBeFocused(); await page.keyboard.press('Escape'); await expect(page.locator('.composer-dictation')).toHaveCount(0); await expect(input).toBeFocused();
  await dictate(); await expect(page.getByRole('alert')).toContainText('Microphone access was denied');
  await page.evaluate(() => { window.fakeAudio.permission = 'allow'; }); await page.getByRole('button', { name: 'Retry dictation' }).click(); await expect(page.getByText('Recording…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel dictation', exact: true }).click(); assert.equal(await page.evaluate(() => window.fakeAudio.tracks), 2);
  // A definite transcription rejection retains exactly the same audio and lease.
  fail = true; await dictate(); await stop(); await expect(page.getByRole('alert')).toHaveText('Fixture workspace does not allow dictation.'); const failed = transcriptions().at(-1);
  fail = false; await page.getByRole('button', { name: 'Retry dictation' }).click(); await expectComposerText(input, 'Dictated words.'); assert.equal(transcriptions().at(-1).url, failed.url); assert.equal(transcriptions().at(-1).body, failed.body);
  // A native stop exception still releases the mic and keeps captured chunks for explicit retry.
  await page.evaluate(() => { window.fakeAudio.throwStop = true; }); await dictate(); await stop(); await expect(page.getByRole('alert')).toHaveText('Fixture stop failed');
  await page.getByRole('button', { name: 'Retry dictation' }).click(); await expectComposerText(input, 'Dictated words. Dictated words.'); assert.equal(transcriptions().at(-1).body, 'recorded-audio');
  await page.evaluate(() => { window.fakeAudio.throwStop = false; });
  // Explicit Transcribe and send uses the committed new draft, once. A failed
  // transcript keeps its original send intent until the user explicitly retries.
  await input.fill('Send this'); fail = true; await dictate();
  await page.getByRole('button', { name: 'Transcribe and send', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
  assert.equal(await page.evaluate(() => window.submitted?.length || 0), 0); fail = false;
  await page.getByRole('button', { name: 'Retry dictation' }).click();
  await expect.poll(() => page.evaluate(() => window.submitted?.length || 0)).toBe(1);
  assert.equal(await page.evaluate(() => window.submitted[0].text), 'Send this Dictated words.');
  hold = true; await dictate(); await page.getByRole('button', { name: 'Transcribe and send', exact: true }).click(); await expect(page.getByText('Transcribing', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel transcription', exact: true }).click(); release(); hold = false;
  await expectComposerText(input, 'Send this Dictated words.'); assert.equal(await page.evaluate(() => window.submitted.length), 1);
  // Native selected text is replaced; surrounding draft and an adjacent atom survive.
  await input.fill('left old right'); await composerCaretAtStart(input);
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
  await dictate(); await stop(); await expectComposerText(input, 'left Dictated words. right');
  await input.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z'); await expectComposerText(input, 'left old right');
  await input.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a'); await page.keyboard.type('prefix '); await page.evaluate(() => window.fixture.insertReference());
  const withReference = await readComposerText(input);
  await composerCaretAtStart(input); await dictate(); await stop();
  await expectComposerText(input, 'Dictated words. ' + withReference);
  assert.equal((await page.evaluate(() => window.fixture.getDocument())).references[0].from, 'Dictated words. prefix '.length);
  await input.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z'); await expectComposerText(input, withReference);
  await composerCaretAtStart(input); for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowRight');
  await dictate(); await stop(); await expectComposerText(input, 'prefix Dictated words. ');
  assert.equal(await input.locator('[data-reference-path]').count(), 0);
  await input.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z'); await expectComposerText(input, withReference); assert.equal(await input.locator('[data-reference-path]').count(), 1);
  // Provider switches and programmatic draft changes revoke capture immediately.
  await dictate(); await expect(page.getByText('Recording…', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Switch provider' }).click(); await expect(page.locator('.composer-dictation')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Switch provider' })).toBeFocused(); await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toHaveCount(0);
  await reload(); await dictate(); await expect(page.getByText('Recording…', { exact: true })).toBeVisible(); await page.evaluate(() => window.fixture.setDocument({ text: 'External update', references: [] })); await expectComposerText(input, 'External update'); await expect(page.locator('.composer-dictation')).toHaveCount(0);
  // The actual byte limit aborts capture without sending over-limit audio.
  const beforeLimit = transcriptions().length; maxBytes = 1; await dictate(); await expect(page.getByRole('alert')).toContainText('Recording is too large'); assert.equal(transcriptions().length, beforeLimit); maxBytes = 1000;
  await page.getByRole('button', { name: 'Cancel dictation', exact: true }).click();
  await page.evaluate(() => window.fakeAudio.enableVisual());
  await fs.mkdir('test-results', { recursive: true });
  for (const theme of ['light', 'dark']) { await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await page.setViewportSize({ width: 390, height: 720 }); await dictate(); await expect(page.locator('canvas')).toBeVisible(); await expect.poll(() => page.locator('canvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data].some((value,index) => index % 4 === 3 && value > 0))).toBe(true); await page.screenshot({ path: `test-results/codex-dictation-recording-${theme}.png` }); fail = true; await stop(); await expect(page.getByRole('alert')).toBeVisible(); await page.screenshot({ path: `test-results/codex-dictation-error-${theme}.png` }); await page.getByRole('button', { name: 'Cancel dictation', exact: true }).click(); fail = false; }
  assert.ok(await page.evaluate(() => window.fakeAudio.closed >= 2), 'visualizer contexts close on stop'); const draws = await page.evaluate(() => window.fakeAudio.draws); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.equal(await page.evaluate(() => window.fakeAudio.draws), draws, 'no waveform frames after stop');
  available = false; await page.goto(url); await expect(page.getByRole('textbox', { name: 'Draft' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toHaveCount(0);
  const beforeUnsupported = calls.length; available = true; await page.evaluate(() => { window.MediaRecorder = undefined; window.fixture.setKey('unsupported'); }); await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toHaveCount(0); assert.equal(calls.length, beforeUnsupported);
  assert.deepEqual(errors, []); console.log('Dictation PASS: fake devices only; draft/refs/undo, binary transport, IME, repeated stop, late permission, task/provider switch, cancellation, retry, stop failure, byte limit, light/dark mobile.');
} finally { await browser?.close(); await server.close(); await fs.rm(output, { recursive: true, force: true }); }
