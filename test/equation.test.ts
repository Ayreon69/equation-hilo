import { describe, expect, it } from 'vitest';
import { NumberCard, Op } from '../shared/cards';
import { bestDistances, checkArrangement, defaultArrangement, evaluateArrangement, evaluateValues, formatEquation, formatNumber, solveHand } from '../shared/equation';

const n = (value: number, suit: NumberCard['suit'] = 'gold'): NumberCard => ({ id: `${suit[0]}${value}${Math.random()}`, kind: 'num', value, suit });

describe('évaluation (exemples tirés de l’émission)', () => {
  const cases: [number[], Op[], number][] = [
    [[9, 8, 1, Math.SQRT2], ['+', '-', '/'], 16.293],
    [[5, 5, 10, 9], ['*', '-', '/'], 23.889],
    [[8, 4, 1, 0], ['/', '-', '+'], 1],
    [[0, 7, 7, 6], ['/', '+', '-'], 1],
    [[10, 2, 8, 10], ['*', '-', '/'], 19.2],
    [[10, Math.sqrt(5), 8, 2], ['+', '*', '/'], 18.944],
    [[8, 2, 3, 10], ['/', '*', '+'], 22],
    [[7, 6, 1, 3], ['/', '+', '-'], -0.833],
    [[1, 4, 5, 10], ['-', '+', '/'], -2.5],
  ];
  it.each(cases)('%j %j ≈ %d', (values, ops, expected) => {
    expect(evaluateValues(values, ops)).toBeCloseTo(expected, 3);
  });

  it('refuse la division par zéro', () => {
    expect(evaluateValues([5, 0, 1, 2], ['/', '+', '-'])).toBeNull();
    expect(evaluateValues([0, 0, 1, 2], ['/', '+', '-'])).toBeNull();
  });

  it('formate à la française', () => {
    expect(formatNumber(19.2)).toBe('19,2');
    expect(formatNumber(16.29289)).toBe('16,293');
    expect(formatNumber(-0.8333)).toBe('−0,833');
    expect(formatNumber(1)).toBe('1');
    expect(formatNumber(-0.0001)).toBe('0');
  });
});

describe('équations complètes', () => {
  it('applique les racines sur les bons chiffres', () => {
    const cards = [n(9), n(8), n(1, 'silver'), n(2, 'bronze')];
    const arr = { nums: cards.map((c) => c.id), ops: ['+', '-', '/'] as Op[], roots: [cards[2].id, cards[3].id] };
    expect(evaluateArrangement(arr, cards)).toBeCloseTo(16.293, 3);
    expect(formatEquation(arr, cards)).toBe('9 + 8 − √1 ÷ √2');
  });

  it('valide qu’une équation utilise toutes les cartes', () => {
    const cards = [n(3), n(4), n(5), n(6)];
    const hand = { nums: cards, ops: ['+', '-', '/'] as Op[], roots: 1 };
    const ok = { nums: [cards[1].id, cards[0].id, cards[3].id, cards[2].id], ops: ['/', '+', '-'], roots: [cards[0].id] };
    expect(checkArrangement(ok, hand)).not.toBeNull();
    expect(checkArrangement({ ...ok, roots: [] }, hand)).toBeNull();
    expect(checkArrangement({ ...ok, ops: ['+', '+', '/'] }, hand)).toBeNull();
    expect(checkArrangement({ ...ok, nums: [cards[0].id, cards[0].id, cards[1].id, cards[2].id] }, hand)).toBeNull();
    expect(checkArrangement('nimporte', hand)).toBeNull();
  });

  it('équation par défaut toujours calculable quand c’est possible', () => {
    const cards = [n(5), n(0), n(3), n(2)];
    const hand = { nums: cards, ops: ['/', '+', '-'] as Op[], roots: 0 };
    const d = defaultArrangement(hand);
    expect(evaluateArrangement(d, cards)).not.toBeNull();
  });

  it('le solveur trouve les meilleures équations', () => {
    const cards = [n(10), n(2), n(8), n(10, 'black')];
    const res = solveHand({ nums: cards, ops: ['*', '-', '/'], roots: 0 }, 3);
    expect(res.high[0].dist).toBeLessThanOrEqual(0.8 + 1e-9);
    const low = solveHand({ nums: [n(8), n(4), n(1), n(0)], ops: ['/', '-', '+'], roots: 0 });
    expect(low.low[0].dist).toBeCloseTo(0, 9);
  });

  it('bestDistances est cohérent avec le solveur', () => {
    const cards = [n(7), n(3), n(9), n(1)];
    const shape = { nums: cards, ops: ['+', '-', '/'] as Op[], roots: 1 };
    const solved = solveHand(shape);
    const fast = bestDistances(cards.map((c) => c.value), shape.ops, 1);
    expect(fast.high).toBeCloseTo(solved.high[0].dist, 9);
    expect(fast.low).toBeCloseTo(solved.low[0].dist, 9);
  });
});
