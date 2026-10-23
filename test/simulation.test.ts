// Des centaines de parties complètes jouées par des bots, des humains absents et des humains « au hasard ».
import { describe, expect, it } from 'vitest';
import { checkArrangement, defaultArrangement, permutations } from '../shared/equation';
import type { Decl, Phase } from '../shared/protocol';
import { FakeScheduler } from '../server/scheduler';
import { Player, Room } from '../server/room';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLAYING: Phase[] = ['deal', 'discard', 'bet1', 'build', 'bet2', 'declare'];

interface SimOptions {
  seed: number;
  bots: number;
  afk: number;
  active: number;
  endMode: 'survivor' | 'rounds';
  startChips?: number;
}

/** Un humain connecté qui joue au hasard (mais toujours des coups légaux). */
function driveHuman(room: Room, p: Player, rng: () => number) {
  const r = room.round;
  const h = p.hand;
  if (!r) return;
  if (room.phase === 'showdown' && rng() < 0.5) room.readyNext(p.id);
  if (!h || h.folded) return;
  switch (room.phase) {
    case 'discard':
      if (h.pendingDiscard > 0) {
        const options = h.ops.filter((o) => o !== '/');
        expect(room.discard(p.id, '/')).toBeTruthy();
        expect(room.discard(p.id, options[Math.floor(rng() * options.length)])).toBeUndefined();
      }
      break;
    case 'bet1':
    case 'bet2':
      if (r.toAct === p.id) {
        const toCall = r.currentBet - h.roundBet;
        const max = room.maxRoundBet();
        const x = rng();
        if (x < 0.2 && max > r.currentBet) {
          const amount = r.currentBet + 1 + Math.floor(rng() * (max - r.currentBet));
          expect(room.act(p.id, { type: 'raise', amount })).toBeUndefined();
        } else if (x < 0.3 && toCall > 0) {
          expect(room.act(p.id, { type: 'fold' })).toBeUndefined();
        } else if (toCall > 0) {
          expect(room.act(p.id, { type: 'raise', amount: max + 1 })).toBeTruthy();
          expect(room.act(p.id, { type: 'call' })).toBeUndefined();
        } else {
          expect(room.act(p.id, { type: 'fold' })).toBeTruthy();
          expect(room.act(p.id, { type: 'check' })).toBeUndefined();
        }
      }
      break;
    case 'build':
      if (!h.ready) {
        const shape = { nums: h.nums, ops: h.ops, roots: h.roots };
        const base = defaultArrangement(shape);
        const perms = permutations(base.nums);
        const high = { ...base, nums: perms[Math.floor(rng() * perms.length)] };
        expect(checkArrangement(high, shape)).not.toBeNull();
        expect(room.arrange(p.id, { high, low: base })).toBeUndefined();
        expect(room.arrange(p.id, { high: { ...base, roots: [] } })).toBe(h.roots ? 'Équation incomplète : toutes les cartes doivent être utilisées.' : undefined);
        if (rng() < 0.7) room.setReady(p.id, true);
      }
      break;
    case 'declare':
      if (!h.declaration) {
        const decls: Decl[] = ['high', 'low', 'swing'];
        expect(room.declare(p.id, decls[Math.floor(rng() * 3)])).toBeUndefined();
      }
      break;
    default:
      break;
  }
}

function simulate(opts: SimOptions) {
  const sched = new FakeScheduler();
  const rng = mulberry32(opts.seed);
  const room = new Room('TEST', sched, rng, 1);
  const host = room.addHuman('Hôte', '🦊') as Player;
  const humans: Player[] = [];
  for (let i = 0; i < opts.bots; i++) expect(room.addBot(host.id)).toBeUndefined();
  for (let i = 0; i < opts.afk; i++) room.addHuman(`Absent${i}`, '🐼');
  for (let i = 0; i < opts.active; i++) {
    const p = room.addHuman(`Actif${i}`, '🐸') as Player;
    room.connect(p, `sock-${i}`);
    humans.push(p);
  }
  expect(room.updateSettings(host.id, { endMode: opts.endMode, maxRounds: 15, startChips: opts.startChips ?? 10 })).toBeUndefined();
  expect(room.start(host.id)).toBeUndefined();

  const initial = room.players.reduce((s, p) => s + p.chips, 0) + (room.round?.pot ?? 0);
  let steps = 0;
  const seenPhases = new Set<Phase>();
  while (room.phase !== 'gameover') {
    for (const p of humans) if (room.get(p.id)) driveHuman(room, p, rng);
    if ((room.phase as Phase) === 'gameover') break;
    if (!sched.step()) throw new Error(`Partie bloquée en phase ${room.phase}`);
    steps++;
    seenPhases.add(room.phase);
    const r = room.round!;
    const chips = room.players.reduce((s, p) => s + p.chips, 0);
    const inPlay = PLAYING.includes(room.phase) ? r.pot : 0;
    expect(chips + inPlay).toBe(initial - room.burnedTotal);
    for (const p of room.players) expect(p.chips).toBeGreaterThanOrEqual(0);
    if (steps > 400_000) throw new Error('Partie trop longue');
  }
  return { room, steps, seenPhases };
}

describe('simulation de parties complètes', () => {
  it('bots uniquement, mode survie, 2 à 8 joueurs', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const size = 1 + (seed % 7);
      const { room } = simulate({ seed, bots: size, afk: 0, active: 0, endMode: 'survivor' });
      expect(room.phase).toBe('gameover');
      const alive = room.players.filter((p) => !p.out && p.chips > 0);
      expect(alive.length).toBeLessThanOrEqual(1 + room.players.length);
      expect(room.gameOver!.ranking.length).toBe(room.players.length);
    }
  });

  it('mélange de bots, humains absents et humains au hasard', () => {
    const phases = new Set<Phase>();
    for (let seed = 100; seed < 160; seed++) {
      const { room, seenPhases } = simulate({
        seed,
        bots: seed % 3,
        afk: seed % 2,
        active: 1 + (seed % 3),
        endMode: seed % 2 ? 'rounds' : 'survivor',
      });
      seenPhases.forEach((p) => phases.add(p));
      expect(room.phase).toBe('gameover');
      if (room.settings.endMode === 'rounds') expect(room.roundNumber).toBeLessThanOrEqual(15);
    }
    for (const p of ['deal', 'discard', 'bet1', 'build', 'bet2', 'declare', 'showdown'] as Phase[]) expect(phases.has(p)).toBe(true);
  });

  it('un joueur qui quitte en pleine manche ne bloque pas la table', () => {
    for (let seed = 300; seed < 330; seed++) {
      const sched = new FakeScheduler();
      const rng = mulberry32(seed);
      const room = new Room('QUIT', sched, rng, 1);
      const host = room.addHuman('Hôte', '🦊') as Player;
      room.connect(host, 's1');
      room.addBot(host.id);
      room.addBot(host.id);
      const guest = room.addHuman('Invité', '🐼') as Player;
      room.connect(guest, 's2');
      room.start(host.id);
      let left = false;
      let steps = 0;
      while (room.phase !== 'gameover' && steps < 200_000) {
        if (!left && room.phase === (['bet1', 'build', 'declare', 'discard', 'deal'] as Phase[])[seed % 5]) {
          room.leave(guest.id);
          left = true;
        }
        if (room.phase === 'showdown') room.readyNext(host.id);
        const r = room.round;
        if (r && (room.phase === 'bet1' || room.phase === 'bet2') && r.toAct === host.id) {
          room.act(host.id, { type: r.currentBet > host.hand!.roundBet ? 'call' : 'check' });
          continue;
        }
        if (room.phase === 'build' && host.hand && !host.hand.folded && !host.hand.ready) room.setReady(host.id, true);
        if (room.phase === 'declare' && host.hand && !host.hand.folded && !host.hand.declaration) room.declare(host.id, 'low');
        if ((room.phase as Phase) === 'gameover') break;
        if (!sched.step()) throw new Error(`Bloqué en ${room.phase}`);
        steps++;
      }
      expect(room.phase).toBe('gameover');
    }
  });
});
