/**
 * Minimal typed event bus.
 *
 * Stores stay acyclic: the session store announces lifecycle events, the vault
 * and browser stores subscribe. Nothing imports anything back.
 */

export interface BusEvents {
  'session:unlocked': { profileId: string; envelope: VaultEnvelopeLike | null };
  'session:locked': { reason: LockReason };
  'session:created': { profileId: string };
  'vault:hydrated': { revision: number };
  'vault:dirty': { at: number };
  'vault:synced': { revision: number };
  'browser:navigate': { tabId: string; url: string; newTab?: boolean };
  'browser:autofill': { origin: string };
  'cloud:changed': undefined;
}

export interface VaultEnvelopeLike {
  revision: number;
  updatedAt: number;
  sizeBytes: number;
  checksum: string;
  vault: string;
}

export type LockReason = 'manual' | 'idle' | 'expired' | 'created' | 'profile-switch';

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;

const handlers = new Map<keyof BusEvents, Set<Handler<never>>>();

export function on<K extends keyof BusEvents>(event: K, handler: Handler<K>): () => void {
  const set = handlers.get(event) ?? new Set();
  set.add(handler as Handler<never>);
  handlers.set(event, set);
  return () => off(event, handler);
}

export function off<K extends keyof BusEvents>(event: K, handler: Handler<K>): void {
  handlers.get(event)?.delete(handler as Handler<never>);
}

export function emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
  const set = handlers.get(event);
  if (!set) return;
  for (const h of [...set]) {
    try {
      (h as Handler<K>)(payload);
    } catch (err) {
      console.error(`[nimbus:bus] handler for ${String(event)} failed`, err);
    }
  }
}
