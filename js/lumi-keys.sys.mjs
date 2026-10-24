// ==UserScript==
// @name           Luminoctis: шорткаты
// @description    Сочетания шорткатов мода (настройки luminoctis.keys.*): значения по умолчанию, проверка нажатия и подписи для панели настроек.
// ==/UserScript==

// Один экземпляр на всё приложение (chrome://userscripts/content/lumi-keys.sys.mjs): его берут рейка, полоса вкладок и панель настроек.
// Сочетание — строка: модификаторы (ctrl, alt, shift, meta) и кнопка мыши (left, middle, right) или клавиша (event.key) через «+»:
// "shift+right", "Tab", "ctrl+alt+k". Значения по умолчанию — на ветке по умолчанию: «сбросить» — просто clearUserPref.
export const KEYS = {
  unload: { combo: "shift+right", mouse: true }, // выгрузить вкладку или закреп
  inter: { combo: "Tab", mouse: false },         // открыть / закрыть Luminoctis Home (js/lumi-home.uc.js)
};
const PREF = "luminoctis.keys.";
const defaults = Services.prefs.getDefaultBranch(PREF);
for (const [name, { combo }] of Object.entries(KEYS)) defaults.setStringPref(name, combo);
export const pref = name => PREF + name;
export const get = name => Services.prefs.getStringPref(PREF + name, KEYS[name].combo);

const MODS = ["ctrl", "alt", "shift", "meta"];
const BUTTONS = ["left", "middle", "right"];
const mods = e => MODS.filter(m => e[m + "Key"]);
// Мышь: левая — click, средняя — auxclick, правая — contextmenu (auxclick правой кнопки приходит вдобавок — его не считаем).
// Меню с клавиатуры (Shift+F10) — не мышь. mousedown — для записи нового сочетания в настройках.
export function mouseCombo(e) {
  if (e.mozInputSource == e.MOZ_SOURCE_KEYBOARD) return null;
  const button = e.type == "contextmenu" ? 2 : e.type == "auxclick" && e.button == 2 ? -1 : e.button;
  return BUTTONS[button] ? [...mods(e), BUTTONS[button]].join("+") : null;
}
// клавиша с модификаторами; одно нажатие модификатора — ещё не сочетание
export const keyCombo = e => ["Control", "Alt", "Shift", "Meta", "OS"].includes(e.key) ? null : [...mods(e), e.key].join("+");
export const matches = (name, e) => (KEYS[name].mouse ? mouseCombo(e) : keyCombo(e)) == get(name);

const NAMES = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "Win", left: "ЛКМ", middle: "СКМ", right: "ПКМ", " ": "Space" };
export const label = combo => combo.split(/\+(?!$)/).map(p => NAMES[p] ?? (p.length == 1 ? p.toUpperCase() : p)).join(" + ");
