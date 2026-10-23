// Qui gagne quoi à la révélation : High, Low, Swing, égalités et partage du pot.
import { NumberCard, compareNum } from './cards';
import { EPS, Side, TARGET } from './equation';
import type { AwardReason, Decl } from './protocol';

export interface Contender {
  id: string;
  decl: Decl;
  highVal: number | null;
  lowVal: number | null;
  /** Plus grand chiffre du joueur (départage en High). */
  maxCard: NumberCard;
  /** Plus petit chiffre du joueur (départage en Low). */
  minCard: NumberCard;
}

export interface Resolution {
  highRanking: string[];
  lowRanking: string[];
  swing: { id: string; success: boolean }[];
  awards: { id: string; amount: number; reason: AwardReason }[];
  burned: number;
}

function sideValue(c: Contender, side: Side): number | null {
  return side === 'high' ? c.highVal : c.lowVal;
}

function playsSide(c: Contender, side: Side): boolean {
  return c.decl === 'swing' || c.decl === side;
}

/** Classement d'un côté : le plus proche de la cible d'abord ; à égalité, la plus grande carte (High) ou la plus petite (Low). */
export function rankSide(contenders: Contender[], side: Side): Contender[] {
  const target = TARGET[side];
  return contenders
    .filter((c) => playsSide(c, side) && sideValue(c, side) !== null)
    .sort((a, b) => {
      const da = Math.abs((sideValue(a, side) as number) - target);
      const db = Math.abs((sideValue(b, side) as number) - target);
      if (Math.abs(da - db) > EPS) return da - db;
      return side === 'high' ? compareNum(b.maxCard, a.maxCard) : compareNum(a.minCard, b.minCard);
    });
}

export function resolveShowdown(contenders: Contender[], pot: number): Resolution {
  const high = rankSide(contenders, 'high');
  const low = rankSide(contenders, 'low');
  const bestHigh = high[0]?.id ?? null;
  const bestLow = low[0]?.id ?? null;
  const swingers = contenders.filter((c) => c.decl === 'swing').map((c) => c.id);
  const isSwinger = (id: string | null) => id !== null && swingers.includes(id);
  const swing = swingers.map((id) => ({ id, success: id === bestHigh && id === bestLow }));

  const awards: Resolution['awards'] = [];
  let burned = 0;

  const split = (hId: string, lId: string) => {
    const half = Math.floor(pot / 2);
    awards.push({ id: hId, amount: half, reason: 'high' }, { id: lId, amount: half, reason: 'low' });
    burned = pot - 2 * half;
  };
  const all = (id: string, reason: AwardReason) => {
    awards.push({ id, amount: pot, reason });
  };

  const winner = swing.find((s) => s.success);
  if (winner) {
    all(winner.id, 'swing');
  } else if (swingers.length > 0) {
    // Swing raté : celui qui a battu le swing rafle tout ; s'il a été battu des deux côtés, partage normal.
    const beatHigh = bestHigh && !isSwinger(bestHigh) ? bestHigh : null;
    const beatLow = bestLow && !isSwinger(bestLow) ? bestLow : null;
    if (beatHigh && beatLow) split(beatHigh, beatLow);
    else if (beatHigh || beatLow) all((beatHigh ?? beatLow) as string, 'beat-swing');
    else {
      const h2 = high.find((c) => !isSwinger(c.id))?.id ?? null;
      const l2 = low.find((c) => !isSwinger(c.id))?.id ?? null;
      if (h2 && l2) split(h2, l2);
      else if (h2 || l2) all((h2 ?? l2) as string, 'all');
      else if (bestHigh && bestLow && bestHigh !== bestLow) split(bestHigh, bestLow);
      else if (bestHigh || bestLow) all((bestHigh ?? bestLow) as string, 'all');
    }
  } else if (bestHigh && bestLow) {
    split(bestHigh, bestLow);
  } else if (bestHigh || bestLow) {
    all((bestHigh ?? bestLow) as string, 'all');
  }

  if (awards.length === 0) {
    // Personne n'a d'équation valide : les mises sont rendues.
    const n = contenders.length || 1;
    const each = Math.floor(pot / n);
    for (const c of contenders) awards.push({ id: c.id, amount: each, reason: 'refund' });
    burned = pot - each * contenders.length;
  }

  return {
    highRanking: high.map((c) => c.id),
    lowRanking: low.map((c) => c.id),
    swing,
    awards,
    burned,
  };
}
