// Языки Luminoctis. Язык берётся один раз из языка интерфейса Zen (Services.locale.appLocaleAsBCP47, первая часть кода);
// пользователь в моде язык не выбирает. Нет в списке — en. Тесты могут подменить язык скрытой настройкой luminoctis.dev.locale.
// Ключ = русский текст (как gettext): t("Русский текст {0}", a). Для ru словарь не нужен — t() возвращает ключ. Для остальных языков:
// словарь js/lumi-l10n-<код>.sys.mjs → английский → ключ. Словари собирает dev/build-l10n.mjs из dev/l10n/*.json; правила — docs/areas/i18n.md.
// Без побочных эффектов, кроме чтения языка и словаря.
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

// ru — исходный язык: словари не грузим
const load = code => { try { return ChromeUtils.importESModule(new URL(`lumi-l10n-${code}.sys.mjs`, import.meta.url).href).strings ?? {}; } catch { return {}; } };
const dict = lang == "ru" ? {} : load(lang);
const base = lang == "ru" ? {} : lang == "en" ? dict : load("en");

// t("ключ", a, b): подставляет {0}, {1}…; нет ключа в языке — английский, нет и там — сам ключ
export const t = (key, ...args) => (dict[key] ?? base[key] ?? key).replace(/\{(\d+)\}/g, (m, i) => args[i] ?? m);

// Разметка страниц (подробно — docs/areas/i18n.md):
//   data-lumi-l10n="ключ" или без значения (ключ = исходный текст элемента, у элемента не должно быть детей);
//   data-lumi-l10n-title / -placeholder / -aria-label — то же для одноимённого атрибута (без значения — ключ = исходное значение атрибута).
// Исходный текст запоминается при первом вызове, поэтому localize() можно звать повторно. В ru пустые (неявные) ключи не трогаем.
const ATTRS = ["title", "placeholder", "aria-label"];
const memo = new WeakMap();
const keyOf = (e, kind, explicit, read) => explicit || ((memo.get(e) ?? memo.set(e, {}).get(e))[kind] ??= read());
export function localize(root) {
  const doc = root.ownerDocument ?? root;
  if (doc.documentElement) { doc.documentElement.lang = lang; doc.documentElement.dir = dir; }
  for (const e of root.querySelectorAll("[data-lumi-l10n]")) {
    const explicit = e.getAttribute("data-lumi-l10n");
    if (!explicit && lang == "ru") continue;
    e.textContent = t(keyOf(e, "", explicit, () => e.textContent.trim()));
  }
  for (const a of ATTRS) for (const e of root.querySelectorAll(`[data-lumi-l10n-${a}]`)) {
    const explicit = e.getAttribute(`data-lumi-l10n-${a}`);
    if (!explicit && lang == "ru") continue;
    e.setAttribute(a, t(keyOf(e, a, explicit, () => e.getAttribute(a) ?? "")));
  }
}
