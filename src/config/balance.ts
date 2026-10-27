/**
 * Zentrale Balancing-Datei. Alle Kosten, Boni und Mengen des Spiels stehen hier.
 * Änderungen wirken sich auf Spiellogik, KI und UI gleichermaßen aus.
 */

export const BOARD_SIZE = 15;

export type ShipKind = 'dreadnought' | 'carrier' | 'cruiser' | 'destroyer' | 'interceptor' | 'skiff';

export const SHIP_LENGTH: Record<ShipKind, number> = {
  dreadnought: 6,
  carrier: 5,
  cruiser: 4,
  destroyer: 3,
  interceptor: 2,
  skiff: 1,
};

/** Flotte je Spieler (Reihenfolge = Reihenfolge im Dock). */
export const FLEET: ShipKind[] = [
  'dreadnought',
  'carrier',
  'cruiser',
  'cruiser',
  'destroyer',
  'destroyer',
  'interceptor',
  'interceptor',
  'skiff',
  'skiff',
];

export type SpecialId = 'salvo' | 'radar' | 'drone' | 'emp' | 'shield' | 'repair' | 'hologram' | 'jump';

export interface SpecialDef {
  cost: number;
  /** Ziel: gegnerisches Feld oder eigenes Feld. */
  target: 'enemy' | 'own';
  /** Maximal pro Spiel (0 = unbegrenzt). */
  perGame: number;
}

export const SPECIALS: Record<SpecialId, SpecialDef> = {
  salvo: { cost: 3, target: 'enemy', perGame: 0 },
  radar: { cost: 2, target: 'enemy', perGame: 0 },
  drone: { cost: 3, target: 'enemy', perGame: 0 },
  emp: { cost: 4, target: 'enemy', perGame: 0 },
  shield: { cost: 3, target: 'own', perGame: 0 },
  repair: { cost: 4, target: 'own', perGame: 0 },
  hologram: { cost: 2, target: 'own', perGame: 1 },
  jump: { cost: 5, target: 'own', perGame: 0 },
};

export const SPECIAL_ORDER: SpecialId[] = ['salvo', 'radar', 'drone', 'emp', 'shield', 'repair', 'hologram', 'jump'];

export const BALANCE = {
  energy: {
    start: 0,
    max: 10,
    perTurn: 1,
    perHit: 1,
    perSunk: 2,
  },
  /** Spezialaktionen pro Zug (zusätzlich zum Schuss). */
  specialsPerTurn: 1,
  salvoLength: 3,
  radarSize: 3,
  empSize: 3,
  mines: {
    count: 3,
    energyPenalty: 2,
  },
  combo: {
    /** Treffer in Folge, die einen Extra-Schuss auslösen. */
    hitsForBonus: 3,
    bonusShots: 1,
  },
  events: {
    /** Alle N Runden ein Zufalls-Event. */
    everyRounds: 8,
    energyBoost: 2,
    /** Sonnensturm: maximale Abweichung des Radar-Ergebnisses. */
    stormNoise: 1,
    /** Überladung: Rabatt auf Spezialaktionen. */
    overchargeDiscount: 1,
  },
  timers: {
    /** Zug-Timer in Sekunden (0 = aus). */
    turnSeconds: 45,
    setupSeconds: 150,
  },
  classic: {
    /** Klassischer Modus: Bei Treffer erneut schießen. */
    extraShotOnHit: true,
  },
} as const;

export type GameMode = 'cyber' | 'classic';
