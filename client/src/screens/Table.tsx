// Table de jeu : en-tête (manche, pot, minuteur), étapes de la manche, adversaires, ta main et actions.
import confetti from 'canvas-confetti';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, Flag, LogOut, Menu, ScrollText, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Phase, PublicPlayer, RoomState } from '../../../shared/protocol';
import { BuildPanel, Dock } from '../components/Actions';
import { Chips } from '../components/Cards';
import { GameOverSheet, LogPanel, ShowdownSheet } from '../components/Results';
import { MyArea, Seat } from '../components/Seats';
import { Logo, TimerRing } from '../components/Ui';
import { act, leaveRoom } from '../net';
import { play, vibrate } from '../lib/sound';
import { cx, me as findMe, playerName, seatsAfter } from '../lib/util';
import { useStore } from '../store';

const STEPS: { phases: Phase[]; label: string }[] = [
  { phases: ['deal'], label: 'Cartes' },
  { phases: ['bet1'], label: 'Mises 1' },
  { phases: ['build'], label: 'Équation' },
  { phases: ['bet2'], label: 'Mises 2' },
  { phases: ['declare'], label: 'Déclaration' },
  { phases: ['showdown'], label: 'Révélation' },
];

function stepIndex(state: RoomState): number {
  const r = state.round;
  if (state.phase === 'discard') return r && r.bettingRound >= 1 ? 2 : 0;
  if (state.phase === 'deal') return r && r.bettingRound >= 1 ? 2 : 0;
  return STEPS.findIndex((s) => s.phases.includes(state.phase));
}

function phaseInfo(state: RoomState, me: PublicPlayer | undefined): { title: string; hint: string; tone: string } {
  const r = state.round;
  const h = me?.hand;
  const myTurn = r?.toAct === state.youId;
  switch (state.phase) {
    case 'deal':
      return r && r.bettingRound >= 1
        ? { title: 'Dernière carte', hint: 'Chaque joueur encore en jeu reçoit une 4ᵉ carte visible.', tone: 'neutral' }
        : { title: 'Distribution', hint: '1 jeton de mise de départ, 1 carte cachée et 2 cartes visibles pour chacun.', tone: 'neutral' };
    case 'discard':
      return h?.pendingDiscard
        ? { title: 'Tu as reçu un ×', hint: 'Défausse le + ou le − (ou renonce au ×). Le ÷ reste toujours.', tone: 'active' }
        : { title: 'Carte ×', hint: 'Un joueur a reçu un × et choisit quel opérateur défausser.', tone: 'neutral' };
    case 'bet1':
      return myTurn
        ? { title: 'À toi de miser !', hint: 'Ta main n’est pas complète : il reste une carte à venir. Parole, suivre, relancer ou se coucher ?', tone: 'active' }
        : { title: 'Enchères n°1', hint: `${playerName(state, r?.toAct)} réfléchit. Estime ton potentiel en regardant les cartes visibles.`, tone: 'neutral' };
    case 'build':
      return { title: 'Construis tes équations', hint: 'Une équation pour approcher 20, une pour approcher 1. Toutes tes cartes doivent servir.', tone: 'active' };
    case 'bet2':
      return myTurn
        ? { title: 'À toi de miser !', hint: 'Tes équations sont verrouillées. Dernière chance de miser… ou de bluffer.', tone: 'active' }
        : { title: 'Enchères n°2', hint: `${playerName(state, r?.toAct)} réfléchit. Les équations sont verrouillées.`, tone: 'neutral' };
    case 'declare':
      return { title: 'Déclaration secrète', hint: 'High (20), Low (1) ou Swing (les deux, tout ou rien). Personne ne voit ton choix avant la révélation.', tone: 'active' };
    case 'showdown':
      return { title: 'Révélation', hint: r?.result?.headline ?? '', tone: 'win' };
    case 'gameover':
      return { title: 'Fin de partie', hint: 'Bravo à tous !', tone: 'win' };
    default:
      return { title: '', hint: '', tone: 'neutral' };
  }
}

function phaseTotal(state: RoomState): number {
  switch (state.phase) {
    case 'bet1':
    case 'bet2':
      return state.settings.turnSeconds;
    case 'build':
      return state.settings.buildSeconds;
    case 'discard':
      return 20;
    case 'declare':
      return 30;
    case 'showdown':
      return state.round?.result?.kind === 'fold' ? 10 : 35;
    default:
      return 30;
  }
}

/** Sons, vibrations, titre de l'onglet et confettis selon l'évolution de la partie. */
function useTableEffects(state: RoomState) {
  const prev = useRef<RoomState | null>(null);
  const meId = state.youId;
  useEffect(() => {
    const before = prev.current;
    prev.current = state;
    if (!before) return;
    const mine = (s: RoomState) => s.players.find((p) => p.id === meId)?.hand;
    const isMyTurn = (s: RoomState) => (s.phase === 'bet1' || s.phase === 'bet2') && s.round?.toAct === meId;
    const needsMe = (s: RoomState) => {
      const h = mine(s);
      if (!h || h.folded) return false;
      return isMyTurn(s) || (s.phase === 'discard' && h.pendingDiscard > 0) || (s.phase === 'declare' && !h.hasDeclared) || (s.phase === 'build' && !h.ready);
    };
    if (needsMe(state) && !needsMe(before)) {
      play('turn');
      vibrate([70, 50, 70]);
    } else if (state.phase === 'deal' && before.phase !== 'deal') {
      play('deal');
    }
    if (state.round && before.round && state.round.number === before.round.number && state.round.pot > before.round.pot && state.phase !== 'deal') play('chip');
    if (state.phase === 'showdown' && before.phase !== 'showdown') {
      const won = state.round?.result?.awards.some((a) => a.id === meId && a.reason !== 'refund');
      if (won) {
        play('win');
        confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 }, colors: ['#ffb15e', '#ff5d3a', '#7fe0ff', '#3f86ff', '#e7c27a'] });
      } else play('reveal');
    }
    if (state.phase === 'gameover' && before.phase !== 'gameover') {
      const first = state.gameOver?.ranking[0]?.id === meId;
      play(first ? 'win' : 'reveal');
      confetti({ particleCount: first ? 220 : 90, spread: 100, origin: { y: 0.55 }, colors: ['#e7c27a', '#ffb15e', '#7fe0ff', '#f6eedc'] });
    }
  }, [state, meId]);

  useEffect(() => {
    const h = state.players.find((p) => p.id === meId)?.hand;
    const turn = (state.phase === 'bet1' || state.phase === 'bet2') && state.round?.toAct === meId;
    const pending = !!h && !h.folded && ((state.phase === 'discard' && h.pendingDiscard > 0) || (state.phase === 'declare' && !h.hasDeclared));
    document.title = turn || pending ? '🔔 À toi ! · Équation Hi-Lo' : 'Équation Hi-Lo · 20 ou 1 ?';
    return () => {
      document.title = 'Équation Hi-Lo · 20 ou 1 ?';
    };
  }, [state, meId]);
}

function TableMenu({ state, onClose }: { state: RoomState; onClose: () => void }) {
  const sound = useStore((s) => s.sound);
  const toggleSound = useStore((s) => s.toggleSound);
  const [confirm, setConfirm] = useState<'leave' | 'end' | null>(null);
  const isHost = state.hostId === state.youId;
  const playing = state.phase !== 'gameover' && state.phase !== 'lobby';
  return (
    <motion.div className="menu-pop" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }}>
      <button
        type="button"
        onClick={() => {
          useStore.getState().setRulesOpen(true);
          onClose();
        }}
      >
        <BookOpen size={16} /> Règles du jeu
      </button>
      <button
        type="button"
        className="only-mobile"
        onClick={() => {
          useStore.getState().setLogOpen(true);
          onClose();
        }}
      >
        <ScrollText size={16} /> Journal de la table
      </button>
      <button type="button" onClick={toggleSound}>
        {sound ? <Volume2 size={16} /> : <VolumeX size={16} />} Son et vibrations : {sound ? 'activés' : 'coupés'}
      </button>
      {isHost && playing && (
        <button type="button" className="danger" onClick={() => (confirm === 'end' ? act('game:end').then(onClose) : setConfirm('end'))}>
          <Flag size={16} /> {confirm === 'end' ? 'Confirmer l’arrêt de la partie' : 'Arrêter la partie (hôte)'}
        </button>
      )}
      <button type="button" className="danger" onClick={() => (confirm === 'leave' ? leaveRoom() : setConfirm('leave'))}>
        <LogOut size={16} /> {confirm === 'leave' ? 'Confirmer : quitter la table' : 'Quitter la table'}
      </button>
    </motion.div>
  );
}

export function Table({ state }: { state: RoomState }) {
  const me = findMe(state);
  const r = state.round;
  const [menuOpen, setMenuOpen] = useState(false);
  const logOpen = useStore((s) => s.logOpen);
  const setLogOpen = useStore((s) => s.setLogOpen);
  useTableEffects(state);

  const opponents = seatsAfter(state, state.youId).filter((p) => p.inGame || p.hand);
  const spectators = state.players.filter((p) => !p.inGame && p.id !== state.youId);
  const info = phaseInfo(state, me);
  const step = stepIndex(state);
  const building = state.phase === 'build' && !!me?.hand && !me.hand.folded;
  const betting = state.phase === 'bet1' || state.phase === 'bet2';

  return (
    <div className={cx('table-screen', `phase-${state.phase}`)}>
      <header className="table-top">
        <div className="tt-left">
          <Logo size="sm" />
          <div className="tt-round">
            <span className="eyebrow">Manche {r?.number ?? 0}</span>
            <span className="tt-code">Table {state.code}</span>
          </div>
        </div>
        <div className="tt-pot">
          <span className="eyebrow">Pot</span>
          <motion.span key={r?.pot} initial={{ scale: 1.25 }} animate={{ scale: 1 }}>
            <Chips n={r?.pot ?? 0} size="lg" />
          </motion.span>
          {betting && r && <span className="tt-cap" title="Mise totale maximale par joueur cette manche">plafond {r.cap}</span>}
        </div>
        <div className="tt-right">
          {state.phase !== 'build' && <TimerRing deadline={r?.deadline} total={phaseTotal(state)} size={42} />}
          <div className="menu-wrap">
            <button type="button" className={cx('icon-btn', menuOpen && 'active')} onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <AnimatePresence>{menuOpen && <TableMenu state={state} onClose={() => setMenuOpen(false)} />}</AnimatePresence>
          </div>
        </div>
      </header>

      <div className="phase-track" aria-label="Étapes de la manche">
        {STEPS.map((s, i) => (
          <span key={s.label} className={cx('pt-step', i < step && 'done', i === step && 'current')}>
            <span className="pt-dot" />
            <span className="pt-label">{s.label}</span>
          </span>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${state.phase}-${r?.number}-${info.title}`}
          className={cx('phase-banner', `tone-${info.tone}`)}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.25 }}
        >
          <b>{info.title}</b>
          <span>{info.hint}</span>
        </motion.div>
      </AnimatePresence>

      <div className="table-layout">
        <main className="table-main">
          <div className={cx('opponents', building && 'compact', opponents.length > 4 && 'many')}>
            {opponents.map((p) => (
              <Seat key={p.id} p={p} state={state} />
            ))}
          </div>
          {spectators.length > 0 && (
            <p className="spectators muted small">
              Spectateurs : {spectators.map((p) => `${p.avatar} ${p.name}`).join(' · ')}
            </p>
          )}
          {me && (building ? <BuildPanel state={state} me={me} /> : <MyArea state={state} me={me} />)}
        </main>
        <aside className={cx('table-side', logOpen && 'open')}>
          <button type="button" className="icon-btn side-close only-mobile" onClick={() => setLogOpen(false)} aria-label="Fermer le journal">
            <X size={18} />
          </button>
          <LogPanel state={state} />
        </aside>
      </div>

      {!building && <Dock state={state} me={me} />}
      {state.phase === 'showdown' && r?.result && <ShowdownSheet state={state} />}
      {state.phase === 'gameover' && state.gameOver && <GameOverSheet state={state} />}
    </div>
  );
}
