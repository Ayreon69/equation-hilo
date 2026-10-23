// Registre des tables ouvertes, avec un code court à partager et un nettoyage des tables abandonnées.
import { Room } from './room';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const IDLE_MS = 20 * 60 * 1000;

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private onCreate: (room: Room) => void = () => {}) {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  get size(): number {
    return this.rooms.size;
  }

  get(code: unknown): Room | undefined {
    if (typeof code !== 'string') return undefined;
    return this.rooms.get(code.trim().toUpperCase());
  }

  create(): Room {
    let code = '';
    do {
      code = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code);
    this.rooms.set(code, room);
    this.onCreate(room);
    return room;
  }

  /** Supprime les tables sans joueur humain connecté depuis un moment. */
  sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.hasConnectedHuman()) {
        room.touch();
        continue;
      }
      if (now - room.lastActivity > IDLE_MS) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }
}
