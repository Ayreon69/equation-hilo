// Une table de jeu : salon, distribution, enchères, équations, déclarations et révélation.
import { randomUUID } from 'node:crypto';
import { BASE_OPS, Card, NumberCard, Op, OP_SYMBOL, compareNum, createDeck, shuffle } from '../shared/cards';
import {
  Arrangement,
  EPS,
  TARGET,
  checkArrangement,
  defaultArrangement,
  evaluateArrangement,
  formatEquation,
  solveHand,
} from '../shared/equation';
import { Contender, resolveShowdown } from '../shared/showdown';
import {
  ActionType,
  AwardReason,
  DEFAULT_SETTINGS,
  Decl,
  LogEntry,
  MAX_PLAYERS,
  MIN_PLAYERS,
  Phase,
  PublicPlayer,
  ResultEntry,
  RoomState,
  RoundResult,
  SETTING_OPTIONS,
  Settings,
} from '../shared/protocol';
import { Scheduler, realScheduler } from './scheduler';
import * as Bots from './bots';

export const TIMING = {
  deal: 2600,
  deal2: 1600,
  discard: 20_000,
  declare: 30_000,
  showdown: 35_000,
  showdownBotsOnly: 8_000,
  foldWin: 10_000,
  offlineTurn: 20_000,
  lobbyGhost: 90_000,
  hostHandover: 25_000,
};

interface Hand {
  hidden: NumberCard;
  open: Card[];
  nums: NumberCard[];
  ops: Op[];
  discarded: Op[];
  roots: number;
  pendingDiscard: number;
  stackStart: number;
  committed: number;
  roundBet: number;
  folded: boolean;
  acted: boolean;
  ready: boolean;
  arr: { high: Arrangement; low: Arrangement } | null;
  declaration: Decl | null;
  lastAction: { type: ActionType; amount?: number } | null;
}

export interface Player {
  id: string;
  token: string;
  name: string;
  avatar: string;
  isBot: boolean;
  sockets: Set<string>;
  connected: boolean;
  chips: number;
  inGame: boolean;
  out: boolean;
  outOrder: number;
  stats: { wins: number; perfect: number; bestWin: number };
  hand: Hand | null;
}

interface Round {
  number: number;
  deck: Card[];
  firstId: string;
  order: string[];
  pot: number;
  bettingRound: 0 | 1 | 2;
  currentBet: number;
  baseCommitted: number;
  toAct: string | null;
  deadline: number | null;
  afterDiscard: 'bet1' | 'build' | null;
  result: RoundResult | null;
}

export interface BetAction {
  type: 'check' | 'call' | 'raise' | 'fold';
  amount?: number;
}

const PLAYING: Phase[] = ['deal', 'discard', 'bet1', 'build', 'bet2', 'declare'];
const symbolName = (c: Card) => (c.kind === 'root' ? '√' : '×');

export class Room {
  readonly code: string;
  hostId = '';
  phase: Phase = 'lobby';
  settings: Settings = { ...DEFAULT_SETTINGS };
  players: Player[] = [];
  round: Round | null = null;
  log: LogEntry[] = [];
  nextReady = new Set<string>();
  gameOver: RoomState['gameOver'] = null;
  roundNumber = 0;
  /** Jetons détruits depuis le début de la partie (pots impairs). */
  burnedTotal = 0;
  lastActivity: number;
  onChange: () => void = () => {};

  private logSeq = 0;
  private eliminations = 0;
  private timers = new Map<string, unknown>();

  constructor(
    code: string,
    private sched: Scheduler = realScheduler,
    private rng: () => number = Math.random,
    private botSpeed = 1,
  ) {
    this.code = code;
    this.lastActivity = sched.now();
  }

  // ---------- Outils ----------

  get(id: string | null | undefined): Player | undefined {
    return id ? this.players.find((p) => p.id === id) : undefined;
  }

  now(): number {
    return this.sched.now();
  }

  touch(): void {
    this.lastActivity = this.now();
  }

  emit(): void {
    this.onChange();
  }

  hasConnectedHuman(): boolean {
    return this.players.some((p) => !p.isBot && p.connected);
  }

  dispose(): void {
    this.clearTimers();
    this.onChange = () => {};
  }

  private addLog(text: string, kind: LogEntry['kind'] = 'info'): void {
    this.log.push({ id: ++this.logSeq, t: this.now(), text, kind });
    if (this.log.length > 80) this.log.splice(0, this.log.length - 80);
  }

  private setTimer(key: string, ms: number, fn: () => void): void {
    this.clearTimer(key);
    const handle = this.sched.setTimeout(() => {
      this.timers.delete(key);
      try {
        fn();
      } catch (err) {
        console.error(`[room ${this.code}] erreur minuteur ${key}`, err);
      }
      this.emit();
    }, Math.max(0, ms));
    this.timers.set(key, handle);
  }

  private setTimerOnce(key: string, ms: number, fn: () => void): void {
    if (!this.timers.has(key)) this.setTimer(key, ms, fn);
  }

  private clearTimer(key: string): void {
    const handle = this.timers.get(key);
    if (handle !== undefined) {
      this.sched.clearTimeout(handle);
      this.timers.delete(key);
    }
  }

  private clearTimers(prefix = ''): void {
    for (const key of [...this.timers.keys()]) if (key.startsWith(prefix)) this.clearTimer(key);
  }

  private botDelay(min: number, max: number): number {
    return Math.round((min + this.rng() * (max - min)) * this.botSpeed);
  }

  private isPlaying(): boolean {
    return PLAYING.includes(this.phase);
  }

  /** Joueurs encore dans la manche (non couchés), dans l'ordre de parole. */
  inHand(): Player[] {
    const r = this.round;
    if (!r) return [];
    return r.order.map((id) => this.get(id)).filter((p): p is Player => !!p && !!p.hand && !p.hand.folded);
  }

  /** Joueurs encore en lice dans la partie. */
  alive(): Player[] {
    return this.players.filter((p) => p.inGame && !p.out && p.chips > 0);
  }

  /** Mise totale maximale par joueur pour la manche : le plus petit tapis parmi ceux encore en jeu. */
  cap(): number {
    const stacks = this.inHand().map((p) => p.hand!.stackStart);
    return stacks.length ? Math.min(...stacks) : 0;
  }

  maxRoundBet(): number {
    const r = this.round;
    if (!r || r.bettingRound === 0) return 0;
    return Math.max(0, this.cap() - r.baseCommitted);
  }

  // ---------- Salon ----------

  private createPlayer(name: string, avatar: string, isBot: boolean): Player {
    return {
      id: randomUUID().slice(0, 8),
      token: randomUUID(),
      name,
      avatar,
      isBot,
      sockets: new Set(),
      connected: isBot,
      chips: 0,
      inGame: false,
      out: false,
      outOrder: 0,
      stats: { wins: 0, perfect: 0, bestWin: 0 },
      hand: null,
    };
  }

  addHuman(name: string, avatar: string): Player | string {
    if (this.players.length >= MAX_PLAYERS) return 'La table est complète (8 joueurs maximum).';
    const p = this.createPlayer(name, avatar, false);
    this.players.push(p);
    if (!this.get(this.hostId)) this.hostId = p.id;
    this.addLog(`${p.name} a rejoint la table${this.phase === 'lobby' ? '' : ' en spectateur'}.`);
    this.touch();
    return p;
  }

  findByToken(id: unknown, token: unknown): Player | undefined {
    if (typeof id !== 'string' || typeof token !== 'string') return undefined;
    return this.players.find((p) => p.id === id && p.token === token && !p.isBot);
  }

  connect(p: Player, socketId: string): void {
    const wasOffline = !p.connected;
    p.sockets.add(socketId);
    p.connected = true;
    this.clearTimer(`ghost:${p.id}`);
    if (wasOffline && this.phase !== 'lobby') this.addLog(`${p.name} est de retour.`);
    // Retour pendant son tour d'enchère : on lui redonne du temps.
    const r = this.round;
    if (wasOffline && r && r.toAct === p.id && (this.phase === 'bet1' || this.phase === 'bet2')) this.startTurn();
    this.touch();
  }

  disconnect(playerId: string, socketId: string): void {
    const p = this.get(playerId);
    if (!p) return;
    p.sockets.delete(socketId);
    if (p.sockets.size > 0 || p.isBot) return;
    p.connected = false;
    if (this.phase === 'lobby') {
      this.setTimer(`ghost:${p.id}`, TIMING.lobbyGhost, () => {
        if (!p.connected && this.phase === 'lobby') this.removePlayerNow(p, `${p.name} a quitté le salon.`);
      });
    } else {
      this.addLog(`${p.name} s'est déconnecté.`, 'alert');
      const r = this.round;
      if (r && r.toAct === p.id && (this.phase === 'bet1' || this.phase === 'bet2')) {
        r.deadline = this.now() + TIMING.offlineTurn;
        this.setTimer('turn', TIMING.offlineTurn, () => this.timeoutTurn(p.id));
      }
      if (this.phase === 'showdown') this.checkNextReady();
    }
    if (this.hostId === p.id) {
      this.setTimer('host', TIMING.hostHandover, () => {
        const host = this.get(this.hostId);
        if (!host || host.connected) return;
        const next = this.players.find((x) => !x.isBot && x.connected);
        if (next) {
          this.hostId = next.id;
          this.addLog(`${next.name} devient l'hôte de la table.`);
        }
      });
    }
  }

  updateSettings(by: string, patch: Partial<Settings>): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut modifier les réglages.";
    if (this.phase !== 'lobby') return 'Les réglages se modifient avant le début de la partie.';
    const next = { ...this.settings };
    const pickNum = (key: keyof typeof SETTING_OPTIONS) => {
      const v = Number(patch[key]);
      if (patch[key] !== undefined && (SETTING_OPTIONS[key] as readonly number[]).includes(v)) next[key] = v;
    };
    pickNum('startChips');
    pickNum('buildSeconds');
    pickNum('turnSeconds');
    pickNum('maxRounds');
    if (patch.endMode === 'survivor' || patch.endMode === 'rounds') next.endMode = patch.endMode;
    this.settings = next;
    this.touch();
    return undefined;
  }

  addBot(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut ajouter des bots.";
    if (this.phase !== 'lobby') return 'Les bots se rejoignent avant le début de la partie.';
    if (this.players.length >= MAX_PLAYERS) return 'La table est complète (8 joueurs maximum).';
    const used = new Set(this.players.filter((p) => p.isBot).map((p) => p.name));
    const profile = Bots.BOT_PROFILES.find((b) => !used.has(b.name)) ?? Bots.BOT_PROFILES[0];
    const bot = this.createPlayer(profile.name, profile.avatar, true);
    this.players.push(bot);
    this.addLog(`${bot.name} (bot) s'installe à la table.`);
    return undefined;
  }

  /** Retire un joueur (par l'hôte). Renvoie le joueur retiré pour prévenir ses connexions. */
  kick(by: string, targetId: string): Player | string {
    if (by !== this.hostId) return "Seul l'hôte peut retirer un joueur.";
    if (targetId === by) return 'Tu ne peux pas te retirer toi-même : utilise « Quitter ».';
    const target = this.get(targetId);
    if (!target) return 'Joueur introuvable.';
    this.removePlayerNow(target, target.isBot ? `${target.name} quitte la table.` : `${target.name} a été retiré de la table.`);
    return target;
  }

  leave(playerId: string): void {
    const p = this.get(playerId);
    if (!p) return;
    this.removePlayerNow(p, `${p.name} a quitté la table.`);
  }

  private removePlayerNow(p: Player, message: string): void {
    const r = this.round;
    const wasToAct = r?.toAct === p.id;
    const wasInHand = !!p.hand && !p.hand.folded && this.isPlaying();
    if (p.hand && this.isPlaying()) p.hand.folded = true;
    this.players = this.players.filter((x) => x !== p);
    this.clearTimer(`bot:${p.id}`);
    this.clearTimer(`ghost:${p.id}`);
    this.nextReady.delete(p.id);
    this.addLog(message, 'alert');
    if (this.hostId === p.id) {
      const next = this.players.find((x) => !x.isBot && x.connected) ?? this.players.find((x) => !x.isBot);
      this.hostId = next?.id ?? '';
      if (next) this.addLog(`${next.name} devient l'hôte de la table.`);
    }
    if (!this.isPlaying()) {
      if (this.phase === 'showdown') this.checkNextReady();
      return;
    }
    if (!wasInHand) return;
    const inHand = this.inHand();
    if (inHand.length === 1) return this.foldWin(inHand[0]);
    if (inHand.length === 0) return this.endGame();
    switch (this.phase) {
      case 'bet1':
      case 'bet2':
        if (wasToAct) this.advanceFrom(p.id);
        break;
      case 'discard':
        this.checkDiscardsDone();
        break;
      case 'build':
        if (inHand.every((x) => x.hand!.ready)) this.endBuild(false);
        break;
      case 'declare':
        if (inHand.every((x) => x.hand!.declaration)) this.showdown();
        break;
      default:
        break;
    }
  }

  start(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut lancer la partie.";
    if (this.phase !== 'lobby') return 'La partie a déjà commencé.';
    if (this.players.length < MIN_PLAYERS) return 'Il faut au moins 2 joueurs (ajoute un bot si besoin).';
    this.startGame();
    return undefined;
  }

  restart(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut relancer une partie.";
    if (this.phase !== 'gameover') return 'La partie est encore en cours.';
    this.clearTimers();
    this.phase = 'lobby';
    this.round = null;
    this.gameOver = null;
    this.nextReady.clear();
    for (const p of this.players) {
      p.hand = null;
      p.inGame = false;
      p.out = false;
      p.chips = 0;
    }
    this.addLog('Retour au salon : prêts pour une revanche ?');
    return undefined;
  }

  endEarly(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut arrêter la partie.";
    if (this.phase === 'lobby' || this.phase === 'gameover') return 'Aucune partie en cours.';
    // Les jetons engagés dans la manche en cours sont rendus.
    if (this.isPlaying()) {
      for (const p of this.players) if (p.hand && this.round) p.chips += p.hand.committed;
    }
    this.addLog("L'hôte a arrêté la partie.", 'alert');
    this.endGame();
    return undefined;
  }

  // ---------- Déroulement d'une partie ----------

  startGame(): void {
    this.clearTimers();
    this.gameOver = null;
    this.roundNumber = 0;
    this.eliminations = 0;
    this.burnedTotal = 0;
    this.round = null;
    this.log = [];
    for (const p of this.players) {
      p.inGame = true;
      p.out = false;
      p.outOrder = 0;
      p.chips = this.settings.startChips;
      p.hand = null;
      p.stats = { wins: 0, perfect: 0, bestWin: 0 };
    }
    this.addLog(`La partie commence : ${this.players.length} joueurs, ${this.settings.startChips} jetons chacun. Bonne chance !`);
    this.startRound();
  }

  private startRound(): void {
    this.clearTimers('phase');
    this.clearTimers('turn');
    this.clearTimers('bot:');
    const alive = this.alive();
    const roundLimit = this.settings.endMode === 'rounds' && this.roundNumber >= this.settings.maxRounds;
    if (alive.length < 2 || roundLimit) return this.endGame();
    this.roundNumber++;

    // Le premier à parler tourne à chaque manche.
    const prev = this.round ? this.players.findIndex((p) => p.id === this.round!.firstId) : -1;
    let firstIdx = -1;
    if (prev < 0 && !this.round) {
      firstIdx = this.players.indexOf(alive[Math.floor(this.rng() * alive.length)]);
    } else {
      for (let k = 1; k <= this.players.length; k++) {
        const idx = ((prev < 0 ? -1 : prev) + k + this.players.length) % this.players.length;
        if (alive.includes(this.players[idx])) {
          firstIdx = idx;
          break;
        }
      }
    }
    const order: string[] = [];
    for (let k = 0; k < this.players.length; k++) {
      const p = this.players[(firstIdx + k) % this.players.length];
      if (alive.includes(p)) order.push(p.id);
    }

    const r: Round = {
      number: this.roundNumber,
      deck: shuffle(createDeck(), this.rng),
      firstId: order[0],
      order,
      pot: 0,
      bettingRound: 0,
      currentBet: 0,
      baseCommitted: 1,
      toAct: null,
      deadline: null,
      afterDiscard: null,
      result: null,
    };
    this.round = r;
    this.nextReady.clear();
    for (const p of this.players) p.hand = null;
    for (const id of order) {
      const p = this.get(id)!;
      p.hand = {
        hidden: undefined as unknown as NumberCard,
        open: [],
        nums: [],
        ops: [...BASE_OPS],
        discarded: [],
        roots: 0,
        pendingDiscard: 0,
        stackStart: p.chips,
        committed: 1,
        roundBet: 0,
        folded: false,
        acted: false,
        ready: false,
        arr: null,
        declaration: null,
        lastAction: null,
      };
      p.chips -= 1;
      r.pot += 1;
    }
    this.addLog(`Manche ${r.number} · mise de départ : 1 jeton chacun (pot : ${r.pot}).`, 'deal');

    for (const id of order) {
      const p = this.get(id)!;
      const hidden = this.drawHidden(p);
      p.hand!.hidden = hidden;
      p.hand!.nums.push(hidden);
    }
    for (let slot = 0; slot < 2; slot++) for (const id of order) this.dealOpen(this.get(id)!);

    this.phase = 'deal';
    this.setTimer('phase', TIMING.deal, () => {
      if (this.phase === 'deal') this.afterDeal('bet1');
    });
  }

  private draw(): Card {
    const r = this.round!;
    if (r.deck.length === 0) r.deck = shuffle(createDeck(), this.rng);
    return r.deck.pop()!;
  }

  private drawHidden(p: Player): NumberCard {
    for (;;) {
      const c = this.draw();
      if (c.kind === 'num') return c;
      this.addLog(`${p.name} tire un ${symbolName(c)} en carte cachée : il est défaussé.`, 'deal');
    }
  }

  private dealOpen(p: Player): void {
    const h = p.hand!;
    const c = this.draw();
    h.open.push(c);
    if (c.kind === 'num') {
      h.nums.push(c);
      return;
    }
    if (c.kind === 'root') {
      h.roots++;
      this.addLog(`${p.name} reçoit une racine √ et pioche un chiffre en plus.`, 'deal');
    } else {
      h.ops.push('*');
      h.pendingDiscard++;
      this.addLog(`${p.name} reçoit un × et doit défausser un opérateur.`, 'deal');
    }
    for (;;) {
      const extra = this.draw();
      if (extra.kind === 'num') {
        h.open.push(extra);
        h.nums.push(extra);
        return;
      }
      this.addLog(`Un ${symbolName(extra)} sort en pioche bonus : défaussé.`, 'deal');
    }
  }

  private afterDeal(next: 'bet1' | 'build'): void {
    this.clearTimer('phase');
    const r = this.round!;
    const pending = this.inHand().filter((p) => p.hand!.pendingDiscard > 0);
    if (pending.length === 0) return next === 'bet1' ? this.startBetting(1) : this.startBuild();
    this.phase = 'discard';
    r.afterDiscard = next;
    r.deadline = this.now() + TIMING.discard;
    this.setTimer('phase', TIMING.discard, () => {
      if (this.phase === 'discard') this.autoDiscardAll();
    });
    this.clearTimers('bot:');
    this.scheduleBots();
  }

  discard(playerId: string, op: unknown): string | undefined {
    if (this.phase !== 'discard') return "Ce n'est pas le moment de défausser.";
    const p = this.get(playerId);
    const h = p?.hand;
    if (!p || !h || h.folded || h.pendingDiscard <= 0) return "Tu n'as rien à défausser.";
    if (op === '/') return 'Le ÷ ne peut jamais être défaussé.';
    if (op !== '+' && op !== '-' && op !== '*') return 'Opérateur invalide.';
    const idx = h.ops.indexOf(op);
    if (idx < 0) return "Tu n'as pas cet opérateur.";
    h.ops.splice(idx, 1);
    h.discarded.push(op);
    h.pendingDiscard--;
    this.addLog(`${p.name} défausse ${OP_SYMBOL[op]}.`, 'deal');
    this.checkDiscardsDone();
    return undefined;
  }

  private defaultDiscard(h: Hand): Op {
    if (h.ops.includes('+')) return '+';
    if (h.ops.includes('-')) return '-';
    return '*';
  }

  private autoDiscardAll(): void {
    for (const p of this.inHand()) {
      while (p.hand!.pendingDiscard > 0) {
        const op = this.defaultDiscard(p.hand!);
        const idx = p.hand!.ops.indexOf(op);
        p.hand!.ops.splice(idx, 1);
        p.hand!.discarded.push(op);
        p.hand!.pendingDiscard--;
        this.addLog(`⏱ ${p.name} défausse ${OP_SYMBOL[op]} (choix automatique).`, 'deal');
      }
    }
    this.checkDiscardsDone();
  }

  private checkDiscardsDone(): void {
    const r = this.round!;
    if (this.phase !== 'discard') return;
    if (this.inHand().some((p) => p.hand!.pendingDiscard > 0)) return;
    this.clearTimer('phase');
    const next = r.afterDiscard ?? 'bet1';
    r.afterDiscard = null;
    if (next === 'bet1') this.startBetting(1);
    else this.startBuild();
  }

  // ---------- Enchères ----------

  private startBetting(n: 1 | 2): void {
    const r = this.round!;
    this.phase = n === 1 ? 'bet1' : 'bet2';
    r.bettingRound = n;
    r.currentBet = 0;
    const inHand = this.inHand();
    r.baseCommitted = Math.max(...inHand.map((p) => p.hand!.committed));
    for (const p of inHand) {
      p.hand!.roundBet = 0;
      p.hand!.acted = false;
      p.hand!.lastAction = null;
    }
    this.clearTimers('bot:');
    if (this.maxRoundBet() <= 0) {
      this.addLog('Plafond de mise atteint : pas d’enchères ce tour-ci.', 'bet');
      return this.endBetting();
    }
    r.toAct = this.nextToAct(null);
    if (!r.toAct) return this.endBetting();
    this.startTurn();
  }

  private needsToAct(p: Player): boolean {
    const r = this.round!;
    const h = p.hand;
    if (!h || h.folded) return false;
    if (h.roundBet < r.currentBet) return true;
    return !h.acted && h.roundBet < this.maxRoundBet();
  }

  private nextToAct(afterId: string | null): string | null {
    const r = this.round!;
    const start = afterId ? r.order.indexOf(afterId) + 1 : 0;
    for (let k = 0; k < r.order.length; k++) {
      const id = r.order[(start + k) % r.order.length];
      const p = this.get(id);
      if (p && this.needsToAct(p)) return id;
    }
    return null;
  }

  private startTurn(): void {
    const r = this.round!;
    const p = this.get(r.toAct);
    this.clearTimer('turn');
    if (!p) return this.advanceFrom(r.toAct);
    if (p.isBot) {
      r.deadline = null;
      this.setTimer(`bot:${p.id}`, this.botDelay(800, 2200), () => this.botBet(p.id));
      return;
    }
    const ms = p.connected ? this.settings.turnSeconds * 1000 : TIMING.offlineTurn;
    r.deadline = this.now() + ms;
    this.setTimer('turn', ms, () => this.timeoutTurn(p.id));
  }

  act(playerId: string, action: BetAction): string | undefined {
    if (this.phase !== 'bet1' && this.phase !== 'bet2') return "Ce n'est pas le moment de miser.";
    const r = this.round!;
    if (r.toAct !== playerId) return "Ce n'est pas ton tour.";
    const p = this.get(playerId)!;
    const h = p.hand!;
    const toCall = r.currentBet - h.roundBet;
    const maxRB = this.maxRoundBet();
    switch (action?.type) {
      case 'check':
        if (toCall > 0) return 'Tu dois suivre, relancer ou te coucher.';
        h.lastAction = { type: 'check' };
        this.addLog(`${p.name} : parole.`, 'bet');
        break;
      case 'call':
        if (toCall <= 0) return 'Rien à suivre : tu peux faire parole.';
        this.pay(p, toCall);
        h.lastAction = { type: h.committed >= this.cap() ? 'allin' : 'call', amount: h.roundBet };
        this.addLog(`${p.name} suit (${toCall}).`, 'bet');
        break;
      case 'raise': {
        const amount = Math.floor(Number(action.amount));
        if (!Number.isFinite(amount) || amount <= r.currentBet) return 'Relance trop faible.';
        if (amount > maxRB) return `La mise maximale ce tour-ci est de ${maxRB}.`;
        const opening = r.currentBet === 0;
        this.pay(p, amount - h.roundBet);
        r.currentBet = amount;
        const allin = h.committed >= this.cap();
        h.lastAction = { type: allin ? 'allin' : 'raise', amount };
        this.addLog(`${p.name} ${opening ? 'mise' : 'relance à'} ${amount}${allin ? ' (plafond !)' : ''}.`, 'bet');
        break;
      }
      case 'fold':
        if (toCall <= 0) return 'Inutile de te coucher : tu peux faire parole gratuitement.';
        h.folded = true;
        h.lastAction = { type: 'fold' };
        this.addLog(`${p.name} se couche.`, 'bet');
        break;
      default:
        return 'Action inconnue.';
    }
    h.acted = true;
    this.clearTimer('turn');
    this.clearTimer(`bot:${playerId}`);
    this.advanceFrom(playerId);
    return undefined;
  }

  private advanceFrom(playerId: string | null): void {
    const r = this.round!;
    const inHand = this.inHand();
    if (inHand.length === 1) return this.foldWin(inHand[0]);
    if (inHand.length === 0) return this.endGame();
    r.toAct = this.nextToAct(playerId);
    if (!r.toAct) return this.endBetting();
    this.startTurn();
  }

  private pay(p: Player, amount: number): void {
    const h = p.hand!;
    p.chips -= amount;
    h.roundBet += amount;
    h.committed += amount;
    this.round!.pot += amount;
  }

  private timeoutTurn(playerId: string): void {
    const r = this.round;
    if (!r || r.toAct !== playerId || (this.phase !== 'bet1' && this.phase !== 'bet2')) return;
    const p = this.get(playerId)!;
    const toCall = r.currentBet - p.hand!.roundBet;
    this.addLog(`⏱ Temps écoulé pour ${p.name}.`, 'alert');
    this.act(playerId, { type: toCall > 0 ? 'fold' : 'check' });
  }

  private endBetting(): void {
    const r = this.round!;
    r.toAct = null;
    r.deadline = null;
    this.clearTimer('turn');
    if (r.bettingRound === 1) this.dealThird();
    else this.startDeclare();
  }

  private dealThird(): void {
    const r = this.round!;
    this.phase = 'deal';
    r.deadline = null;
    for (const p of this.inHand()) this.dealOpen(p);
    this.addLog('Dernière carte distribuée.', 'deal');
    this.setTimer('phase', TIMING.deal2, () => {
      if (this.phase === 'deal') this.afterDeal('build');
    });
  }

  // ---------- Équations ----------

  private shape(h: Hand) {
    return { nums: h.nums, ops: h.ops, roots: h.roots };
  }

  private startBuild(): void {
    const r = this.round!;
    this.phase = 'build';
    const ms = this.settings.buildSeconds * 1000;
    r.deadline = this.now() + ms;
    for (const p of this.inHand()) {
      const h = p.hand!;
      h.ready = false;
      const d = defaultArrangement(this.shape(h));
      h.arr = { high: d, low: { nums: [...d.nums], ops: [...d.ops], roots: [...d.roots] } };
    }
    this.addLog(`À vos équations : ${this.settings.buildSeconds} secondes !`);
    this.setTimer('phase', ms, () => {
      if (this.phase === 'build') this.endBuild(true);
    });
    this.clearTimers('bot:');
    this.scheduleBots();
  }

  arrange(playerId: string, payload: { high?: unknown; low?: unknown }): string | undefined {
    if (this.phase !== 'build') return 'Les équations sont verrouillées.';
    const h = this.get(playerId)?.hand;
    if (!h || h.folded || !h.arr) return "Tu n'es pas dans cette manche.";
    const high = payload.high === undefined ? h.arr.high : checkArrangement(payload.high, this.shape(h));
    const low = payload.low === undefined ? h.arr.low : checkArrangement(payload.low, this.shape(h));
    if (!high || !low) return 'Équation incomplète : toutes les cartes doivent être utilisées.';
    h.arr = { high, low };
    return undefined;
  }

  setReady(playerId: string, ready: boolean): string | undefined {
    if (this.phase !== 'build') return 'Les équations sont déjà verrouillées.';
    const h = this.get(playerId)?.hand;
    if (!h || h.folded) return "Tu n'es pas dans cette manche.";
    h.ready = !!ready;
    if (this.inHand().every((p) => p.hand!.ready)) this.endBuild(false);
    return undefined;
  }

  private endBuild(timedOut: boolean): void {
    this.clearTimer('phase');
    this.addLog(timedOut ? '⏱ Temps écoulé : équations verrouillées.' : 'Tout le monde est prêt : équations verrouillées.', timedOut ? 'alert' : 'info');
    this.startBetting(2);
  }

  // ---------- Déclaration et révélation ----------

  private startDeclare(): void {
    const r = this.round!;
    this.phase = 'declare';
    r.deadline = this.now() + TIMING.declare;
    this.addLog('Déclaration secrète : High, Low ou Swing ?');
    this.setTimer('phase', TIMING.declare, () => {
      if (this.phase === 'declare') this.autoDeclareAll();
    });
    this.clearTimers('bot:');
    this.scheduleBots();
  }

  declare(playerId: string, decl: unknown): string | undefined {
    if (this.phase !== 'declare') return "Ce n'est pas le moment de déclarer.";
    const h = this.get(playerId)?.hand;
    if (!h || h.folded) return "Tu n'es pas dans cette manche.";
    if (decl !== 'high' && decl !== 'low' && decl !== 'swing') return 'Choix invalide.';
    if (h.declaration) return 'Ta déclaration est déjà faite.';
    h.declaration = decl;
    if (this.inHand().every((p) => p.hand!.declaration)) this.showdown();
    return undefined;
  }

  private distances(h: Hand): { high: number | null; low: number | null } {
    const hv = h.arr ? evaluateArrangement(h.arr.high, h.nums) : null;
    const lv = h.arr ? evaluateArrangement(h.arr.low, h.nums) : null;
    return { high: hv === null ? null : Math.abs(hv - TARGET.high), low: lv === null ? null : Math.abs(lv - TARGET.low) };
  }

  private autoDeclareAll(): void {
    for (const p of this.inHand()) {
      const h = p.hand!;
      if (h.declaration) continue;
      const d = this.distances(h);
      h.declaration = Bots.chooseDeclaration(d.high, d.low, () => 0.99);
      if (!p.isBot) this.addLog(`⏱ ${p.name} n'a pas choisi : déclaration automatique.`, 'alert');
    }
    this.showdown();
  }

  private showdown(): void {
    const r = this.round!;
    this.clearTimers('phase');
    this.clearTimers('turn');
    this.clearTimers('bot:');
    this.phase = 'showdown';
    const inHand = this.inHand();
    const contenders: Contender[] = inHand.map((p) => {
      const h = p.hand!;
      const sorted = [...h.nums].sort(compareNum);
      return {
        id: p.id,
        decl: h.declaration ?? 'low',
        highVal: h.arr ? evaluateArrangement(h.arr.high, h.nums) : null,
        lowVal: h.arr ? evaluateArrangement(h.arr.low, h.nums) : null,
        maxCard: sorted[sorted.length - 1],
        minCard: sorted[0],
      };
    });
    const res = resolveShowdown(contenders, r.pot);

    const entries: ResultEntry[] = inHand.map((p) => {
      const h = p.hand!;
      const c = contenders.find((x) => x.id === p.id)!;
      const solved = solveHand(this.shape(h), 1);
      const line = (side: 'high' | 'low') => {
        const value = side === 'high' ? c.highVal : c.lowVal;
        const ranking = side === 'high' ? res.highRanking : res.lowRanking;
        const idx = ranking.indexOf(p.id);
        return {
          text: h.arr ? formatEquation(h.arr[side], h.nums) : '—',
          value,
          dist: value === null ? null : Math.abs(value - TARGET[side]),
          rank: idx >= 0 ? idx + 1 : null,
        };
      };
      return {
        id: p.id,
        decl: c.decl,
        hidden: h.hidden,
        high: line('high'),
        low: line('low'),
        best: {
          high: solved.high[0]?.value ?? null,
          low: solved.low[0]?.value ?? null,
          highText: solved.high[0] ? formatEquation(solved.high[0].arr, h.nums) : null,
          lowText: solved.low[0] ? formatEquation(solved.low[0].arr, h.nums) : null,
        },
      };
    });

    // Statistiques : équation parfaite du côté déclaré.
    for (const e of entries) {
      const p = this.get(e.id)!;
      const perfect =
        (e.decl !== 'low' && e.high.dist !== null && e.high.dist < EPS) || (e.decl !== 'high' && e.low.dist !== null && e.low.dist < EPS);
      if (perfect) p.stats.perfect++;
    }

    const headline = this.applyAwards(res.awards, r.pot, res.burned, res.swing);
    r.result = { kind: 'showdown', entries, awards: res.awards, swing: res.swing, burned: res.burned, pot: r.pot, headline };
    this.afterResult(TIMING.showdown);
  }

  private foldWin(winner: Player): void {
    const r = this.round!;
    this.clearTimers('phase');
    this.clearTimers('turn');
    this.clearTimers('bot:');
    this.phase = 'showdown';
    r.toAct = null;
    const awards = [{ id: winner.id, amount: r.pot, reason: 'fold' as AwardReason }];
    const headline = this.applyAwards(awards, r.pot, 0, []);
    r.result = { kind: 'fold', entries: [], awards, swing: [], burned: 0, pot: r.pot, headline };
    this.afterResult(TIMING.foldWin);
  }

  private applyAwards(awards: { id: string; amount: number; reason: AwardReason }[], pot: number, burned: number, swing: { id: string; success: boolean }[]): string {
    const name = (id: string) => this.get(id)?.name ?? '?';
    const seen = new Set<string>();
    this.burnedTotal += burned;
    for (const a of awards) {
      const p = this.get(a.id);
      if (!p) continue;
      p.chips += a.amount;
      if (!seen.has(p.id) && a.reason !== 'refund') {
        p.stats.wins++;
        seen.add(p.id);
      }
      const total = awards.filter((x) => x.id === a.id).reduce((s, x) => s + x.amount, 0);
      p.stats.bestWin = Math.max(p.stats.bestWin, total);
    }
    const first = awards[0];
    let headline = '';
    if (!first) headline = 'Manche terminée.';
    else if (first.reason === 'fold') headline = `${name(first.id)} remporte ${pot} jetons : tous les autres se sont couchés.`;
    else if (first.reason === 'swing') headline = `🎯 Swing réussi ! ${name(first.id)} rafle les ${pot} jetons.`;
    else if (first.reason === 'beat-swing') {
      const failed = swing.filter((s) => !s.success).map((s) => name(s.id)).join(' et ');
      headline = `⚔️ ${name(first.id)} fait échouer le Swing de ${failed} et rafle les ${pot} jetons !`;
    } else if (first.reason === 'all') headline = `${name(first.id)} remporte tout le pot : ${pot} jetons.`;
    else if (first.reason === 'refund') headline = 'Aucune équation valide : les mises sont rendues.';
    else {
      const hi = awards.find((a) => a.reason === 'high');
      const lo = awards.find((a) => a.reason === 'low');
      const failed = swing.filter((s) => !s.success).map((s) => name(s.id));
      headline = `${name(hi!.id)} gagne le High, ${name(lo!.id)} le Low : ${hi!.amount} jetons chacun.`;
      if (failed.length) headline = `Swing raté pour ${failed.join(' et ')} ! ` + headline;
    }
    if (burned > 0) headline += ` (${burned} jeton brûlé : pot impair.)`;
    this.addLog(headline, 'win');

    for (const p of this.players) {
      if (p.inGame && !p.out && p.chips <= 0) {
        p.out = true;
        p.outOrder = ++this.eliminations;
        this.addLog(`${p.name} n'a plus de jetons et quitte la course.`, 'alert');
      }
    }
    return headline;
  }

  private humansToWait(): Player[] {
    return this.players.filter((p) => !p.isBot && p.connected && p.inGame && !p.out);
  }

  private afterResult(ms: number): void {
    const r = this.round!;
    this.nextReady.clear();
    const wait = this.humansToWait().length > 0 ? ms : Math.min(ms, TIMING.showdownBotsOnly);
    r.deadline = this.now() + wait;
    this.setTimer('phase', wait, () => {
      if (this.phase === 'showdown') this.startRound();
    });
  }

  readyNext(playerId: string): string | undefined {
    if (this.phase !== 'showdown') return undefined;
    this.nextReady.add(playerId);
    this.checkNextReady();
    return undefined;
  }

  private checkNextReady(): void {
    if (this.phase !== 'showdown') return;
    const waiting = this.humansToWait();
    if (waiting.length > 0 && waiting.every((p) => this.nextReady.has(p.id))) this.startRound();
  }

  private endGame(): void {
    this.clearTimers('phase');
    this.clearTimers('turn');
    this.clearTimers('bot:');
    this.phase = 'gameover';
    if (this.round) {
      this.round.toAct = null;
      this.round.deadline = null;
    }
    const ranked = this.players
      .filter((p) => p.inGame)
      .sort((a, b) => b.chips - a.chips || Number(a.out) - Number(b.out) || b.outOrder - a.outOrder);
    const ranking: { id: string; chips: number; place: number }[] = [];
    ranked.forEach((p, i) => {
      const prev = ranking[i - 1];
      const tied = prev && prev.chips === p.chips && p.chips > 0;
      ranking.push({ id: p.id, chips: p.chips, place: tied ? prev.place : i + 1 });
    });
    this.gameOver = { ranking, rounds: this.roundNumber };
    const winner = ranked[0];
    if (winner) this.addLog(`🏁 Fin de partie ! ${winner.name} l'emporte avec ${winner.chips} jetons.`, 'win');
  }

  // ---------- Bots ----------

  private visibleNumbersFor(p: Player): NumberCard[] {
    const out: NumberCard[] = [];
    if (p.hand) out.push(p.hand.hidden);
    for (const q of this.players) {
      if (!q.hand) continue;
      for (const c of q.hand.open) if (c.kind === 'num') out.push(c);
    }
    return out;
  }

  private scheduleBots(): void {
    const r = this.round;
    if (!r) return;
    const bots = this.inHand().filter((p) => p.isBot);
    switch (this.phase) {
      case 'discard':
        for (const b of bots) {
          if (b.hand!.pendingDiscard > 0) this.setTimerOnce(`bot:${b.id}`, this.botDelay(700, 1800), () => this.botDiscard(b.id));
        }
        break;
      case 'build':
        for (const b of bots) {
          if (!b.hand!.ready) this.setTimerOnce(`bot:${b.id}`, this.botDelay(3000, 9000), () => this.botBuild(b.id));
        }
        break;
      case 'declare':
        for (const b of bots) {
          if (!b.hand!.declaration) this.setTimerOnce(`bot:${b.id}`, this.botDelay(900, 2600), () => this.botDeclare(b.id));
        }
        break;
      default:
        break;
    }
  }

  private botBet(id: string): void {
    const r = this.round;
    const p = this.get(id);
    if (!r || !p?.hand || r.toAct !== id || (this.phase !== 'bet1' && this.phase !== 'bet2')) return;
    const h = p.hand;
    let est: Bots.Estimate;
    if (this.phase === 'bet2' && h.arr) {
      const d = this.distances(h);
      est = Bots.estimateFromDistances(d.high, d.low);
    } else {
      est = Bots.estimate(
        h.nums.map((c) => c.value),
        h.ops,
        h.roots,
        Bots.unseenPool(this.visibleNumbersFor(p)),
      );
    }
    const decision = Bots.chooseBet(
      {
        est,
        toCall: r.currentBet - h.roundBet,
        pot: r.pot,
        currentBet: r.currentBet,
        maxRoundBet: this.maxRoundBet(),
        opponents: this.inHand().length - 1,
      },
      this.rng,
    );
    const err = this.act(id, decision);
    if (err) {
      const toCall = r.currentBet - h.roundBet;
      this.act(id, { type: toCall > 0 ? 'call' : 'check' });
    }
  }

  private botDiscard(id: string): void {
    const p = this.get(id);
    if (this.phase !== 'discard' || !p?.hand) return;
    const h = p.hand;
    while (h.pendingDiscard > 0 && this.phase === 'discard') {
      const op = Bots.chooseDiscard(
        h.nums.map((c) => c.value),
        h.ops,
        h.pendingDiscard,
        h.roots,
        Bots.unseenPool(this.visibleNumbersFor(p)),
      );
      if (this.discard(id, op)) this.discard(id, this.defaultDiscard(h));
    }
  }

  private botBuild(id: string): void {
    const p = this.get(id);
    if (this.phase !== 'build' || !p?.hand || p.hand.folded) return;
    p.hand.arr = Bots.chooseArrangement(this.shape(p.hand), this.rng);
    this.setReady(id, true);
  }

  private botDeclare(id: string): void {
    const p = this.get(id);
    if (this.phase !== 'declare' || !p?.hand || p.hand.folded || p.hand.declaration) return;
    const d = this.distances(p.hand);
    this.declare(id, Bots.chooseDeclaration(d.high, d.low, this.rng));
  }

  // ---------- Vue envoyée à chaque joueur ----------

  viewFor(viewerId: string): RoomState {
    const r = this.round;
    const reveal = !!r?.result && r.result.kind === 'showdown' && (this.phase === 'showdown' || this.phase === 'gameover');
    return {
      code: this.code,
      hostId: this.hostId,
      youId: viewerId,
      phase: this.phase,
      settings: this.settings,
      players: this.players.map((p) => this.publicPlayer(p, viewerId, reveal)),
      round: r
        ? {
            number: r.number,
            firstId: r.firstId,
            pot: r.pot,
            cap: this.cap(),
            bettingRound: r.bettingRound,
            currentBet: r.currentBet,
            maxRoundBet: this.maxRoundBet(),
            toAct: r.toAct,
            deadline: r.deadline,
            result: r.result,
          }
        : null,
      log: this.log.slice(-40),
      nextReady: [...this.nextReady],
      serverNow: this.now(),
      gameOver: this.gameOver,
    };
  }

  private publicPlayer(p: Player, viewerId: string, reveal: boolean): PublicPlayer {
    const h = p.hand;
    const self = p.id === viewerId;
    const secret = self || (reveal && !!h && !h.folded);
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isBot: p.isBot,
      connected: p.connected,
      chips: p.chips,
      inGame: p.inGame,
      out: p.out,
      stats: p.stats,
      hand: h
        ? {
            hidden: secret ? h.hidden : null,
            open: h.open,
            ops: h.ops,
            discarded: h.discarded,
            roots: h.roots,
            committed: h.committed,
            roundBet: h.roundBet,
            pendingDiscard: h.pendingDiscard,
            folded: h.folded,
            ready: h.ready,
            hasDeclared: !!h.declaration,
            declaration: secret ? h.declaration : null,
            arrangements: secret ? h.arr : null,
            lastAction: h.lastAction,
          }
        : null,
    };
  }
}
