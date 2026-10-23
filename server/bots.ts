// Intelligence des bots : estimation de la main, enchères, choix d'opérateur, équation et déclaration.
import { NumberCard, Op } from '../shared/cards';
import { Arrangement, bestDistances, combinations, HandShape, solveHand } from '../shared/equation';
import type { Decl } from '../shared/protocol';

const scoreHigh = (d: number) => 1 / (1 + 1.2 * d);
// Viser 1 est facile pour tout le monde (− et ÷), il faut donc être très précis pour être fort.
const scoreLow = (d: number) => 1 / (1 + 4 * d);

export interface Estimate {
  high: number;
  low: number;
  dHigh: number;
  dLow: number;
}

/** Force attendue d'une main : exacte si toutes les cartes sont connues, sinon moyenne sur la carte à venir. */
export function estimate(nums: number[], ops: Op[], roots: number, pool: number[]): Estimate {
  const missing = ops.length + 1 - nums.length;
  if (missing <= 0 || pool.length === 0) {
    const d = bestDistances(nums.slice(0, ops.length + 1), ops, roots);
    return { high: scoreHigh(d.high), low: scoreLow(d.low), dHigh: d.high, dLow: d.low };
  }
  const counts = new Map<number, number>();
  for (const v of pool) counts.set(v, (counts.get(v) ?? 0) + 1);
  let sh = 0;
  let sl = 0;
  let dh = 0;
  let dl = 0;
  let total = 0;
  for (const [v, c] of counts) {
    const filled = nums.concat(Array(missing).fill(v));
    const d = bestDistances(filled, ops, roots);
    sh += c * scoreHigh(d.high);
    sl += c * scoreLow(d.low);
    dh += c * d.high;
    dl += c * d.low;
    total += c;
  }
  return { high: sh / total, low: sl / total, dHigh: dh / total, dLow: dl / total };
}

/** Force d'une main dont les équations sont déjà verrouillées. */
export function estimateFromDistances(dHigh: number | null, dLow: number | null): Estimate {
  const dh = dHigh ?? Infinity;
  const dl = dLow ?? Infinity;
  return { high: Number.isFinite(dh) ? scoreHigh(dh) : 0, low: Number.isFinite(dl) ? scoreLow(dl) : 0, dHigh: dh, dLow: dl };
}

const strengthOf = (e: Estimate) => Math.max(e.high * 1.05, e.low);

/** Choisit l'opérateur à défausser après un × (jamais le ÷). */
export function chooseDiscard(nums: number[], ops: Op[], pending: number, roots: number, pool: number[]): Op {
  const removable = ops.map((op, i) => ({ op, i })).filter((x) => x.op !== '/');
  let best: { score: number; remove: Op } | null = null;
  for (const combo of combinations(removable.length, Math.min(pending, removable.length))) {
    const removeIdx = new Set(combo.map((k) => removable[k].i));
    const kept = ops.filter((_, i) => !removeIdx.has(i));
    const score = strengthOf(estimate(nums, kept, roots, pool));
    if (!best || score > best.score) best = { score, remove: removable[combo[0]].op };
  }
  return best?.remove ?? removable[0].op;
}

export interface BetContext {
  est: Estimate;
  toCall: number;
  pot: number;
  currentBet: number;
  maxRoundBet: number;
  opponents: number;
}

export function chooseBet(ctx: BetContext, rng: () => number): { type: 'check' | 'call' | 'raise' | 'fold'; amount?: number } {
  const s = strengthOf(ctx.est) - 0.035 * Math.max(0, ctx.opponents - 1);
  const canRaise = ctx.maxRoundBet > ctx.currentBet;
  const raiseTo = (f: number) => {
    const target = ctx.currentBet + Math.max(1, Math.round(ctx.pot * f));
    return Math.min(ctx.maxRoundBet, Math.max(ctx.currentBet + 1, target));
  };
  const r = rng();
  if (ctx.toCall > 0) {
    if (canRaise && s > 0.62 && r < 0.5) return { type: 'raise', amount: raiseTo(0.4 + 0.4 * rng()) };
    const potOdds = ctx.toCall / (ctx.pot + ctx.toCall);
    if (s > potOdds + 0.1 || (ctx.toCall <= 1 && s > 0.2)) return { type: 'call' };
    if (canRaise && r < 0.04) return { type: 'raise', amount: raiseTo(0.3) };
    return { type: 'fold' };
  }
  if (canRaise && s > 0.55 && r < 0.65) return { type: 'raise', amount: raiseTo(0.3 + 0.4 * rng()) };
  if (canRaise && r < 0.07) return { type: 'raise', amount: raiseTo(0.25) };
  return { type: 'check' };
}

/** Équations du bot : la meilleure la plupart du temps, parfois une presque aussi bonne (il est humain, lui aussi). */
export function chooseArrangement(hand: HandShape, rng: () => number): { high: Arrangement; low: Arrangement } {
  const solved = solveHand(hand, 4);
  const pick = (list: { arr: Arrangement }[]) => {
    if (list.length === 0) return null;
    const idx = rng() < 0.75 || list.length === 1 ? 0 : 1 + Math.floor(rng() * (list.length - 1));
    return list[idx].arr;
  };
  const high = pick(solved.high);
  const low = pick(solved.low);
  const fallback = high ?? low;
  return { high: high ?? fallback!, low: low ?? fallback! };
}

export function chooseDeclaration(dHigh: number | null, dLow: number | null, rng: () => number): Decl {
  if (dHigh === null && dLow === null) return 'low';
  if (dHigh === null) return 'low';
  if (dLow === null) return 'high';
  if (dHigh < 0.2 && dLow < 0.05 && rng() < 0.6) return 'swing';
  const sh = scoreHigh(dHigh) * 1.05;
  const sl = scoreLow(dLow);
  if (Math.abs(sh - sl) < 0.06) return rng() < 0.5 ? 'high' : 'low';
  return sh >= sl ? 'high' : 'low';
}

export function unseenPool(visible: NumberCard[]): number[] {
  const counts = Array(11).fill(4) as number[];
  for (const c of visible) counts[c.value] = Math.max(0, counts[c.value] - 1);
  const pool: number[] = [];
  counts.forEach((c, v) => {
    for (let i = 0; i < c; i++) pool.push(v);
  });
  return pool;
}

export const BOT_PROFILES = [
  { name: 'Ada', avatar: '🤖' },
  { name: 'Euler', avatar: '🦉' },
  { name: 'Hypatie', avatar: '🦊' },
  { name: 'Gauss', avatar: '🐙' },
  { name: 'Noether', avatar: '🐝' },
  { name: 'Turing', avatar: '🐢' },
  { name: 'Ramanujan', avatar: '🐯' },
  { name: 'Fibonacci', avatar: '🐌' },
];
