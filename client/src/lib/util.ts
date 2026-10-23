import { useEffect, useState } from 'react';
import type { PublicPlayer, RoomState } from '../../../shared/protocol';
import { serverNow } from '../store';

/** Rafraîchit le composant régulièrement (comptes à rebours). */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function secondsLeft(deadline: number | null | undefined, now: number): number | null {
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${Math.abs(n) > 1 ? pluralWord : word}`;
}

export function me(state: RoomState): PublicPlayer | undefined {
  return state.players.find((p) => p.id === state.youId);
}

export function playerName(state: RoomState, id: string | null | undefined): string {
  return state.players.find((p) => p.id === id)?.name ?? '…';
}

/** Joueurs dans l'ordre de la table, en commençant par celui qui suit le joueur donné. */
export function seatsAfter(state: RoomState, id: string): PublicPlayer[] {
  const idx = state.players.findIndex((p) => p.id === id);
  if (idx < 0) return state.players;
  return [...state.players.slice(idx + 1), ...state.players.slice(0, idx)];
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
