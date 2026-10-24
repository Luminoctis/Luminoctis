// ==UserScript==
// @name           Luminoctis: палитры
// @description    Цвета мода: 8 готовых палитр и правка каждого цвета (настройки luminoctis.palette.*); применяет их сразу во всех окнах и в панели настроек.
// ==/UserScript==

// Один экземпляр на всё приложение: окна (js/lumi-rail.uc.js) и панель настроек импортируют его по одному адресу
// chrome://userscripts/content/lumi-palette.sys.mjs. Цвета ставятся переменными --lumi-<токен> на корень документа,
// значения Tokyo Night в chrome.css — запасные (если скрипты не загрузились).
export const TOKENS = ["bg0", "bg1", "surface", "raised", "fg", "muted", "dim", "accent",
  "blue", "cyan", "teal", "green", "yellow", "orange", "red", "pink", "purple"];
// подписи для панели настроек, по группам
export const GROUPS = [
  ["Фон", { bg0: "Фон окна", bg1: "Рейка и вкладки", surface: "Поверхности", raised: "Выбранное" }],
  ["Текст", { fg: "Текст", muted: "Приглушённый текст", dim: "Тусклый текст" }],
  ["Акцент", { accent: "Акцент" }],
  ["Цвета", { blue: "Синий", cyan: "Голубой (ссылки)", teal: "Бирюзовый", green: "Зелёный", yellow: "Жёлтый",
    orange: "Оранжевый", red: "Красный", pink: "Розовый", purple: "Фиолетовый" }],
];
const p = (name, s) => ({ name, colors: s.split(" ") }); // цвета — в порядке TOKENS
export const PRESETS = {
  "tokyo-night": p("Tokyo Night", "#16161e #1a1b26 #1f2335 #24283b #c0caf5 #a9b1d6 #565f89 #7aa2f7 #7aa2f7 #7dcfff #73daca #9ece6a #e0af68 #ff9e64 #f7768e #ff007c #bb9af7"),
  "tokyo-night-storm": p("Tokyo Night Storm", "#1f2335 #24283b #292e42 #3b4261 #c0caf5 #a9b1d6 #565f89 #7aa2f7 #7aa2f7 #7dcfff #73daca #9ece6a #e0af68 #ff9e64 #f7768e #ff007c #bb9af7"),
  "catppuccin-mocha": p("Catppuccin Mocha", "#11111b #181825 #1e1e2e #313244 #cdd6f4 #a6adc8 #6c7086 #cba6f7 #89b4fa #89dceb #94e2d5 #a6e3a1 #f9e2af #fab387 #f38ba8 #f5c2e7 #cba6f7"),
  "dracula": p("Dracula", "#191a21 #21222c #282a36 #44475a #f8f8f2 #cbd0db #6272a4 #bd93f9 #6272a4 #8be9fd #8be9fd #50fa7b #f1fa8c #ffb86c #ff5555 #ff79c6 #bd93f9"),
  "nord": p("Nord", "#2e3440 #3b4252 #434c5e #4c566a #eceff4 #d8dee9 #616e88 #88c0d0 #81a1c1 #88c0d0 #8fbcbb #a3be8c #ebcb8b #d08770 #bf616a #b48ead #b48ead"),
  "gruvbox-dark": p("Gruvbox Dark", "#1d2021 #282828 #32302f #3c3836 #ebdbb2 #bdae93 #928374 #fe8019 #83a598 #8ec07c #8ec07c #b8bb26 #fabd2f #fe8019 #fb4934 #d3869b #b16286"),
  "rose-pine": p("Rosé Pine", "#191724 #1f1d2e #26233a #403d52 #e0def4 #908caa #6e6a86 #ebbcba #9ccfd8 #c4a7e7 #31748f #95b1ac #f6c177 #f6c177 #eb6f92 #ebbcba #c4a7e7"),
  "one-dark": p("One Dark", "#21252b #282c34 #2c323c #3e4452 #abb2bf #828997 #5c6370 #61afef #61afef #56b6c2 #56b6c2 #98c379 #e5c07b #d19a66 #e06c75 #c678dd #c678dd"),
};
const PREF = "luminoctis.palette", HEX = /^#[0-9a-f]{6}$/;
export const presetId = () => { const id = Services.prefs.getStringPref(PREF, ""); return PRESETS[id] ? id : "tokyo-night"; };
const own = (id, t) => Services.prefs.getStringPref(`${PREF}.${id}.${t}`, "").toLowerCase();
// правки хранятся у каждой палитры свои: смена палитры их не теряет
export function colors(id = presetId()) {
  return Object.fromEntries(TOKENS.map((t, i) => [t, HEX.test(own(id, t)) ? own(id, t) : PRESETS[id].colors[i]])); // кривое значение из about:config не ломает цвета
}
export const edited = (id = presetId()) => TOKENS.filter(t => HEX.test(own(id, t)));

const docs = new Set();
// цвет акцента из обоев Home (home/wallpaper.js пишет accentOverride; действует, пока включён luminoctis.home.accentFromWallpaper)
const FROM_WALL = "luminoctis.home.accentFromWallpaper";
const override = () => Services.prefs.getBoolPref(FROM_WALL, false) && Services.prefs.getStringPref(`${PREF}.accentOverride`, "").toLowerCase();
// Режим окна (settings → «Внешний вид»): luminoctis.look.window = "transparent" — фоны интерфейса полупрозрачные,
// сквозь них видна подложка Windows (Acrylic/Mica, её даёт Zen: widget.windows.mica). Сайты не трогаются.
const LOOK = "luminoctis.look.";
export const GLASS = { see: [LOOK + "transparency", 45], blur: [LOOK + "blur", 24] }; // [pref, по умолчанию]
const int = ([pref, def], max) => Math.min(max, Math.max(0, Services.prefs.getIntPref(pref, def)));
const isGlass = () => Services.prefs.getStringPref(LOOK + "window", "") == "transparent";
// чем выше слой, тем плотнее: текст на поверхностях и выбранном остаётся читаемым
const LIFT = { bg0: 0, bg1: 0, surface: 15, raised: 25 };
const glassDocs = new WeakSet(); // окна и панель настроек; Home и заглушка фокуса — страницы во вкладке, остаются непрозрачными
const paint = doc => {
  const c = colors(), o = override(), root = doc.documentElement;
  if (HEX.test(o)) c.accent = o;
  const glass = glassDocs.has(doc) && isGlass(), solid = 100 - int(GLASS.see, 90);
  for (const t of TOKENS) root.style.setProperty(`--lumi-${t}`,
    glass && t in LIFT ? `color-mix(in srgb, ${c[t]} ${Math.min(100, solid + LIFT[t])}%, transparent)` : c[t]);
  root.style.setProperty("--lumi-solid", c.bg0); // непрозрачный bg0: текст на акценте, подложка сайтов
  root.style.setProperty("--lumi-glass-blur", int(GLASS.blur, 60) + "px");
  root.toggleAttribute("lumi-glass", glass);
};
let queued = null; // «Сбросить палитру» меняет много настроек — перекрашиваем один раз
const repaint = () => queued ||= Promise.resolve().then(() => { queued = null; docs.forEach(paint); });
Services.prefs.addObserver(PREF, repaint);
Services.prefs.addObserver(FROM_WALL, repaint);
Services.prefs.addObserver(LOOK, repaint);
// glass: документ — интерфейс браузера (окно, панель настроек) и становится прозрачным в прозрачном режиме
export function watch(doc, { glass = false } = {}) {
  docs.add(doc);
  if (glass) glassDocs.add(doc);
  paint(doc);
  doc.defaultView.addEventListener("unload", () => docs.delete(doc), { once: true });
}

export const choose = id => Services.prefs.setStringPref(PREF, id);
export const resetColor = t => Services.prefs.clearUserPref(`${PREF}.${presetId()}.${t}`);
export function setColor(t, hex) {
  const id = presetId();
  if (hex == PRESETS[id].colors[TOKENS.indexOf(t)]) resetColor(t); // вернули цвет палитры — правки больше нет
  else Services.prefs.setStringPref(`${PREF}.${id}.${t}`, hex);
}
export const resetPalette = () => Services.prefs.getChildList(`${PREF}.${presetId()}.`).forEach(n => Services.prefs.clearUserPref(n));
