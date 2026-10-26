// Construction des deux équations (viser 20 et viser 1) : toucher deux cartes pour les échanger.
import { LayoutGroup, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { NumberCard, Op } from '../../../shared/cards';
import { Arrangement, EPS, Side, TARGET, evaluateArrangement, formatNumber, isRounded } from '../../../shared/equation';
import { play } from '../lib/sound';
import { cx } from '../lib/util';
import { NumCard, OpTile } from './Cards';

export interface BuilderHand {
  nums: NumberCard[];
  ops: Op[];
  roots: number;
}

interface OpToken {
  key: string;
  op: Op;
}

export interface BuilderRow {
  nums: string[];
  ops: OpToken[];
  roots: string[];
}

export type BuilderValue = Record<Side, BuilderRow>;

export function toTokens(ops: Op[]): OpToken[] {
  const count: Record<string, number> = {};
  return ops.map((op) => {
    count[op] = (count[op] ?? 0) + 1;
    return { key: `${op}${count[op]}`, op };
  });
}

export function rowFromArrangement(arr: Arrangement): BuilderRow {
  return { nums: [...arr.nums], ops: toTokens(arr.ops), roots: [...arr.roots] };
}

export function rowToArrangement(row: BuilderRow): Arrangement {
  return { nums: row.nums, ops: row.ops.map((t) => t.op), roots: row.roots };
}

export function builderFrom(arrs: { high: Arrangement; low: Arrangement }): BuilderValue {
  return { high: rowFromArrangement(arrs.high), low: rowFromArrangement(arrs.low) };
}

type Selection = { side: Side; kind: 'num' | 'op'; index: number } | null;

const SPRING = { type: 'spring', stiffness: 500, damping: 34 } as const;

interface Props {
  hand: BuilderHand;
  value: BuilderValue;
  onChange: (v: BuilderValue) => void;
  locked?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Affiche la valeur et l'écart en direct (entraînement uniquement : en partie, on calcule soi-même). */
  showResult?: boolean;
}

export function EquationBuilder({ hand, value, onChange, locked, size = 'lg', showResult = false }: Props) {
  const [sel, setSel] = useState<Selection>(null);
  const byId = useMemo(() => new Map(hand.nums.map((c) => [c.id, c])), [hand.nums]);

  const update = (side: Side, row: BuilderRow) => onChange({ ...value, [side]: row });

  const tap = (side: Side, kind: 'num' | 'op', index: number) => {
    if (locked) return;
    if (sel && sel.side === side && sel.kind === kind) {
      if (sel.index !== index) {
        const row = value[side];
        if (kind === 'num') {
          const nums = [...row.nums];
          [nums[sel.index], nums[index]] = [nums[index], nums[sel.index]];
          update(side, { ...row, nums });
        } else {
          const ops = [...row.ops];
          [ops[sel.index], ops[index]] = [ops[index], ops[sel.index]];
          update(side, { ...row, ops });
        }
        play('click');
      }
      setSel(null);
      return;
    }
    setSel({ side, kind, index });
  };

  const moveRoot = (side: Side, id: string) => {
    if (locked || hand.roots === 0) return;
    const row = value[side];
    if (row.roots.includes(id)) return;
    const roots = row.roots.length >= hand.roots ? [...row.roots.slice(1), id] : [...row.roots, id];
    update(side, { ...row, roots });
    play('click');
  };

  return (
    <div className={cx('builder', locked && 'locked', `builder-${size}`)}>
      {(['high', 'low'] as Side[]).map((side) => {
        const row = value[side];
        const arr = rowToArrangement(row);
        const v = evaluateArrangement(arr, hand.nums);
        const dist = v === null ? null : Math.abs(v - TARGET[side]);
        return (
          <section key={side} className={cx('eq-row', `eq-${side}`)}>
            <header className="eq-head">
              <span className="eq-target">
                Viser <b>{TARGET[side]}</b>
              </span>
              <span className="eq-kind">{side === 'high' ? 'High' : 'Low'}</span>
              {showResult && (
              <span className="eq-result" aria-live="polite">
                {v === null ? (
                  <span className="eq-error">Division par zéro !</span>
                ) : (
                  <>
                    <span className="eq-value">
                      {isRounded(v) ? '≈' : '='} {formatNumber(v)}
                    </span>
                    <span className={cx('eq-dist', dist !== null && dist < EPS && 'perfect')}>
                      {dist !== null && dist < EPS ? 'Parfait !' : `écart ${formatNumber(dist ?? 0)}`}
                    </span>
                  </>
                )}
              </span>
              )}
            </header>
            <LayoutGroup id={`row-${side}`}>
              <div className="eq-cards">
                {row.nums.flatMap((id, i) => {
                  const card = byId.get(id);
                  if (!card) return [];
                  const rooted = row.roots.includes(id);
                  const items = [
                    <motion.div key={`n-${id}`} layout transition={SPRING} className="eq-slot">
                      <NumCard
                        card={card}
                        size={size}
                        rooted={rooted}
                        selected={sel?.side === side && sel.kind === 'num' && sel.index === i}
                        onClick={locked ? undefined : () => tap(side, 'num', i)}
                      />
                      {hand.roots > 0 && (
                        <button
                          type="button"
                          className={cx('root-toggle', rooted && 'on')}
                          onClick={() => moveRoot(side, id)}
                          disabled={locked}
                          aria-label={rooted ? 'Racine placée ici' : 'Placer la racine sur ce chiffre'}
                        >
                          √
                        </button>
                      )}
                    </motion.div>,
                  ];
                  if (i < row.ops.length) {
                    const token = row.ops[i];
                    items.push(
                      <motion.div key={`o-${token.key}`} layout transition={SPRING} className="eq-op">
                        <OpTile
                          op={token.op}
                          size={size}
                          selected={sel?.side === side && sel.kind === 'op' && sel.index === i}
                          onClick={locked ? undefined : () => tap(side, 'op', i)}
                        />
                      </motion.div>,
                    );
                  }
                  return items;
                })}
              </div>
            </LayoutGroup>
          </section>
        );
      })}
      {!locked && (
        <p className="builder-hint">
          Touche deux chiffres (ou deux opérateurs) pour les échanger.
          {hand.roots > 0 && ' Touche √ sous un chiffre pour y déplacer ta racine.'} × et ÷ se calculent avant + et −.
        </p>
      )}
    </div>
  );
}
