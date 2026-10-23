import { describe, expect, it } from 'vitest';
import { NumberCard, Suit } from '../shared/cards';
import { Contender, resolveShowdown } from '../shared/showdown';
import type { Decl } from '../shared/protocol';

const card = (value: number, suit: Suit = 'gold'): NumberCard => ({ id: `${suit}${value}`, kind: 'num', value, suit });

function c(id: string, decl: Decl, highVal: number | null, lowVal: number | null, maxCard = card(9), minCard = card(1)): Contender {
  return { id, decl, highVal, lowVal, maxCard, minCard };
}

const total = (r: ReturnType<typeof resolveShowdown>, id: string) => r.awards.filter((a) => a.id === id).reduce((s, a) => s + a.amount, 0);

describe('résolution de la révélation', () => {
  it('partage le pot entre High et Low', () => {
    const r = resolveShowdown([c('A', 'high', 19.2, null), c('B', 'low', null, 1), c('C', 'low', null, 1.5)], 20);
    expect(total(r, 'A')).toBe(10);
    expect(total(r, 'B')).toBe(10);
    expect(total(r, 'C')).toBe(0);
    expect(r.burned).toBe(0);
  });

  it('brûle le jeton restant d’un pot impair', () => {
    const r = resolveShowdown([c('A', 'high', 19, null), c('B', 'low', null, 1)], 21);
    expect(total(r, 'A')).toBe(10);
    expect(total(r, 'B')).toBe(10);
    expect(r.burned).toBe(1);
  });

  it('donne tout le pot quand tout le monde joue le même côté', () => {
    const r = resolveShowdown([c('A', 'low', 5, 1.2), c('B', 'low', 7, 0.9)], 12);
    expect(total(r, 'B')).toBe(12);
    expect(r.awards[0].reason).toBe('all');
  });

  it('Swing réussi : rafle tout', () => {
    const r = resolveShowdown([c('S', 'swing', 19.9, 1), c('H', 'high', 19, null), c('L', 'low', null, 1.4)], 30);
    expect(total(r, 'S')).toBe(30);
    expect(r.swing).toEqual([{ id: 'S', success: true }]);
  });

  it('Swing raté d’un côté : celui qui l’a battu rafle tout', () => {
    const r = resolveShowdown([c('S', 'swing', 19.9, 1.3), c('H', 'high', 19, null), c('L', 'low', null, 1)], 30);
    expect(total(r, 'L')).toBe(30);
    expect(total(r, 'H')).toBe(0);
    expect(r.awards[0].reason).toBe('beat-swing');
  });

  it('Swing battu des deux côtés : partage normal', () => {
    const r = resolveShowdown([c('S', 'swing', 15, 3), c('H', 'high', 19, null), c('L', 'low', null, 1)], 30);
    expect(total(r, 'H')).toBe(15);
    expect(total(r, 'L')).toBe(15);
    expect(total(r, 'S')).toBe(0);
  });

  it('Swing seul contre un High : le High doit le battre', () => {
    const lose = resolveShowdown([c('S', 'swing', 18, 1), c('H', 'high', 19.5, null)], 10);
    expect(total(lose, 'H')).toBe(10);
    const win = resolveShowdown([c('S', 'swing', 19.9, 1), c('H', 'high', 19.5, null)], 10);
    expect(total(win, 'S')).toBe(10);
  });

  it('égalité en High : la plus grande carte gagne, puis la couleur', () => {
    const r = resolveShowdown([c('A', 'high', 19, null, card(9)), c('B', 'high', 21, null, card(10, 'black'))], 10);
    expect(total(r, 'B')).toBe(10);
    const suit = resolveShowdown([c('A', 'high', 19, null, card(10, 'silver')), c('B', 'high', 21, null, card(10, 'gold'))], 10);
    expect(total(suit, 'B')).toBe(10);
  });

  it('égalité en Low : la plus petite carte gagne, puis la couleur la plus faible', () => {
    // Exemple de l'émission : 0 bronze bat 0 argent.
    const r = resolveShowdown(
      [c('Dongju', 'low', null, 1, card(8), card(0, 'bronze')), c('Kwedo', 'low', null, 1, card(7), card(0, 'silver'))],
      10,
    );
    expect(total(r, 'Dongju')).toBe(10);
  });

  it('une équation invalide ne gagne jamais', () => {
    const r = resolveShowdown([c('A', 'high', null, null), c('B', 'high', 3, null)], 8);
    expect(total(r, 'B')).toBe(8);
  });

  it('rend les mises si personne n’a d’équation valide', () => {
    const r = resolveShowdown([c('A', 'high', null, null), c('B', 'low', null, null)], 9);
    expect(total(r, 'A')).toBe(4);
    expect(total(r, 'B')).toBe(4);
    expect(r.burned).toBe(1);
  });
});
