// Deterministic browser-only capture devices. No real media permission or audio API call.
export function installFakeDictationDevices() {
    window.fakeAudio = { starts: 0, stops: 0, tracks: 0, permission: 'allow', requests: 0, throwStop: false, release: null };
    Object.defineProperty(window, 'AudioContext', { value: undefined, configurable: true });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const state = window.fakeAudio; state.requests++;
      if (state.permission === 'hold') await new Promise(resolve => { state.release = resolve; });
      if (state.permission === 'deny') throw new DOMException('Denied', 'NotAllowedError');
      let stopped = false; return { getTracks: () => [{ stop() { if (!stopped) { stopped = true; state.tracks++; } } }] };
    } });
    window.MediaRecorder = class {
      static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
      constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; this.state = 'inactive'; }
      start() { this.state = 'recording'; window.fakeAudio.starts++; queueMicrotask(() => this.ondataavailable?.({ data: new Blob(['recorded-audio'], { type: this.mimeType }) })); }
      stop() { window.fakeAudio.stops++; if (window.fakeAudio.throwStop) throw new Error('Fixture stop failed'); this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['final-audio'], { type: this.mimeType }) }); this.onstop?.(); }); }
    };
  window.fakeAudio.enableVisual = () => {
    window.fakeAudio.draws = 0; window.fakeAudio.closed = 0;
    window.AudioContext = class {
      createMediaStreamSource() { return { connect() {} }; }
      createAnalyser() { return { fftSize: 256, getByteTimeDomainData(samples) { window.fakeAudio.draws++; for (let i = 0; i < samples.length; i++) samples[i] = 128 + Math.sin(i / 5) * 32; } }; }
      async resume() {} async close() { window.fakeAudio.closed++; }
    };
  };
}
