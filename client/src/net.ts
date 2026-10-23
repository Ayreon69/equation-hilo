// Connexion temps réel au serveur de jeu, réveil du serveur et reprise automatique de la partie.
import { io } from 'socket.io-client';
import type { Ack, JoinData, RoomState } from '../../shared/protocol';
import { useStore } from './store';

const configured = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim();
export const SERVER_URL = configured ? configured.replace(/\/$/, '') : window.location.origin;

export const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling'],
  reconnectionDelay: 700,
  reconnectionDelayMax: 4000,
  timeout: 30000,
});

const store = () => useStore.getState();

export function getUrlCode(): string | null {
  const code = new URLSearchParams(window.location.search).get('code');
  return code && /^[A-Za-z]{4}$/.test(code) ? code.toUpperCase() : null;
}

export function setUrlCode(code: string | null): void {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('code', code);
  else url.searchParams.delete('code');
  window.history.replaceState(null, '', url.toString());
}

export function inviteLink(code: string): string {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('code', code);
  return url.toString();
}

/** Se résout quand la connexion est rétablie et la place à table reprise (ou false après le délai). */
let ready: Promise<void> = Promise.resolve();
function waitUntilReady(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    const done = () => {
      clearTimeout(timer);
      void ready.then(() => resolve(true));
    };
    if (socket.connected) done();
    else socket.once('connect', () => setTimeout(done, 0));
  });
}

export function call<T = unknown>(event: string, payload: Record<string, unknown> = {}, retry = true): Promise<Ack<T>> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: 'Connexion au serveur en cours… réessaie dans un instant.' });
      return;
    }
    socket.timeout(8000).emit(event, payload, async (err: unknown, res: Ack<T>) => {
      if (!err) return resolve(res);
      // Pas de réponse : connexion à moitié coupée (veille du téléphone, réseau mobile…). On la relance et on réessaie une fois.
      socket.disconnect().connect();
      if (!retry) return resolve({ ok: false, error: 'Le serveur ne répond pas, réessaie.' });
      const back = await waitUntilReady(20000);
      if (!back) return resolve({ ok: false, error: 'Connexion perdue, réessaie dans un instant.' });
      resolve(await call<T>(event, payload, false));
    });
  });
}

/** Envoie une action et affiche l'erreur éventuelle. */
export async function act(event: string, payload: Record<string, unknown> = {}): Promise<boolean> {
  const res = await call(event, payload);
  if (!res.ok && res.error) store().toast(res.error, 'error');
  return res.ok;
}

function enterRoom(data: JoinData): void {
  store().setSession({ code: data.code, playerId: data.playerId, token: data.token });
  store().setInviteCode(null);
  setUrlCode(data.code);
}

export async function createRoom(): Promise<boolean> {
  const { profile } = store();
  const res = await call<JoinData>('room:create', { name: profile.name, avatar: profile.avatar });
  if (!res.ok || !res.data) {
    store().toast(res.error ?? 'Impossible de créer la table.', 'error');
    return false;
  }
  enterRoom(res.data);
  return true;
}

export async function joinRoom(code: string): Promise<boolean> {
  const { profile, session } = store();
  const sameTable = session && session.code === code.toUpperCase();
  const res = await call<JoinData>('room:join', {
    code,
    name: profile.name,
    avatar: profile.avatar,
    playerId: sameTable ? session.playerId : undefined,
    token: sameTable ? session.token : undefined,
  });
  if (!res.ok || !res.data) {
    store().toast(res.error ?? 'Impossible de rejoindre la table.', 'error');
    if (res.error?.startsWith('Table introuvable') && store().inviteCode === code.toUpperCase()) {
      store().setInviteCode(null);
      setUrlCode(null);
    }
    return false;
  }
  enterRoom(res.data);
  if (res.data.spectator) store().toast('Partie en cours : tu regardes en spectateur et joueras à la prochaine.', 'info');
  return true;
}

export async function leaveRoom(): Promise<void> {
  await call('room:leave');
  store().clearRoom();
  setUrlCode(null);
}

export function sendEmote(emoji: string): void {
  socket.emit('emote', { emoji });
}

// ---------- Événements du serveur ----------

socket.on('connect', () => {
  store().setConnected(true);
  store().setServerStatus('online');
  ready = rejoin();
});

/** Après chaque (re)connexion, on reprend automatiquement sa place à la table. */
async function rejoin(): Promise<void> {
  const { session, inviteCode } = store();
  if (!session) return;
  if (inviteCode && inviteCode !== session.code) return;
  const res = await call<JoinData>(
    'room:join',
    {
      code: session.code,
      playerId: session.playerId,
      token: session.token,
      name: store().profile.name,
      avatar: store().profile.avatar,
    },
    false,
  );
  if (!res.ok && res.error === 'Le serveur ne répond pas, réessaie.') return;
  if (res.ok && res.data) {
    enterRoom(res.data);
  } else {
    // La table n'existe plus (serveur redémarré ou table expirée) : retour à l'accueil.
    const explicit = getUrlCode() === session.code || !!store().state;
    store().clearRoom();
    if (getUrlCode() === session.code) {
      setUrlCode(null);
      store().setInviteCode(null);
    }
    if (explicit) store().toast('Cette table n’existe plus (le serveur a peut-être redémarré). Crée une nouvelle table !', 'error');
  }
}

socket.on('disconnect', () => store().setConnected(false));
socket.on('state', (state: RoomState) => store().receiveState(state));
socket.on('emote', (e: { playerId: string; emoji: string }) => store().addEmote(e));
socket.on('kicked', () => {
  store().clearRoom();
  setUrlCode(null);
  store().toast("L'hôte t'a retiré de la table.", 'error');
});

// ---------- Réveil et maintien du serveur ----------

let waking = false;
export async function wakeServer(): Promise<void> {
  if (waking || store().connected) return;
  waking = true;
  store().setServerStatus('waking');
  for (let attempt = 0; attempt < 40 && !store().connected; attempt++) {
    try {
      const res = await fetch(`${SERVER_URL}/health`, { cache: 'no-store' });
      if (res.ok) {
        store().setServerStatus('online');
        if (!socket.connected) socket.connect();
        break;
      }
    } catch {
      /* serveur encore endormi */
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (!store().connected && store().serverStatus !== 'online') store().setServerStatus('offline');
  waking = false;
}

// Une requête régulière pendant une partie empêche l'hébergement gratuit de mettre le serveur en veille.
setInterval(() => {
  if (store().state) fetch(`${SERVER_URL}/health`, { cache: 'no-store' }).catch(() => {});
}, 4 * 60 * 1000);
