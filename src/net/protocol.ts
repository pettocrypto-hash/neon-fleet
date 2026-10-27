import type { GameMode } from '../config/balance';
import type { ActionResult, PlayerId, PublicAction } from '../game/types';
import type { Reveal } from '../game/verify';

export const PROTOCOL_VERSION = 1;

/** Spielnachrichten (typisiert). `game` = laufende Partienummer im Raum (Revanche zählt hoch). */
export type GameMsg =
  | { k: 'hello'; proto: number; client: string; name: string }
  | { k: 'reject'; reason: 'full' | 'version' }
  | { k: 'config'; game: number; mode: GameMode; turnSeconds: number; seed: number; starter: PlayerId }
  | { k: 'ready'; game: number; hash: string }
  | { k: 'action'; game: number; seq: number; action: PublicAction }
  | { k: 'result'; game: number; seq: number; result: ActionResult }
  | { k: 'reveal'; game: number; reveal: Reveal }
  | { k: 'rematch'; game: number }
  | { k: 'forfeit'; game: number }
  | { k: 'emote'; e: string };

/** Transport-Umschlag der zuverlässigen Session-Schicht. */
export type Envelope =
  | { s: 'msg'; id: number; m: GameMsg }
  | { s: 'ack'; id: number }
  | { s: 'resume'; last: number; client: string }
  | { s: 'ping'; t: number }
  | { s: 'pong'; t: number }
  | { s: 'raw'; m: GameMsg };

export function isEnvelope(d: unknown): d is Envelope {
  return !!d && typeof d === 'object' && typeof (d as { s?: unknown }).s === 'string';
}
