/**
 * Abstrakte Transportschicht. PeerJS ist eine Implementierung; Firebase, WebSockets
 * o. ä. können später hinter demselben Interface ergänzt werden.
 */
export type TransportStatus = 'idle' | 'waiting' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

export interface Transport {
  readonly role: 'host' | 'guest';
  /** Startet bzw. baut die Verbindung auf. */
  start(): void;
  /** Erzwingt einen Neuaufbau (z. B. nach Heartbeat-Timeout). */
  restart(): void;
  send(data: unknown): boolean;
  close(): void;
  onData: (data: unknown) => void;
  onStatus: (status: TransportStatus, detail?: string) => void;
}

export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_LENGTH = 5;

export function makeRoomCode(): string {
  const arr = new Uint8Array(ROOM_LENGTH);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
}

/** Normalisiert Nutzereingaben (Kleinbuchstaben, Leerzeichen, Bindestriche). */
export function normalizeRoomCode(s: string): string | null {
  const c = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== ROOM_LENGTH) return null;
  return [...c].every((ch) => ROOM_ALPHABET.includes(ch)) ? c : null;
}
