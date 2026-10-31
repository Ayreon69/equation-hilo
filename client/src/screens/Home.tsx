// Accueil : pseudo + avatar, créer une table, rejoindre avec un code, s'entraîner contre des bots.
import { motion } from 'framer-motion';
import { BookOpen, Bot, House, LogIn, Plus } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { NumberCard, Op } from '../../../shared/cards';
import { AVATARS } from '../../../shared/protocol';
import { NumCard, OpTile } from '../components/Cards';
import { Logo, ServerPill } from '../components/Ui';
import { act, call, createRoom, joinRoom } from '../net';
import { useStore } from '../store';
import { cx } from '../lib/util';

const heroCard = (value: number, suit: NumberCard['suit'], id: string): NumberCard => ({ id, kind: 'num', value, suit });

const HERO_ROWS: { side: 'high' | 'low'; items: (NumberCard | Op)[]; result: string; note: string }[] = [
  {
    side: 'high',
    items: [heroCard(10, 'gold', 'h1'), '*', heroCard(2, 'silver', 'h2'), '-', heroCard(8, 'bronze', 'h3'), '/', heroCard(10, 'black', 'h4')],
    result: '19,2',
    note: 'écart 0,8 de 20',
  },
  {
    side: 'low',
    items: [heroCard(8, 'silver', 'l1'), '/', heroCard(4, 'gold', 'l2'), '-', heroCard(1, 'black', 'l3'), '+', heroCard(0, 'bronze', 'l4')],
    result: '1',
    note: 'pile sur 1 !',
  },
];

function HeroArt() {
  return (
    <div className="hero-art" aria-hidden>
      {HERO_ROWS.map((row, r) => (
        <motion.div
          key={row.side}
          className={cx('hero-row', `hero-${row.side}`)}
          initial={{ opacity: 0, x: r ? 30 : -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.25 + r * 0.25, duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <div className="hero-cards">
            {row.items.map((it, i) =>
              typeof it === 'string' ? (
                <OpTile key={i} op={it} size="sm" />
              ) : (
                <NumCard key={it.id} card={it} size="md" deal={0.35 + r * 0.25 + i * 0.06} />
              ),
            )}
          </div>
          <div className="hero-result">
            <span className="hero-eq">= {row.result}</span>
            <span className="hero-note">{row.note}</span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

export function Home() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const invite = useStore((s) => s.inviteCode);
  const connected = useStore((s) => s.connected);
  const toast = useStore((s) => s.toast);
  const openRules = () => useStore.getState().setRulesOpen(true);
  const [code, setCode] = useState(invite ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (invite) setCode(invite);
  }, [invite]);

  const ensureName = () => {
    if (profile.name.trim().length > 0) return true;
    nameRef.current?.focus();
    setShake(true);
    setTimeout(() => setShake(false), 500);
    toast('Choisis d’abord un pseudo 🙂');
    return false;
  };

  const run = async (key: string, fn: () => Promise<unknown>) => {
    if (busy || !ensureName()) return;
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const onJoin = (e?: FormEvent) => {
    e?.preventDefault();
    const c = code.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(c)) {
      toast('Le code d’une table fait 4 lettres.', 'error');
      return;
    }
    void run('join', () => joinRoom(c));
  };

  const onPractice = () =>
    run('practice', async () => {
      if (!(await createRoom())) return;
      for (let i = 0; i < 3; i++) await call('room:addBot');
      await act('game:start');
    });

  return (
    <div className="home">
      <header className="topbar">
        <Logo size="sm" />
        <div className="topbar-right">
          <ServerPill />
          <a className="btn btn-ghost btn-sm all-games" href="https://akhis-games.onrender.com">
            <House size={16} aria-hidden /> Tous les jeux
          </a>
          <button type="button" className="btn btn-ghost btn-sm" onClick={openRules}>
            <BookOpen size={16} /> Règles
          </button>
        </div>
      </header>

      <main className="home-main">
        <section className="hero-copy">
          <motion.p className="eyebrow" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            Jeu de calcul & de bluff · 2 à 8 joueurs
          </motion.p>
          <motion.h1 className="hero-title" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.6 }}>
            <span className="t-high">20</span>
            <span className="hero-ou">ou</span>
            <span className="t-low">1</span>
            <span className="hero-q">?</span>
          </motion.h1>
          <motion.p className="hero-sub" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}>
            Range tes cartes en équation, vise <b className="t-high">20</b> ou <b className="t-low">1</b>, mise et bluffe. Le plus proche
            rafle le pot.
          </motion.p>
          <HeroArt />
        </section>

        <motion.section
          className="panel start-panel"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          {invite && (
            <div className="invite-banner">
              <span className="eyebrow">Invitation</span>
              <p>
                On t’attend à la table <b className="code-inline">{invite}</b> !
              </p>
            </div>
          )}

          <label className="field">
            <span className="field-label">Ton pseudo</span>
            <input
              ref={nameRef}
              className={cx('input', shake && 'shake')}
              value={profile.name}
              maxLength={16}
              placeholder="Ex. : Léa"
              autoComplete="nickname"
              onChange={(e) => setProfile({ name: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && (invite ? onJoin() : undefined)}
            />
          </label>

          <div className="field">
            <span className="field-label">Ton avatar</span>
            <div className="avatar-picker" role="radiogroup" aria-label="Avatar">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={profile.avatar === a}
                  className={cx('avatar-choice', profile.avatar === a && 'on')}
                  onClick={() => setProfile({ avatar: a })}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {invite ? (
            <button type="button" className="btn btn-primary btn-xl" onClick={() => onJoin()} disabled={!connected || !!busy}>
              <LogIn size={20} /> {busy === 'join' ? 'Connexion…' : `Rejoindre la table ${invite}`}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-primary btn-xl" onClick={() => run('create', createRoom)} disabled={!connected || !!busy}>
                <Plus size={20} /> {busy === 'create' ? 'Création…' : 'Créer une table'}
              </button>
              <form className="join-row" onSubmit={onJoin}>
                <input
                  className="input code-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4))}
                  placeholder="CODE"
                  aria-label="Code de la table"
                  inputMode="text"
                  autoCapitalize="characters"
                />
                <button type="submit" className="btn btn-secondary" disabled={!connected || !!busy || code.length !== 4}>
                  <LogIn size={18} /> Rejoindre
                </button>
              </form>
              <button type="button" className="btn btn-ghost" onClick={onPractice} disabled={!connected || !!busy}>
                <Bot size={18} /> {busy === 'practice' ? 'Préparation…' : 'S’entraîner contre 3 bots'}
              </button>
            </>
          )}

          {!connected && <p className="hint center">Le serveur se réveille (jusqu’à une minute la première fois)… Lis les règles en attendant !</p>}
          <button type="button" className="link-btn" onClick={openRules}>
            Première fois ? Les règles en 2 minutes →
          </button>
        </motion.section>
      </main>

      <section className="how">
        {[
          ['Reçois tes cartes', '4 chiffres dont un caché, et tes opérateurs + − ÷. Parfois un × ou une √ en bonus.'],
          ['Construis ton équation', '90 secondes pour approcher 20 (High) ou 1 (Low) en utilisant toutes tes cartes.'],
          ['Mise, bluffe, déclare', 'Enchères à la poker, puis High, Low ou Swing en secret. Le pot se partage.'],
        ].map(([title, text], i) => (
          <motion.article
            key={title}
            className="how-card"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
          >
            <span className="how-n">{i + 1}</span>
            <h3>{title}</h3>
            <p>{text}</p>
          </motion.article>
        ))}
      </section>

      <footer className="home-foot">
        <p>
          Projet fan non officiel, inspiré de l’épreuve <em>Equation High-Low</em> de l’émission <em>The Devil’s Plan</em>.
        </p>
      </footer>
    </div>
  );
}
