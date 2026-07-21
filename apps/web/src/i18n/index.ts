import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enCommon from './locales/en/common.json';
import enImport from './locales/en/import.json';
import enTimeline from './locales/en/timeline.json';
import enDelta from './locales/en/delta.json';
import enTrace from './locales/en/trace.json';
import enPanorama from './locales/en/panorama.json';
import enWiki from './locales/en/wiki.json';
import enTraining from './locales/en/training.json';
import enSettings from './locales/en/settings.json';

import zhCommon from './locales/zh-Hans/common.json';
import zhImport from './locales/zh-Hans/import.json';
import zhTimeline from './locales/zh-Hans/timeline.json';
import zhDelta from './locales/zh-Hans/delta.json';
import zhTrace from './locales/zh-Hans/trace.json';
import zhPanorama from './locales/zh-Hans/panorama.json';
import zhWiki from './locales/zh-Hans/wiki.json';
import zhTraining from './locales/zh-Hans/training.json';
import zhSettings from './locales/zh-Hans/settings.json';

export const LOCALES = ['en', 'zh-Hans'] as const;
export type AppLocale = (typeof LOCALES)[number];

export const LOCALE_STORAGE_KEY = 'codedelta.locale';
export const DEFAULT_LOCALE: AppLocale = 'en';

const NAMESPACES = [
  'common',
  'import',
  'timeline',
  'delta',
  'trace',
  'panorama',
  'wiki',
  'training',
  'settings',
] as const;

export type AppNamespace = (typeof NAMESPACES)[number];

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === 'en' || value === 'zh-Hans';
}

export function readStoredLocale(): AppLocale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isAppLocale(raw)) return raw;
  } catch {
    // localStorage unavailable (private mode / SSR) — fall through to default
  }
  return DEFAULT_LOCALE;
}

export function persistLocale(locale: AppLocale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore quota / privacy errors
  }
}

export function applyDocumentLang(locale: AppLocale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'zh-Hans' ? 'zh-Hans' : 'en';
  }
}

export async function setAppLocale(locale: AppLocale): Promise<void> {
  persistLocale(locale);
  applyDocumentLang(locale);
  await i18n.changeLanguage(locale);
}

const initialLocale = readStoredLocale();
applyDocumentLang(initialLocale);

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: enCommon,
      import: enImport,
      timeline: enTimeline,
      delta: enDelta,
      trace: enTrace,
      panorama: enPanorama,
      wiki: enWiki,
      training: enTraining,
      settings: enSettings,
    },
    'zh-Hans': {
      common: zhCommon,
      import: zhImport,
      timeline: zhTimeline,
      delta: zhDelta,
      trace: zhTrace,
      panorama: zhPanorama,
      wiki: zhWiki,
      training: zhTraining,
      settings: zhSettings,
    },
  },
  lng: initialLocale,
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: 'common',
  ns: [...NAMESPACES],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
