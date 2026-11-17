import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ComposerInput } from './composer-input.ts';
import { errorText, t } from './i18n.ts';
import { CodexIcon } from './codex-icons.tsx';
import './composer-dictation.css';

export interface DictationApi {
  available(signal: AbortSignal): Promise<boolean>;
  start(): Promise<{ id: string; maxBytes: number }>;
  transcribe(id: string, audio: Blob, signal: AbortSignal): Promise<string>;
  cancel(id: string): Promise<void>;
}
export function dictationApi(token: () => string): DictationApi {
  async function request(path: string, method: 'GET' | 'POST', signal?: AbortSignal, audio?: Blob) {
    const response = await fetch('/api/runtime/codex/dictation' + path, { method, signal, headers: {
      'X-Papilot-Token': token(), ...(audio ? { 'Content-Type': 'application/octet-stream', 'X-Papilot-Audio-Type': audio.type } : {}),
    }, body: audio });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ? errorText(value.error) : t('Request failed. Please try again.'));
    return value;
  }
  return { available: signal => request('', 'GET', signal).then(value => value.available === true), start: () => request('/sessions', 'POST'),
    transcribe: (id, audio, signal) => request(`/sessions/${encodeURIComponent(id)}/transcribe`, 'POST', signal, audio).then(value => value.text),
    cancel: id => request(`/sessions/${encodeURIComponent(id)}/cancel`, 'POST').then(() => {}) };
}
type Phase = 'starting' | 'recording' | 'stopping' | 'transcribing' | 'error';
type Session = { key: string; snapshot: string; from: number; to: number; id?: string; maxBytes: number; chunks: Blob[]; bytes: number; phase: Phase; action?: 'insert' | 'send'; stream?: MediaStream; recorder?: MediaRecorder; audio?: Blob; controller?: AbortController; stopVisual?: () => void; unsubscribe?: () => void; error?: string };
const snapshot = (input: ComposerInput) => JSON.stringify([input.value, input.references]);
const supported = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
const stopTracks = (session: Session) => { session.stream?.getTracks().forEach(track => track.stop()); session.stopVisual?.(); session.stopVisual = undefined; };

// Buffered native recording: audio stays in this composer until explicit stop,
// retry or cancel. Neither the microphone nor a model is started on mount.
export function useComposerDictation({ inputRef, contextKey, enabled, api, onSubmit }: { inputRef: RefObject<ComposerInput | null>; contextKey?: string; enabled: boolean; api: DictationApi; onSubmit?: () => void }) {
  const options = useRef({ contextKey, enabled, api, onSubmit }); options.current = { contextKey, enabled, api, onSubmit };
  const session = useRef<Session | null>(null), canvas = useRef<HTMLCanvasElement>(null), cancelButton = useRef<HTMLButtonElement>(null), stopButton = useRef<HTMLButtonElement>(null);
  const [available, setAvailable] = useState(false), [state, setState] = useState<{ phase: Phase; error?: string } | null>(null);
  const pendingSend = useRef<{ key: string; snapshot: string } | null>(null);
  const pendingFocus = useRef<{ key: string | undefined; input: ComposerInput } | null>(null);
  useLayoutEffect(() => {
    if (state) return;
    const pending = pendingFocus.current; pendingFocus.current = null;
    if (pending && options.current.enabled && options.current.contextKey === pending.key && inputRef.current === pending.input) pending.input.focus();
  });
  useLayoutEffect(() => {
    const pending = pendingSend.current; if (!pending) return; pendingSend.current = null;
    if (options.current.enabled && options.current.contextKey === pending.key && inputRef.current && snapshot(inputRef.current) === pending.snapshot && !inputRef.current.composing) options.current.onSubmit?.();
  });
  useLayoutEffect(() => {
    if (state) (state.phase === 'recording' ? stopButton.current : cancelButton.current)?.focus();
  }, [state?.phase]);
  const valid = (active: Session) => session.current === active && options.current.enabled && options.current.contextKey === active.key && !!inputRef.current && snapshot(inputRef.current) === active.snapshot;
  function release(active: Session) {
    active.unsubscribe?.(); active.controller?.abort(); active.stopVisual?.();
    if (active.recorder?.state !== 'inactive') { try { active.recorder?.stop(); } catch { /* Tracks below always release the device. */ } }
    stopTracks(active);
    if (active.id) void api.cancel(active.id).catch(() => {});
  }
  function cancel(focus = true) {
    const active = session.current; session.current = null; pendingSend.current = null;
    pendingFocus.current = focus && inputRef.current ? { key: options.current.contextKey, input: inputRef.current } : null;
    if (active) release(active);
    setState(null);
  }
  useEffect(() => {
    const controller = new AbortController(); setAvailable(false);
    if (contextKey && enabled && supported()) void api.available(controller.signal).then(value => { if (!controller.signal.aborted) setAvailable(value); }).catch(() => {});
    return () => { controller.abort(); cancel(false); };
  }, [contextKey, enabled, api]);
  function fail(active: Session, error: unknown) {
    if (!valid(active)) return;
    active.phase = 'error'; active.error = error instanceof Error ? error.message : t('Unable to transcribe audio. Please try again.');
    setState({ phase: 'error', error: active.error });
  }
  async function transcribe(active: Session) {
    if (!valid(active) || !active.audio || !active.id || active.phase === 'transcribing') return;
    active.phase = 'transcribing'; active.controller = new AbortController(); setState({ phase: active.phase });
    try {
      const text = await api.transcribe(active.id, active.audio, active.controller.signal);
      if (!valid(active)) return;
      if (!text.trim()) throw new Error(t('No speech detected. Please try again.'));
      const input = inputRef.current!;
      if (input.composing) throw new Error(t('Finish typing before inserting the transcript.'));
      // Cancel the session before applying the transaction so the draft-change
      // subscription cannot mistake our own insertion for an external edit.
      session.current = null; release(active); pendingFocus.current = { key: active.key, input }; setState(null);
      const before = input.value.slice(0, active.from), after = input.value.slice(active.to);
      const insertion = (before && !/\s$/.test(before) ? ' ' : '') + text.trim() + (after && !/^\s/.test(after) ? ' ' : '');
      input.replaceRange(active.from, active.to, insertion, true);
      if (active.action === 'send') pendingSend.current = { key: active.key, snapshot: snapshot(input) };
    } catch (error) { if (!active.controller.signal.aborted) fail(active, error); }
  }
  function finish(active: Session) {
    stopTracks(active);
    if (!valid(active)) return;
    active.audio = new Blob(active.chunks, { type: active.recorder?.mimeType || active.chunks[0]?.type || 'audio/webm' });
    if (!active.audio.size) { fail(active, new Error(t('No audio recorded. Please try again.'))); return; }
    if (active.error) { fail(active, new Error(active.error)); return; }
    void transcribe(active);
  }
  function stop(action: 'insert' | 'send' = 'insert') {
    const active = session.current;
    if (!active || active.phase !== 'recording') return;
    active.action = action; active.phase = 'stopping'; setState({ phase: active.phase });
    try { active.recorder!.stop(); }
    catch (error) { active.error = error instanceof Error ? error.message : t('Unable to stop recording. Please try again.'); finish(active); }
  }
  async function start() {
    const input = inputRef.current;
    if (!available || !options.current.enabled || !options.current.contextKey || !input || input.composing || session.current) return;
    const active: Session = { key: options.current.contextKey, snapshot: snapshot(input), from: input.selectionStart, to: input.selectionEnd, maxBytes: 0, bytes: 0, chunks: [], phase: 'starting' };
    session.current = active; setState({ phase: active.phase });
    active.unsubscribe = input.subscribe(() => { if (session.current === active && snapshot(input) !== active.snapshot) cancel(false); });
    try {
      // Keep this request observable after cancellation so a late-created lease
      // can be released without ever requesting microphone permission.
      const lease = await api.start(); active.id = lease.id; active.maxBytes = lease.maxBytes;
      if (!valid(active)) { release(active); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); active.stream = stream;
      if (!valid(active)) { release(active); return; }
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); active.recorder = recorder;
      recorder.ondataavailable = event => {
        if (!valid(active) || !event.data.size) return;
        active.bytes += event.data.size;
        if (active.bytes > active.maxBytes) { cancel(false); setState({ phase: 'error', error: t('Recording is too large. Please try a shorter recording.') }); return; }
        active.chunks.push(event.data);
      };
      recorder.onerror = () => { active.error = t('Unable to record audio. Please try again.'); stopTracks(active); };
      recorder.onstop = () => finish(active);
      recorder.start(250); active.phase = 'recording'; setState({ phase: active.phase });
      active.stopVisual = drawWaveform(stream, () => canvas.current);
    } catch (error) {
      stopTracks(active); fail(active, error instanceof DOMException && error.name === 'NotAllowedError' ? new Error(t('Microphone access was denied. Allow microphone access and try again.')) : error);
    }
  }
  const retry = () => { const active = session.current; if (active?.phase === 'error' && active.audio) { active.error = undefined; void transcribe(active); } else { cancel(false); void start(); } };
  const busy = !!state && state.phase !== 'error', retained = !!session.current;
  const cancelLabel = state?.phase === 'transcribing' ? t('Cancel transcription') : t('Cancel dictation');
  const button = available && !state ? <button type="button" className="composer-dictation-button" aria-label={t('Dictate')} title={t('Dictate')} onPointerDown={event => event.preventDefault()} onClick={() => void start()}><Microphone/></button> : null;
  const panel = state ? <div className="composer-dictation" onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || inputRef.current?.composing || event.repeat) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); state.phase === 'recording' ? stop() : cancel(); }
  }}>
    <button ref={cancelButton} type="button" className="composer-dictation-button" aria-label={cancelLabel} title={cancelLabel} onClick={() => cancel()}><DictationGlyph name="cancel"/></button>
    {state.phase === 'recording' ? <><span className="sr-only" role="status">{t('Dictation is active and in use')}</span>{typeof AudioContext === 'undefined' ? <span className="composer-dictation-status">{t('Recording…')}</span> : <canvas ref={canvas} width={600} height={32} aria-hidden="true"/>}</> : <span className="composer-dictation-status" role={state.phase === 'error' ? 'alert' : 'status'}>{state.error || (state.phase === 'starting' ? t('Starting dictation…') : state.phase === 'stopping' ? t('Finishing dictation') : t('Transcribing'))}</span>}
    {state.phase === 'error' ? <button type="button" className="composer-dictation-button" aria-label={t('Retry dictation')} title={t('Retry dictation')} onClick={retry}><span aria-hidden="true">↻</span></button> : <button ref={stopButton} type="button" className="composer-dictation-button" aria-label={t('Stop dictation')} title={t('Stop dictation')} disabled={state.phase !== 'recording'} onClick={() => stop()}><DictationGlyph name="stop"/></button>}
    {onSubmit && state.phase !== 'error' && <button type="button" className="send-button" aria-label={t('Transcribe and send')} title={t('Transcribe and send')} disabled={state.phase !== 'recording'} onClick={() => stop('send')}><CodexIcon name="send" size={18}/></button>}
  </div> : null;
  return { button, panel, busy, retained, cancel };
}
// Static microphone paths from the pinned official composer (RSa/LSa).
function Microphone() { return <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><g transform="scale(0.8333333333333334)"><path d="M18.5848 13.4121C18.7715 12.9516 19.2961 12.7296 19.7567 12.916C20.217 13.1027 20.4391 13.6274 20.2528 14.0879C19.0405 17.0826 16.2438 19.2675 12.9003 19.6035V22C12.9003 22.4971 12.4969 22.9004 11.9999 22.9004C11.5029 22.9003 11.0995 22.497 11.0995 22V19.6035C7.75618 19.2673 4.96018 17.0823 3.74791 14.0879C3.56144 13.6272 3.78344 13.1026 4.244 12.916C4.70458 12.7298 5.22933 12.9517 5.41588 13.4121C6.46985 16.0157 9.02264 17.8496 12.0008 17.8496C14.9787 17.8493 17.531 16.0155 18.5848 13.4121Z"/><path d="M11.9999 1.34961C14.7061 1.34961 16.9003 3.5438 16.9003 6.25V10.7334C16.9003 13.4396 14.7061 15.6338 11.9999 15.6338C9.29371 15.6337 7.09947 13.4396 7.09947 10.7334V6.25C7.09947 3.54384 9.29372 1.34967 11.9999 1.34961ZM11.9999 3.15039C10.2878 3.15045 8.90025 4.53795 8.90025 6.25V10.7334C8.90025 12.4454 10.2878 13.8339 11.9999 13.834C13.7119 13.834 15.0995 12.4455 15.0995 10.7334V6.25C15.0995 4.53792 13.7119 3.15039 11.9999 3.15039Z"/></g></svg>; }
function drawWaveform(stream: MediaStream, getCanvas: () => HTMLCanvasElement | null) {
  if (typeof AudioContext === 'undefined') return () => {};
  let context: AudioContext | undefined, frame = 0;
  try {
    context = new AudioContext(); const source = context.createMediaStreamSource(stream), analyser = context.createAnalyser(); analyser.fftSize = 256; source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const draw = () => {
      const canvas = getCanvas(), paint = canvas?.getContext('2d');
      if (canvas && paint) {
        analyser.getByteTimeDomainData(samples); paint.clearRect(0, 0, canvas.width, canvas.height); paint.strokeStyle = getComputedStyle(canvas).color; paint.lineWidth = 2; paint.beginPath();
        for (let index = 0; index < samples.length; index++) { const x = index * canvas.width / (samples.length - 1), y = samples[index] / 255 * canvas.height; index ? paint.lineTo(x, y) : paint.moveTo(x, y); } paint.stroke();
      }
      frame = requestAnimationFrame(draw);
    }; draw(); void context.resume().catch(() => {});
  } catch { void context?.close().catch(() => {}); }
  return () => { cancelAnimationFrame(frame); void context?.close().catch(() => {}); };
}

// Pinned official buffered controls: xmark-md-light-16 and stop-fill-light-16.
const dictationGlyphs = {"cancel": "M10.962 4.29539C11.1669 4.09057 11.4992 4.09076 11.7042 4.29539C11.9092 4.50039 11.9091 4.83255 11.7042 5.03758L8.74229 7.99949L11.7052 10.9624C11.9097 11.1673 11.9097 11.4996 11.7052 11.7046C11.5003 11.9095 11.168 11.9093 10.963 11.7046L8.0001 8.74168L5.03721 11.7046C4.83216 11.9093 4.49994 11.9095 4.29502 11.7046C4.09047 11.4996 4.09045 11.1673 4.29502 10.9624L7.25791 7.99949L4.296 5.03758C4.09101 4.83255 4.09099 4.5004 4.296 4.29539C4.50105 4.09079 4.8333 4.09054 5.03819 4.29539L8.0001 7.2573L10.962 4.29539Z", "stop": "M10.4664 3.14111C11.7872 3.14111 12.8578 4.21204 12.858 5.53271V10.4663C12.858 11.7872 11.7873 12.8579 10.4664 12.8579H5.53284C4.21217 12.8577 3.14124 11.787 3.14124 10.4663V5.53271C3.14148 4.2122 4.21232 3.14136 5.53284 3.14111H10.4664Z"};
function DictationGlyph({ name }: { name: keyof typeof dictationGlyphs }) { return <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d={dictationGlyphs[name]}/></svg>; }
