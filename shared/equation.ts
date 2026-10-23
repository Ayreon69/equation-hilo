// Évaluation des équations, validation et recherche de la meilleure combinaison.
import { NumberCard, Op, OP_SYMBOL } from './cards';

export const EPS = 1e-9;
export type Side = 'high' | 'low';
export const TARGET: Record<Side, number> = { high: 20, low: 1 };

/** Une équation : l'ordre des chiffres, l'ordre des opérateurs et les chiffres sous une racine. */
export interface Arrangement {
  nums: string[];
  ops: Op[];
  roots: string[];
}

export interface HandShape {
  nums: NumberCard[];
  ops: Op[];
  roots: number;
}

/** Calcule n0 op0 n1 op1 n2 … avec la priorité habituelle (× et ÷ avant + et −). Renvoie null si division par zéro. */
export function evaluateValues(values: number[], ops: Op[]): number | null {
  if (values.length === 0 || values.length !== ops.length + 1) return null;
  const terms: number[] = [values[0]];
  const signs: ('+' | '-')[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const v = values[i + 1];
    if (op === '*') {
      terms[terms.length - 1] *= v;
    } else if (op === '/') {
      if (Math.abs(v) < EPS) return null;
      terms[terms.length - 1] /= v;
    } else {
      signs.push(op);
      terms.push(v);
    }
  }
  let total = terms[0];
  for (let i = 0; i < signs.length; i++) {
    total = signs[i] === '+' ? total + terms[i + 1] : total - terms[i + 1];
  }
  return Number.isFinite(total) ? total : null;
}

export function arrangementValues(arr: Arrangement, nums: NumberCard[]): number[] | null {
  const byId = new Map(nums.map((c) => [c.id, c]));
  const out: number[] = [];
  for (const id of arr.nums) {
    const card = byId.get(id);
    if (!card) return null;
    out.push(arr.roots.includes(id) ? Math.sqrt(card.value) : card.value);
  }
  return out;
}

export function evaluateArrangement(arr: Arrangement, nums: NumberCard[]): number | null {
  const values = arrangementValues(arr, nums);
  return values ? evaluateValues(values, arr.ops) : null;
}

function sameMultiset<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const sa = a.map(String).sort();
  const sb = b.map(String).sort();
  return sa.every((x, i) => x === sb[i]);
}

/** Vérifie qu'une équation utilise exactement toutes les cartes de la main. Renvoie une copie propre ou null. */
export function checkArrangement(input: unknown, hand: HandShape): Arrangement | null {
  if (!input || typeof input !== 'object') return null;
  const a = input as Record<string, unknown>;
  if (!Array.isArray(a.nums) || !Array.isArray(a.ops) || !Array.isArray(a.roots)) return null;
  const ids = hand.nums.map((c) => c.id);
  if (!a.nums.every((x) => typeof x === 'string')) return null;
  if (!a.ops.every((x) => x === '+' || x === '-' || x === '*' || x === '/')) return null;
  if (!a.roots.every((x) => typeof x === 'string')) return null;
  const nums = a.nums as string[];
  const ops = a.ops as Op[];
  const roots = a.roots as string[];
  if (!sameMultiset(nums, ids)) return null;
  if (!sameMultiset(ops, hand.ops)) return null;
  if (roots.length !== Math.min(hand.roots, ids.length)) return null;
  if (new Set(roots).size !== roots.length || !roots.every((r) => ids.includes(r))) return null;
  return { nums: [...nums], ops: [...ops], roots: [...roots] };
}

/** Équation de départ : cartes dans l'ordre reçu, en évitant une division par zéro si possible. */
export function defaultArrangement(hand: HandShape): Arrangement {
  const roots = hand.nums.slice(0, Math.min(hand.roots, hand.nums.length)).map((c) => c.id);
  const base: Arrangement = { nums: hand.nums.map((c) => c.id), ops: [...hand.ops], roots };
  if (evaluateArrangement(base, hand.nums) !== null) return base;
  // Une division par zéro : on décale les chiffres jusqu'à trouver un ordre valide.
  for (let shift = 1; shift < base.nums.length; shift++) {
    const nums = base.nums.slice(shift).concat(base.nums.slice(0, shift));
    const candidate = { ...base, nums };
    if (evaluateArrangement(candidate, hand.nums) !== null) return candidate;
  }
  const solved = solveHand(hand, 1);
  return solved.low[0]?.arr ?? base;
}

// ---------- Recherche exhaustive ----------

export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const p of permutations(rest)) out.push([item, ...p]);
  });
  return out;
}

export function uniquePermutations<T>(items: readonly T[]): T[][] {
  const seen = new Set<string>();
  const out: T[][] = [];
  for (const p of permutations(items)) {
    const key = p.map(String).join('|');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

export function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const pick = (start: number, acc: number[]) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i < n; i++) {
      acc.push(i);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}

const permCache = new Map<number, number[][]>();
function indexPermutations(n: number): number[][] {
  let p = permCache.get(n);
  if (!p) {
    p = permutations([...Array(n).keys()]);
    permCache.set(n, p);
  }
  return p;
}

export interface Solution {
  arr: Arrangement;
  value: number;
  dist: number;
}

/** Toutes les équations possibles avec leur valeur (au plus 24 × 6 × 4 ≈ 600 combinaisons). */
export function allSolutions(hand: HandShape): { arr: Arrangement; value: number }[] {
  const n = hand.nums.length;
  const rootCount = Math.min(hand.roots, n);
  const opPerms = uniquePermutations(hand.ops);
  const results: { arr: Arrangement; value: number }[] = [];
  for (const rootSet of combinations(n, rootCount)) {
    const vals = hand.nums.map((c, i) => (rootSet.includes(i) ? Math.sqrt(c.value) : c.value));
    const rootIds = rootSet.map((i) => hand.nums[i].id);
    const seen = new Set<string>();
    for (const perm of indexPermutations(n)) {
      const seq = perm.map((i) => vals[i]);
      const key = seq.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      for (const ops of opPerms) {
        const value = evaluateValues(seq, ops);
        if (value === null) continue;
        results.push({ arr: { nums: perm.map((i) => hand.nums[i].id), ops, roots: rootIds }, value });
      }
    }
  }
  return results;
}

/** Les meilleures équations pour viser 20 et pour viser 1 (valeurs distinctes, de la plus proche à la moins proche). */
export function solveHand(hand: HandShape, topK = 1): { high: Solution[]; low: Solution[] } {
  const all = allSolutions(hand);
  const pick = (side: Side): Solution[] => {
    const target = TARGET[side];
    const sorted = all
      .map((s) => ({ ...s, dist: Math.abs(s.value - target) }))
      .sort((a, b) => a.dist - b.dist);
    const out: Solution[] = [];
    for (const s of sorted) {
      if (out.some((o) => Math.abs(o.value - s.value) < 1e-7)) continue;
      out.push(s);
      if (out.length >= topK) break;
    }
    return out;
  };
  return { high: pick('high'), low: pick('low') };
}

/** Version rapide pour les bots : meilleures distances à 20 et à 1 à partir de valeurs brutes. */
export function bestDistances(values: number[], ops: Op[], roots: number): { high: number; low: number } {
  const n = values.length;
  const opPerms = uniquePermutations(ops);
  let high = Infinity;
  let low = Infinity;
  for (const rootSet of combinations(n, Math.min(roots, n))) {
    const vals = values.map((v, i) => (rootSet.includes(i) ? Math.sqrt(v) : v));
    for (const perm of indexPermutations(n)) {
      const seq = perm.map((i) => vals[i]);
      for (const o of opPerms) {
        const v = evaluateValues(seq, o);
        if (v === null) continue;
        const dh = Math.abs(v - 20);
        const dl = Math.abs(v - 1);
        if (dh < high) high = dh;
        if (dl < low) low = dl;
      }
    }
  }
  return { high, low };
}

// ---------- Affichage ----------

/** 19.2 → « 19,2 » ; 16.29289 → « 16,293 » ; −0.8333 → « −0,833 ». */
export function formatNumber(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  let s = Math.abs(r).toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
  if (s === '') s = '0';
  return r < 0 ? `−${s}` : s;
}

export function isRounded(v: number): boolean {
  return Math.abs(v - Math.round(v * 1000) / 1000) > 1e-9;
}

export function formatEquation(arr: Arrangement, nums: NumberCard[]): string {
  const byId = new Map(nums.map((c) => [c.id, c]));
  const parts: string[] = [];
  arr.nums.forEach((id, i) => {
    const card = byId.get(id);
    const label = card ? `${arr.roots.includes(id) ? '√' : ''}${card.value}` : '?';
    parts.push(label);
    if (i < arr.ops.length) parts.push(OP_SYMBOL[arr.ops[i]]);
  });
  return parts.join(' ');
}
