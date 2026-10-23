import { motion } from 'framer-motion';
import type { KeyboardEvent, ReactNode } from 'react';
import { Card, NumberCard, Op, OP_SYMBOL, SUIT_LABEL, SUIT_SHORT } from '../../../shared/cards';
import type { Decl } from '../../../shared/protocol';
import { cx } from '../lib/util';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

const OP_CLASS: Record<Op, string> = { '+': 'plus', '-': 'minus', '*': 'mul', '/': 'div' };

function pressable(onClick?: () => void) {
  if (!onClick) return {};
  return {
    role: 'button',
    tabIndex: 0,
    onClick,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    },
  };
}

interface NumCardProps {
  card: NumberCard;
  size?: CardSize;
  rooted?: boolean;
  hidden?: boolean;
  selected?: boolean;
  dim?: boolean;
  deal?: number | false;
  onClick?: () => void;
}

export function NumCard({ card, size = 'md', rooted, hidden, selected, dim, deal = false, onClick }: NumCardProps) {
  const label = `${rooted ? 'racine de ' : ''}${card.value} ${SUIT_LABEL[card.suit].toLowerCase()}${hidden ? ', carte cachée' : ''}`;
  return (
    <motion.div
      className={cx('card', 'num', `suit-${card.suit}`, `size-${size}`, selected && 'selected', dim && 'dim', onClick && 'tappable', rooted && 'rooted')}
      initial={deal === false ? false : { y: -26, opacity: 0, rotate: -7, scale: 0.9 }}
      animate={{ y: 0, opacity: 1, rotate: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 360, damping: 24, delay: deal === false ? 0 : deal }}
      title={label}
      aria-label={label}
      {...pressable(onClick)}
    >
      <span className="card-frame" aria-hidden />
      <span className="card-value">
        {rooted ? (
          <span className="radical">
            <span className="radical-sign">√</span>
            <span className="radicand">{card.value}</span>
          </span>
        ) : (
          card.value
        )}
      </span>
      <span className="card-suit">{SUIT_SHORT[card.suit]}</span>
      {hidden && <span className="card-hidden-tag" title="Carte cachée : toi seul la vois" />}
    </motion.div>
  );
}

export function CardBack({ size = 'md', deal = false }: { size?: CardSize; deal?: number | false }) {
  return (
    <motion.div
      className={cx('card', 'back', `size-${size}`)}
      initial={deal === false ? false : { y: -26, opacity: 0, rotate: 7 }}
      animate={{ y: 0, opacity: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 360, damping: 24, delay: deal === false ? 0 : deal }}
      title="Carte cachée"
      aria-label="Carte cachée"
    >
      <span className="back-emblem">?</span>
    </motion.div>
  );
}

export function SymbolCard({ kind, size = 'md', deal = false }: { kind: 'root' | 'mul'; size?: CardSize; deal?: number | false }) {
  return (
    <motion.div
      className={cx('card', 'sym', `sym-${kind}`, `size-${size}`)}
      initial={deal === false ? false : { y: -26, opacity: 0, rotate: -7 }}
      animate={{ y: 0, opacity: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 360, damping: 24, delay: deal === false ? 0 : deal }}
      title={kind === 'root' ? 'Racine carrée : s’applique à un chiffre' : 'Multiplication : remplace + ou −'}
    >
      <span className="sym-glyph">{kind === 'root' ? '√' : '×'}</span>
    </motion.div>
  );
}

export function AnyCard({ card, size, deal }: { card: Card; size?: CardSize; deal?: number | false }) {
  if (card.kind === 'num') return <NumCard card={card} size={size} deal={deal} />;
  return <SymbolCard kind={card.kind} size={size} deal={deal} />;
}

/** Opérateurs dessinés en vectoriel : un ÷ qui ne ressemble jamais à un +, même tout petit. */
export function OpGlyph({ op }: { op: Op }) {
  return (
    <svg className="op-glyph" viewBox="0 0 24 24" aria-hidden focusable="false">
      {op === '+' && <path d="M12 5v14M5 12h14" />}
      {op === '-' && <path d="M5 12h14" />}
      {op === '*' && <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />}
      {op === '/' && (
        <>
          <path d="M5 12h14" />
          <circle cx="12" cy="6" r="1.9" className="dot" />
          <circle cx="12" cy="18" r="1.9" className="dot" />
        </>
      )}
    </svg>
  );
}

interface OpTileProps {
  op: Op;
  size?: CardSize;
  discarded?: boolean;
  selected?: boolean;
  onClick?: () => void;
}

export function OpTile({ op, size = 'md', discarded, selected, onClick }: OpTileProps) {
  return (
    <div
      className={cx('op', `op-${OP_CLASS[op]}`, `size-${size}`, discarded && 'discarded', selected && 'selected', onClick && 'tappable')}
      title={discarded ? `${OP_SYMBOL[op]} défaussé` : OP_SYMBOL[op]}
      aria-label={OP_SYMBOL[op]}
      {...pressable(onClick)}
    >
      <OpGlyph op={op} />
    </div>
  );
}

export function Avatar({ emoji, size = 'md', ring }: { emoji: string; size?: 'sm' | 'md' | 'lg' | 'xl'; ring?: 'turn' | 'win' | null }) {
  return <span className={cx('avatar', `avatar-${size}`, ring && `ring-${ring}`)}>{emoji}</span>;
}

export function Chips({ n, size = 'md', delta }: { n: number; size?: 'sm' | 'md' | 'lg'; delta?: number }) {
  return (
    <span className={cx('chips', `chips-${size}`)} title={`${n} jeton${n > 1 ? 's' : ''}`}>
      <span className="chip-icon" aria-hidden />
      <span className="chips-n">{n}</span>
      {delta ? <span className={cx('chips-delta', delta > 0 ? 'up' : 'down')}>{delta > 0 ? `+${delta}` : delta}</span> : null}
    </span>
  );
}

const SYMBOL_OP: Record<string, Op> = { '+': '+', '−': '-', '×': '*', '÷': '/' };

/** Équation en texte (« 7 − 3 + √5 ÷ 1 ») avec des opérateurs colorés et bien lisibles. */
export function EqText({ text }: { text: string }) {
  return (
    <span className="eq-text" aria-label={text}>
      {text.split(' ').map((tok, i) =>
        SYMBOL_OP[tok] ? (
          <span key={i} className={cx('eq-sym', `op-${OP_CLASS[SYMBOL_OP[tok]]}`)}>
            <OpGlyph op={SYMBOL_OP[tok]} />
          </span>
        ) : (
          <span key={i} className="eq-num">
            {tok}
          </span>
        ),
      )}
    </span>
  );
}

const DECL_LABEL: Record<Decl, string> = { high: 'High · 20', low: 'Low · 1', swing: 'Swing' };

export function DeclBadge({ decl, children }: { decl: Decl; children?: ReactNode }) {
  return (
    <span className={cx('decl-badge', `decl-${decl}`)}>
      {DECL_LABEL[decl]}
      {children}
    </span>
  );
}
