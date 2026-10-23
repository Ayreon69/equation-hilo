// Horloge injectable : la vraie en production, une horloge simulée pour les tests (des milliers de manches en quelques secondes).

export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class FakeScheduler implements Scheduler {
  private t = 1_000_000;
  private seq = 0;
  private queue: { id: number; at: number; fn: () => void }[] = [];

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.queue.push({ id, at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.queue = this.queue.filter((q) => q.id !== handle);
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Exécute le prochain minuteur ; renvoie false s'il n'y en a plus. */
  step(): boolean {
    if (this.queue.length === 0) return false;
    this.queue.sort((a, b) => a.at - b.at || a.id - b.id);
    const next = this.queue.shift()!;
    this.t = next.at;
    next.fn();
    return true;
  }
}
