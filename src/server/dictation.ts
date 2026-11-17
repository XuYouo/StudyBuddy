import { createHash, randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type { FastifyInstance } from 'fastify';
import { MAX_ATTACHMENT_BYTES } from '../shared.ts';

// The official extension's buffered fallback uses this ChatGPT endpoint, not
// the API-key audio API. Neither the browser nor host configuration chooses it.
const TRANSCRIBE = 'https://chatgpt.com/backend-api/transcribe';
const SESSION_LIFETIME = 30 * 60 * 1000;
const REQUEST_TIMEOUT = 120_000;
// i18n: error
const SIGN_IN = 'Sign in to Codex with ChatGPT to use dictation.';
// i18n: error
const CHANGED = 'The ChatGPT account changed. Start a new recording.';
// i18n: error
const FAILED = 'Unable to transcribe this recording. Try again.';
// i18n: error
const CANCELLED = 'Dictation was cancelled.';
// i18n: error
const TIMEOUT = 'Dictation timed out. Try again.';
type NativeAuth = Pick<EventEmitter, 'on' | 'off'> & { ready: boolean; userAgent?: string; request(method: string, params: unknown, timeout?: number): Promise<any> };
type Identity = { accountId: string; userId: string };
type Session = { identity: Identity; controller: AbortController; timer: NodeJS.Timeout; inputHash?: string; busy?: boolean; result?: { text: string } };

class DictationError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}
const sameIdentity = (a: Identity, b: Identity) => a.accountId === b.accountId && a.userId === b.userId;

// This is identity extraction from a token supplied by the trusted native auth
// bridge, not acceptance of a JWT supplied by the browser. Never persist it.
function credential(value: any): { token: string; identity: Identity } {
  if (value?.authMethod !== 'chatgpt' || value.requiresOpenaiAuth === false || typeof value.authToken !== 'string') throw new DictationError(SIGN_IN, 403);
  const token = value.authToken;
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new DictationError(SIGN_IN, 403);
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    const auth = claims['https://api.openai.com/auth'];
    const accountId = auth?.chatgpt_account_id ?? auth?.account_id, userId = auth?.user_id ?? auth?.chatgpt_user_id;
    if (![accountId, userId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x20\x7f]/.test(value)) || !Number.isSafeInteger(claims.exp) || claims.exp <= 0) throw new Error();
    return { token, identity: { accountId, userId } };
  } catch { throw new DictationError(SIGN_IN, 403); }
}

function audioOptions(type: unknown, language: unknown) {
  if (typeof type !== 'string' || !/^audio\/(?:webm|mp4|ogg|wav|x-wav|mpeg|aac|x-m4a|flac)(?:\s*;\s*codecs=[\w., "-]+)?$/i.test(type)) throw new DictationError('This recording format is not supported.');
  if (language !== undefined && (typeof language !== 'string' || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language))) throw new DictationError('Choose a valid dictation language.');
  return { type, language: language as string | undefined, extension: type.split(/[;/]/)[1].replace(/^x-/, '') };
}

export class CodexDictation {
  private sessions = new Map<string, Session>();
  private generation = 0;
  private closed = false;
  private checking: Promise<void> | undefined;
  private accountRevision = 0;
  private checkedRevision = 0;
  constructor(private native: NativeAuth, private fetcher: typeof fetch = fetch) {
    native.on('disconnected', this.disconnected);
    native.on('notification', this.notification);
  }
  async available() {
    if (this.closed || !this.native.ready) return { available: false };
    try {
      const status = await this.native.request('getAuthStatus', { includeToken: false, refreshToken: false }, 20000);
      return { available: this.native.ready && status?.authMethod === 'chatgpt' && status.requiresOpenaiAuth !== false };
    } catch { return { available: false }; }
  }
  private async authorize(refreshToken = false) {
    const generation = this.generation;
    if (this.closed || !this.native.ready) throw new DictationError(SIGN_IN, 403);
    let result;
    try { result = await this.native.request('getAuthStatus', { includeToken: true, refreshToken }, 20000); }
    catch { throw new DictationError(SIGN_IN, 403); }
    if (this.closed || !this.native.ready || generation !== this.generation) throw new DictationError(CHANGED, 409);
    return credential(result);
  }
  async start() {
    const generation = this.generation;
    let identity: Identity;
    while (true) {
      await this.settledAccount();
      const revision = this.accountRevision, auth = await this.authorize();
      await this.settledAccount();
      if (generation !== this.generation) throw new DictationError(CHANGED, 409);
      if (revision === this.accountRevision) { identity = auth.identity; break; }
    }
    const id = randomUUID(), controller = new AbortController();
    // Abandoned tabs keep no audio or credentials. Expire their identity lease
    // independently of recording length so forgotten sessions cannot accumulate.
    const timer = setTimeout(() => this.cancel(id), SESSION_LIFETIME); timer.unref();
    this.sessions.set(id, { identity, controller, timer });
    return { id, maxBytes: MAX_ATTACHMENT_BYTES };
  }
  cancel(id: string, message = CANCELLED) {
    const session = this.sessions.get(id);
    if (session) { clearTimeout(session.timer); session.controller.abort(new DictationError(message, 409)); this.sessions.delete(id); }
    return { ok: true };
  }
  private disconnected = () => {
    this.generation++;
    for (const id of this.sessions.keys()) this.cancel(id, CHANGED);
  };
  private notification = (event: { method?: string }) => {
    if (event.method !== 'account/updated') return;
    this.accountRevision++;
    if (this.sessions.size) this.checkAccount();
    else this.checkedRevision = this.accountRevision;
  };
  private checkAccount() {
    if (this.checking || this.closed) return;
    // A token refresh may emit the same account again. Only a changed identity
    // invalidates its recordings. Every notification advances the revision so a
    // second switch arriving during this read cannot be silently discarded.
    this.checking = (async () => {
      while (this.checkedRevision < this.accountRevision && !this.closed) {
        if (!this.sessions.size) { this.checkedRevision = this.accountRevision; break; }
        const revision = this.accountRevision;
        try {
          const { identity } = await this.authorize();
          for (const [id, session] of this.sessions) if (!sameIdentity(session.identity, identity)) this.cancel(id, CHANGED);
        } catch { for (const id of this.sessions.keys()) this.cancel(id, CHANGED); }
        this.checkedRevision = revision;
      }
    })().finally(() => {
      this.checking = undefined;
      if (this.checkedRevision < this.accountRevision && !this.closed) this.checkAccount();
    });
  }
  private async settledAccount() {
    while (this.checking || this.checkedRevision < this.accountRevision) {
      if (this.closed) throw new DictationError(CHANGED, 409);
      this.checkAccount(); await this.checking;
    }
  }
  async transcribe(id: string, audio: unknown, type: unknown, language?: unknown, signal?: AbortSignal) {
    const session = this.sessions.get(id);
    if (!session) throw new DictationError('This recording session has expired. Start a new recording.', 409);
    if (!Buffer.isBuffer(audio) || !audio.length) throw new DictationError('Record some audio before transcribing.');
    if (audio.length > MAX_ATTACHMENT_BYTES) throw new DictationError('Recordings must be 25 MB or smaller.', 413);
    const options = audioOptions(type, language), inputHash = createHash('sha256').update(audio).update(JSON.stringify(options)).digest('hex');
    if (session.inputHash && session.inputHash !== inputHash) throw new DictationError('Start a new recording before changing its audio.', 409);
    if (session.busy) throw new DictationError('This recording is already being transcribed.', 409);
    const cancelled = () => this.cancel(id);
    signal?.addEventListener('abort', cancelled, { once: true });
    const combined = AbortSignal.any([session.controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT), ...(signal ? [signal] : [])]);
    const current = async (refresh = false) => {
      while (true) {
        combined.throwIfAborted(); await this.settledAccount(); combined.throwIfAborted();
        const revision = this.accountRevision, auth = await this.authorize(refresh); combined.throwIfAborted();
        refresh = false;
        await this.settledAccount(); combined.throwIfAborted();
        if (revision !== this.accountRevision) continue;
        if (!sameIdentity(auth.identity, session.identity)) { this.cancel(id, CHANGED); throw new DictationError(CHANGED, 409); }
        return { ...auth, revision };
      }
    };
    session.busy = true; session.inputHash = inputHash;
    try {
      let auth = await current();
      if (session.result) return session.result;
      const body = new FormData();
      body.set('file', new Blob([new Uint8Array(audio)], { type: options.type }), 'codex.' + options.extension);
      if (options.language) body.set('language', options.language);
      for (let attempt = 0; ; attempt++) {
        await this.settledAccount(); combined.throwIfAborted();
        while (auth.revision !== this.accountRevision) {
          auth = await current(); await this.settledAccount(); combined.throwIfAborted();
        }
        combined.throwIfAborted();
        const response = await this.fetcher(TRANSCRIBE, { method: 'POST', redirect: 'error', signal: combined, body,
          headers: { Authorization: 'Bearer ' + auth.token, 'ChatGPT-Account-Id': auth.identity.accountId, originator: 'codex_vscode', ...(this.native.userAgent ? { 'User-Agent': this.native.userAgent } : {}) } });
        if (response.status === 401 && attempt === 0) {
          await response.body?.cancel();
          const refreshed = await current(true);
          if (refreshed.token === auth.token) throw new DictationError(SIGN_IN, 401);
          auth = refreshed; continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 401) throw new DictationError(SIGN_IN, 401);
          if (response.status === 403) throw new DictationError('Dictation is not available for this ChatGPT account.', 403);
          throw new DictationError(FAILED, response.status === 429 ? 429 : 502);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new DictationError(FAILED, 502);
        const chunks: Uint8Array[] = []; let length = 0;
        try {
          while (true) {
            combined.throwIfAborted(); const { value, done } = await reader.read(); if (done) break;
            length += value.length;
            if (length > MAX_ATTACHMENT_BYTES) throw new DictationError(FAILED, 502);
            chunks.push(value);
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!result || typeof result.text !== 'string') throw new DictationError(FAILED, 502);
        await current(); // Never insert a reply into a newly selected account.
        session.result = { text: result.text };
        return session.result;
      }
    } catch (error) {
      if (session.controller.signal.aborted) throw session.controller.signal.reason;
      if (combined.aborted) throw new DictationError(signal?.aborted ? CANCELLED : TIMEOUT, signal?.aborted ? 409 : 504);
      // Native errors, network errors and upstream bodies may contain credentials
      // or private diagnostics. Only locally constructed messages leave the host.
      throw error instanceof DictationError ? error : new DictationError(FAILED, 502);
    } finally { session.busy = false; signal?.removeEventListener('abort', cancelled); }
  }
  close() {
    this.closed = true; this.disconnected();
    this.native.off('disconnected', this.disconnected); this.native.off('notification', this.notification);
  }
}

export function registerDictationRoutes(app: FastifyInstance, dictation: CodexDictation) {
  const base = '/api/runtime/codex/dictation';
  app.addHook('onClose', async () => { dictation.close(); });
  app.get(base, () => dictation.available());
  app.post(base + '/sessions', () => dictation.start());
  app.post<{ Params: { id: string } }>(base + '/sessions/:id/cancel', request => dictation.cancel(request.params.id));
  app.post<{ Params: { id: string } }>(base + '/sessions/:id/transcribe', { bodyLimit: MAX_ATTACHMENT_BYTES }, async (request, reply) => {
    const controller = new AbortController();
    const abort = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.once('close', abort);
    try { return await dictation.transcribe(request.params.id, request.body, request.headers['x-papilot-audio-type'], request.headers['x-papilot-language'], controller.signal); }
    finally { reply.raw.off('close', abort); }
  });
}
