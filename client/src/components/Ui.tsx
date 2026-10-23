// Petits éléments d'interface partagés : logo, notifications, compte à rebours, feuilles et menus.
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { ReactNode, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { cx, secondsLeft, useNow } from '../lib/util';

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={cx('logo', `logo-${size}`)} aria-label="Équation Hi-Lo">
      <span className="logo-mark" aria-hidden>
        <span className="logo-20">20</span>
        <span className="logo-slash" />
        <span className="logo-1">1</span>
      </span>
      {size !== 'sm' && (
        <span className="logo-word">
          Équation <em>Hi·Lo</em>
        </span>
      )}
    </span>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            type="button"
            className={cx('toast', `toast-${t.kind}`)}
            onClick={() => dismiss(t.id)}
            initial={{ opacity: 0, y: -14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.96 }}
          >
            {t.text}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Anneau de compte à rebours. */
export function TimerRing({ deadline, total, size = 44, warnAt = 10 }: { deadline: number | null | undefined; total: number; size?: number; warnAt?: number }) {
  const now = useNow(200);
  const left = secondsLeft(deadline, now);
  if (left === null || !deadline) return null;
  const ratio = Math.max(0, Math.min(1, (deadline - now) / (total * 1000)));
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  return (
    <span className={cx('timer-ring', left <= warnAt && 'warn')} style={{ width: size, height: size }} title={`${left} s restantes`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="timer-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="timer-bar"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="timer-text">{left}</span>
    </span>
  );
}

export function Sheet({
  open,
  onClose,
  children,
  className,
  label,
}: {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            ref={ref}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className={cx('sheet', className)}
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            {onClose && (
              <button type="button" className="sheet-close icon-btn" onClick={onClose} aria-label="Fermer">
                <X size={18} />
              </button>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  format,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  disabled?: boolean;
  format?: (v: T) => ReactNode;
}) {
  return (
    <div className={cx('segmented', disabled && 'disabled')} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          role="radio"
          aria-checked={o === value}
          className={cx('seg', o === value && 'on')}
          onClick={() => !disabled && onChange(o)}
          disabled={disabled && o !== value}
        >
          {format ? format(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

export function ServerPill() {
  const status = useStore((s) => s.serverStatus);
  const connected = useStore((s) => s.connected);
  const label = connected ? 'Serveur en ligne' : status === 'offline' ? 'Serveur injoignable' : 'Réveil du serveur…';
  return (
    <span className={cx('server-pill', connected ? 'online' : status)} title={connected ? 'Connecté' : 'Le serveur gratuit se réveille en 30 à 60 secondes la première fois.'}>
      <span className="dot" />
      {label}
    </span>
  );
}
