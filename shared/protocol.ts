// Types échangés entre le serveur et le navigateur.
import type { Card, NumberCard, Op } from './cards';
import type { Arrangement } from './equation';

export type Phase = 'lobby' | 'deal' | 'discard' | 'bet1' | 'build' | 'bet2' | 'declare' | 'showdown' | 'gameover';
export type Decl = 'high' | 'low' | 'swing';
export type ActionType = 'check' | 'call' | 'raise' | 'fold' | 'allin';
export type EndMode = 'survivor' | 'rounds';

export interface Settings {
  startChips: number;
  buildSeconds: number;
  turnSeconds: number;
  endMode: EndMode;
  maxRounds: number;
}

export const DEFAULT_SETTINGS: Settings = {
  startChips: 20,
  buildSeconds: 90,
  turnSeconds: 45,
  endMode: 'survivor',
  maxRounds: 15,
};

export const SETTING_OPTIONS = {
  startChips: [10, 20, 30, 50],
  buildSeconds: [60, 90, 120, 180],
  turnSeconds: [30, 45, 60, 90],
  maxRounds: [10, 15, 20, 30],
} as const;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const EMOTES = ['👏', '😂', '😱', '🤔', '🔥', '😈', '🫡', '💀'] as const;
export const AVATARS = ['🦊', '🐼', '🐸', '🐙', '🦁', '🐯', '🐵', '🦄', '🐲', '🐧', '🦉', '🐝', '🐨', '🦖', '🐳', '🦩'] as const;

export interface PublicHand {
  /** null quand la carte est cachée pour toi. */
  hidden: NumberCard | null;
  /** Cartes visibles dans l'ordre reçu (chiffres et symboles gardés). */
  open: Card[];
  ops: Op[];
  discarded: Op[];
  roots: number;
  committed: number;
  roundBet: number;
  pendingDiscard: number;
  folded: boolean;
  ready: boolean;
  hasDeclared: boolean;
  declaration: Decl | null;
  arrangements: { high: Arrangement; low: Arrangement } | null;
  lastAction: { type: ActionType; amount?: number } | null;
}

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: string;
  isBot: boolean;
  connected: boolean;
  chips: number;
  inGame: boolean;
  out: boolean;
  stats: { wins: number; perfect: number; bestWin: number };
  hand: PublicHand | null;
}

export type AwardReason = 'high' | 'low' | 'swing' | 'beat-swing' | 'all' | 'fold' | 'refund';

export interface SideLine {
  text: string;
  value: number | null;
  dist: number | null;
  rank: number | null;
}

export interface ResultEntry {
  id: string;
  decl: Decl;
  hidden: NumberCard;
  high: SideLine;
  low: SideLine;
  best: { high: number | null; low: number | null; highText: string | null; lowText: string | null };
}

export interface RoundResult {
  kind: 'fold' | 'showdown';
  entries: ResultEntry[];
  awards: { id: string; amount: number; reason: AwardReason }[];
  swing: { id: string; success: boolean }[];
  burned: number;
  pot: number;
  headline: string;
}

export interface PublicRound {
  number: number;
  firstId: string;
  pot: number;
  cap: number;
  bettingRound: 0 | 1 | 2;
  currentBet: number;
  maxRoundBet: number;
  toAct: string | null;
  deadline: number | null;
  result: RoundResult | null;
}

export interface LogEntry {
  id: number;
  t: number;
  text: string;
  kind: 'info' | 'bet' | 'win' | 'deal' | 'alert';
}

export interface RoomState {
  code: string;
  hostId: string;
  youId: string;
  phase: Phase;
  settings: Settings;
  players: PublicPlayer[];
  round: PublicRound | null;
  log: LogEntry[];
  nextReady: string[];
  serverNow: number;
  gameOver: { ranking: { id: string; chips: number; place: number }[]; rounds: number } | null;
}

export interface Ack<T = Record<string, unknown>> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface JoinData {
  code: string;
  playerId: string;
  token: string;
  spectator: boolean;
}
