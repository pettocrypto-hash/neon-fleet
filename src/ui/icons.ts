import type { SpecialId } from '../config/balance';

/** Inline-SVG-Icons der Spezialaktionen (vektorbasiert, scharf auf jedem Display). */
const P: Record<SpecialId | 'fire' | 'rotate' | 'sound' | 'mute' | 'back' | 'swap' | 'flag', string> = {
  salvo: '<path d="M4 18 L9 6 M10 18 L15 6 M16 18 L21 6"/><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="21" cy="6" r="1.6"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 L19 6"/><circle cx="16" cy="9" r="1.4" fill="currentColor"/>',
  drone: '<circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2.4"/><circle cx="19" cy="5" r="2.4"/><circle cx="5" cy="19" r="2.4"/><circle cx="19" cy="19" r="2.4"/><path d="M7 7 L10 10 M17 7 L14 10 M7 17 L10 14 M17 17 L14 14"/>',
  emp: '<path d="M13 2 L5 13 H11 L10 22 L19 10 H13 Z"/>',
  shield: '<path d="M12 2 L20 5 V11 C20 16 16.5 20 12 22 C7.5 20 4 16 4 11 V5 Z"/><path d="M8 12 L11 15 L16 9"/>',
  repair: '<path d="M14.5 4.5 a4 4 0 0 0 5 5 L11 18 a2.1 2.1 0 0 1 -3 -3 Z"/><path d="M4 20 L7 17"/>',
  hologram: '<path d="M12 3 L20 8 V16 L12 21 L4 16 V8 Z" stroke-dasharray="2.5 2"/><circle cx="12" cy="12" r="2.6"/>',
  jump: '<path d="M4 12 H14"/><path d="M11 7 L16 12 L11 17"/><path d="M18 5 V19"/><path d="M21 8 V16"/>',
  fire: '<circle cx="12" cy="12" r="7"/><path d="M12 2 V7 M12 17 V22 M2 12 H7 M17 12 H22"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  rotate: '<path d="M20 12 a8 8 0 1 1 -2.5 -5.8"/><path d="M20 4 V9 H15"/>',
  sound: '<path d="M4 9 H8 L13 5 V19 L8 15 H4 Z"/><path d="M16 9 a4 4 0 0 1 0 6 M18.5 6.5 a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9 H8 L13 5 V19 L8 15 H4 Z"/><path d="M16 9 L21 14 M21 9 L16 14"/>',
  back: '<path d="M15 5 L8 12 L15 19"/>',
  swap: '<path d="M7 4 L3 8 L7 12"/><path d="M3 8 H17"/><path d="M17 12 L21 16 L17 20"/><path d="M21 16 H7"/>',
  flag: '<path d="M5 21 V4"/><path d="M5 4 H17 L14 8 L17 12 H5"/>',
};

export function icon(name: keyof typeof P, size = 22): string {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;
}

export function iconEl(name: keyof typeof P, size = 22): HTMLElement {
  const s = document.createElement('span');
  s.className = 'ico-wrap';
  s.innerHTML = icon(name, size);
  return s;
}
