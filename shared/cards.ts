// Cartes du jeu : 44 chiffres (0 à 10 en quatre couleurs), 4 racines carrées et 4 multiplications.

export type Suit = 'gold' | 'silver' | 'bronze' | 'black';
export const SUITS: readonly Suit[] = ['gold', 'silver', 'bronze', 'black'];

/** Valeur d'une couleur pour départager les égalités : or > argent > bronze > noir. */
export const SUIT_RANK: Record<Suit, number> = { gold: 4, silver: 3, bronze: 2, black: 1 };
export const SUIT_LABEL: Record<Suit, string> = { gold: 'Or', silver: 'Argent', bronze: 'Bronze', black: 'Noir' };
export const SUIT_SHORT: Record<Suit, string> = { gold: 'OR', silver: 'AR', bronze: 'BR', black: 'NO' };
const SUIT_PREFIX: Record<Suit, string> = { gold: 'G', silver: 'S', bronze: 'B', black: 'N' };

export interface NumberCard {
  id: string;
  kind: 'num';
  value: number;
  suit: Suit;
}

export interface SymbolCard {
  id: string;
  kind: 'root' | 'mul';
}

export type Card = NumberCard | SymbolCard;

export type Op = '+' | '-' | '*' | '/';
export const OP_SYMBOL: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };
export const OP_NAME: Record<Op, string> = { '+': 'plus', '-': 'moins', '*': 'multiplié', '/': 'divisé' };

/** Opérateurs que chaque joueur possède au début de chaque manche. */
export const BASE_OPS: readonly Op[] = ['+', '-', '/'];

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let value = 0; value <= 10; value++) {
      deck.push({ id: `${SUIT_PREFIX[suit]}${value}`, kind: 'num', value, suit });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `R${i}`, kind: 'root' });
    deck.push({ id: `M${i}`, kind: 'mul' });
  }
  return deck;
}

export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Compare deux chiffres : d'abord la valeur, puis la couleur. */
export function compareNum(a: NumberCard, b: NumberCard): number {
  return a.value - b.value || SUIT_RANK[a.suit] - SUIT_RANK[b.suit];
}

export function isNumber(card: Card): card is NumberCard {
  return card.kind === 'num';
}

export function cardLabel(card: Card): string {
  if (card.kind !== 'num') return card.kind === 'root' ? '√' : '×';
  return `${card.value} ${SUIT_LABEL[card.suit].toLowerCase()}`;
}
