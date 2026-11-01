// Языки Luminoctis. Язык берётся один раз из языка интерфейса Zen (Services.locale.appLocaleAsBCP47, первая часть кода);
// пользователь в моде язык не выбирает. Нет в списке — en. Тесты могут подменить язык скрытой настройкой luminoctis.dev.locale.
// Словари — js/lumi-l10n-<код>.sys.mjs (export const strings = { ключ: "текст с {0}, {1}" }). Правило: любая новая надпись — сразу на всех
// 10 языках (проверяет dev/check-i18n.js). Без побочных эффектов, кроме чтения языка и словаря.
export const LANGS = ["en", "zh", "es", "ar", "pt", "id", "fr", "ja", "ru", "de"];

const raw = (() => {
  try {
    const dev = Services.prefs.getStringPref("luminoctis.dev.locale", "");
    if (dev) return dev;
  } catch {}
  try { return Services.locale.appLocaleAsBCP47 || "en"; } catch { return "en"; }
})();
const first = String(raw).toLowerCase().split(/[-_]/)[0];
export const lang = LANGS.includes(first) ? first : "en";
export const dir = lang == "ar" ? "rtl" : "ltr";
// тег для Intl (даты, числа): свой регион у pt — бразильский вариант; остальные — как есть, если язык мода совпал с языком Zen
export const locale = lang == "pt" ? "pt-BR" : lang == first && raw.includes("-") ? raw : lang;

// словарей может не быть (переводы — на финальном этапе): тогда {} и t() вернёт ключ
const load = code => { try { return ChromeUtils.importESModule(new URL(`lumi-l10n-${code}.sys.mjs`, import.meta.url).href).strings ?? {}; } catch { return {}; } };
const dict = load(lang);
const base = lang == "en" ? dict : load("en");

// t("ключ", a, b): подставляет {0}, {1}…; нет ключа в языке — английский, нет и там — сам ключ
export const t = (key, ...args) => (dict[key] ?? base[key] ?? key).replace(/\{(\d+)\}/g, (m, i) => args[i] ?? m);

// Разметка страниц: data-lumi-l10n="ключ" — текст элемента; data-lumi-l10n-title / -placeholder / -aria-label — одноимённый атрибут.
const ATTRS = ["title", "placeholder", "aria-label"];
export function localize(root) {
  const doc = root.ownerDocument ?? root;
  if (doc.documentElement) { doc.documentElement.lang = lang; doc.documentElement.dir = dir; }
  for (const e of root.querySelectorAll("[data-lumi-l10n]")) e.textContent = t(e.dataset.lumiL10n);
  for (const a of ATTRS) for (const e of root.querySelectorAll(`[data-lumi-l10n-${a}]`)) e.setAttribute(a, t(e.getAttribute(`data-lumi-l10n-${a}`)));
}
