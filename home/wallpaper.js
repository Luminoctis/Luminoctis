// Обои Luminoctis Home (#lumi-wallpaper): два слоя с плавной сменой, следующая картинка загружается заранее.
// Источники: Wallhaven, Konachan (safe), картинка дня Bing, своя папка (картинки/gif/mp4/webm), избранное.
// Данные (home/store.js): wallpapers/state.json (текущие + очередь), favorites.json + favorites/<файлы>, bans.json.
// Настройки: luminoctis.home.wallpaper.* (+ luminoctis.home.accentFromWallpaper — цвет акцента мода из обоев).
// Wallpaper Engine (home/we.js): источник "we", виды "web" (страница без прав браузера) и "scene" (превью); эквалайзер — home/equalizer.js.
// Новый вид обоев — registerKind(name, { create(src, item), ready(el) }).
import * as store from "./store.js";
import * as we from "./we.js";

const P = "luminoctis.home.wallpaper.", ACCENT = "luminoctis.home.accentFromWallpaper", OVERRIDE = "luminoctis.palette.accentOverride";
const prefs = Services.prefs;
const bool = (n, d = false) => prefs.getBoolPref(P + n, d), int = (n, d) => prefs.getIntPref(P + n, d), str = (n, d = "") => prefs.getStringPref(P + n, d);
const win = window.browsingContext.topChromeWindow;
const FAV = "wallpapers/favorites.json", BANS = "wallpapers/bans.json", STATE = "wallpapers/state.json";
const key = it => it && `${it.source}:${it.id}`;

// ---------- виды обоев: как элемент получается из адреса ----------
export const kinds = {
  image: { create: src => Object.assign(new Image(), { src, decoding: "async", alt: "" }), ready: el => el.decode() },
  video: {
    create: src => Object.assign(document.createElement("video"), { src, muted: true, loop: true, autoplay: true, playsInline: true, preload: "auto" }),
    ready: el => new Promise((ok, fail) => { el.onloadeddata = ok; el.onerror = () => fail(new Error("видео не открылось")); }),
  },
  ...we.kinds,
};
we.init();
export const registerKind = (name, impl) => (kinds[name] = impl);

// ---------- источники: каждый возвращает список { source, id, kind, url|file, page, author } ----------
const IMG = /\.(jpe?g|png|webp|gif|avif|bmp)$/i, VID = /\.(mp4|webm)$/i;
async function json(url) {
  const r = await fetch(url, { credentials: "omit" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
const words = () => str("query").trim();
export const sources = {
  async wallhaven() { // без ключа: только SFW (purity 100), лимит 45 запросов в минуту — берём страницу из 24 за раз
    const q = new URLSearchParams({ q: words(), categories: { anime: "010", general: "100" }[str("category", "all")] ?? "110",
      purity: "100", sorting: str("sorting", "random") == "toplist" ? "toplist" : "random", ratios: "landscape" });
    const { data } = await json("https://wallhaven.cc/api/v1/search?" + q);
    return data.map(w => ({ source: "wallhaven", id: w.id, kind: "image", url: w.path, page: w.url }));
  },
  async konachan() { // konachan.net — безопасное зеркало; rating:safe ещё и в запросе
    const tags = ["rating:safe", ...words().split(/\s+/).filter(Boolean).slice(0, 4), str("sorting", "random") == "toplist" ? "order:score" : "order:random"];
    const posts = await json(`https://konachan.net/post.json?limit=40&tags=${encodeURIComponent(tags.join(" "))}`);
    return posts.filter(p => p.rating == "s" && p.width > p.height).map(p => ({ source: "konachan", id: String(p.id), kind: "image",
      url: new URL(p.jpeg_url || p.file_url, "https://konachan.net").href, page: `https://konachan.net/post/show/${p.id}`, author: p.author }));
  },
  async bing() {
    const { images } = await json("https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=ru-RU");
    return images.map(i => ({ source: "bing", id: i.startdate, kind: "image", url: `https://www.bing.com${i.urlbase}_UHD.jpg`,
      page: i.copyrightlink, author: i.copyright }));
  },
  async we() { // Wallpaper Engine: все обои папки мастерской, кроме снятых галочкой в настройках (we.off — id через запятую)
    const off = new Set(str("we.off").split(",").filter(Boolean));
    return (await we.list()).filter(i => !off.has(i.id));
  },
  async local() {
    const dir = str("folder").trim();
    if (!dir) return [];
    return (await IOUtils.getChildren(dir)).filter(f => IMG.test(f) || VID.test(f))
      .map(f => ({ source: "local", id: PathUtils.filename(f), kind: VID.test(f) ? "video" : "image", file: f, page: f }));
  },
};
export const SOURCES = Object.keys(sources);
const sourceOn = s => bool("src." + s, s == "wallhaven");

// ---------- состояние ----------
let state = { current: null, shownAt: 0, queue: [] };
let favs = [], bans = new Set(); // favs = null — favorites.json битый: избранное не трогаем, чтобы не затереть
const favFile = f => store.path("wallpapers/favorites/" + f.file);
const fromFav = f => ({ ...f, file: favFile(f) });
const save = () => store.writeJSON(STATE, state).catch(e => console.error("Luminoctis обои:", e));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function refill() {
  let list;
  if (bool("favoritesOnly")) list = (favs ?? []).map(fromFav);
  else list = (await Promise.allSettled(SOURCES.filter(sourceOn).map(s => sources[s]()))).flatMap(r => {
    if (r.status == "rejected") console.warn("Luminoctis обои: источник недоступен", r.reason);
    return r.value ?? [];
  });
  const fresh = list.filter(i => !bans.has(key(i)));
  state.queue = shuffle(fresh.length > 1 ? fresh.filter(i => key(i) != key(state.current)) : fresh);
}
async function nextItem() {
  if (!state.queue.length) await refill();
  return state.queue.shift() ?? null;
}

// ---------- слои ----------
const root = document.getElementById("lumi-wallpaper");
const stage = Object.assign(document.createElement("div"), { className: "lumi-wp-stage" });
const dim = Object.assign(document.createElement("div"), { className: "lumi-wp-dim" });
const bar = Object.assign(document.createElement("nav"), { className: "lumi-wp-controls" });
let current = null, pending = null; // показанный слой и обещание следующего

async function load(item) {
  let blob = null, src;
  if (item.file) src = PathUtils.toFileURI(item.file);
  else { // картинка из сети — сначала blob: её можно сохранить в избранное и прочитать цвет без «чужого» холста
    const r = await fetch(item.url, { credentials: "omit" });
    if (!r.ok) throw new Error(`${item.url}: ${r.status}`);
    blob = await r.blob();
    src = URL.createObjectURL(blob);
  }
  const kind = kinds[item.kind] ?? kinds.image;
  const el = kind.create(src, item);
  try { await kind.ready(el); } catch (e) { if (blob) URL.revokeObjectURL(src); throw e; }
  return { item, el, blob, src };
}
const drop = layer => { layer.box?.remove(); if (layer.blob) URL.revokeObjectURL(layer.src); };
const preload = () => (pending = nextItem().then(it => it && load(it)).catch(e => (console.warn("Luminoctis обои:", e), null)));

function show(layer) {
  const box = layer.box = Object.assign(document.createElement("div"), { className: "lumi-wp-layer" });
  box.append(layer.el);
  stage.append(box);
  if (layer.el.play && !document.hidden) layer.el.play().catch(() => {});
  box.getBoundingClientRect(); // старт перехода прозрачности
  box.classList.add("on");
  const old = current;
  current = layer;
  if (old) setTimeout(() => drop(old), 900);
  state.current = layer.item;
  state.shownAt = Date.now();
  save();
  syncButtons();
  applyAccent();
  effects(); // параллакс выключается для веб-обоев — мышь им нужна самим
}
// показать выбранные обои сейчас (выбор Wallpaper Engine в настройках)
export async function showItem(item) {
  show(await load(item));
  return true;
}

// следующая картинка; не открылась — пробуем ещё (до 4 раз), нет ничего — остаётся градиент
let busy = null;
export function next() {
  return busy ??= (async () => {
    try {
      for (let tries = 0; tries < 4; tries++) {
        const layer = await (pending ?? preload());
        pending = null;
        if (layer && !bans.has(key(layer.item))) { show(layer); preload(); return true; }
        if (layer) drop(layer);
        if (!state.queue.length) break; // источники пусты или недоступны
      }
      return false;
    } finally { busy = null; }
  })();
}
// сменились источники/поиск — очередь и заготовка устарели
function reset() {
  state.queue = [];
  pending?.then(l => l && drop(l));
  pending = null;
}

// ---------- избранное, «больше не показывать», источник ----------
export async function favorite() {
  const it = current?.item;
  if (!it || !favs) return false;
  const i = favs.findIndex(f => key(f) == key(it));
  if (i >= 0) { // повторный ♥ — убрать из избранного вместе с сохранённой копией
    const [f] = favs.splice(i, 1);
    await store.writeJSON(FAV, favs);
    await IOUtils.remove(favFile(f), { ignoreAbsent: true });
  } else {
    const ext = ((it.file ?? new URL(it.url).pathname).match(/\.\w{2,4}$/)?.[0] ?? ".jpg").toLowerCase();
    const name = `${it.source}-${it.id}`.replace(/\.\w{2,4}$/, "").replace(/[^\w.-]+/g, "_") + ext;
    await store.ensureDir("wallpapers/favorites");
    const dest = store.path("wallpapers/favorites/" + name);
    if (current.blob) await IOUtils.write(dest, new Uint8Array(await current.blob.arrayBuffer()), { tmpPath: dest + ".tmp" });
    else if (it.file != dest) await IOUtils.copy(it.file, dest);
    favs.push({ source: it.source, id: it.id, kind: it.kind, url: it.url ?? null, page: it.page ?? null, author: it.author ?? null,
      file: name, added: new Date().toISOString() });
    await store.writeJSON(FAV, favs);
  }
  syncButtons();
  return true;
}
export async function ban() {
  const it = current?.item;
  if (!it) return;
  bans.add(key(it));
  state.queue = state.queue.filter(i => !bans.has(key(i)));
  await store.writeJSON(BANS, [...bans]);
  await next();
}
export function openSource() {
  const page = current?.item.page;
  if (!page) return;
  if (/^https?:/.test(page)) win.openTrustedLinkIn(page, "tab");
  else { const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile); f.initWithPath(page); f.reveal(); }
}
const isFav = () => !!favs?.some(f => key(f) == key(current?.item));
function syncButtons() {
  const fav = bar.querySelector("[data-act=fav]");
  fav.classList.toggle("on", isFav());
  fav.title = isFav() ? "Убрать из избранного" : "В избранное (копия — в папке Luminoctis Home)";
  bar.querySelector("[data-act=open]").title = current?.item.source == "local" ? "Показать файл в папке" : "Открыть страницу обоев";
  for (const b of bar.querySelectorAll("[data-act=fav], [data-act=ban], [data-act=open]")) b.disabled = !current;
  if (current?.item.source == "we") { fav.disabled = true; fav.title = "Обои Wallpaper Engine и так лежат в папке Steam"; }
}

// ---------- цвет акцента из обоев ----------
const hsl = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx == r ? ((g - b) / d + 6) % 6 : mx == g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
};
const hex = (h, s, l) => {
  const f = n => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return "#" + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
};
// самый «весомый» насыщенный оттенок (24 корзины по кругу), потом подтянуть яркость под тёмную тему
export function accentOf(el) {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 36;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(el, 0, 0, c.width, c.height);
  const px = g.getImageData(0, 0, c.width, c.height).data, bins = Array.from({ length: 24 }, () => [0, 0, 0, 0]);
  for (let i = 0; i < px.length; i += 4) {
    const [r, gr, b] = [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255], [h, s, l] = hsl(r, gr, b);
    if (l < 0.1 || l > 0.94 || s < 0.15) continue;
    const w = s * s * (1 - Math.abs(l - 0.55)), bin = bins[Math.floor(h * 24) % 24];
    bin[0] += r * w; bin[1] += gr * w; bin[2] += b * w; bin[3] += w;
  }
  const best = bins.reduce((a, b) => (b[3] > a[3] ? b : a));
  if (best[3] < 0.5) return null; // почти серые обои — оставляем акцент палитры
  const [h, s, l] = hsl(best[0] / best[3], best[1] / best[3], best[2] / best[3]);
  return hex(h, Math.max(s, 0.55), Math.min(Math.max(l, 0.62), 0.74));
}
function applyAccent() {
  if (!prefs.getBoolPref(ACCENT, false)) return prefs.clearUserPref(OVERRIDE);
  const el = current?.el.matches("img, video") ? current.el : current?.el.querySelector("img"); // веб-обои — цвет не читаем
  if (!el) return;
  try {
    const color = accentOf(el);
    color ? prefs.setStringPref(OVERRIDE, color) : prefs.clearUserPref(OVERRIDE);
  } catch (e) { console.warn("Luminoctis обои: цвет не прочитан", e); }
}

// ---------- эффекты: параллакс, затемнение, размытие ----------
const still = matchMedia("(prefers-reduced-motion: reduce)");
let parallax = 0, tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
function effects() {
  root.style.setProperty("--wp-dim", Math.min(Math.max(int("dim", 25), 0), 90) / 100);
  root.style.setProperty("--wp-blur", Math.min(Math.max(int("blur", 0), 0), 40) + "px");
  parallax = bool("parallax", true) && !still.matches && current?.item.kind != "web" ? Math.min(Math.max(int("parallaxStrength", 40), 0), 100) / 100 : 0;
  root.classList.toggle("lumi-wp-zoom", !!parallax || int("blur", 0) > 0); // увеличение прячет края при сдвиге и размытии
  if (!parallax) { tx = ty = cx = cy = 0; stage.style.transform = ""; }
}
function step() {
  if (!parallax) return (raf = 0);
  cx += (tx - cx) * 0.08;
  cy += (ty - cy) * 0.08;
  stage.style.transform = `translate(${(-cx * parallax * 5).toFixed(3)}%, ${(-cy * parallax * 5).toFixed(3)}%) scale(1.06)`; // ≤2.5% при запасе 3%
  raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 1e-4 ? requestAnimationFrame(step) : 0;
}
window.addEventListener("mousemove", e => {
  if (!parallax) return;
  tx = e.clientX / innerWidth - 0.5;
  ty = e.clientY / innerHeight - 0.5;
  raf ||= requestAnimationFrame(step);
});
document.addEventListener("visibilitychange", () => { // видео не играет, пока Home не видна
  const v = current?.el;
  if (v?.play) document.hidden ? v.pause() : v.play().catch(() => {});
});

// ---------- смена по расписанию ----------
let timer = 0;
const due = () => {
  const mode = str("rotate", "open"), at = new Date(state.shownAt);
  if (!state.current) return true;
  if (mode == "interval") return Date.now() - state.shownAt >= Math.max(int("interval", 30), 1) * 60000;
  if (mode == "daily") return at.toDateString() != new Date().toDateString();
  return false; // open — решает старт, manual — только кнопкой
};
function schedule() {
  clearInterval(timer);
  const mode = str("rotate", "open");
  if (mode == "interval" || mode == "daily") timer = setInterval(() => due() && next(), 30000);
}

// ---------- старт ----------
const ACTS = { next: ["⟳", "Следующие обои", () => next()], fav: ["♥", "", favorite], ban: ["✕", "Больше не показывать", ban], open: ["↗", "", openSource] };
for (const [act, [icon, title, run]] of Object.entries(ACTS)) {
  const b = Object.assign(document.createElement("button"), { textContent: icon, title, type: "button" });
  b.dataset.act = act;
  b.addEventListener("click", () => run());
  bar.append(b);
}
root.append(stage, dim, bar);
syncButtons();
effects();

async function readData() {
  const safe = async (rel, fb) => { try { return await store.readJSON(rel, fb); } catch (e) { console.error("Luminoctis обои:", rel, e); return undefined; } };
  favs = (await safe(FAV, [])) ?? null;
  bans = new Set((await safe(BANS, [])) ?? []);
  state = { current: null, shownAt: 0, queue: [], ...(await safe(STATE, {})) };
}
export const ready = (async () => {
  await readData();
  let shown = false;
  if (state.current && str("rotate", "open") != "open" && !due() && !bans.has(key(state.current)))
    shown = await load(state.current).then(l => (show(l), preload(), true), () => false);
  if (!shown) await next();
  schedule();
})();

let soon = 0;
const onPref = (_, __, name) => {
  if (name.endsWith(".we.off")) reset(); // галочки в выборе — без смены текущих обоев
  else if (/\.(src\.|query|category|sorting|folder|favoritesOnly)/.test(name)) { reset(); clearTimeout(soon); soon = setTimeout(() => (busy ?? Promise.resolve()).then(next), 300); } // несколько настроек подряд — одна смена, после текущей
  else if (name.endsWith(".rotate") || name.endsWith(".interval")) schedule();
  else if (name == ACCENT) applyAccent();
  else effects();
};
prefs.addObserver(P, onPref);
prefs.addObserver(ACCENT, onPref);
still.addEventListener("change", effects);
window.addEventListener("unload", () => {
  prefs.removeObserver(P, onPref);
  prefs.removeObserver(ACCENT, onPref);
  clearInterval(timer);
});

// для проверок (dev/check-home-wallpaper.js) и будущих виджетов
window.lumiWallpaper = { next, showItem, we, favorite, ban, openSource, sources, kinds, registerKind, accentOf, ready,
  get current() { return current; }, get state() { return state; }, get favs() { return favs; }, get bans() { return bans; }, reload: () => (reset(), readData()) };
