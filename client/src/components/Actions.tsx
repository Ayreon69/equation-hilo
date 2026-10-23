// Barre d'actions selon la phase : défausse du ×, enchères, équation, déclaration.
import { motion } from 'framer-motion';
import { Check, ChevronDown, ChevronUp, Minus, Pencil, Plus, Smile } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { OP_SYMBOL, Op } from '../../../shared/cards';
import { EPS, Side, TARGET, evaluateArrangement, formatNumber } from '../../../shared/equation';
import { Decl, EMOTES, PublicPlayer, RoomState } from '../../../shared/protocol';
import { act, call, sendEmote } from '../net';
import { cx, playerName, plural } from '../lib/util';
import { DeclBadge, OpTile } from './Cards';
import { BuilderValue, EquationBuilder, builderFrom, rowToArrangement } from './EquationBuilder';
import { handNums } from './Seats';
import { TimerRing } from './Ui';

// ---------- Enchères ----------

export function BetControls({ state, me }: { state: RoomState; me: PublicPlayer }) {
  const r = state.round!;
  const h = me.hand!;
  const toCall = r.currentBet - h.roundBet;
  const maxRaise = r.maxRoundBet - r.currentBet;
  const canRaise = maxRaise > 0;
  const [open, setOpen] = useState(false);
  const [raiseBy, setRaiseBy] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRaiseBy(Math.max(1, Math.min(maxRaise, Math.round(r.pot / 3) || 1)));
    setOpen(false);
  }, [r.currentBet, r.toAct, maxRaise, r.pot]);

  const send = async (payload: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    await act('game:action', payload);
    setBusy(false);
  };

  const presets = useMemo(() => {
    const list: [string, number][] = [
      ['+1', 1],
      ['+2', 2],
      ['+5', 5],
      ['½ pot', Math.max(1, Math.round(r.pot / 2))],
      ['Max', maxRaise],
    ];
    return list.filter(([, v], i, arr) => v <= maxRaise && v > 0 && arr.findIndex(([, w]) => w === v) === i);
  }, [r.pot, maxRaise]);

  return (
    <div className="bet-controls">
      <p className="bet-info">
        {toCall > 0 ? (
          <>
            <b>{toCall}</b> pour suivre
          </>
        ) : (
          'Personne n’a encore misé'
        )}{' '}
        · mise max ce tour : <b>{r.maxRoundBet}</b>
      </p>
      <div className="bet-row">
        {toCall > 0 && (
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => send({ type: 'fold' })}>
            Se coucher
          </button>
        )}
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => send({ type: toCall > 0 ? 'call' : 'check' })}>
          {toCall > 0 ? `Suivre · ${toCall}` : 'Parole'}
        </button>
        {canRaise && (
          <button type="button" className={cx('btn btn-primary', open && 'active')} disabled={busy} onClick={() => setOpen((o) => !o)}>
            {r.currentBet > 0 ? 'Relancer' : 'Miser'} {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        )}
      </div>
      {open && canRaise && (
          <motion.div className="raise-panel" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
            <div className="raise-top">
              <button type="button" className="icon-btn" onClick={() => setRaiseBy((v) => Math.max(1, v - 1))} aria-label="Moins">
                <Minus size={18} />
              </button>
              <div className="raise-amount">
                <span className="raise-n">+{raiseBy}</span>
                <span className="raise-sub">{toCall > 0 ? `${toCall} pour suivre + ${raiseBy} de relance` : `Ta mise : ${raiseBy}`}</span>
              </div>
              <button type="button" className="icon-btn" onClick={() => setRaiseBy((v) => Math.min(maxRaise, v + 1))} aria-label="Plus">
                <Plus size={18} />
              </button>
            </div>
            <input
              type="range"
              min={1}
              max={maxRaise}
              value={raiseBy}
              onChange={(e) => setRaiseBy(Number(e.target.value))}
              className="raise-range"
              aria-label="Montant de la relance"
            />
            <div className="raise-presets">
              {presets.map(([label, v]) => (
                <button key={label} type="button" className={cx('chip-btn', raiseBy === v && 'on')} onClick={() => setRaiseBy(v)}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-primary full" disabled={busy} onClick={() => send({ type: 'raise', amount: r.currentBet + raiseBy })}>
              Je mets {plural(toCall + raiseBy, 'jeton')}
            </button>
          </motion.div>
        )}
    </div>
  );
}

// ---------- Défausse après un × ----------

export function DiscardChoice({ me }: { me: PublicPlayer }) {
  const h = me.hand!;
  const options = [...new Set(h.ops.filter((o) => o !== '/'))] as Op[];
  const help: Record<string, string> = {
    '+': 'garde − et × : bien pour viser 1 ou 20',
    '-': 'garde + et × : idéal pour viser 20',
    '*': 'renonce au × : garde + et −',
  };
  return (
    <div className="discard-choice">
      <p className="dock-title">
        Tu as reçu un <b>×</b> ! Choisis l’opérateur à défausser{h.pendingDiscard > 1 ? ` (encore ${h.pendingDiscard})` : ''} :
      </p>
      <div className="discard-options">
        {options.map((op) => (
          <button key={op} type="button" className="discard-btn" onClick={() => act('game:discard', { op })}>
            <OpTile op={op} size="md" />
            <span>
              Défausser <b>{OP_SYMBOL[op]}</b>
              <em>{help[op]}</em>
            </span>
          </button>
        ))}
      </div>
      <p className="hint">Le ÷ ne peut jamais être défaussé.</p>
    </div>
  );
}

// ---------- Construction de l'équation ----------

export function BuildPanel({ state, me }: { state: RoomState; me: PublicPlayer }) {
  const h = me.hand!;
  const r = state.round!;
  const nums = useMemo(() => handNums(h), [h]);
  const hand = useMemo(() => ({ nums, ops: h.ops, roots: h.roots }), [nums, h.ops, h.roots]);
  const [value, setValue] = useState<BuilderValue | null>(null);
  const initRound = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (h.arrangements && initRound.current !== r.number) {
      initRound.current = r.number;
      setValue(builderFrom(h.arrangements));
    }
  }, [h.arrangements, r.number]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const push = (v: BuilderValue) => call('game:arrange', { high: rowToArrangement(v.high), low: rowToArrangement(v.low) });

  const onChange = (v: BuilderValue) => {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void push(v), 250);
  };

  const toggleReady = async () => {
    if (!value) return;
    if (!h.ready) {
      if (timer.current) clearTimeout(timer.current);
      await push(value);
      await act('game:ready', { ready: true });
    } else {
      await act('game:ready', { ready: false });
    }
  };

  const inHand = state.players.filter((p) => p.hand && !p.hand.folded);
  const readyCount = inHand.filter((p) => p.hand!.ready).length;
  const invalid = value ? (['high', 'low'] as Side[]).filter((s) => evaluateArrangement(rowToArrangement(value[s]), nums) === null) : [];

  return (
    <section className="build-panel">
      <header className="build-head">
        <div>
          <p className="eyebrow">Ton équation</p>
          <h2>Prépare ton 20 et ton 1</h2>
        </div>
        <TimerRing deadline={r.deadline} total={state.settings.buildSeconds} size={54} warnAt={10} />
      </header>
      {value && <EquationBuilder hand={hand} value={value} onChange={onChange} locked={h.ready} />}
      <div className="dock build-dock">
        {invalid.length > 0 && !h.ready && <p className="hint warn">Division par zéro : cette équation ne pourra pas gagner.</p>}
        <button type="button" className={cx('btn btn-xl', h.ready ? 'btn-ghost' : 'btn-primary')} onClick={toggleReady}>
          {h.ready ? (
            <>
              <Pencil size={18} /> Modifier mes équations
            </>
          ) : (
            <>
              <Check size={20} /> Je suis prêt
            </>
          )}
        </button>
        <p className="hint center">
          {readyCount}/{inHand.length} prêts · tu choisiras High, Low ou Swing après les enchères
        </p>
      </div>
    </section>
  );
}

// ---------- Déclaration ----------

export function DeclarePanel({ state, me }: { state: RoomState; me: PublicPlayer }) {
  const h = me.hand!;
  const [confirmSwing, setConfirmSwing] = useState(false);
  const nums = handNums(h);
  const val = (side: Side) => (h.arrangements ? evaluateArrangement(h.arrangements[side], nums) : null);
  const dist = (side: Side) => {
    const v = val(side);
    return v === null ? null : Math.abs(v - TARGET[side]);
  };
  const declared = state.players.filter((p) => p.hand && !p.hand.folded);
  const done = declared.filter((p) => p.hand!.hasDeclared).length;

  if (h.declaration) {
    return (
      <div className="declared">
        <p className="dock-title">
          Ton choix : <DeclBadge decl={h.declaration} />
        </p>
        <p className="hint center">
          En attente des autres ({done}/{declared.length})… Révélation dès que tout le monde a choisi.
        </p>
      </div>
    );
  }

  const choose = (decl: Decl) => act('game:declare', { decl });
  const line = (side: Side) => {
    const v = val(side);
    const d = dist(side);
    if (v === null) return 'équation invalide';
    return `${formatNumber(v)} · ${d !== null && d < EPS ? 'parfait !' : `écart ${formatNumber(d ?? 0)}`}`;
  };

  return (
    <div className="declare-panel">
      <p className="dock-title">Choisis ton camp, en secret :</p>
      <div className="declare-options">
        <button type="button" className="decl-btn decl-high" onClick={() => choose('high')}>
          <span className="decl-name">High</span>
          <span className="decl-target">vise 20</span>
          <span className="decl-val">{line('high')}</span>
        </button>
        <button type="button" className="decl-btn decl-low" onClick={() => choose('low')}>
          <span className="decl-name">Low</span>
          <span className="decl-target">vise 1</span>
          <span className="decl-val">{line('low')}</span>
        </button>
        <button
          type="button"
          className={cx('decl-btn decl-swing', confirmSwing && 'confirm')}
          onClick={() => (confirmSwing ? choose('swing') : setConfirmSwing(true))}
        >
          <span className="decl-name">Swing</span>
          <span className="decl-target">{confirmSwing ? 'Sûr ? Touche encore' : 'les deux'}</span>
          <span className="decl-val">tout ou rien !</span>
        </button>
      </div>
      <p className="hint center">
        {done}/{declared.length} ont choisi · <TimerRing deadline={state.round?.deadline} total={30} size={26} warnAt={8} />
      </p>
    </div>
  );
}

// ---------- Réactions ----------

export function EmoteButton() {
  const [open, setOpen] = useState(false);
  return (
    <div className="emote-picker">
      <button type="button" className={cx('icon-btn', open && 'active')} onClick={() => setOpen((o) => !o)} aria-label="Envoyer une réaction">
        <Smile size={20} />
      </button>
      {open && (
        <motion.div className="emote-menu" initial={{ opacity: 0, y: 8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
          {EMOTES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                sendEmote(e);
                setOpen(false);
              }}
            >
              {e}
            </button>
          ))}
        </motion.div>
      )}
    </div>
  );
}

// ---------- Barre du bas ----------

export function Dock({ state, me }: { state: RoomState; me: PublicPlayer | undefined }) {
  const r = state.round;
  const h = me?.hand;
  let content: ReactNode = null;

  if (!me || !h) {
    content = <p className="waiting">{me?.out ? 'Éliminé : profite du spectacle !' : 'Tu regardes la partie.'}</p>;
  } else if (h.folded && state.phase !== 'showdown') {
    content = <p className="waiting">Tu es couché pour cette manche. Prochaine manche bientôt !</p>;
  } else {
    switch (state.phase) {
      case 'deal':
        content = (
          <p className="waiting">
            <span className="pulse-dot" /> Distribution des cartes…
          </p>
        );
        break;
      case 'discard':
        content =
          h.pendingDiscard > 0 ? (
            <DiscardChoice me={me} />
          ) : (
            <p className="waiting">
              <span className="pulse-dot" /> Un joueur choisit l’opérateur à défausser…
            </p>
          );
        break;
      case 'bet1':
      case 'bet2':
        content =
          r?.toAct === me.id ? (
            <BetControls state={state} me={me} />
          ) : (
            <p className="waiting">
              <span className="pulse-dot" /> Au tour de <b>{playerName(state, r?.toAct)}</b>
              {r?.deadline && <TimerRing deadline={r.deadline} total={state.settings.turnSeconds} size={26} warnAt={8} />}
            </p>
          );
        break;
      case 'declare':
        content = <DeclarePanel state={state} me={me} />;
        break;
      default:
        content = null;
    }
  }

  if (!content) return null;
  return (
    <div className="dock table-dock">
      <div className="dock-inner">
        <EmoteButton />
        <div className="dock-content">{content}</div>
      </div>
    </div>
  );
}
