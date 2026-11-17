import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { CodexDictation, registerDictationRoutes } from '../src/server/dictation.ts';
import { guard } from '../src/server/access.ts';
import { MAX_ATTACHMENT_BYTES } from '../src/shared.ts';
import { Codex } from '../src/server/codex.ts';

const audio = Buffer.from('isolated recorder bytes');
const token = (account = 'fixture-account', user = 'fixture-user', nonce = 'fixture-signature') => Buffer.from('{}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ exp: 2000000000, 'https://api.openai.com/auth': { chatgpt_account_id: account, chatgpt_user_id: user } })).toString('base64url') + '.' + nonce;
class Native extends EventEmitter {
  ready = true;
  userAgent = 'codex/fixture (isolated tests)';
  authMethod = 'chatgpt';
  authToken = token();
  calls: any[] = [];
  refresh?: () => void;
  async request(method: string, params: any) {
    this.calls.push({ method, params });
    assert.equal(method, 'getAuthStatus');
    if (params.refreshToken) this.refresh?.();
    return { authMethod: this.authMethod, authToken: params.includeToken ? this.authToken : null, requiresOpenaiAuth: true };
  }
}
const setup = (fetcher: typeof fetch = async () => { assert.fail('No HTTP call expected'); }) => {
  const native = new Native(), dictation = new CodexDictation(native, fetcher);
  return { native, dictation };
};

test('dictation capability is tokenless and only native ChatGPT sign-ins can create sessions', async () => {
  const { native, dictation } = setup();
  try {
    assert.deepEqual(await dictation.available(), { available: true });
    assert.deepEqual(native.calls, [{ method: 'getAuthStatus', params: { includeToken: false, refreshToken: false } }]);
    for (const method of ['apikey', 'chatgptAuthTokens', 'headers', 'agentIdentity', 'personalAccessToken']) {
      native.authMethod = method;
      assert.deepEqual(await dictation.available(), { available: false });
      await assert.rejects(dictation.start(), /Sign in to Codex with ChatGPT/);
    }
    native.ready = false; const count = native.calls.length;
    assert.deepEqual(await dictation.available(), { available: false }); assert.equal(native.calls.length, count);
    await assert.rejects(dictation.start(), /Sign in/);
  } finally { dictation.close(); }
});

test('dictation sends only multipart audio and optional language to the fixed official endpoint', async () => {
  let calls = 0;
  const { native, dictation } = setup(async (url, options) => {
    calls++;
    assert.equal(url, 'https://chatgpt.com/backend-api/transcribe');
    assert.equal(options?.method, 'POST'); assert.equal(options?.redirect, 'error');
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('authorization'), 'Bearer ' + native.authToken);
    assert.equal(headers.get('chatgpt-account-id'), 'fixture-account');
    assert.equal(headers.get('originator'), 'codex_vscode');
    assert.equal(headers.get('user-agent'), native.userAgent);
    assert.equal(headers.has('content-type'), false, 'FormData owns its boundary');
    const body = options?.body as FormData;
    assert.deepEqual([...body.keys()], ['file', 'language']);
    const file = body.get('file') as File;
    assert.equal(file.name, 'codex.webm'); assert.equal(file.type, 'audio/webm;codecs=opus');
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), audio); assert.equal(body.get('language'), 'zh-CN');
    return Response.json({ text: 'Check the references.', asset_pointer: 'private-asset', conversation_detail_metadata: { secret: true } });
  });
  try {
    const session = await dictation.start();
    assert.deepEqual(Object.keys(session), ['id', 'maxBytes']); assert.equal(session.maxBytes, MAX_ATTACHMENT_BYTES);
    assert.doesNotMatch(JSON.stringify(session), /fixture-account|fixture-user|signature/);
    assert.deepEqual(await dictation.transcribe(session.id, audio, 'audio/webm;codecs=opus', 'zh-CN'), { text: 'Check the references.' });
    assert.deepEqual(await dictation.transcribe(session.id, audio, 'audio/webm;codecs=opus', 'zh-CN'), { text: 'Check the references.' });
    assert.equal(calls, 1, 'Lost browser replies do not upload the same successful recording twice');
    await assert.rejects(dictation.transcribe(session.id, Buffer.from('changed'), 'audio/webm'), /new recording/);
  } finally { dictation.close(); }
});

test('a 401 refresh retries once for the same identity and never forwards an API key', async () => {
  const sent: string[] = [];
  const { native, dictation } = setup(async (_url, options) => {
    sent.push(new Headers(options?.headers).get('authorization')!);
    return sent.length === 1 ? new Response('private upstream body', { status: 401 }) : Response.json({ text: 'Ready.' });
  });
  try {
    native.refresh = () => { native.authToken = token('fixture-account', 'fixture-user', 'renewed-signature'); };
    const session = await dictation.start();
    assert.deepEqual(await dictation.transcribe(session.id, audio, 'audio/mp4'), { text: 'Ready.' });
    assert.equal(sent.length, 2); assert.notEqual(sent[0], sent[1]);
    assert.equal(native.calls.filter(call => call.params.refreshToken).length, 1);
  } finally { dictation.close(); }
  const changed = setup(async () => new Response('', { status: 401 }));
  try {
    changed.native.refresh = () => { changed.native.authMethod = 'apikey'; changed.native.authToken = 'fixture-api-key-never-send'; };
    const session = await changed.dictation.start();
    await assert.rejects(changed.dictation.transcribe(session.id, audio, 'audio/webm'), /Sign in/);
    assert.equal(changed.native.calls.filter(call => call.params.refreshToken).length, 1);
  } finally { changed.dictation.close(); }
});

test('account or user changes before upload or during refresh cancel instead of crossing identities', async () => {
  for (const duringRefresh of [false, true]) for (const changedUser of [false, true]) {
    let sent = 0;
    const { native, dictation } = setup(async () => { sent++; return new Response('', { status: 401 }); });
    try {
      const session = await dictation.start();
      const change = () => { native.authToken = token(changedUser ? 'fixture-account' : 'other-account', changedUser ? 'other-user' : 'fixture-user'); };
      if (duringRefresh) native.refresh = change; else change();
      await assert.rejects(dictation.transcribe(session.id, audio, 'audio/webm'), /account changed/);
      assert.equal(sent, Number(duringRefresh));
    } finally { dictation.close(); }
  }
});

test('account changes while a response is in flight cannot insert its transcript', async () => {
  const { native, dictation } = setup(async () => { native.authToken = token('other-account'); return Response.json({ text: 'Must not return this text.' }); });
  try {
    const session = await dictation.start();
    await assert.rejects(dictation.transcribe(session.id, audio, 'audio/webm'), /account changed/);
  } finally { dictation.close(); }
});

test('cancel, browser abort, account notifications and native disconnect abort upstream requests', async () => {
  for (const action of ['cancel', 'browser', 'account', 'disconnect']) {
    let started!: () => void; const pending = new Promise<void>(resolve => { started = resolve; });
    const { native, dictation } = setup(async (_url, options) => {
      started();
      return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true }));
    });
    try {
      const session = await dictation.start(), controller = new AbortController();
      const result = dictation.transcribe(session.id, audio, 'audio/webm', undefined, controller.signal);
      const rejected = assert.rejects(result, /cancelled|account changed/);
      await pending;
      if (action === 'cancel') dictation.cancel(session.id);
      if (action === 'browser') controller.abort();
      if (action === 'account') { native.authToken = token('other-account'); native.emit('notification', { method: 'account/updated' }); }
      if (action === 'disconnect') native.emit('disconnected');
      await rejected;
    } finally { dictation.close(); }
  }
});

test('same-account refresh notifications do not cancel recordings and concurrent upload is rejected', async () => {
  let release!: () => void, started!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
  const { native, dictation } = setup(async () => { started(); await wait; return Response.json({ text: '' }); });
  try {
    const session = await dictation.start(), result = dictation.transcribe(session.id, audio, 'audio/webm');
    await pending; native.emit('notification', { method: 'account/updated' });
    await assert.rejects(dictation.transcribe(session.id, audio, 'audio/webm'), /already being transcribed/);
    release(); assert.deepEqual(await result, { text: '' });
  } finally { dictation.close(); }
});

test('consecutive account notifications during a pending identity read retain the last switch', async () => {
  const { native, dictation } = setup();
  let release!: () => void;
  try {
    const session = await dictation.start(), original = native.request.bind(native);
    let first = true;
    native.request = async (method, params) => {
      const auth = await original(method, params);
      if (first) { first = false; await new Promise<void>(resolve => { release = resolve; }); }
      return auth;
    };
    native.emit('notification', { method: 'account/updated' });
    await new Promise(resolve => setImmediate(resolve));
    native.authToken = token('other-account');
    native.emit('notification', { method: 'account/updated' });
    const rejected = assert.rejects(dictation.transcribe(session.id, audio, 'audio/webm'), /account changed/);
    release(); await rejected;
    assert.equal(native.calls.length, 3, 'Initial binding plus both native account notifications are read');
  } finally { dictation.close(); }
});

test('an account update arriving while upload authorization resolves is checked before HTTP dispatch', async () => {
  const { native, dictation } = setup();
  try {
    const session = await dictation.start(), original = native.request.bind(native);
    let first = true;
    native.request = async (method, params) => {
      const auth = await original(method, params);
      if (first) {
        first = false;
        queueMicrotask(() => { native.authToken = token('other-account'); native.emit('notification', { method: 'account/updated' }); });
      }
      return auth;
    };
    await assert.rejects(dictation.transcribe(session.id, audio, 'audio/webm'), /account changed/);
  } finally { dictation.close(); }
});

test('invalid audio, malformed credentials and private upstream errors never leak to the browser', async () => {
  const { native, dictation } = setup(async () => { throw new Error('Authorization: Bearer private-network-credential'); });
  try {
    const session = await dictation.start();
    await assert.rejects(dictation.transcribe(session.id, Buffer.alloc(0), 'audio/webm'), /Record some audio/);
    await assert.rejects(dictation.transcribe(session.id, audio, 'text/plain'), /format/);
    await assert.rejects(dictation.transcribe(session.id, audio, 'audio/webm', 'en\r\nsecret'), /language/);
    await assert.rejects(dictation.transcribe(session.id, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1), 'audio/webm'), /25 MB/);
    await assert.rejects(dictation.transcribe(session.id, audio, 'audio/webm'), error => String(error) === 'Error: Unable to transcribe this recording. Try again.');
    native.authToken = 'private-malformed-credential';
    await assert.rejects(dictation.start(), error => String(error) === 'Error: Sign in to Codex with ChatGPT to use dictation.');
  } finally { dictation.close(); }
  for (const response of [new Response('private-upstream-error', { status: 500 }), Response.json({ wrong: 'private-result' })]) {
    const fixture = setup(async () => response);
    try { const session = await fixture.dictation.start(); await assert.rejects(fixture.dictation.transcribe(session.id, audio, 'audio/webm'), error => String(error) === 'Error: Unable to transcribe this recording. Try again.'); }
    finally { fixture.dictation.close(); }
  }
});

test('dictation HTTP routes require host authorization and CSRF, enforce body limits and return only text', async () => {
  const { native, dictation } = setup(async () => Response.json({ text: 'A spoken note.', private: 'never-forward' }));
  const app = Fastify({ logger: false });
  guard(app, { listener: { kind: 'local', port: 7274, publicOrigin: 'https://fixture.example.ts.net', owner: 'fixture-owner' }, csrf: 'fixture-csrf' });
  app.setErrorHandler((error, _request, reply) => reply.code((error as any).statusCode || 400).send({ error: (error as Error).message }));
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  registerDictationRoutes(app, dictation);
  const base = '/api/runtime/codex/dictation', headers = { host: '127.0.0.1:7274', 'x-papilot-token': 'fixture-csrf' };
  try {
    assert.equal((await app.inject({ url: base, headers: { host: 'untrusted.invalid' } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: base + '/sessions', headers: { host: headers.host } })).statusCode, 403);
    assert.equal(native.calls.length, 0);
    assert.deepEqual((await app.inject({ url: base, headers })).json(), { available: true });
    const session = (await app.inject({ method: 'POST', url: base + '/sessions', headers })).json();
    const url = base + '/sessions/' + session.id + '/transcribe';
    assert.equal((await app.inject({ method: 'POST', url, headers: { host: headers.host, 'content-type': 'application/octet-stream' }, payload: audio })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url, headers: { ...headers, 'content-type': 'application/octet-stream', 'x-papilot-audio-type': 'audio/webm' }, payload: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1) })).statusCode, 413);
    const response = await app.inject({ method: 'POST', url, headers: { ...headers, 'content-type': 'application/octet-stream', 'x-papilot-audio-type': 'audio/webm' }, payload: audio });
    assert.equal(response.statusCode, 200, response.body); assert.deepEqual(response.json(), { text: 'A spoken note.' });
    assert.doesNotMatch(response.body, /fixture-account|fixture-user|signature|never-forward/);
    assert.equal((await app.inject({ method: 'POST', url: base + '/sessions/' + session.id + '/cancel', headers })).statusCode, 200);
  } finally { await app.close(); }
});

test('closing the browser HTTP connection cancels its upstream transcription', { timeout: 5000 }, async () => {
  let started!: () => void, stopped!: () => void;
  const active = new Promise<void>(resolve => { started = resolve; }), aborted = new Promise<void>(resolve => { stopped = resolve; });
  const { dictation } = setup(async (_url, options) => {
    started();
    return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => { stopped(); reject(options.signal!.reason); }, { once: true }));
  });
  const app = Fastify({ logger: false });
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  registerDictationRoutes(app, dictation);
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const session = await dictation.start();
    const request = http.request(address + '/api/runtime/codex/dictation/sessions/' + session.id + '/transcribe', {
      method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-papilot-audio-type': 'audio/webm', 'content-length': audio.length },
    });
    request.on('error', () => {}); request.end(audio);
    await active; request.destroy(); await aborted;
  } finally { await app.close(); }
});

test('Codex retains only a valid public initialize user agent and clears it when disconnected', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studybuddy-dictation-native-'));
  const script = path.join(directory, 'fixture.mjs');
  fs.writeFileSync(script, `import { createInterface } from 'node:readline';
createInterface({input:process.stdin}).on('line', line => {
  const request=JSON.parse(line);
  if(request.method==='initialize')process.stdout.write(JSON.stringify({id:request.id,result:{userAgent:process.argv[2],codexHome:'private-fixture-path'}})+'\\n');
});
`);
  try {
    for (const ua of ['codex/fixture (isolated)', 'bad\r\nheader']) {
      const native = new Codex(process.execPath, [script, ua], { PATH: process.env.PATH, HOME: directory, CODEX_HOME: directory }, 'linux');
      try { await native.start(); assert.equal(native.userAgent, ua.startsWith('bad') ? undefined : ua); }
      finally { const closed = native.child ? once(native.child, 'close') : Promise.resolve(); native.close(); await closed; }
      assert.equal(native.userAgent, undefined);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
