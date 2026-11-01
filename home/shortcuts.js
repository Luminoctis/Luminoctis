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
  const plus = el("button", "lumi-add", "+"); // плитка «+» в конце ряда
  plus.type = "button";
  plus.title = "Добавить ярлык";
  plus.setAttribute("aria-label", "Добавить ярлык");
  if (!tiles.length) {
    const hint = el("p", "lumi-shortcuts-hint", "Здесь будут ваши ярлыки: добавьте закладки в выбранную папку или выберите другую в Настройки → Home → Ярлыки.");
    return root.replaceChildren(hint, plus);
  }
  root.replaceChildren(...tiles.map(t => {
    const a = el("a", "lumi-tile");
    a.href = t.uri;
    a.dataset.url = t.uri;
    a.title = t.uri;
    a.append(Object.assign(el("img", "lumi-tile-icon"), { src: "page-icon:" + t.uri, alt: "" }), el("span", "lumi-tile-title", t.title || t.uri.replace(/^https?:\/\/(www\.)?/, "")));
    return a;
  }), ...(tiles.length < MAX ? [plus] : []));
}

// окошко «+»: адрес (обязательно) и название (можно пустое → домен) → закладка в папке ярлыков
const addUrl = raw => { // без схемы — https://; нужен нормальный хост (домен.зона, localhost или IP)
  const t = raw.trim();
  if (!t || /\s/.test(t)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : "https://" + t);
    return /^(localhost|\d{1,3}(\.\d{1,3}){3}|.+\..{2,})$/.test(u.hostname) ? u.href : null;
  } catch { return null; }
};
function openAdd() {
  if (document.querySelector(".lumi-add-back")) return;
  const back = el("div", "lumi-add-back"), box = el("form", "lumi-add-box");
  const field = (label, ph) => { const l = el("label", "lumi-add-field"), i = el("input"); i.type = "text"; i.placeholder = ph; i.spellcheck = false; l.append(el("span", null, label), i); return [l, i]; };
  const [l1, url] = field("Адрес", "example.com"), [l2, name] = field("Название", "можно оставить пустым");
  const ok = el("button", "lumi-add-ok", "Добавить"), no = el("button", "lumi-add-cancel", "Отмена");
  ok.type = "submit";
  no.type = "button";
  const row = el("div", "lumi-add-row");
  row.append(no, ok);
  box.append(el("h3", null, "Новый ярлык"), l1, l2, row);
  back.append(box);
  const done = () => { back.remove(); document.removeEventListener("keydown", esc, true); };
  const esc = e => { if (e.key == "Escape") { e.preventDefault(); e.stopPropagation(); done(); } };
  document.addEventListener("keydown", esc, true);
  back.addEventListener("mousedown", e => { if (e.target == back) done(); });
  no.onclick = done;
  url.addEventListener("input", () => url.classList.remove("bad"));
  box.addEventListener("submit", async e => {
    e.preventDefault();
    const href = addUrl(url.value);
    if (!href) { url.classList.add("bad"); url.focus(); return; }
    try {
      await PlacesUtils.bookmarks.insert({ parentGuid: folder(), url: href, title: name.value.trim() || new URL(href).hostname.replace(/^www\./, "") });
    } catch { url.classList.add("bad"); return; } // папки нет и т. п.
    done();
  });
  document.body.append(back);
  url.focus();
}
root.addEventListener("click", e => { if (e.target.closest(".lumi-add")) openAdd(); });
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
