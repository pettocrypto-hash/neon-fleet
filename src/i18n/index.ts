import { de, type I18nKey } from './de';

type Dict = Partial<Record<I18nKey, string>>;

/** Weitere Sprachen hier registrieren, z. B. `en: () => import('./en').then((m) => m.en)`. */
const dictionaries: Record<string, Dict> = { de };
let current: Dict = de;

export function setLanguage(lang: string) {
  current = dictionaries[lang] ?? de;
}

export function t(key: I18nKey, params?: Record<string, string | number>): string {
  let s: string = current[key] ?? de[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export type { I18nKey };
