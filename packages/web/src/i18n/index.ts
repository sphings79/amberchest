import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { de } from './de.js';
import { en } from './en.js';

export const LANGUAGES = ['de', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

void i18n.use(initReactI18next).init({
  resources: {
    de: { translation: de },
    en: { translation: en },
  },
  lng: 'de',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLanguage(language: Language): void {
  void i18n.changeLanguage(language);
  document.documentElement.lang = language;
}

export default i18n;
