// Поиск на первом экране Home (#lumi-search): поисковик по умолчанию (Services.search), подсказки движка (SearchSuggestionController)
// и совпадения из истории/закладок (moz_places по frecency). Адрес/домен открывается сразу. Результат — в новой выбранной вкладке, Home остаётся.
// Клавиши: ↑/↓ по подсказкам, Enter, Esc (закрыть список, повторно — снять фокус).
// Ctrl+V с картинкой в буфере — сразу поиск по ней в Google Lens (POST multipart на lens.google.com/v3/upload, поле encoded_image), в новой вкладке.
const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
const win = window.browsingContext.topChromeWindow;
const root = document.getElementById("lumi-search");
// в Zen 1.23 (Firefox 14x) Services.search убран — служба в модуле SearchService; старый путь оставлен запасным
let SS;
try { SS = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs").SearchService; } catch { SS = Services.search; }
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const input = el("input", "lumi-search-input");
Object.assign(input, { type: "text", spellcheck: false, autocomplete: "off" });
input.setAttribute("role", "combobox");
input.setAttribute("aria-expanded", "false");
const list = el("ul", "lumi-search-list");
list.hidden = true;
list.setAttribute("role", "listbox");
root.replaceChildren(input, list);

let engine = null, controller = null, seq = 0, timer = 0, items = [], sel = -1;
async function init() {
  await SS.init();
  engine = await SS.getDefault();
  setHint();
}
let hintTimer = 0;
function setHint(msg, ms) { // подсказка в поле: msg на ms миллисекунд, иначе обычная
  clearTimeout(hintTimer);
  input.placeholder = msg || (engine ? `Искать в ${engine.name} или ввести адрес` : "");
  if (msg && ms) hintTimer = setTimeout(setHint, ms);
}
const ready = init().catch(e => console.error("Luminoctis поиск:", e));
const engineObs = { observe: () => init().catch(() => {}) };
Services.obs.addObserver(engineObs, "browser-search-engine-modified");
window.addEventListener("unload", () => Services.obs.removeObserver(engineObs, "browser-search-engine-modified"));

// «похоже на адрес»: со схемой, localhost, IPv4 или домен.зона без пробелов
const looksLikeUrl = t => !/\s/.test(t) && (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(t) || /^(localhost|\d{1,3}(\.\d{1,3}){3}|[^\s./]+(\.[^\s./]+)*\.[a-z\u0400-\u04ff]{2,})(:\d+)?([/?#]\S*)?$/i.test(t));
const urlFor = t => (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : "https://" + t);

async function searchUrl(term) {
  await ready;
  const sub = engine.getSubmission(term);
  return { url: sub.uri.spec, postData: sub.postData };
}
async function go(item, background = false) {
  const { url, postData } = item.url ? item : await searchUrl(item.term);
  win.openTrustedLinkIn(url, "tab", { postData, inBackground: background });
  clearTimeout(timer);
  input.value = ""; // после перехода строка пустая
  close();
}
const goText = async text => { // Enter без выбранной подсказки
  const t = text.trim();
  if (t) await go(looksLikeUrl(t) ? { url: urlFor(t) } : { term: t });
};

// поиск по картинке: тело multipart собирает FormData (Response отдаёт байты и Content-Type с boundary), в поток — без потери байтов
const MAX_IMG = 20 * 1024 * 1024;
async function lensRequest(file) {
  const bmp = await createImageBitmap(file); // не картинка — исключение
  const fd = new FormData();
  fd.append("encoded_image", file, "image");
  fd.append("processed_image_dimensions", `${bmp.width},${bmp.height}`);
  bmp.close();
  const r = new Response(fd), buf = await r.arrayBuffer();
  const bin = Cc["@mozilla.org/io/arraybuffer-input-stream;1"].createInstance(Ci.nsIArrayBufferInputStream);
  bin.setData(buf, 0, buf.byteLength);
  const postData = Cc["@mozilla.org/network/mime-input-stream;1"].createInstance(Ci.nsIMIMEInputStream);
  postData.addHeader("Content-Type", r.headers.get("content-type"));
  postData.setData(bin);
  return { url: `https://lens.google.com/v3/upload?hl=${Services.locale.appLocaleAsBCP47}&re=df&st=${Date.now()}&ep=gisbubb`, postData };
}
async function searchImage(file) {
  if (file.size > MAX_IMG) return setHint("Картинка больше 20 МБ", 3000);
  setHint("Ищу по картинке…");
  try {
    const { url, postData } = await lensRequest(file);
    win.openTrustedLinkIn(url, "tab", { postData });
    clearTimeout(timer);
    input.value = "";
    close();
    setHint();
  } catch (e) {
    console.error("Luminoctis поиск по картинке:", e);
    setHint("Не удалось отправить картинку", 3000);
  }
}

function close() { list.hidden = true; input.setAttribute("aria-expanded", "false"); sel = -1; seq++; controller?.stop(); }
function paint() {
  list.replaceChildren(...items.map((it, i) => {
    const li = el("li", "lumi-search-item" + (i == sel ? " sel" : ""));
    li.setAttribute("role", "option");
    li.dataset.i = i;
    const icon = it.url ? Object.assign(el("img", "lumi-search-icon"), { src: "page-icon:" + it.url, alt: "" }) : el("span", "lumi-search-icon", "⌕");
    li.append(icon, el("span", "lumi-search-text", it.title || it.term || it.url));
    if (it.url) li.append(el("span", "lumi-search-sub", it.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")));
    return li;
  }));
  list.hidden = !items.length;
  input.setAttribute("aria-expanded", String(!list.hidden));
}
async function localMatches(q) {
  try {
    const db = await PlacesUtils.promiseDBConnection();
    const rows = await db.executeCached(`SELECT url, title FROM moz_places WHERE hidden = 0 AND (frecency > 0 OR foreign_count > 0) AND url LIKE :h
      AND (title LIKE :q OR url LIKE :q) ORDER BY foreign_count > 0 DESC, frecency DESC LIMIT 4`, { h: "http%", q: `%${q.replace(/[%_\\]/g, "")}%` });
    return rows.map(r => ({ url: r.getResultByName("url"), title: r.getResultByName("title") }));
  } catch { return []; }
}
async function suggest() {
  const q = input.value.trim(), my = ++seq;
  if (!q) return close();
  const base = looksLikeUrl(q) ? { url: urlFor(q), title: q } : { term: q, title: q };
  items = [base];
  sel = -1;
  paint();
  await ready;
  if (!engine) return;
  let local = [], remote = [];
  const show = () => { // закладки/история приходят сразу, не дожидаясь сети; подсказки движка — когда ответит
    if (my != seq) return; // пока ждали, ввод поменялся
    items = [base, ...remote.map(term => ({ term, title: term })), ...local.filter(l => l.url != base.url)].slice(0, 9);
    paint();
  };
  localMatches(q).then(r => { local = r; show(); });
  try {
    if (!controller) {
      let m;
      try { m = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchSuggestionController.sys.mjs"); }
      catch { m = ChromeUtils.importESModule("resource://gre/modules/SearchSuggestionController.sys.mjs"); }
      controller = new m.SearchSuggestionController();
    }
    const r = await controller.fetch({ searchString: q, inPrivateBrowsing: false, engine, maxLocalResults: 2, maxRemoteResults: 6 });
    remote = [...r.local, ...r.remote].map(e => e.value).filter(v => v && v != q);
    show();
  } catch {}
}

function onPaste(e) {
  const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith("image/"));
  if (!file) return; // текст вставляется как обычно
  e.preventDefault();
  searchImage(file);
}
input.addEventListener("paste", onPaste);
input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(suggest, 120); });
input.addEventListener("keydown", e => {
  if (e.key == "ArrowDown" || e.key == "ArrowUp") {
    if (list.hidden) return;
    e.preventDefault();
    sel = e.key == "ArrowDown" ? (sel + 1 >= items.length ? -1 : sel + 1) : (sel < 0 ? items.length - 1 : sel - 1);
    paint();
  } else if (e.key == "Enter") {
    e.preventDefault();
    clearTimeout(timer);
    sel >= 0 && items[sel] ? go(items[sel], e.ctrlKey || e.metaKey) : goText(input.value);
  } else if (e.key == "Escape") {
    e.preventDefault();
    e.stopPropagation();
    if (!list.hidden) close(); else input.blur();
  }
});
list.addEventListener("mousedown", e => e.preventDefault()); // клик по подсказке не снимает фокус раньше времени
list.addEventListener("click", e => {
  const li = e.target.closest(".lumi-search-item");
  if (li) go(items[Number(li.dataset.i)]);
});
input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement != input) close(); }, 100));
input.addEventListener("focus", () => { if (input.value.trim() && list.hidden) suggest(); });

// фокус при показе Home — только если пользователь ничем другим не занят (адресная строка, панель настроек, другое окно)
const canFocus = () => {
  if (document.hidden || document.body.hasAttribute("lumi-hide-search")) return false;
  const a = win.document.activeElement;
  return Services.focus.activeWindow == win && !win.gURLBar?.focused && (!a || a == win.gBrowser.selectedBrowser || a == win.document.body);
};
document.addEventListener("visibilitychange", () => { if (canFocus()) input.focus(); });

window.lumiSearch = { onPaste, lensRequest, searchImage, input, items: () => items, select: i => { sel = i; paint(); }, go, goText, suggest, looksLikeUrl, urlFor, canFocus,
  get engine() { return engine; }, ready, list };
