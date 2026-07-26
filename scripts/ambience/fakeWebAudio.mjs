// A minimal Web Audio implementation, enough to instantiate and run the real
// AmbienceEngine outside a browser.
//
// This exists because there was no runtime test of the engine at all — check:ambience
// only ever inspected tables and baked WAVs — and that gap let a 100% reproducible
// "no stem ever plays" bug ship. The engine's whole job is to build a graph and start
// sources; asserting on the graph it actually builds is the only way to know it did.
//
// It is not an audio renderer. Nodes record their connections and their param
// automation so a test can ask structural questions ("was a source started for every
// layer?", "what gain does the bed bus end up at?"), not acoustic ones.

let nextId = 1;

class FakeAudioParam {
  constructor(name, value) {
    this.name = name;
    this.value = value;
    this.automation = [];
  }

  setValueAtTime(v, t) { this.value = v; this.automation.push(['setValueAtTime', v, t]); return this; }
  linearRampToValueAtTime(v, t) { this.value = v; this.automation.push(['linearRamp', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { this.value = v; this.automation.push(['exponentialRamp', v, t]); return this; }
  setTargetAtTime(v, t, c) { this.value = v; this.automation.push(['setTarget', v, t, c]); return this; }
  cancelScheduledValues(t) { this.automation.push(['cancel', t]); return this; }
  setValueCurveAtTime(curve, t, d) { this.automation.push(['curve', curve, t, d]); return this; }
}

class FakeAudioNode {
  constructor(ctx, type) {
    this.ctx = ctx;
    this.type_ = type;
    this.id = nextId++;
    this.outputs = [];
    this.inputs = [];
    this.disconnected = false;
    ctx.nodes.push(this);
  }

  connect(target, outputIndex = 0, inputIndex = 0) {
    // Connecting to an AudioParam is legal Web Audio; record it the same way.
    this.outputs.push(target);
    this.connections ??= [];
    this.connections.push({ target, outputIndex, inputIndex });
    if (target instanceof FakeAudioNode) target.inputs.push(this);
    return target;
  }

  disconnect() { this.disconnected = true; this.outputs.length = 0; }
}

class FakeGainNode extends FakeAudioNode {
  constructor(ctx) { super(ctx, 'gain'); this.gain = new FakeAudioParam('gain', 1); }
}

class FakeBiquadFilterNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx, 'biquad');
    this.type = 'lowpass';
    this.frequency = new FakeAudioParam('frequency', 350);
    this.Q = new FakeAudioParam('Q', 1);
    this.gain = new FakeAudioParam('gain', 0);
    this.detune = new FakeAudioParam('detune', 0);
  }
}

class FakeStereoPannerNode extends FakeAudioNode {
  constructor(ctx) { super(ctx, 'panner'); this.pan = new FakeAudioParam('pan', 0); }
}

class FakeDelayNode extends FakeAudioNode {
  constructor(ctx) { super(ctx, 'delay'); this.delayTime = new FakeAudioParam('delayTime', 0); }
}

class FakeConvolverNode extends FakeAudioNode {
  constructor(ctx) { super(ctx, 'convolver'); this.buffer = null; this.normalize = true; }
}

class FakeWaveShaperNode extends FakeAudioNode {
  constructor(ctx) { super(ctx, 'shaper'); this.curve = null; this.oversample = 'none'; }
}

class FakeChannelSplitterNode extends FakeAudioNode {
  constructor(ctx, channels) { super(ctx, 'splitter'); this.numberOfOutputs = channels; }
}

class FakeChannelMergerNode extends FakeAudioNode {
  constructor(ctx, channels) { super(ctx, 'merger'); this.numberOfInputs = channels; }
}

class FakeDynamicsCompressorNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx, 'compressor');
    this.threshold = new FakeAudioParam('threshold', -24);
    this.knee = new FakeAudioParam('knee', 30);
    this.ratio = new FakeAudioParam('ratio', 12);
    this.attack = new FakeAudioParam('attack', 0.003);
    this.release = new FakeAudioParam('release', 0.25);
    this.reduction = 0;
  }
}

export class FakeAudioBufferSourceNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx, 'bufferSource');
    this.buffer = null;
    this.loop = false;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.playbackRate = new FakeAudioParam('playbackRate', 1);
    this.detune = new FakeAudioParam('detune', 0);
    this.started = null;
    this.stopped = null;
  }

  start(when = 0, offset = 0, duration) {
    if (this.started !== null) throw new Error('AudioBufferSourceNode.start called twice');
    this.started = { when, offset, duration };
    this.ctx.startedSources.push(this);
  }

  stop(when = 0) { this.stopped = when; }
}

export class FakeOscillatorNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx, 'oscillator');
    this.type = 'sine';
    this.frequency = new FakeAudioParam('frequency', 440);
    this.detune = new FakeAudioParam('detune', 0);
    this.started = null;
    this.stopped = null;
  }

  start(when = 0) { this.started = { when }; this.ctx.startedSources.push(this); }
  stop(when = 0) { this.stopped = when; }
}

class FakeAudioBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(ch) { return this.data[ch]; }
}

export class FakeAudioContext {
  constructor({ sampleRate = 48000 } = {}) {
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.state = 'running';
    this.nodes = [];
    this.startedSources = [];
    this.destination = new FakeAudioNode(this, 'destination');
  }

  createGain() { return new FakeGainNode(this); }
  createBiquadFilter() { return new FakeBiquadFilterNode(this); }
  createStereoPanner() { return new FakeStereoPannerNode(this); }
  createDelay() { return new FakeDelayNode(this); }
  createConvolver() { return new FakeConvolverNode(this); }
  createWaveShaper() { return new FakeWaveShaperNode(this); }
  createDynamicsCompressor() { return new FakeDynamicsCompressorNode(this); }
  createChannelSplitter(channels = 6) { return new FakeChannelSplitterNode(this, channels); }
  createChannelMerger(channels = 6) { return new FakeChannelMergerNode(this, channels); }
  createBufferSource() { return new FakeAudioBufferSourceNode(this); }
  createOscillator() { return new FakeOscillatorNode(this); }
  createBuffer(ch, len, sr) { return new FakeAudioBuffer(ch, len, sr); }

  decodeAudioData() {
    // Content is irrelevant here; only the shape the engine reads (duration, channels).
    const buffer = new FakeAudioBuffer(2, this.sampleRate * 18, this.sampleRate);
    // Tagged so a test can tell a bed source from a looping event source (steam,
    // vehiclePass and friends also set loop = true).
    buffer.fromDecode = true;
    return Promise.resolve(buffer);
  }

  /** Advance the clock so scheduled cleanup and lookahead behave sensibly. */
  advance(seconds) { this.currentTime += seconds; }
}

/**
 * Install the browser globals the engine reaches for, and return a restore function.
 *
 * `window.setTimeout`/`setInterval` are used for the event scheduler, and `stop()`
 * does `instanceof AudioBufferSourceNode | OscillatorNode`, so those constructors must
 * be global and must be the same classes the fake context produces.
 */
export function installBrowserGlobals({ stemBytes = new ArrayBuffer(64) } = {}) {
  const g = globalThis;
  const saved = {};

  // Virtual timers, so a test can run the event scheduler over minutes of scene time
  // without waiting for them. Real timers would make anything that samples the
  // schedule flaky, and the point of these checks is to be deterministic.
  let nowMs = 0;
  let nextTimerId = 1;
  const pending = new Map();

  const remember = (key, value) => {
    saved[key] = { had: key in g, value: g[key] };
    g[key] = value;
  };

  remember('window', {
    setTimeout: (fn, ms = 0) => {
      const id = nextTimerId++;
      pending.set(id, { fn, at: nowMs + ms, every: null });
      return id;
    },
    clearTimeout: (id) => pending.delete(id),
    setInterval: (fn, ms = 0) => {
      const id = nextTimerId++;
      pending.set(id, { fn, at: nowMs + ms, every: Math.max(1, ms) });
      return id;
    },
    clearInterval: (id) => pending.delete(id),
  });
  remember('AudioBufferSourceNode', FakeAudioBufferSourceNode);
  remember('OscillatorNode', FakeOscillatorNode);
  remember('fetch', async () => ({ ok: true, status: 200, arrayBuffer: async () => stemBytes }));

  /**
   * Advance virtual time by `seconds`, firing due timers and keeping the given
   * AudioContext's clock in step (the scheduler works off ctx.currentTime).
   */
  const pump = (ctx, seconds, stepMs = 100) => {
    const target = nowMs + seconds * 1000;
    let guard = 0;
    while (nowMs < target && guard++ < 200000) {
      nowMs = Math.min(target, nowMs + stepMs);
      ctx.currentTime = nowMs / 1000;
      for (const [id, timer] of [...pending]) {
        if (timer.at > nowMs) continue;
        if (timer.every === null) pending.delete(id);
        else timer.at = nowMs + timer.every;
        timer.fn();
      }
    }
  };

  const restore = () => {
    pending.clear();
    for (const [key, { had, value }] of Object.entries(saved)) {
      if (had) g[key] = value; else delete g[key];
    }
  };
  restore.pump = pump;
  return restore;
}

/** Let every pending microtask (and the stem fetch/decode chain) settle. */
export const flushMicrotasks = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
};
