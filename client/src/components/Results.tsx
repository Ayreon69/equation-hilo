// Révélation de fin de manche, fin de partie (podium) et journal des événements.
import { motion } from 'framer-motion';
import { Lightbulb, LogOut, RotateCcw, Trophy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EPS, Side, formatNumber, isRounded } from '../../../shared/equation';
import type { ResultEntry, RoomState, RoundResult } from '../../../shared/protocol';
import { act, leaveRoom } from '../net';
import { cx, secondsLeft, useNow } from '../lib/util';
import { Avatar, Chips, DeclBadge, EqText, NumCard } from './Cards';
import { Sheet } from './Ui';

function totalAward(res: RoundResult, id: string): number {
  return res.awards.filter((a) => a.id === id).reduce((s, a) => s + a.amount, 0);
}

function wonSide(res: RoundResult, entry: ResultEntry, side: Side): boolean {
  return res.awards.some((a) => {
    if (a.id !== entry.id) return false;
    if (a.reason === side || a.reason === 'swing') return true;
    if (a.reason === 'beat-swing' || a.reason === 'all') return entry.decl === side;
    return false;
  });
}

function SideColumn({ side, state, res }: { side: Side; state: RoomState; res: RoundResult }) {
  const list = res.entries
    .filter((e) => e.decl === side || e.decl === 'swing')
    .sort((a, b) => (a[side].rank ?? 99) - (b[side].rank ?? 99));
  return (
    <section className={cx('sd-col', `sd-${side}`)}>
      <h3>{side === 'high' ? 'High · viser 20' : 'Low · viser 1'}</h3>
      {list.length === 0 && <p className="muted small">Personne n’a joué ce côté.</p>}
      {list.map((e, i) => {
        const p = state.players.find((x) => x.id === e.id);
        const line = e[side];
        const won = wonSide(res, e, side);
        return (
          <motion.div
            key={e.id}
            className={cx('sd-entry', won && 'won', e.id === state.youId && 'me')}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.12 }}
          >
            <div className="sd-who">
              <Avatar emoji={p?.avatar ?? '❔'} size="sm" />
              <b className="ellipsis">{p?.name ?? '?'}</b>
              {e.decl === 'swing' && <DeclBadge decl="swing" />}
              {won && <Trophy size={16} className="trophy" aria-label="gagnant" />}
            </div>
            <div className="sd-eq">
              <EqText text={line.text} />
            </div>
            <div className="sd-val">
              {line.value === null ? (
                <span className="bad">÷0 invalide</span>
              ) : (
                <b>
                  {isRounded(line.value) ? '≈' : '='} {formatNumber(line.value)}
                </b>
              )}
              {line.dist !== null && <em>{line.dist < EPS ? 'parfait !' : `écart ${formatNumber(line.dist)}`}</em>}
            </div>
            <div className="sd-hidden">
              <span>cachée</span>
              <NumCard card={e.hidden} size="xs" />
            </div>
          </motion.div>
        );
      })}
    </section>
  );
}

export function ShowdownSheet({ state }: { state: RoomState }) {
  const r = state.round!;
  const res = r.result!;
  const [minimized, setMinimized] = useState(false);
  const now = useNow(500);
  useEffect(() => setMinimized(false), [r.number]);
  const me = state.players.find((p) => p.id === state.youId);
  const myEntry = res.entries.find((e) => e.id === state.youId);
  const ready = state.nextReady.includes(state.youId);
  const waitingHumans = state.players.filter((p) => !p.isBot && p.connected && p.inGame && !p.out);
  const left = secondsLeft(r.deadline, now);
  const canVote = !!me && me.inGame && !me.out;
  const winners = [...new Set(res.awards.map((a) => a.id))];
  const sides = (['high', 'low'] as Side[]).filter((side) => res.entries.some((e) => e.decl === side || e.decl === 'swing'));

  if (minimized) {
    return (
      <button type="button" className="results-pill" onClick={() => setMinimized(false)}>
        <Trophy size={16} /> Résultats de la manche {r.number} {left !== null && `· ${left} s`}
      </button>
    );
  }

  return (
    <Sheet open onClose={() => setMinimized(true)} className="showdown-sheet" label="Résultats de la manche">
      <header className="sd-head">
        <p className="eyebrow">
          Manche {r.number} · {res.kind === 'fold' ? 'Fin des enchères' : 'Révélation'}
        </p>
        <h2>{res.headline}</h2>
        <div className="sd-awards">
          {winners.map((id) => {
            const p = state.players.find((x) => x.id === id);
            return (
              <motion.span key={id} className="sd-award" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', delay: 0.5 }}>
                <Avatar emoji={p?.avatar ?? '❔'} size="sm" ring="win" /> {p?.name} <b>+{totalAward(res, id)}</b>
              </motion.span>
            );
          })}
          <span className="sd-pot">
            Pot <Chips n={res.pot} size="sm" />
            {res.burned > 0 && <em> · {res.burned} brûlé</em>}
          </span>
        </div>
      </header>

      {res.kind === 'showdown' ? (
        <>
          <div className={cx('sd-columns', sides.length === 1 && 'single')}>
            {sides.map((side) => (
              <SideColumn key={side} side={side} state={state} res={res} />
            ))}
          </div>
          {sides.length === 1 && (
            <p className="hint center">Personne n’a joué {sides[0] === 'high' ? 'Low' : 'High'} : tout le pot revient au meilleur {sides[0] === 'high' ? 'High' : 'Low'}.</p>
          )}
        </>
      ) : (
        <p className="sd-fold">Pas de révélation : les cartes restent secrètes… bluff ou pas ?</p>
      )}

      {myEntry && (myEntry.best.highText || myEntry.best.lowText) && (
        <div className="best-hint">
          <Lightbulb size={18} />
          <div>
            <b>Ton meilleur possible :</b>
            {myEntry.best.highText && myEntry.best.high !== null && (
              <span>
                <span className="tag-high">High</span> <EqText text={myEntry.best.highText} /> {isRounded(myEntry.best.high) ? '≈' : '='}{' '}
                <b>{formatNumber(myEntry.best.high)}</b>
              </span>
            )}
            {myEntry.best.lowText && myEntry.best.low !== null && (
              <span>
                <span className="tag-low">Low</span> <EqText text={myEntry.best.lowText} /> {isRounded(myEntry.best.low) ? '≈' : '='}{' '}
                <b>{formatNumber(myEntry.best.low)}</b>
              </span>
            )}
          </div>
        </div>
      )}

      <footer className="sd-foot">
        {canVote ? (
          <button type="button" className="btn btn-primary btn-lg" disabled={ready} onClick={() => act('game:next')}>
            {ready ? 'En attente des autres…' : 'Manche suivante'}
          </button>
        ) : (
          <button type="button" className="btn btn-ghost btn-lg" onClick={() => setMinimized(true)}>
            Voir la table
          </button>
        )}
        <p className="hint center">
          {left !== null && `Suite automatique dans ${left} s`}
          {waitingHumans.length > 0 && ` · ${state.nextReady.length}/${waitingHumans.length} prêts`}
        </p>
      </footer>
    </Sheet>
  );
}

export function GameOverSheet({ state }: { state: RoomState }) {
  const go = state.gameOver!;
  const isHost = state.hostId === state.youId;
  const ranking = go.ranking.map((r) => ({ ...r, p: state.players.find((p) => p.id === r.id) })).filter((r) => r.p);
  const winner = ranking[0];
  const podium = [ranking[1], ranking[0], ranking[2]].filter(Boolean);
  const best = (key: 'wins' | 'perfect' | 'bestWin') => {
    const sorted = [...ranking].sort((a, b) => b.p!.stats[key] - a.p!.stats[key]);
    return sorted[0] && sorted[0].p!.stats[key] > 0 ? sorted[0] : null;
  };
  const awards = [
    { label: 'Manches gagnées', who: best('wins'), value: (n: number) => `${n}` },
    { label: 'Équations parfaites', who: best('perfect'), value: (n: number) => `${n}` },
    { label: 'Plus gros gain', who: best('bestWin'), value: (n: number) => `+${n}` },
  ];
  const statKey = ['wins', 'perfect', 'bestWin'] as const;

  return (
    <Sheet open className="gameover-sheet" label="Fin de partie">
      <header className="go-head">
        <p className="eyebrow">Fin de partie · {go.rounds} manche{go.rounds > 1 ? 's' : ''}</p>
        <h2>{winner ? `${winner.p!.name} remporte la partie !` : 'Partie terminée'}</h2>
      </header>
      <div className="podium">
        {podium.map((r) => (
          <motion.div
            key={r!.id}
            className={cx('podium-step', `place-${r!.place}`)}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: r!.place === 1 ? 0.5 : r!.place === 2 ? 0.25 : 0.1, type: 'spring' }}
          >
            <Avatar emoji={r!.p!.avatar} size={r!.place === 1 ? 'xl' : 'lg'} ring={r!.place === 1 ? 'win' : null} />
            <b className="ellipsis">{r!.p!.name}</b>
            <Chips n={r!.chips} size="sm" />
            <div className="podium-block">{r!.place}</div>
          </motion.div>
        ))}
      </div>
      {ranking.length > 3 && (
        <ol className="final-ranking" start={4}>
          {ranking.slice(3).map((r) => (
            <li key={r.id}>
              <Avatar emoji={r.p!.avatar} size="sm" /> {r.p!.name} <Chips n={r.chips} size="sm" />
            </li>
          ))}
        </ol>
      )}
      <div className="go-awards">
        {awards.map((a, i) =>
          a.who ? (
            <div key={a.label} className="go-award">
              <span className="eyebrow">{a.label}</span>
              <span>
                <Avatar emoji={a.who.p!.avatar} size="sm" /> {a.who.p!.name} · <b>{a.value(a.who.p!.stats[statKey[i]])}</b>
              </span>
            </div>
          ) : null,
        )}
      </div>
      <footer className="go-foot">
        {isHost ? (
          <button type="button" className="btn btn-primary btn-lg" onClick={() => act('game:restart')}>
            <RotateCcw size={18} /> Revanche !
          </button>
        ) : (
          <p className="waiting">
            <span className="pulse-dot" /> L’hôte peut lancer une revanche…
          </p>
        )}
        <button type="button" className="btn btn-ghost" onClick={() => leaveRoom()}>
          <LogOut size={16} /> Quitter la table
        </button>
      </footer>
    </Sheet>
  );
}

export function LogPanel({ state }: { state: RoomState }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.log.length]);
  return (
    <section className="log-panel">
      <h3 className="eyebrow">Journal de la table</h3>
      <ol ref={ref}>
        {state.log.map((e) => (
          <li key={e.id} className={`log-${e.kind}`}>
            {e.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
