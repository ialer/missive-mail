import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import zhCN from './locales/zh-CN.json';
import en from './locales/en.json';

const savedLang = localStorage.getItem('i18n_language');

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': { translation: zhCN },
      en: { translation: en },
    },
    fallbackLng: 'zh-CN',
    lng: savedLang || undefined,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

// Sync html lang attribute
const syncLang = (lng: string) => {
  document.documentElement.lang = lng === 'zh-CN' ? 'zh-CN' : 'en';
};
syncLang(i18n.language);
i18n.on('languageChanged', (lng: string) => {
  localStorage.setItem('i18n_language', lng);
  syncLang(lng);
});

export default i18n;
