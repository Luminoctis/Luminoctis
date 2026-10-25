// Обои Luminoctis Home (#lumi-wallpaper): два слоя с плавной сменой, следующая картинка загружается заранее.
// Источники: Wallhaven, Konachan (safe), картинка дня Bing, своя папка (картинки/gif/mp4/webm), избранное.
// Данные (home/store.js): wallpapers/state.json (текущие + очередь), favorites.json + favorites/<файлы>, bans.json.
// Настройки: luminoctis.home.wallpaper.* (+ luminoctis.home.accentFromWallpaper — цвет акцента мода из обоев).
// Wallpaper Engine (home/we.js): источник "we", виды "web" (страница без прав браузера) и "scene" (кадр из scene.pkg); эквалайзер — home/equalizer.js.
// Новый вид обоев — registerKind(name, { create(src, item), ready(el) }).
// Фон «Прозрачный» (mode = transparent): своих обоев нет, Home насквозь (js/lumi-home-live.uc.js) — виден рабочий стол.
// Панель ⚙ (.lumi-wp-panel): громкость обоев (volume/muted) и свойства обоев WE (home/we-props.js, значения — wallpapers/we-props/<id>.json).
import * as store from "./store.js";
import * as we from "./we.js";
import * as weProps from "./we-props.js";

const P = "luminoctis.home.wallpaper.", ACCENT = "luminoctis.home.accentFromWallpaper", OVERRIDE = "luminoctis.palette.accentOverride";
const prefs = Services.prefs;
const bool = (n, d = false) => prefs.getBoolPref(P + n, d), int = (n, d) => prefs.getIntPref(P + n, d), str = (n, d = "") => prefs.getStringPref(P + n, d);
const win = window.browsingContext.topChromeWindow;
const FAV = "wallpapers/favorites.json", BANS = "wallpapers/bans.json", STATE = "wallpapers/state.json";
const key = it => it && `${it.source}:${it.id}`;
const transparent = () => str("mode", "wallpaper") == "transparent";

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
  applyVolume();
  if (layer.el.play && !document.hidden) layer.el.play().catch(() => {});
  box.getBoundingClientRect(); // старт перехода прозрачности
  box.classList.add("on");
  const old = current;
  current = layer;
  if (old) setTimeout(() => drop(old), 900);
  fade = old ? { old, at: performance.now() } : null; // окно повторяет плавную смену
  state.current = layer.item;
  state.shownAt = Date.now();
  save();
  syncButtons();
  applyAccent();
  kick();
  liveWant();
  if (panel.classList.contains("open")) fillPanel();
}
// живая сцена WE в своём окне под браузером (js/lumi-home-live.uc.js); здесь остаётся её статичный кадр — пока окно WE не готово или его нет
// прозрачная Home — то же «насквозь», без окна WE (lumiHomeLive.DESKTOP)
const liveWant = () => win.lumiHomeLive?.want(transparent() ? win.lumiHomeLive.DESKTOP
  : current?.item.source == "we" && current.item.type == "scene" ? current.item.page : null);
// показать выбранные обои сейчас (выбор Wallpaper Engine в настройках)
export async function showItem(item) {
  show(await load(item));
  if (transparent()) prefs.clearUserPref(P + "mode"); // выбрали обои — значит, уже не прозрачная (после show: onPref видит current)
  return true;
}
// прозрачная Home: свои обои убираются (видео и веб-обои не играют впустую)
function clearWall() {
  const old = current;
  current = null;
  fade = null;
  if (old) { old.box?.classList.remove("on"); setTimeout(() => drop(old), 900); }
  liveWant();
  syncButtons();
  applyAccent();
  paint();
  if (panel.classList.contains("open")) fillPanel();
}

// следующая картинка; не открылась — пробуем ещё (до 4 раз), нет ничего — остаётся градиент
let busy = null;
export function next() {
  if (transparent()) return Promise.resolve(false);
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
  bar.querySelector("[data-act=next]").disabled = transparent();
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
  if (!prefs.getBoolPref(ACCENT, false) || transparent()) return prefs.clearUserPref(OVERRIDE); // прозрачная — акцент палитры
  const el = current?.el.matches("img, video") ? current.el : current?.el.querySelector("img"); // веб-обои — цвет не читаем
  if (!el) return;
  try {
    const color = accentOf(el);
    color ? prefs.setStringPref(OVERRIDE, color) : prefs.clearUserPref(OVERRIDE);
  } catch (e) { console.warn("Luminoctis обои: цвет не прочитан", e); }
}

// ---------- обои на всё окно: сцена = прямоугольник окна браузера (cover относительно окна), сдвинутый на место вкладки ----------
// Тот же кадр рисует окно браузера под рейкой, полосой вкладок и адресом (#lumi-home-wall из js/lumi-home.uc.js, chrome.css раздел 15) —
// размытым и притемнённым по настройкам «Интерфейс над обоями»; у краёв страницы блюр нарастает (.lumi-wp-edge), шва нет.
// Видео перерисовывается в окне ~15 кадров/с, веб-обои там — превью из project.json (живую страницу дважды не запускаем).
// .lumi-wp-edge — тот же кадр, что в окне (холст во всё окно, размытый), под маской-градиентом у краёв: backdrop-filter тут не годится —
// он не видит обои за краем вкладки и у края светлел бы
const edge = Object.assign(document.createElement("div"), { className: "lumi-wp-edge" }), edgeCanvas = document.createElement("canvas");
edge.append(edgeCanvas);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
let geo = { x: 0, y: 0, W: innerWidth, H: innerHeight, k: 1 }, zoom = 1, fade = null; // fade — { old, at } на время смены слоёв
function place() { // позиция вкладки в окне; true — изменилась
  const b = window.browsingContext.embedderElement;
  if (!b?.isConnected) return false;
  const r = b.getBoundingClientRect(), k = win.devicePixelRatio / devicePixelRatio; // px окна → px страницы (масштаб страницы)
  const g = { x: r.x, y: r.y, W: win.innerWidth, H: win.innerHeight, k };
  if (["x", "y", "W", "H", "k"].every(n => Math.abs(g[n] - geo[n]) < 0.01)) return false;
  geo = g;
  for (const [n, v] of [["--wp-x", g.x], ["--wp-y", g.y], ["--wp-w", g.W], ["--wp-h", g.H]]) root.style.setProperty(n, v * k + "px");
  root.style.setProperty("--wp-ramp-l", g.x > 0.5 ? "var(--wp-ramp)" : "0px"); // нарастание блюра — только у краёв, где интерфейс
  root.style.setProperty("--wp-ramp-t", g.y > 0.5 ? "var(--wp-ramp)" : "0px");
  wall()?.style.setProperty("--lumi-home-x", g.x + "px"); // тон интерфейса над живой сценой — только вне вкладки (chrome.css раздел 15)
  wall()?.style.setProperty("--lumi-home-y", g.y + "px");
  return true;
}
const wall = () => win.document.getElementById("lumi-home-wall");
// чем рисовать слой в окне: картинка/видео, превью сцены, превью веб-обоев
function frameOf(layer) {
  const el = layer?.el;
  if (!el) return null;
  if (el.matches("img, video")) return el;
  if (el.matches(".lumi-wp-scene")) return el.querySelector("img");
  if (!layer.poster && layer.item.preview) layer.poster = Object.assign(new Image(), { src: PathUtils.toFileURI(layer.item.preview), onload: paint });
  return layer.poster?.complete && layer.poster.naturalWidth ? layer.poster : null;
}
function drawCover(g, src, W, H, pad) {
  const sw = src.naturalWidth || src.videoWidth || 0, sh = src.naturalHeight || src.videoHeight || 0;
  if (!sw || !sh) return;
  g.drawImage(src, -pad, -pad, W + 2 * pad, H + 2 * pad); // запас под размытие за краями окна (иначе края светлеют/темнеют)
  const s = Math.max(W / sw, H / sh) * zoom, w = sw * s, h = sh * s;
  g.drawImage(src, (W - w) / 2, (H - h) / 2, w, h); // = object-fit: cover на странице
}
const PAD = 80;
function paint() {
  const c = edgeCanvas;
  if (document.hidden) return;
  const { W, H } = geo, dpr = win.devicePixelRatio, cw = Math.round((W + 2 * PAD) * dpr), ch = Math.round((H + 2 * PAD) * dpr);
  if (c.width != cw || c.height != ch) Object.assign(c, { width: cw, height: ch });
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, PAD * dpr, PAD * dpr);
  g.globalAlpha = 1;
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--lumi-bg0") || "#16161e";
  g.fillRect(-PAD, -PAD, W + 2 * PAD, H + 2 * PAD);
  const t = fade ? clamp((performance.now() - fade.at) / 800, 0, 1) : 1;
  if (fade && t < 1) { const o = frameOf(fade.old); if (o) drawCover(g, o, W, H, PAD); }
  const src = frameOf(current);
  if (src) { g.globalAlpha = t; drawCover(g, src, W, H, PAD); g.globalAlpha = 1; }
  g.fillStyle = `rgba(0,0,0,${clamp(int("dim", 25), 0, 90) / 100})`;
  g.fillRect(-PAD, -PAD, W + 2 * PAD, H + 2 * PAD);
  if (t >= 1) fade = null;
  const wc = wall()?.querySelector("canvas"); // окну — копия кадра
  if (wc) {
    if (wc.width != cw || wc.height != ch) Object.assign(wc, { width: cw, height: ch });
    wc.getContext("2d").drawImage(c, 0, 0);
  }
}
// цикл: пока Home видна и идёт смена слоёв или играет видео; положение вкладки проверяется каждые 0.5 с
let raf = 0, lastPaint = 0, lastPlace = 0;
function loop(now) {
  raf = 0;
  if (document.hidden) return;
  if (now - lastPlace > 500) { lastPlace = now; if (place() || !wall()?.style.getPropertyValue("--lumi-home-blur")) effects(); }
  const live = fade || current?.el.matches?.("video");
  if (live && now - lastPaint > 66) { lastPaint = now; paint(); }
  raf = requestAnimationFrame(loop);
}
const kick = () => { effects(); raf ||= requestAnimationFrame(loop); };

// ---------- эффекты: затемнение, размытие обоев, интерфейс над обоями ----------
function effects() {
  place();
  const dimV = clamp(int("dim", 25), 0, 90) / 100, blur = clamp(int("blur", 0), 0, 40);
  root.style.setProperty("--wp-dim", dimV);
  root.style.setProperty("--wp-blur", blur + "px");
  // размытие у краёв окна светлеет — только при размытии чуть увеличиваем, ровно на запас под него
  zoom = blur ? 1 + (4 * blur) / Math.max(Math.min(geo.W, geo.H), 1) : 1;
  root.style.setProperty("--wp-zoom", zoom);
  const ui = clamp(int("ui.blur", 24), 0, 60), tint = 100 - clamp(int("ui.transparency", 70), 0, 100);
  root.style.setProperty("--wp-ui-blur", Math.hypot(ui, blur).toFixed(1) + "px");
  root.style.setProperty("--wp-ui-tint", tint + "%");
  root.style.setProperty("--wp-ramp", clamp(ui * 3, 32, 120) + "px");
  const box = wall();
  if (box) { // окно: размытие интерфейса поверх размытия самих обоев (гауссовы складываются по корню из суммы квадратов)
    box.style.setProperty("--lumi-home-blur", Math.hypot(ui, blur).toFixed(1) + "px");
    box.style.setProperty("--lumi-home-tint", tint + "%");
  }
  paint();
}
document.addEventListener("visibilitychange", () => { // видео не играет, пока Home не видна
  const v = current?.el;
  if (v?.play) document.hidden ? v.pause() : v.play().catch(() => {});
  if (!document.hidden) { kick(); syncWE(); }
});
addEventListener("resize", effects);

// ---------- синхронизация с Wallpaper Engine (we.sync): обои рабочего стола из config.json программы ----------
let weStamp = null, weBusy = null;
function syncWE(force) {
  if (!bool("we.sync") || transparent()) return Promise.resolve(false);
  return weBusy ??= (async () => {
    try {
      const cfg = await we.configPath();
      if (!cfg) return false;
      const { lastModified } = await IOUtils.stat(cfg);
      if (!force && lastModified == weStamp) return true;
      weStamp = lastModified;
      const it = await we.selected(cfg);
      if (it && key(it) != key(current?.item)) show(await load(it));
      return !!it;
    } catch (e) { console.warn("Luminoctis обои: Wallpaper Engine", e); return false; }
    finally { weBusy = null; }
  })();
}
setInterval(() => !document.hidden && syncWE(), 3000);

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
  if (mode == "interval" || mode == "daily") timer = setInterval(() => !bool("we.sync") && due() && next(), 30000); // синхронизация с WE главнее
}

// ---------- звук обоев: видео — громкость элемента, веб-обои — их audio/video (we.setVolume) ----------
// Живая сцена в окне WE сюда не входит: у WE громкость/mute только на все обои сразу (и на рабочем столе) — не трогаем.
const volume = () => (bool("muted") ? 0 : clamp(int("volume", 50), 0, 100) / 100);
function applyVolume() {
  const v = volume();
  for (const m of stage.querySelectorAll("video")) Object.assign(m, { volume: v, muted: !v });
  we.setVolume(v);
}

// ---------- панель ⚙: громкость и свойства обоев Wallpaper Engine ----------
const panel = Object.assign(document.createElement("section"), { className: "lumi-wp-panel" });
let propsSave = 0, propsValues = null, panelGen = 0;
async function fillPanel() {
  const it = current?.item, my = ++panelGen;
  const values = it?.source == "we" ? await we.savedProps(it) : {};
  if (my != panelGen) return;
  propsValues = values;
  const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const vol = h("input", { type: "range", min: 0, max: 100, value: int("volume", 50) }), out = h("output", { value: String(int("volume", 50)) });
  vol.addEventListener("input", () => { out.value = vol.value; prefs.setIntPref(P + "volume", Number(vol.value)); });
  const mute = h("input", { type: "checkbox", checked: bool("muted") });
  mute.addEventListener("change", () => prefs.setBoolPref(P + "muted", mute.checked));
  const close = h("button", { type: "button", className: "wp-close", textContent: "×", title: "Закрыть" });
  close.addEventListener("click", () => togglePanel(false));
  const kids = [h("header", {}, h("b", { textContent: transparent() ? "Прозрачная Home" : "Обои" }), close),
    h("label", { className: "wp-prop" }, h("span", { textContent: "Громкость" }), h("span", { className: "wp-prop-range" }, vol, out)),
    h("label", { className: "wp-prop wp-prop-bool" }, mute, h("span", { textContent: "Без звука" }))];
  if (it?.source == "we" && it.type == "scene") kids.push(h("p", { className: "wp-prop-text", textContent: "Звук живой сцены играет сама программа Wallpaper Engine — громкость у неё одна на все обои, меняется в ней" }));
  const box = h("div", { className: "wp-props" });
  const n = it?.source == "we" && (it.kind == "web" || it.type == "scene") ? weProps.build(box, it, values, (k, v, live) => onProp(it, k, v, live)) : 0;
  if (n) {
    const reset = h("button", { type: "button", className: "wp-reset", textContent: "Сбросить свойства" });
    reset.addEventListener("click", async () => {
      for (const k of Object.keys(values)) delete values[k];
      await we.saveProps(it, {});
      pushProps(it, Object.keys(it.props));
      fillPanel();
    });
    kids.push(h("h3", { textContent: it.title }), box, reset);
  } else if (it?.source == "we") kids.push(h("p", { className: "wp-prop-text", textContent: it.kind == "video" ? "Свойства видео-обоев применяет только сама программа Wallpaper Engine" : "У этих обоев нет своих настроек" }));
  panel.replaceChildren(...kids);
}
// свойство изменено: веб-обои — сразу (applyUserProperties), сцена в окне WE — по отпусканию (CLI только нашему окну); запись — через 300 мс
function onProp(it, k, v, live) {
  if (it.kind == "web" || !live) pushProps(it, [k]);
  clearTimeout(propsSave);
  const vals = { ...propsValues };
  propsSave = setTimeout(() => we.saveProps(it, vals).catch(e => console.warn("Luminoctis обои: свойства не сохранены", e)), 300);
}
let sceneT = 0;
function pushProps(it, keys) {
  if (key(it) != key(current?.item)) return;
  if (it.kind == "web") {
    const all = we.withSaved(it.props, propsValues ?? {}), w = current.el.contentWindow;
    try { w?.wrappedJSObject?.wallpaperPropertyListener?.applyUserProperties?.(Cu.cloneInto(Object.fromEntries(keys.map(k => [k, all[k]])), w)); }
    catch (e) { console.warn("Luminoctis обои: applyUserProperties", e); }
    current.el.lumiProps = all; // перезагрузка страницы обоев — уже с новыми значениями
  } else if (it.type == "scene") { // окно WE берёт значения из файла — сначала записать
    clearTimeout(sceneT);
    sceneT = setTimeout(async () => { await we.saveProps(it, { ...propsValues }); win.lumiHomeLive?.applyProps(it.page); }, 50);
  }
}
function togglePanel(on = !panel.classList.contains("open")) {
  panel.classList.toggle("open", on);
  bar.querySelector("[data-act=props]").classList.toggle("on", on);
  if (on) fillPanel();
}
document.addEventListener("keydown", e => e.key == "Escape" && panel.classList.contains("open") && togglePanel(false));

// ---------- старт ----------
const ACTS = { next: ["⟳", "Следующие обои", () => next()], fav: ["♥", "", favorite], ban: ["✕", "Больше не показывать", ban], open: ["↗", "", openSource],
  props: ["⚙", "Звук и настройки обоев", () => togglePanel()] };
for (const [act, [icon, title, run]] of Object.entries(ACTS)) {
  const b = Object.assign(document.createElement("button"), { textContent: icon, title, type: "button" });
  b.dataset.act = act;
  b.addEventListener("click", () => run());
  bar.append(b);
}
root.append(stage, dim, edge, bar, panel);
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
  if (transparent()) return liveWant(); // прозрачная Home — свои обои не грузим
  let shown = await syncWE(true); // синхронизация с Wallpaper Engine — вместо смены
  if (!shown && state.current && str("rotate", "open") != "open" && !due() && !bans.has(key(state.current)))
    shown = await load(state.current).then(l => (show(l), preload(), true), () => false);
  if (!shown) await next();
  schedule();
})();

let soon = 0;
const onPref = (_, __, name) => {
  if (name.endsWith(".mode")) transparent() ? clearWall() : current ? (liveWant(), applyAccent(), syncButtons()) : next();
  else if (/\.(volume|muted)$/.test(name)) applyVolume();
  else if (name.endsWith(".we.off")) reset(); // галочки в выборе — без смены текущих обоев
  else if (name.endsWith(".we.sync") || name == we.CONFIG_PREF) syncWE(true);
  else if (/\.(src\.|query|category|sorting|folder|favoritesOnly)/.test(name)) { reset(); clearTimeout(soon); soon = setTimeout(() => (busy ?? Promise.resolve()).then(next), 300); } // несколько настроек подряд — одна смена, после текущей
  else if (name.endsWith(".rotate") || name.endsWith(".interval")) schedule();
  else if (name == ACCENT) applyAccent();
  else effects();
};
prefs.addObserver(P, onPref);
prefs.addObserver(ACCENT, onPref);
window.addEventListener("unload", () => {
  prefs.removeObserver(P, onPref);
  prefs.removeObserver(ACCENT, onPref);
  clearInterval(timer);
  win.lumiHomeLive?.want(null);
});

// для проверок (dev/check-home-wallpaper.js) и будущих виджетов
window.lumiWallpaper = { next, showItem, we, weProps, togglePanel, panel, applyVolume, favorite, ban, openSource, sources, kinds, registerKind, accentOf, ready,
  get current() { return current; }, get state() { return state; }, get favs() { return favs; }, get bans() { return bans; }, reload: () => (reset(), readData()) };
