import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { interpolate, translations } from "../locales/translations";

const I18nContext = createContext(null);
const STORAGE_KEY = "paketo_lang";

function getNested(obj, path) {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return translations[saved] ? saved : "en";
  });

  const setLang = useCallback((code) => {
    if (!translations[code]) return;
    localStorage.setItem(STORAGE_KEY, code);
    setLangState(code);
  }, []);

  const t = useCallback((key, vars) => {
    const value = getNested(translations[lang], key) ?? getNested(translations.en, key) ?? key;
    return typeof value === "string" && vars ? interpolate(value, vars) : value;
  }, [lang]);

  const ts = useCallback((status) => t(`status.${status}`) || status, [t]);

  const value = useMemo(() => ({ lang, setLang, t, ts }), [lang, setLang, t, ts]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
