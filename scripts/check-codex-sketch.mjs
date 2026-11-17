import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '../engine/node_modules/playwright/index.mjs';

// A real bundled component, isolated from root dist and all live agent services.
// Integration checks exercise the same onSave contract through AttachmentDraft.
const temp = await mkdtemp(path.join(tmpdir(), 'studybuddy-sketch-'));
const source = `import React,{useState,useSyncExternalStore} from 'react';import{createRoot}from'react-dom/client';import{CodexSketchEditor}from'${path.resolve('src/web/codex-sketch.tsx')}';import{useComposerSketch}from'${path.resolve('src/web/composer-sketch.tsx')}';import{AttachmentDraft}from'${path.resolve('src/web/attachment-draft.ts')}';
window.saves=[];window.failSave=false;window.sketchClosed=0;function App(){const[open,setOpen]=useState(false),[doc,setDoc]=useState(),[key,setKey]=useState(0);return <><button onClick={()=>{setDoc(undefined);setKey(key+1);setOpen(true)}}>New sketch</button><button onClick={()=>{setKey(key+1);setOpen(true)}}>Edit sketch</button>{open&&<CodexSketchEditor key={key} initialDocument={doc} onClose={()=>{window.sketchClosed++;setOpen(false)}} onSave={async(file,document,signal)=>{if(window.failSave)throw Error('Fixture upload failed');const bytes=Array.from(new Uint8Array(await file.arrayBuffer()));window.saves.push({name:file.name,type:file.type,bytes,document,aborted:signal.aborted});setDoc(document);}}/>}</>};
const fixtureDrafts=[new AttachmentDraft('sketch-test-a',localStorage),new AttachmentDraft('sketch-test-b',localStorage)];window.uploads=[];window.discards=[];window.holdUpload=false;function HookApp(){const[index,setIndex]=useState(0),[enabled,setEnabled]=useState(true);window.sketchControl={setIndex,setEnabled};const draft=fixtureDrafts[index];const snapshot=useSyncExternalStore(draft.subscribe,draft.getSnapshot);const sketch=useComposerSketch({draft,enabled,onClose:()=>{},discard:file=>window.discards.push(file.id),upload:async(file,signal)=>{const receipt={name:file.name,aborted:false,project:index};window.uploads.push(receipt);if(window.holdUpload)await new Promise((resolve,reject)=>{window.releaseUpload=resolve;signal.addEventListener('abort',()=>{receipt.aborted=true;reject(new DOMException('Aborted','AbortError'))},{once:true})});return{id:'upload-'+window.uploads.length,projectId:'project-'+index,name:file.name,size:file.size,mime:file.type}}});return <><button onClick={()=>sketch.open()}>Open upload sketch</button><div data-entries>{snapshot.entries.map(entry=><button key={entry.key} disabled={entry.uploading} onClick={()=>sketch.edit(entry.key)}>{entry.name} {entry.attachment?.id}</button>)}</div>{sketch.editor}</>};createRoot(document.getElementById('root')).render(location.search.includes('hook')?<HookApp/>:<App/>);`;
let browser, server;
try {
  const bundled = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: process.cwd() }, jsx: 'automatic', bundle: true, format: 'esm', write: false, outfile: 'sketch.js', sourcemap: false });
  const js = bundled.outputFiles.find(file => file.path.endsWith('.js')).text, css = bundled.outputFiles.find(file => file.path.endsWith('.css')).text;
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/sketch.css"><style>html,body,#root{height:100%;margin:0;font-family:system-ui}body{background:#f8f8f8}button{font:inherit}html[data-theme=dark]{--bg:#212121;--fg:#eee;--border:#444}html[data-theme=dark] body{background:#181818}</style></head><body><div id="root"></div><script type="module" src="/sketch.js"></script></body></html>`;
  await writeFile(path.join(temp, 'sketch.js'), js);
  server = createServer((request, response) => { const route = request.url?.split('?')[0]; response.setHeader('Content-Type', route === '/sketch.js' ? 'text/javascript' : route === '/sketch.css' ? 'text/css' : 'text/html'); response.end(route === '/sketch.js' ? js : route === '/sketch.css' ? css : html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, colorScheme: 'light' });
  const page = await context.newPage(), errors = []; page.setDefaultTimeout(7000); page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const button = name => page.getByRole('button', { name, exact: true });
  const canvas = page.getByRole('application', { name: 'Sketch canvas' });
  const visible = async locator => { await locator.waitFor({ state: 'visible' }); assert.equal(await locator.isVisible(), true); };
  const draw = async (x, y, dx, dy) => { const box = await canvas.boundingBox(); await page.mouse.move(box.x + x, box.y + y); await page.mouse.down(); await page.mouse.move(box.x + x + dx, box.y + y + dy, { steps: 12 }); await page.mouse.up(); };
  const objects = async () => page.evaluate(() => window.saves.at(-1).document.objects);
  await button('New sketch').click(); await visible(canvas);
  assert.equal(await button('Attach sketch').isDisabled(), true);
  assert.equal(await button('Undo').isDisabled(), true);
  await draw(160, 140, 180, 50);
  assert.equal(await button('Undo').isEnabled(), true);
  await button('Undo').click(); assert.equal(await button('Attach sketch').isDisabled(), true);
  await button('Redo').click(); assert.equal(await button('Attach sketch').isEnabled(), true);
  await button('Close sketch editor').click(); await visible(page.getByRole('dialog', { name: 'Discard changes?' }));
  await page.screenshot({ path: 'test-results/codex-sketch-discard.png' });
  await button('Keep editing').click(); await visible(canvas);
  await button('Shapes').click(); await visible(button('Heart')); await button('Rectangle').click(); await draw(200, 250, 180, 110);
  await button('Select').click(); const box = await canvas.boundingBox(); await page.mouse.click(box.x + 250, box.y + 250); await canvas.press('ArrowRight');
  await canvas.press('Delete'); await canvas.press('ControlOrMeta+z');
  await button('Text').click(); await canvas.click({ position: { x: 180, y: 420 } });
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Sketch text\n第二行');
  await page.getByRole('textbox', { name: 'Text', exact: true }).press('ControlOrMeta+Enter');
  await button('Pen').click();
  await page.evaluate(() => { window.failSave = true; }); await button('Attach sketch').click(); await visible(page.getByRole('alert')); await visible(canvas);
  await page.evaluate(() => { window.failSave = false; }); await button('Attach sketch').click(); await page.waitForFunction(() => window.saves.length === 1);
  const saved = await page.evaluate(() => window.saves[0]);
  assert.equal(saved.name, 'Sketch.png'); assert.equal(saved.type, 'image/png'); assert.deepEqual(saved.bytes.slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(saved.document.objects.length, 3); assert.deepEqual(saved.document.objects.map(object => object.kind), ['pen', 'rectangle', 'text']); assert.equal(saved.document.objects[2].text, 'Sketch text\n第二行');
  const png = Buffer.from(saved.bytes); assert.ok(png.readUInt32BE(16) > 250); assert.ok(png.readUInt32BE(20) > 300); assert.equal(saved.aborted, false);
  await mkdir('test-results', { recursive: true }); await writeFile('test-results/codex-sketch-export.png', png);
  await button('Edit sketch').click(); await visible(canvas); await button('Close sketch editor').click(); assert.equal(await page.getByRole('dialog').count(), 0);
  await button('Edit sketch').click(); await button('Pen').click(); await draw(400, 180, 100, 0);
  await button('Close sketch editor').click(); await button('Discard changes').click();
  await button('Edit sketch').click(); await button('Attach sketch').click(); assert.equal(await page.evaluate(() => window.saves.length), 1);
  await button('Edit sketch').click();
  await button('Eraser').click(); assert.equal(await page.getByRole('slider', { name: 'Eraser size' }).getAttribute('value'), '32');
  await draw(240, 120, 0, 90); await button('Attach sketch').click(); await page.waitForFunction(() => window.saves.length === 2);
  assert.ok((await objects())[0].erasures?.length); assert.equal((await objects())[2].erasures, undefined);
  await button('Edit sketch').click(); await button('Pen').click();
  const cancelBox = await canvas.boundingBox(); await page.mouse.move(cancelBox.x + 90, cancelBox.y + 300); await page.mouse.down(); await page.mouse.move(cancelBox.x + 130, cancelBox.y + 340);
  await canvas.dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up();
  await button('Attach sketch').click(); assert.equal(await page.evaluate(() => window.saves.length), 2);
  for (const theme of ['light', 'dark']) for (const viewport of [{ name: 'desktop', width: 1024, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await button('Edit sketch').click(); await visible(canvas);
    const geometry = await page.getByRole('dialog', { name: 'Sketch editor' }).evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, overflow: document.documentElement.scrollWidth > innerWidth, radius: getComputedStyle(element).borderTopLeftRadius }));
    assert.equal(geometry.overflow, false); assert.ok(geometry.width <= viewport.width); assert.ok(geometry.height < viewport.height);
    assert.equal(await button('Select').count(), viewport.name === 'desktop' ? 1 : 0); assert.equal(await button('Redo').count(), viewport.name === 'desktop' ? 1 : 0);
    await page.screenshot({ path: `test-results/codex-sketch-${viewport.name}-${theme}.png` });
    await button('Shapes').click(); await page.screenshot({ path: `test-results/codex-sketch-shapes-${viewport.name}-${theme}.png` }); await button('Shapes').press('Escape');
    await button('Close sketch editor').click();
  }
  await button('New sketch').click(); await draw(100, 160, 60, 100); await button('Close sketch editor').click(); await button('Discard changes').click();
  await page.setViewportSize({ width: 699, height: 794 }); await page.evaluate(() => document.documentElement.dataset.theme = 'light');
  await button('New sketch').click();
  const size = await page.getByRole('dialog', { name: 'Sketch editor' }).boundingBox(); assert.ok(Math.abs(size.width - 635) < 2, JSON.stringify(size)); assert.ok(Math.abs(size.height - 635) < 2, JSON.stringify(size));
  for (const [index, shape] of ['Line', 'Arrow', 'Rectangle', 'Ellipse', 'Triangle', 'Diamond', 'Star', 'Heart'].entries()) {
    await button('Shapes').click(); await button(shape).click(); await draw(130 + index % 2 * 220, 120 + Math.floor(index / 2) * 110, 130, 70);
  }
  await button('Attach sketch').click(); await page.waitForFunction(() => window.saves.length === 3);
  assert.deepEqual((await objects()).map(object => object.kind), ['line', 'arrow', 'rectangle', 'ellipse', 'triangle', 'diamond', 'star', 'heart']);
  await button('Edit sketch').click(); await button('Select').click();
  await canvas.click({ position: { x: 130, y: 230 } });
  await canvas.evaluate(element => { const transfer = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('copy', { clipboardData: transfer, bubbles: true })); element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true })); });
  await button('Attach sketch').click(); await page.waitForFunction(() => window.saves.length === 4);
  const pasted = await objects(); assert.equal(pasted.length, 9); assert.equal(pasted.at(-1).kind, 'rectangle'); assert.notEqual(pasted[2].id, pasted[8].id); assert.equal(pasted[8].points[0].x, pasted[2].points[0].x + 16);
  await button('Edit sketch').click(); await button('Select').click();
  await canvas.click({ position: { x: 135, y: 235 } });
  await draw(124, 224, -30, -20); // top-left selection handle, includes half-stroke bounds
  await canvas.press('ArrowRight'); await button('Use red').click(); await button('Attach sketch').click(); await page.waitForFunction(() => window.saves.length === 5);
  const resized = (await objects())[2]; assert.equal(resized.color, '#dc2626'); assert.ok(resized.points[0].x < pasted[2].points[0].x); assert.ok(resized.width > pasted[2].width, JSON.stringify({ resized, before: pasted[2] }));
  await button('New sketch').click(); await button('Shapes').click(); await button('Shapes').press('Escape'); assert.equal(await button('Heart').count(), 0); await visible(canvas);
  await button('Pen').click(); const widthSlider = page.getByRole('slider', { name: 'Stroke width' }); await widthSlider.press('ArrowUp'); await widthSlider.press('ArrowUp');
  await button('Use blue').click(); await draw(180, 150, 120, 80); await button('Attach sketch').click(); await page.waitForFunction(() => window.saves.length === 6);
  assert.equal((await objects())[0].width, 14); assert.equal((await objects())[0].color, '#2563eb');
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await button('New sketch').click(); await draw(180, 150, 120, 80);
  await page.screenshot({ path: 'test-results/codex-sketch-reference-dark.png' }); await button('Attach sketch').click(); await page.waitForFunction(() => window.saves.length === 7);
  assert.equal((await objects())[0].color, '#ffffff');
  assert.equal(await page.getByRole('dialog').count(), 0); assert.deepEqual(errors, []);
  await page.goto(`http://127.0.0.1:${server.address().port}/?hook`);
  await button('Open upload sketch').click(); await draw(140, 140, 150, 60); await button('Attach sketch').click();
  await page.locator('[data-entries] button').waitFor(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-entries] button').innerText(), 'Sketch.png upload-1');
  await page.locator('[data-entries] button').click(); await draw(140, 240, 150, 60); await button('Attach sketch').click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-entries] button').count(), 1); assert.equal(await page.locator('[data-entries] button').innerText(), 'Sketch.png upload-2'); assert.deepEqual(await page.evaluate(() => window.discards), ['upload-1']);
  await page.locator('[data-entries] button').click(); await draw(140, 340, 150, 60); await page.evaluate(() => window.holdUpload = true); await button('Attach sketch').click();
  await page.waitForFunction(() => window.uploads.length === 3); await visible(canvas); // own pending upload must not disable the hook
  await page.evaluate(() => window.sketchControl.setEnabled(false)); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.uploads[2].aborted); assert.equal(await page.locator('[data-entries] button').innerText(), 'Sketch.png upload-2');
  await button('Open upload sketch').click(); assert.equal(await page.getByRole('dialog').count(), 0);
  await page.evaluate(() => { window.sketchControl.setEnabled(true); window.holdUpload = false; });
  await page.locator('[data-entries] button').click(); await draw(140, 340, 150, 60); await page.evaluate(() => window.holdUpload = true); await button('Attach sketch').click();
  await page.waitForFunction(() => window.uploads.length === 4); await page.evaluate(() => window.sketchControl.setIndex(1)); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await page.waitForFunction(() => window.uploads[3].aborted);
  assert.equal(await page.locator('[data-entries] button').count(), 0); await page.evaluate(() => window.sketchControl.setIndex(0)); assert.equal(await page.locator('[data-entries] button').innerText(), 'Sketch.png upload-2');
  assert.deepEqual(errors, []);
  console.log('Codex Sketch: drawing, shapes, selection, text, undo/redo, cancel, PNG save, retry, re-edit and theme/mobile checks passed.');
} finally {
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true });
}
