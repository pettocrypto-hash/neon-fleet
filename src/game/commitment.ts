import { canonicalLayout } from './board';
import { randomHex } from './rng';
import { sha256Hex } from './sha256';
import type { Layout } from './types';

/** Commitment = SHA-256(kanonisches Layout | Salt). Wird vor Spielbeginn gesendet. */
export function commitLayout(layout: Layout, salt: string): string {
  return sha256Hex(`NEONFLEET|${canonicalLayout(layout)}|${salt}`);
}

export function newSalt(): string {
  return randomHex(16);
}
