// Petits sons synthétisés (aucun fichier à charger) : distribution, jetons, ton tour, victoire.
import { useStore } from '../store';

type SoundName = 'deal' | 'chip' | 'turn' | 'win' | 'lose' | 'tick' | 'reveal' | 'click';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, duration: number, type: OscillatorType = 'sine', gain = 0.07): void {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export function play(name: SoundName): void {
  if (!useStore.getState().sound) return;
  switch (name) {
    case 'click':
      tone(880, 0, 0.05, 'triangle', 0.03);
      break;
    case 'deal':
      [0, 0.07, 0.14].forEach((d, i) => tone(520 + i * 60, d, 0.06, 'triangle', 0.04));
      break;
    case 'chip':
      tone(1320, 0, 0.06, 'square', 0.025);
      tone(1760, 0.05, 0.08, 'square', 0.02);
      break;
    case 'turn':
      tone(660, 0, 0.12, 'sine', 0.08);
      tone(990, 0.12, 0.2, 'sine', 0.08);
      break;
    case 'tick':
      tone(1200, 0, 0.04, 'square', 0.02);
      break;
    case 'reveal':
      [392, 523, 659].forEach((f, i) => tone(f, i * 0.09, 0.22, 'triangle', 0.05));
      break;
    case 'win':
      [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.1, 0.3, 'triangle', 0.07));
      break;
    case 'lose':
      [392, 330, 262].forEach((f, i) => tone(f, i * 0.12, 0.25, 'sine', 0.05));
      break;
  }
}

export function vibrate(pattern: number | number[]): void {
  try {
    if (useStore.getState().sound) navigator.vibrate?.(pattern);
  } catch {
    /* non supporté */
  }
}
