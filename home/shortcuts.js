// Ярлыки на первом экране Home (#lumi-shortcuts): плитки из папки закладок (pref luminoctis.home.shortcuts.folder — guid папки,
// пусто — панель закладок). Клик — новая вкладка, средняя кнопка и Ctrl+клик — фоновая. Список обновляется, когда закладки меняются.
const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
const win = window.browsingContext.topChromeWindow;
const root = document.getElementById("lumi-shortcuts");
const PREF = "luminoctis.home.shortcuts.folder", MAX = 24;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const folder = () => Services.prefs.getStringPref(PREF, "") || PlacesUtils.bookmarks.toolbarGuid;
let seq = 0;
async function render() {
  const my = ++seq;
  let tiles = [];
  try {
    const tree = await PlacesUtils.promiseBookmarksTree(folder());
    tiles = (tree.children ?? []).filter(c => c.type == PlacesUtils.TYPE_X_MOZ_PLACE && /^https?:|^file:|^about:/.test(c.uri)).slice(0, MAX);
  } catch {} // папку удалили — как пустая
  if (my != seq) return;
  if (!tiles.length) {
    const hint = el("p", "lumi-shortcuts-hint", "Здесь будут ваши ярлыки: добавьте закладки в выбранную папку или выберите другую в Настройки → Home → Ярлыки.");
    return root.replaceChildren(hint);
  }
  root.replaceChildren(...tiles.map(t => {
    const a = el("a", "lumi-tile");
    a.href = t.uri;
    a.dataset.url = t.uri;
    a.title = t.uri;
    a.append(Object.assign(el("img", "lumi-tile-icon"), { src: "page-icon:" + t.uri, alt: "" }), el("span", "lumi-tile-title", t.title || t.uri.replace(/^https?:\/\/(www\.)?/, "")));
    return a;
  }));
}
const open = (a, background) => win.openTrustedLinkIn(a.dataset.url, "tab", { inBackground: background });
root.addEventListener("click", e => {
  const a = e.target.closest(".lumi-tile");
  if (!a) return;
  e.preventDefault();
  open(a, e.ctrlKey || e.metaKey);
});
root.addEventListener("auxclick", e => {
  const a = e.target.closest(".lumi-tile");
  if (a && e.button == 1) { e.preventDefault(); open(a, true); }
});

// живое обновление: любые правки закладок → одна перерисовка через 200 мс
let timer = 0;
const later = () => { clearTimeout(timer); timer = setTimeout(render, 200); };
const events = ["bookmark-added", "bookmark-removed", "bookmark-moved", "bookmark-title-changed", "bookmark-url-changed"];
PlacesUtils.observers.addListener(events, later);
Services.prefs.addObserver(PREF, later);
window.addEventListener("unload", () => {
  PlacesUtils.observers.removeListener(events, later);
  Services.prefs.removeObserver(PREF, later);
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) later(); });
window.lumiShortcuts = { render, folder, get tiles() { return [...root.querySelectorAll(".lumi-tile")]; } };
render();
