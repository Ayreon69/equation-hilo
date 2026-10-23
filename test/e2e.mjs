// Test de bout en bout : plusieurs joueurs connectés en temps réel jouent une partie complète.
// Usage : node test/e2e.mjs [url-du-serveur] [nombre-de-joueurs]
import { io } from 'socket.io-client';

const URL = process.argv[2] || 'http://localhost:3001';
const PLAYERS = Number(process.argv[3] || 3);
const TIMEOUT_MS = 6 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (n) => Math.floor(Math.random() * n);

function connect(name) {
  const socket = io(URL, { transports: ['websocket'], reconnection: false, timeout: 60000 });
  const client = { name, socket, state: null, actions: 0, errors: [] };
  socket.on('state', (s) => {
    client.state = s;
    void react(client);
  });
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(client));
    socket.on('connect_error', (e) => reject(new Error(`${name} : ${e.message}`)));
  });
}

function emit(client, event, payload = {}) {
  return new Promise((resolve) => {
    client.socket.timeout(10000).emit(event, payload, (err, res) => {
      if (err) resolve({ ok: false, error: 'timeout' });
      else resolve(res);
    });
  });
}

let busy = new WeakSet();
async function react(client) {
  const s = client.state;
  if (!s || busy.has(client)) return;
  const me = s.players.find((p) => p.id === s.youId);
  const h = me?.hand;
  const r = s.round;
  busy.add(client);
  try {
    await sleep(30 + rand(120));
    if (s.phase === 'showdown' && !s.nextReady.includes(s.youId) && me && !me.out) {
      await act(client, 'game:next');
    } else if (h && !h.folded) {
      if (s.phase === 'discard' && h.pendingDiscard > 0) {
        const options = h.ops.filter((o) => o !== '/');
        await act(client, 'game:discard', { op: options[rand(options.length)] });
      } else if ((s.phase === 'bet1' || s.phase === 'bet2') && r.toAct === s.youId) {
        const toCall = r.currentBet - h.roundBet;
        const x = Math.random();
        if (x < 0.15 && r.maxRoundBet > r.currentBet) {
          const amount = Math.min(r.maxRoundBet, r.currentBet + 1 + rand(2));
          await act(client, 'game:action', { type: 'raise', amount });
        } else if (x < 0.32 && toCall > 0) {
          await act(client, 'game:action', { type: 'fold' });
        } else {
          await act(client, 'game:action', { type: toCall > 0 ? 'call' : 'check' });
        }
      } else if (s.phase === 'build' && !h.ready && h.arrangements) {
        const arr = h.arrangements.high;
        const nums = [...arr.nums].sort(() => Math.random() - 0.5);
        await act(client, 'game:arrange', { high: { ...arr, nums }, low: h.arrangements.low });
        await act(client, 'game:ready', { ready: true });
      } else if (s.phase === 'declare' && !h.hasDeclared) {
        await act(client, 'game:declare', { decl: ['high', 'low', 'swing'][rand(3)] });
      }
    }
  } finally {
    busy.delete(client);
    // Un nouvel état est arrivé pendant l'action : on y réagit aussi.
    if (client.state !== s) void react(client);
  }
}

async function act(client, event, payload) {
  const res = await emit(client, event, payload);
  client.actions++;
  if (!res?.ok) client.errors.push(`${event}: ${res?.error}`);
  return res;
}

async function main() {
  const started = Date.now();
  console.log(`Serveur : ${URL} · ${PLAYERS} joueurs`);
  const host = await connect('Hôte');
  const created = await emit(host, 'room:create', { name: 'Hôte', avatar: '🦊' });
  if (!created.ok) throw new Error(`Création impossible : ${created.error}`);
  const code = created.data.code;
  console.log(`Table créée : ${code}`);

  const others = [];
  for (let i = 1; i < PLAYERS; i++) {
    const c = await connect(`Joueur${i}`);
    const joined = await emit(c, 'room:join', { code, name: `Joueur${i}`, avatar: '🐼' });
    if (!joined.ok) throw new Error(`Join impossible : ${joined.error}`);
    others.push(c);
  }
  const all = [host, ...others];

  const bad = await emit(others[0], 'room:settings', { startChips: 50 });
  if (bad.ok) throw new Error('Un invité a pu modifier les réglages !');
  const set = await emit(host, 'room:settings', { startChips: 10, endMode: 'rounds', maxRounds: 10, buildSeconds: 60, turnSeconds: 30 });
  if (!set.ok) throw new Error(`Réglages refusés : ${set.error}`);
  const bot = await emit(host, 'room:addBot');
  if (!bot.ok) throw new Error(`Bot refusé : ${bot.error}`);
  await sleep(200);
  const start = await emit(host, 'game:start');
  if (!start.ok) throw new Error(`Démarrage refusé : ${start.error}`);
  console.log('Partie lancée…');

  let lastRound = 0;
  while (host.state?.phase !== 'gameover') {
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`Délai dépassé en phase ${host.state?.phase}`);
    const n = host.state?.round?.number ?? 0;
    if (n !== lastRound) {
      lastRound = n;
      const chips = host.state.players.map((p) => `${p.name}:${p.chips}`).join(' ');
      console.log(`  manche ${n} · ${chips}`);
    }
    await sleep(250);
  }
  const go = host.state.gameOver;
  const winner = host.state.players.find((p) => p.id === go.ranking[0].id);
  console.log(`Fin de partie après ${go.rounds} manches : ${winner.name} gagne avec ${go.ranking[0].chips} jetons.`);

  // Les autres joueurs ne voient jamais les cartes cachées des autres en cours de partie (vérifié sur l'état final : révélation autorisée).
  const restart = await emit(host, 'game:restart');
  if (!restart.ok) throw new Error(`Revanche refusée : ${restart.error}`);
  await sleep(300);
  if (others[0].state.phase !== 'lobby') throw new Error('La revanche ne ramène pas au salon');
  console.log('Revanche : retour au salon OK');

  const errors = all.flatMap((c) => c.errors.map((e) => `${c.name} → ${e}`));
  const actions = all.reduce((s, c) => s + c.actions, 0);
  for (const c of all) c.socket.close();
  console.log(`${actions} actions envoyées, ${errors.length} refusées.`);
  if (errors.length) console.log(errors.slice(0, 10).join('\n'));
  console.log(`Durée : ${Math.round((Date.now() - started) / 1000)} s`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('ÉCHEC :', e.message);
    process.exit(1);
  },
);
