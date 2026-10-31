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
// Свои темы (2026-10-30): luminoctis.look.themes = JSON [{id, name, colors:{токен:"#hex"}}], выбираются как "custom:<id>".
// Правки цветов сохраняются прямо в тему; встроенные темы не меняются (их правки — luminoctis.palette.<id>.<токен>, как раньше).
export const THEMES = "luminoctis.look.themes";
export const customThemes = () => {
  try {
    const a = JSON.parse(Services.prefs.getStringPref(THEMES, "[]"));
    return Array.isArray(a) ? a.filter(x => x && typeof x.id == "string" && typeof x.name == "string" && x.colors && typeof x.colors == "object") : [];
  } catch { return []; } // битый JSON — как будто своих тем нет
};
export const isCustom = id => typeof id == "string" && id.startsWith("custom:");
const theme = id => customThemes().find(x => "custom:" + x.id == id);
const saveThemes = list => Services.prefs.setStringPref(THEMES, JSON.stringify(list));
export const presetId = () => { const id = Services.prefs.getStringPref(PREF, ""); return PRESETS[id] || theme(id) ? id : "tokyo-night"; };
const own = (id, t) => Services.prefs.getStringPref(`${PREF}.${id}.${t}`, "").toLowerCase();
// правки хранятся у каждой палитры свои: смена палитры их не теряет
export function colors(id = presetId()) {
  const th = theme(id), base = PRESETS["tokyo-night"].colors;
  if (th) return Object.fromEntries(TOKENS.map((t, i) => [t, HEX.test(th.colors[t]) ? th.colors[t] : base[i]]));
  return Object.fromEntries(TOKENS.map((t, i) => [t, HEX.test(own(id, t)) ? own(id, t) : PRESETS[id].colors[i]])); // кривое значение из about:config не ломает цвета
}
export const edited = (id = presetId()) => theme(id) ? [] : TOKENS.filter(t => HEX.test(own(id, t)));
// новая своя тема = копия текущих цветов (с правками); сразу выбирается
export function createTheme(name) {
  const id = Math.random().toString(36).slice(2, 10);
  saveThemes([...customThemes(), { id, name: name.trim() || defaultThemeName(), colors: colors() }]);
  choose("custom:" + id);
  return "custom:" + id;
}
export const defaultThemeName = () => {
  const names = new Set(customThemes().map(x => x.name));
  let n = 1;
  while (names.has(n == 1 ? "Моя тема" : "Моя тема " + n)) n++;
  return n == 1 ? "Моя тема" : "Моя тема " + n;
};
export function renameTheme(id, name) {
  if (name.trim()) saveThemes(customThemes().map(x => "custom:" + x.id == id ? { ...x, name: name.trim() } : x));
}
export function deleteTheme(id) {
  saveThemes(customThemes().filter(x => "custom:" + x.id != id));
  if (Services.prefs.getStringPref(PREF, "") == id) choose("tokyo-night");
}

const docs = new Set();
// цвет акцента из обоев Home (home/wallpaper.js пишет accentOverride; действует, пока включён luminoctis.home.accentFromWallpaper)
const FROM_WALL = "luminoctis.home.accentFromWallpaper";
const override = () => Services.prefs.getBoolPref(FROM_WALL, false) && Services.prefs.getStringPref(`${PREF}.accentOverride`, "").toLowerCase();
// Режим окна (settings → «Оформление»): luminoctis.look.window = opaque | transparent | wallpaper. transparent — фоны интерфейса полупрозрачные,
// сквозь них видна подложка Windows; wallpaper — сквозь них обои Home на всех вкладках (js/lumi-home.uc.js). Сайты не трогаются.
// Вид подложки в прозрачном режиме — luminoctis.look.blur-kind: none | blur (accent policy окна — js/lumi-home-live.uc.js) | acrylic | mica (родная подложка Zen).
const LOOK = "luminoctis.look.";
const SEE = [LOOK + "transparency", 45]; // [pref, по умолчанию]
Services.prefs.clearUserPref(LOOK + "blur"); // ползунок размытия панелей убран (2026-10-30): сайт под ними всё равно не размывается
// отдельная прозрачность выехавших панелей Compacting (рейка, полоса вкладок, адресная строка), только в прозрачном режиме окна
const COMPACT = "luminoctis.compact.transparency";
const int = ([pref, def], max) => Math.min(max, Math.max(0, Services.prefs.getIntPref(pref, def)));
const WIN = LOOK + "window", KIND = LOOK + "blur-kind", HOME_MODE = "luminoctis.home.wallpaper.mode", MICA = "widget.windows.mica.toplevel-backdrop";
const pr = Services.prefs;
export const windowMode = () => { const m = pr.getStringPref(WIN, ""); return m == "transparent" || m == "wallpaper" ? m : "opaque"; };
export const blurKind = () => { const k = pr.getStringPref(KIND, "acrylic"); return ["none", "blur", "mica"].includes(k) ? k : "acrylic"; };
const isGlass = () => windowMode() != "opaque";
// разовая миграция (2026-10-30): «Размыть то, что за окном» → blur-kind=blur (если окно прозрачное), Mica в старом переключателе → blur-kind=mica
if (!pr.getBoolPref(LOOK + "modes-migrated", false)) {
  pr.setBoolPref(LOOK + "modes-migrated", true);
  if (!pr.prefHasUserValue(KIND)) {
    if (pr.getBoolPref("luminoctis.home.through.blur", false) && pr.getStringPref(WIN, "") == "transparent") pr.setStringPref(KIND, "blur");
    else if (pr.prefHasUserValue(MICA) && pr.getIntPref(MICA, 2) == 1) pr.setStringPref(KIND, "mica");
  }
  pr.clearUserPref("luminoctis.home.through.blur");
}
// «Обои» возможны, только пока у Home режим обоев; Home переключили — окно откатывается на «Прозрачный». Родная подложка Zen: acrylic = 2, mica = 1
// (для none/blur — 2, как проверено глазами: под accent policy окна)
function sync() {
  if (windowMode() == "wallpaper" && pr.getStringPref(HOME_MODE, "wallpaper") != "wallpaper") pr.setStringPref(WIN, "transparent");
  const back = blurKind() == "mica" ? 1 : 2;
  if (pr.getIntPref(MICA, 2) != back) pr.setIntPref(MICA, back);
}
sync();
// чем выше слой, тем плотнее: текст на поверхностях и выбранном остаётся читаемым
const LIFT = { bg0: 0, bg1: 0, surface: 15, raised: 25 };
const glassDocs = new WeakSet(); // окна и панель настроек; Home и заглушка фокуса — страницы во вкладке, остаются непрозрачными
const paint = doc => {
  const c = colors(), o = override(), root = doc.documentElement;
  if (HEX.test(o)) c.accent = o;
  const glass = glassDocs.has(doc) && isGlass(), solid = 100 - int(SEE, 90);
  for (const t of TOKENS) root.style.setProperty(`--lumi-${t}`,
    glass && t in LIFT ? `color-mix(in srgb, ${c[t]} ${Math.min(100, solid + LIFT[t])}%, transparent)` : c[t]);
  const cs = glass ? 100 - Math.min(90, Math.max(0, Services.prefs.getIntPref(COMPACT, 45))) : 100; // в непрозрачном режиме — сплошные
  for (const [v, t] of [["compact-bg", "bg0"], ["compact-bg1", "bg1"]]) root.style.setProperty(`--lumi-${v}`, cs == 100 ? c[t] : `color-mix(in srgb, ${c[t]} ${cs}%, transparent)`);
  root.style.setProperty("--lumi-solid", c.bg0); // непрозрачный bg0: текст на акценте, подложка сайтов
  root.toggleAttribute("lumi-glass", glass);
  root.toggleAttribute("lumi-wallpaper", glass && windowMode() == "wallpaper");
};
let queued = null; // «Сбросить палитру» меняет много настроек — перекрашиваем один раз
const repaint = () => queued ||= Promise.resolve().then(() => { queued = null; docs.forEach(paint); });
Services.prefs.addObserver(PREF, repaint);
Services.prefs.addObserver(FROM_WALL, repaint);
Services.prefs.addObserver(LOOK, () => { sync(); repaint(); });
Services.prefs.addObserver(HOME_MODE, sync);
Services.prefs.addObserver(COMPACT, repaint);
// glass: документ — интерфейс браузера (окно, панель настроек) и становится прозрачным в прозрачном режиме
export function watch(doc, { glass = false } = {}) {
  docs.add(doc);
  if (glass) glassDocs.add(doc);
  paint(doc);
  doc.defaultView.addEventListener("unload", () => docs.delete(doc), { once: true });
}

export const choose = id => Services.prefs.setStringPref(PREF, id);
export const resetColor = t => { if (!isCustom(presetId())) Services.prefs.clearUserPref(`${PREF}.${presetId()}.${t}`); };
export function setColor(t, hex) {
  const id = presetId();
  if (isCustom(id)) { saveThemes(customThemes().map(x => "custom:" + x.id == id ? { ...x, colors: { ...x.colors, [t]: hex } } : x)); return; }
  if (hex == PRESETS[id].colors[TOKENS.indexOf(t)]) resetColor(t); // вернули цвет палитры — правки больше нет
  else Services.prefs.setStringPref(`${PREF}.${id}.${t}`, hex);
}
export const resetPalette = () => isCustom(presetId()) || Services.prefs.getChildList(`${PREF}.${presetId()}.`).forEach(n => Services.prefs.clearUserPref(n));

// Окно «Библиотека» Firefox (places.xhtml, Ctrl+Shift+O) — отдельное, скрипты fx-autoconfig до него не доходят (ждут второй DOMContentLoaded).
// Красим его отсюда; стили — chrome.css раздел 16. windowsmica — подложка Windows, как у главного окна: без неё в прозрачном режиме под фоном чёрное.
const PLACES = "chrome://browser/content/places/places.xhtml";
Services.wm.addListener({
  onOpenWindow(appWin) {
    const win = appWin.docShell.domWindow;
    win.addEventListener("load", () => {
      if (win.location.href != PLACES) return;
      win.document.documentElement.setAttribute("windowsmica", "true");
      watch(win.document, { glass: true });
    }, { once: true });
  },
  onCloseWindow() {},
});
