// Serveur temps réel : HTTP (santé + client compilé si présent) et Socket.IO pour les tables.
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, Socket } from 'socket.io';
import { AVATARS, EMOTES } from '../shared/protocol';
import { RoomManager } from './manager';
import { Room } from './room';

const PORT = Number(process.env.PORT) || 3001;
const startedAt = Date.now();

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});
app.get('/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, rooms: manager.size, uptime: Math.round((Date.now() - startedAt) / 1000) });
});

// En local ou en mode « tout-en-un », le serveur sert aussi le client compilé.
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, '../client');
if (fs.existsSync(path.join(clientDir, 'index.html'))) {
  app.use(express.static(clientDir, { maxAge: '1h', index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('text').send('Serveur Équation Hi-Lo en ligne.'));
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 20_000,
  pingTimeout: 25_000,
});

const pendingBroadcast = new Set<Room>();
function broadcast(room: Room): void {
  if (pendingBroadcast.has(room)) return;
  pendingBroadcast.add(room);
  queueMicrotask(() => {
    pendingBroadcast.delete(room);
    const sockets = io.sockets.adapter.rooms.get(room.code);
    if (!sockets) return;
    for (const sid of sockets) {
      const s = io.sockets.sockets.get(sid);
      const pid = s?.data.playerId as string | undefined;
      if (s && pid) s.emit('state', room.viewFor(pid));
    }
  });
}

const manager = new RoomManager((room) => {
  room.onChange = () => broadcast(room);
});

type AckFn = (res: { ok: boolean; error?: string; data?: unknown }) => void;

function cleanName(input: unknown): string {
  const raw = typeof input === 'string' ? input : '';
  const name = raw.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return name || `Joueur ${Math.floor(Math.random() * 90 + 10)}`;
}

function cleanAvatar(input: unknown): string {
  return typeof input === 'string' && (AVATARS as readonly string[]).includes(input) ? input : AVATARS[Math.floor(Math.random() * AVATARS.length)];
}

io.on('connection', (socket: Socket) => {
  let lastEmote = 0;

  const bind = (room: Room, playerId: string) => {
    const previous = socket.data.code as string | undefined;
    if (previous && previous !== room.code) {
      const old = manager.get(previous);
      old?.disconnect(socket.data.playerId, socket.id);
      socket.leave(previous);
      if (old) broadcast(old);
    }
    socket.data.code = room.code;
    socket.data.playerId = playerId;
    socket.join(room.code);
    const p = room.get(playerId);
    if (p) room.connect(p, socket.id);
    broadcast(room);
  };

  const context = (): { room: Room; playerId: string } | null => {
    const room = manager.get(socket.data.code);
    const playerId = socket.data.playerId as string | undefined;
    if (!room || !playerId || !room.get(playerId)) return null;
    return { room, playerId };
  };

  /** Enregistre une action de jeu : le résultat est renvoyé à l'émetteur, l'état à toute la table. */
  const on = (event: string, handler: (room: Room, playerId: string, payload: Record<string, unknown>) => string | undefined | void) => {
    socket.on(event, (payload: unknown, ack?: AckFn) => {
      const reply: AckFn = typeof ack === 'function' ? ack : () => {};
      const ctx = context();
      if (!ctx) return reply({ ok: false, error: "Tu n'es plus à cette table." });
      try {
        const err = handler(ctx.room, ctx.playerId, (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>);
        ctx.room.touch();
        broadcast(ctx.room);
        reply(err ? { ok: false, error: err } : { ok: true });
      } catch (e) {
        console.error(`[${event}]`, e);
        reply({ ok: false, error: 'Erreur inattendue du serveur.' });
      }
    });
  };

  socket.on('room:create', (payload: Record<string, unknown> | undefined, ack?: AckFn) => {
    const reply: AckFn = typeof ack === 'function' ? ack : () => {};
    const room = manager.create();
    const player = room.addHuman(cleanName(payload?.name), cleanAvatar(payload?.avatar));
    if (typeof player === 'string') return reply({ ok: false, error: player });
    room.hostId = player.id;
    bind(room, player.id);
    reply({ ok: true, data: { code: room.code, playerId: player.id, token: player.token, spectator: false } });
  });

  socket.on('room:join', (payload: Record<string, unknown> | undefined, ack?: AckFn) => {
    const reply: AckFn = typeof ack === 'function' ? ack : () => {};
    const room = manager.get(payload?.code);
    if (!room) return reply({ ok: false, error: 'Table introuvable : vérifie le code (elle a peut-être expiré).' });
    let player = room.findByToken(payload?.playerId, payload?.token);
    if (!player) {
      const created = room.addHuman(cleanName(payload?.name), cleanAvatar(payload?.avatar));
      if (typeof created === 'string') return reply({ ok: false, error: created });
      player = created;
    }
    bind(room, player.id);
    reply({
      ok: true,
      data: { code: room.code, playerId: player.id, token: player.token, spectator: room.phase !== 'lobby' && !player.inGame },
    });
  });

  on('room:leave', (room, playerId) => {
    room.leave(playerId);
    socket.leave(room.code);
    socket.data.code = undefined;
    socket.data.playerId = undefined;
  });

  on('room:profile', (room, playerId, payload) => {
    const p = room.get(playerId);
    if (!p || room.phase !== 'lobby') return 'Le profil se modifie dans le salon.';
    p.name = cleanName(payload.name);
    p.avatar = cleanAvatar(payload.avatar);
  });

  on('room:settings', (room, playerId, payload) => room.updateSettings(playerId, payload));
  on('room:addBot', (room, playerId) => room.addBot(playerId));
  on('room:kick', (room, playerId, payload) => {
    const res = room.kick(playerId, String(payload.playerId ?? ''));
    if (typeof res === 'string') return res;
    for (const sid of res.sockets) {
      const s = io.sockets.sockets.get(sid);
      if (!s) continue;
      s.emit('kicked');
      s.leave(room.code);
      s.data.code = undefined;
      s.data.playerId = undefined;
    }
    return undefined;
  });
  on('game:start', (room, playerId) => room.start(playerId));
  on('game:restart', (room, playerId) => room.restart(playerId));
  on('game:end', (room, playerId) => room.endEarly(playerId));
  on('game:discard', (room, playerId, payload) => room.discard(playerId, payload.op));
  on('game:action', (room, playerId, payload) =>
    room.act(playerId, { type: payload.type as 'check' | 'call' | 'raise' | 'fold', amount: Number(payload.amount) }),
  );
  on('game:arrange', (room, playerId, payload) => room.arrange(playerId, payload));
  on('game:ready', (room, playerId, payload) => room.setReady(playerId, payload.ready !== false));
  on('game:declare', (room, playerId, payload) => room.declare(playerId, payload.decl));
  on('game:next', (room, playerId) => room.readyNext(playerId));

  socket.on('emote', (payload: Record<string, unknown> | undefined) => {
    const ctx = context();
    const emoji = payload?.emoji;
    if (!ctx || typeof emoji !== 'string' || !(EMOTES as readonly string[]).includes(emoji)) return;
    const now = Date.now();
    if (now - lastEmote < 1200) return;
    lastEmote = now;
    io.to(ctx.room.code).emit('emote', { playerId: ctx.playerId, emoji });
  });

  socket.on('disconnect', () => {
    const ctx = context();
    if (!ctx) return;
    ctx.room.disconnect(ctx.playerId, socket.id);
    broadcast(ctx.room);
  });
});

server.listen(PORT, () => {
  console.log(`Équation Hi-Lo : serveur prêt sur le port ${PORT}`);
});
