// Salon : inviter ses amis (lien, partage, QR code), ajouter des bots, régler et lancer la partie.
import { motion } from 'framer-motion';
import { BookOpen, Bot, Check, Copy, Crown, LogOut, Play, QrCode, Share2, Wifi, WifiOff, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS, RoomState, SETTING_OPTIONS, Settings } from '../../../shared/protocol';
import { Avatar } from '../components/Cards';
import { Logo, Segmented } from '../components/Ui';
import { act, inviteLink, leaveRoom } from '../net';
import { useStore } from '../store';
import { cx } from '../lib/util';

export function Lobby({ state }: { state: RoomState }) {
  const toast = useStore((s) => s.toast);
  const isHost = state.hostId === state.youId;
  const host = state.players.find((p) => p.id === state.hostId);
  const link = inviteLink(state.code);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  const full = state.players.length >= MAX_PLAYERS;
  const enough = state.players.length >= MIN_PLAYERS;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast(`Lien : ${link}`);
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: 'Équation Hi-Lo', text: `Rejoins ma table d’Équation Hi-Lo (code ${state.code}) !`, url: link });
    } catch {
      /* partage annulé */
    }
  };

  const setSetting = (patch: Partial<Settings>) => act('room:settings', patch);

  return (
    <div className="lobby">
      <header className="topbar">
        <Logo size="sm" />
        <div className="topbar-right">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => useStore.getState().setRulesOpen(true)}>
            <BookOpen size={16} /> Règles
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => leaveRoom()}>
            <LogOut size={16} /> Quitter
          </button>
        </div>
      </header>

      <main className="lobby-grid">
        <motion.section className="panel invite-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <p className="eyebrow">Code de la table</p>
          <div className="room-code" aria-label={`Code ${state.code.split('').join(' ')}`}>
            {state.code.split('').map((l, i) => (
              <motion.span key={i} initial={{ rotateX: 90, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} transition={{ delay: 0.1 + i * 0.08 }}>
                {l}
              </motion.span>
            ))}
          </div>
          <p className="hint">Envoie le lien à tes amis : ils arrivent directement à cette table.</p>
          <div className="invite-actions">
            <button type="button" className="btn btn-primary" onClick={copy}>
              {copied ? <Check size={18} /> : <Copy size={18} />} {copied ? 'Lien copié !' : 'Copier le lien'}
            </button>
            {canShare && (
              <button type="button" className="btn btn-secondary" onClick={share}>
                <Share2 size={18} /> Partager
              </button>
            )}
            <button type="button" className={cx('btn btn-ghost', showQr && 'active')} onClick={() => setShowQr((v) => !v)}>
              <QrCode size={18} /> QR code
            </button>
          </div>
          {showQr && (
            <motion.div className="qr" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
              <QRCodeSVG value={link} size={176} bgColor="#f6eedc" fgColor="#0c0a12" level="M" marginSize={2} />
              <span>Scanne pour rejoindre</span>
            </motion.div>
          )}
        </motion.section>

        <motion.section className="panel players-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <header className="panel-head">
            <h2>Joueurs</h2>
            <span className="count">
              {state.players.length}/{MAX_PLAYERS}
            </span>
          </header>
          <ul className="player-list">
            {state.players.map((p, i) => (
              <motion.li
                key={p.id}
                className={cx('player-item', p.id === state.youId && 'me')}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <Avatar emoji={p.avatar} />
                <span className="player-name">
                  {p.name}
                  {p.id === state.youId && <span className="you">toi</span>}
                </span>
                {p.id === state.hostId && (
                  <span className="tag tag-host" title="Hôte de la table">
                    <Crown size={13} /> hôte
                  </span>
                )}
                {p.isBot && <span className="tag tag-bot">bot</span>}
                {!p.isBot && (p.connected ? <Wifi size={15} className="conn on" aria-label="connecté" /> : <WifiOff size={15} className="conn off" aria-label="déconnecté" />)}
                {isHost && p.id !== state.youId && (
                  <button type="button" className="icon-btn danger" onClick={() => act('room:kick', { playerId: p.id })} aria-label={`Retirer ${p.name}`}>
                    <X size={16} />
                  </button>
                )}
              </motion.li>
            ))}
            {Array.from({ length: Math.max(0, MIN_PLAYERS - state.players.length) }).map((_, i) => (
              <li key={`empty-${i}`} className="player-item empty">
                <span className="avatar avatar-md">·</span>
                <span className="player-name">En attente d’un joueur…</span>
              </li>
            ))}
          </ul>
          {isHost && (
            <button type="button" className="btn btn-ghost full" onClick={() => act('room:addBot')} disabled={full}>
              <Bot size={18} /> Ajouter un bot
            </button>
          )}
        </motion.section>

        <motion.section className="panel settings-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
          <header className="panel-head">
            <h2>Réglages</h2>
            {!isHost && <span className="muted small">choisis par {host?.name ?? 'l’hôte'}</span>}
          </header>
          <div className="setting">
            <span className="setting-label">Jetons de départ</span>
            <Segmented value={state.settings.startChips} options={SETTING_OPTIONS.startChips} onChange={(v) => setSetting({ startChips: v })} disabled={!isHost} />
          </div>
          <div className="setting">
            <span className="setting-label">Temps pour l’équation</span>
            <Segmented
              value={state.settings.buildSeconds}
              options={SETTING_OPTIONS.buildSeconds}
              onChange={(v) => setSetting({ buildSeconds: v })}
              disabled={!isHost}
              format={(v) => `${v} s`}
            />
          </div>
          <div className="setting">
            <span className="setting-label">Temps pour miser</span>
            <Segmented
              value={state.settings.turnSeconds}
              options={SETTING_OPTIONS.turnSeconds}
              onChange={(v) => setSetting({ turnSeconds: v })}
              disabled={!isHost}
              format={(v) => `${v} s`}
            />
          </div>
          <div className="setting">
            <span className="setting-label">Fin de partie</span>
            <Segmented
              value={state.settings.endMode}
              options={['survivor', 'rounds'] as const}
              onChange={(v) => setSetting({ endMode: v })}
              disabled={!isHost}
              format={(v) => (v === 'survivor' ? 'Dernier survivant' : 'Nombre de manches')}
            />
          </div>
          {state.settings.endMode === 'rounds' && (
            <div className="setting">
              <span className="setting-label">Manches</span>
              <Segmented value={state.settings.maxRounds} options={SETTING_OPTIONS.maxRounds} onChange={(v) => setSetting({ maxRounds: v })} disabled={!isHost} />
            </div>
          )}
        </motion.section>
      </main>

      <div className="dock lobby-dock">
        {isHost ? (
          <>
            <button type="button" className="btn btn-primary btn-xl" disabled={!enough} onClick={() => act('game:start')}>
              <Play size={20} /> Lancer la partie
            </button>
            {!enough && <p className="hint">Il faut au moins 2 joueurs : invite un ami ou ajoute un bot.</p>}
          </>
        ) : (
          <p className="waiting">
            <span className="pulse-dot" /> En attente du lancement par <b>{host?.name ?? 'l’hôte'}</b>…
          </p>
        )}
      </div>
    </div>
  );
}
