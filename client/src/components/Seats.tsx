// Places à la table : adversaires (compacts) et ta propre main.
import { motion } from 'framer-motion';
import { Crown, EyeOff, WifiOff } from 'lucide-react';
import { NumberCard } from '../../../shared/cards';
import { Side, formatEquation } from '../../../shared/equation';
import type { PublicHand, PublicPlayer, RoomState } from '../../../shared/protocol';
import { useStore } from '../store';
import { cx } from '../lib/util';
import { AnyCard, Avatar, CardBack, Chips, DeclBadge, EqText, NumCard, OpTile } from './Cards';

export function handNums(h: PublicHand): NumberCard[] {
  const open = h.open.filter((c): c is NumberCard => c.kind === 'num');
  return h.hidden ? [h.hidden, ...open] : open;
}

const isBetting = (state: RoomState) => state.phase === 'bet1' || state.phase === 'bet2';

function actionText(a: PublicHand['lastAction']): string {
  if (!a) return '';
  switch (a.type) {
    case 'check':
      return 'Parole';
    case 'call':
      return `Suit (${a.amount})`;
    case 'bet':
      return `Mise ${a.amount}`;
    case 'raise':
      return `Relance à ${a.amount}`;
    case 'allin':
      return `Plafond ! (${a.amount})`;
    case 'fold':
      return 'Couché';
  }
}

export function seatStatus(p: PublicPlayer, state: RoomState): { text: string; tone: string } {
  if (p.out) return { text: 'Éliminé', tone: 'muted' };
  if (!p.inGame) return { text: 'Spectateur', tone: 'muted' };
  const h = p.hand;
  if (!h) return { text: '', tone: 'muted' };
  if (h.folded) return { text: 'Couché', tone: 'muted' };
  const r = state.round;
  switch (state.phase) {
    case 'deal':
      return { text: 'Reçoit ses cartes', tone: 'muted' };
    case 'discard':
      return h.pendingDiscard > 0 ? { text: 'Défausse un opérateur…', tone: 'wait' } : { text: 'Prêt', tone: 'ok' };
    case 'bet1':
    case 'bet2':
      if (r?.toAct === p.id) return { text: 'Réfléchit…', tone: 'active' };
      if (h.lastAction) return { text: actionText(h.lastAction), tone: ['bet', 'raise', 'allin'].includes(h.lastAction.type) ? 'hot' : 'neutral' };
      return { text: 'Attend son tour', tone: 'muted' };
    case 'build':
      return h.ready ? { text: 'Équation prête ✓', tone: 'ok' } : { text: 'Calcule…', tone: 'wait' };
    case 'declare':
      return h.hasDeclared ? { text: 'A choisi son camp', tone: 'ok' } : { text: 'Hésite…', tone: 'wait' };
    default:
      return { text: '', tone: 'muted' };
  }
}

function EmoteBubbles({ playerId }: { playerId: string }) {
  const emotes = useStore((s) => s.emotes);
  const mine = emotes.filter((e) => e.playerId === playerId);
  return (
    <div className="emote-layer" aria-hidden>
      {mine.map((e) => (
        <span key={e.id} className="emote-bubble">
          {e.emoji}
        </span>
      ))}
    </div>
  );
}

function awardFor(state: RoomState, id: string): number {
  const res = state.round?.result;
  if (!res || (state.phase !== 'showdown' && state.phase !== 'gameover')) return 0;
  return res.awards.filter((a) => a.id === id).reduce((s, a) => s + a.amount, 0);
}

export function Seat({ p, state }: { p: PublicPlayer; state: RoomState }) {
  const r = state.round;
  const h = p.hand;
  const turn = isBetting(state) && r?.toAct === p.id;
  const status = seatStatus(p, state);
  const award = awardFor(state, p.id);
  const showDecl = state.phase === 'showdown' && h?.declaration;
  return (
    <motion.article
      layout
      className={cx('seat', turn && 'turn', h?.folded && 'folded', p.out && 'out', !p.connected && !p.isBot && 'offline', award > 0 && 'winner')}
    >
      <div className="seat-head">
        <Avatar emoji={p.avatar} ring={turn ? 'turn' : award > 0 ? 'win' : null} />
        <div className="seat-id">
          <span className="seat-name">
            <span className="ellipsis">{p.name}</span>
            {p.id === state.hostId && <Crown size={12} className="crown" aria-label="hôte" />}
            {p.isBot && <span className="tag tag-bot">bot</span>}
            {!p.connected && !p.isBot && <WifiOff size={12} className="conn off" aria-label="déconnecté" />}
          </span>
          <span className={cx('seat-status', `tone-${status.tone}`)}>{status.text}</span>
        </div>
        <div className="seat-money">
          <Chips n={p.chips} size="sm" />
          {h && !h.folded && h.committed > 0 && <span className="seat-bet">misé {h.committed}</span>}
        </div>
      </div>
      {h && (
        <div className="seat-hand">
          <div className="seat-cards">
            {h.hidden ? <NumCard card={h.hidden} size="sm" deal={0} /> : <CardBack size="sm" deal={0} />}
            {h.open.map((c, i) => (
              <AnyCard key={c.id} card={c} size="sm" deal={0.08 * (i + 1)} />
            ))}
          </div>
          <div className="seat-ops">
            {h.ops.map((op, i) => (
              <OpTile key={`${op}${i}`} op={op} size="xs" />
            ))}
            {h.discarded.map((op, i) => (
              <OpTile key={`d${op}${i}`} op={op} size="xs" discarded />
            ))}
          </div>
        </div>
      )}
      {(showDecl || award > 0) && (
        <div className="seat-result">
          {showDecl && <DeclBadge decl={h!.declaration!} />}
          {award > 0 && <span className="win-amount">+{award}</span>}
        </div>
      )}
      <EmoteBubbles playerId={p.id} />
    </motion.article>
  );
}

export function EquationLine({ side, h }: { side: Side; h: PublicHand }) {
  if (!h.arrangements) return null;
  const nums = handNums(h);
  const arr = h.arrangements[side];
  return (
    <div className={cx('eq-line', `eq-line-${side}`)}>
      <span className={side === 'high' ? 'tag-high' : 'tag-low'}>{side === 'high' ? 'High' : 'Low'}</span>
      <span className="eq-line-text">
        <EqText text={formatEquation(arr, nums)} />
      </span>
    </div>
  );
}

export function MyArea({ state, me }: { state: RoomState; me: PublicPlayer }) {
  const h = me.hand;
  const r = state.round;
  const turn = isBetting(state) && r?.toAct === me.id;
  const award = awardFor(state, me.id);
  if (!h) {
    return (
      <section className="my-area spectating">
        <p>
          {me.out
            ? 'Tu n’as plus de jetons : tu regardes la fin de la partie.'
            : 'Tu regardes cette partie en spectateur : tu joueras à la prochaine !'}
        </p>
      </section>
    );
  }
  const lockedEq = !!h.arrangements && ['bet2', 'declare', 'showdown'].includes(state.phase) && !h.folded;
  return (
    <section className={cx('my-area', turn && 'turn', h.folded && 'folded', award > 0 && 'winner')}>
      <header className="my-head">
        <Avatar emoji={me.avatar} size="lg" ring={turn ? 'turn' : award > 0 ? 'win' : null} />
        <div className="my-id">
          <span className="my-name">
            {me.name} <span className="you">toi</span>
          </span>
          <span className="my-sub">{h.folded ? 'Couché pour cette manche' : h.committed > 0 ? `Misé cette manche : ${h.committed}` : ' '}</span>
        </div>
        <Chips n={me.chips} size="lg" delta={award > 0 ? award : undefined} />
      </header>
      <div className="my-cards">
        {h.hidden && (
          <div className="my-hidden">
            <NumCard card={h.hidden} size="lg" hidden deal={0} />
            <span className="hidden-label">
              <EyeOff size={12} /> cachée
            </span>
          </div>
        )}
        {h.open.map((c, i) => (
          <AnyCard key={c.id} card={c} size="lg" deal={0.1 * (i + 1)} />
        ))}
      </div>
      <div className="my-ops">
        {h.ops.map((op, i) => (
          <OpTile key={`${op}${i}`} op={op} size="sm" />
        ))}
        {h.discarded.map((op, i) => (
          <OpTile key={`d${op}${i}`} op={op} size="sm" discarded />
        ))}
        {h.roots > 0 && <span className="roots-note">+ {h.roots} racine{h.roots > 1 ? 's' : ''} √ à placer</span>}
      </div>
      {lockedEq && (
        <div className="my-equations">
          <EquationLine side="high" h={h} />
          <EquationLine side="low" h={h} />
        </div>
      )}
      {state.phase === 'showdown' && h.declaration && (
        <div className="seat-result">
          <span className="muted small">Ton choix :</span> <DeclBadge decl={h.declaration} />
          {award > 0 && <span className="win-amount">+{award}</span>}
        </div>
      )}
      <EmoteBubbles playerId={me.id} />
    </section>
  );
}
