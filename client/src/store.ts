import { create } from 'zustand';
import { AVATARS, RoomState } from '../../shared/protocol';

export interface Profile {
  name: string;
  avatar: string;
}

export interface Session {
  code: string;
  playerId: string;
  token: string;
}

export type ServerStatus = 'waking' | 'online' | 'offline';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

export interface Emote {
  id: number;
  playerId: string;
  emoji: string;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible (navigation privée) : on continue sans */
  }
}

const randomAvatar = () => AVATARS[Math.floor(Math.random() * AVATARS.length)];

interface Store {
  connected: boolean;
  serverStatus: ServerStatus;
  profile: Profile;
  session: Session | null;
  state: RoomState | null;
  clockOffset: number;
  sound: boolean;
  rulesOpen: boolean;
  logOpen: boolean;
  toasts: Toast[];
  emotes: Emote[];
  inviteCode: string | null;
  seenTutorial: boolean;
  setConnected: (v: boolean) => void;
  setServerStatus: (s: ServerStatus) => void;
  setProfile: (p: Partial<Profile>) => void;
  setSession: (s: Session | null) => void;
  receiveState: (s: RoomState) => void;
  clearRoom: () => void;
  toggleSound: () => void;
  setRulesOpen: (v: boolean) => void;
  setLogOpen: (v: boolean) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  addEmote: (e: { playerId: string; emoji: string }) => void;
  setInviteCode: (c: string | null) => void;
  markTutorialSeen: () => void;
}

let seq = 0;

export const useStore = create<Store>((set, get) => ({
  connected: false,
  serverStatus: 'waking',
  profile: read<Profile>('ehl:profile', { name: '', avatar: randomAvatar() }),
  session: read<Session | null>('ehl:session', null),
  state: null,
  clockOffset: 0,
  sound: read<boolean>('ehl:sound', true),
  rulesOpen: false,
  logOpen: false,
  toasts: [],
  emotes: [],
  inviteCode: null,
  seenTutorial: read<boolean>('ehl:tuto', false),

  setConnected: (connected) => set({ connected }),
  setServerStatus: (serverStatus) => set({ serverStatus }),
  setProfile: (p) => {
    const profile = { ...get().profile, ...p };
    write('ehl:profile', profile);
    set({ profile });
  },
  setSession: (session) => {
    write('ehl:session', session);
    set({ session });
  },
  receiveState: (state) => set({ state, clockOffset: state.serverNow - Date.now() }),
  clearRoom: () => {
    write('ehl:session', null);
    set({ state: null, session: null, emotes: [] });
  },
  toggleSound: () => {
    const sound = !get().sound;
    write('ehl:sound', sound);
    set({ sound });
  },
  setRulesOpen: (rulesOpen) => set({ rulesOpen }),
  setLogOpen: (logOpen) => set({ logOpen }),
  toast: (text, kind = 'info') => {
    const id = ++seq;
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 5200 : 3600);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  addEmote: (e) => {
    const id = ++seq;
    set({ emotes: [...get().emotes, { id, ...e }] });
    setTimeout(() => set({ emotes: get().emotes.filter((x) => x.id !== id) }), 2600);
  },
  setInviteCode: (inviteCode) => set({ inviteCode }),
  markTutorialSeen: () => {
    write('ehl:tuto', true);
    set({ seenTutorial: true });
  },
}));

/** Heure du serveur, pour afficher des comptes à rebours justes. */
export const serverNow = () => Date.now() + useStore.getState().clockOffset;
