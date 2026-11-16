/**
 * Sound cues, synthesised at runtime. No audio files ship, so there is nothing to
 * license and nothing to download: one noise buffer plus oscillators.
 *
 * The context is created on the first play() (a user gesture), which is what browsers
 * require; until then this module does nothing.
 */

const STORAGE_KEY = 'ludo.muted';

export type Cue =
  | 'dice'
  | 'step'
  | 'capture'
  | 'home'
  | 'turn'
  | 'invalid'
  | 'win'
  | 'tap';

let context: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Private mode or a file:// origin can deny storage; sound stays on.
    return false;
  }
}

let muted = readMuted();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Not worth failing a game over a preference.
  }
}

function audio(): AudioContext {
  if (!context) {
    context = new AudioContext();
    noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.4), context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

interface ToneOptions {
  readonly type?: OscillatorType;
  readonly gain?: number;
  readonly sweepTo?: number;
  readonly delay?: number;
}

function tone(frequency: number, duration: number, options: ToneOptions = {}): void {
  const ac = audio();
  const start = ac.currentTime + (options.delay ?? 0);
  const osc = ac.createOscillator();
  const amp = ac.createGain();

  osc.type = options.type ?? 'sine';
  osc.frequency.setValueAtTime(frequency, start);
  if (options.sweepTo) {
    osc.frequency.exponentialRampToValueAtTime(options.sweepTo, start + duration);
  }

  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(options.gain ?? 0.12, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(amp).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function burst(duration: number, gain: number, cutoff: number, delay = 0): void {
  const ac = audio();
  const start = ac.currentTime + delay;
  const source = ac.createBufferSource();
  const filter = ac.createBiquadFilter();
  const amp = ac.createGain();

  source.buffer = noise;
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  amp.gain.setValueAtTime(gain, start);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(filter).connect(amp).connect(ac.destination);
  source.start(start);
  source.stop(start + duration);
}

export function play(cue: Cue): void {
  if (muted) return;

  switch (cue) {
    case 'dice':
      // Soft wooden roll: dark noise thump, no bright hiss.
      burst(0.22, 0.1, 1200);
      tone(120, 0.16, { gain: 0.06, sweepTo: 90 });
      break;
    case 'step':
      tone(520, 0.05, { type: 'triangle', gain: 0.04 });
      break;
    case 'capture':
      tone(420, 0.26, { type: 'sawtooth', gain: 0.11, sweepTo: 140 });
      burst(0.18, 0.12, 900);
      break;
    case 'home':
      [523, 659, 784].forEach((frequency, index) => {
        tone(frequency, 0.16, { type: 'triangle', gain: 0.09, delay: index * 0.09 });
      });
      break;
    case 'turn':
      tone(660, 0.1, { gain: 0.05 });
      break;
    case 'invalid':
      tone(150, 0.14, { type: 'square', gain: 0.06 });
      break;
    case 'win':
      [523, 659, 784, 1046].forEach((frequency, index) => {
        tone(frequency, 0.3, { type: 'triangle', gain: 0.1, delay: index * 0.12 });
      });
      break;
    case 'tap':
      tone(880, 0.04, { gain: 0.03 });
      break;
  }
}
