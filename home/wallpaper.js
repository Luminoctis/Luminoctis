// Обои Luminoctis Home (#lumi-wallpaper): два слоя с плавной сменой, следующая картинка загружается заранее.
// Источники (wallpaper-sources.js): Wallhaven, Unsplash, Pexels, Reddit, Konachan/Yande.re/Safebooru (только safe), NASA APOD, Wikimedia,
// Bing, своя папка, избранное. Нет ни одного источника (или пусто) — цветной градиент (pref color; пусто — цвет акцента).
// Данные (home/store.js): wallpapers/state.json (текущие + очередь), favorites.json + favorites/<файлы>, bans.json.
// Настройки: luminoctis.home.wallpaper.* (+ luminoctis.home.accentFromWallpaper — цвет акцента мода из обоев).
// Фон «Прозрачный» (mode = transparent): своих обоев нет, Home насквозь (js/lumi-home-live.uc.js) — виден рабочий стол.
// Панель ⚙ (.lumi-wp-panel): громкость локальных видео-обоев (volume/muted).
import { JS } from "./paths.js";
import * as store from "./store.js";
import { sources, SOURCES, sourceOn, net, nsfwOn, env } from "./wallpaper-sources.js";

const P = "luminoctis.home.wallpaper.", ACCENT = "luminoctis.home.accentFromWallpaper", OVERRIDE = "luminoctis.palette.accentOverride";
const prefs = Services.prefs;
const bool = (n, d = false) => prefs.getBoolPref(P + n, d), int = (n, d) => prefs.getIntPref(P + n, d), str = (n, d = "") => prefs.getStringPref(P + n, d);
const win = window.browsingContext.topChromeWindow;
const FAV = "wallpapers/favorites.json", BANS = "wallpapers/bans.json", STATE = "wallpapers/state.json";
const key = it => it && `${it.source}:${it.id}`;
const transparent = () => str("mode", "wallpaper") == "transparent";
const hidden = it => !!it?.nsfw && !nsfwOn(); // NSFW-картинка, которую сейчас нельзя показывать (переключатель выключен, приватное окно, режим окна «Обои»)

// ---------- виды обоев: как элемент получается из адреса ----------
const kinds = {
  image: { create: src => Object.assign(new Image(), { src, decoding: "async", alt: "" }), ready: el => el.decode() },
  video: {
    create: src => Object.assign(document.createElement("video"), { src, muted: true, loop: true, autoplay: true, playsInline: true, preload: "auto" }),
    ready: el => new Promise((ok, fail) => { el.onloadeddata = ok; el.onerror = () => fail(new Error("видео не открылось")); }),
  },
};
// источники (wallpaper-sources.js): каждый возвращает список { source, id, kind, url|file, page, author }

// ---------- состояние ----------
let state = { current: null, shownAt: 0, queue: [] };
let favs = [], bans = new Set(); // favs = null — favorites.json битый: избранное не трогаем, чтобы не затереть
const favFile = f => store.path("wallpapers/favorites/" + f.file);
const fromFav = f => ({ ...f, file: favFile(f) });
const save = () => store.writeJSON(STATE, state).catch(e => console.error("Luminoctis обои:", e));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

let noSources = false; // нечего показывать по настройкам (ни одного источника / пустое избранное) — next() уберёт обои, останется цвет
async function refill() {
  const on = SOURCES.filter(sourceOn);
  if (bool("favoritesOnly")) { // избранное — плейлист: по порядку, начиная с обоев после текущих (или вперемешку)
    const all = (favs ?? []).map(fromFav), i = all.findIndex(f => key(f) == key(state.current));
    const fresh = (bool("favShuffle") ? shuffle(all) : i < 0 ? all : [...all.slice(i + 1), ...all.slice(0, i + 1)]).filter(f => !bans.has(key(f)) && !hidden(f));
    noSources = !fresh.length;
    return void (state.queue = fresh);
  }
  noSources = !on.length;
  const list = (await Promise.allSettled(on.map(s => sources[s]()))).flatMap(r => {
    if (r.status == "rejected") console.warn("Luminoctis обои: источник недоступен", r.reason);
    return r.value ?? [];
  });
  const fresh = list.filter(i => !bans.has(key(i)) && !hidden(i));
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
const hue = Object.assign(document.createElement("div"), { className: "lumi-wp-color" }); // цветной градиент под обоями (виден, если обоев нет)
stage.append(hue);
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
// прозрачная Home — «насквозь», виден рабочий стол (js/lumi-home-live.uc.js, lumiHomeLive.DESKTOP)
// Прозрачный режим окна (настройка «Внешний вид»): интерфейс — стекло; «Прозрачность обоев» на Home (luminoctis.look.homeTransparency) —
// сквозь сами обои виден рабочий стол. Вне прозрачного режима оба не действуют — интерфейс и обои непрозрачные.
const { windowMode: winMode } = ChromeUtils.importESModule(JS("lumi-palette.sys.mjs"));
const glass = () => winMode() == "transparent" || winMode() == "wallpaper";
const windowWall = () => winMode() == "wallpaper"; // режим окна «Обои»: кадр в окне виден на всех вкладках, Home может быть в фоне
const wallAlpha = () => winMode() == "transparent" ? 1 - Math.min(Math.max(prefs.getIntPref("luminoctis.look.homeTransparency", 0), 0), 90) / 100 : 1;
const liveWant = () => win.lumiHomeLive?.want(transparent() || wallAlpha() < 1 ? win.lumiHomeLive.DESKTOP : null);
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
        if (layer && !bans.has(key(layer.item)) && !hidden(layer.item)) { show(layer); preload(); return true; }
        if (layer) drop(layer);
        if (!state.queue.length) break; // источники пусты или недоступны
      }
      if ((noSources || hidden(current?.item)) && current) { clearWall(); state.current = null; save(); } // все источники выключены — вместо старой картинки цвет
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
      file: name, nsfw: !!it.nsfw, added: new Date().toISOString() });
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
  if (!current) return prefs.clearUserPref(OVERRIDE); // цветной фон — акцент палитры
  try {
    const color = accentOf(current.el);
    color ? prefs.setStringPref(OVERRIDE, color) : prefs.clearUserPref(OVERRIDE);
  } catch (e) { console.warn("Luminoctis обои: цвет не прочитан", e); }
}

// ---------- цветной фон: мягкий градиент из одного цвета (pref color; пусто — акцент палитры) ----------
const rgbOf = c => { const m = /^#([0-9a-f]{6})$/i.exec(c?.trim()); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null; };
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
function tones() { // [основа, сияние слева-сверху, сияние справа-снизу]
  const cs = getComputedStyle(document.documentElement);
  const bg = rgbOf(cs.getPropertyValue("--lumi-bg0")) ?? [22, 22, 30], base = rgbOf(str("color")) ?? rgbOf(cs.getPropertyValue("--lumi-accent")) ?? [122, 162, 247];
  return [0.1, 0.5, 0.28].map(t => mix(bg, base, t));
}
function fillColor(g, W, H, pad) { // то же, что .lumi-wp-color в wallpaper.css (два эллипса farthest-corner до 62%)
  const [c0, c1, c2] = tones();
  g.fillStyle = `rgb(${c0})`;
  g.fillRect(-pad, -pad, W + 2 * pad, H + 2 * pad);
  for (const [px, py, c] of [[0.3, 0.2, c1], [0.8, 0.9, c2]]) {
    const cx = W * px, cy = H * py;
    g.save();
    g.translate(cx, cy);
    g.scale(Math.max(cx, W - cx) * Math.SQRT2, Math.max(cy, H - cy) * Math.SQRT2);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    gr.addColorStop(0, `rgb(${c})`);
    gr.addColorStop(0.62, `rgba(${c},0)`);
    g.fillStyle = gr;
    g.fillRect(-1, -1, 2, 2);
    g.restore();
  }
}

// ---------- обои на всё окно: сцена = прямоугольник окна браузера (cover относительно окна), сдвинутый на место вкладки ----------
// Тот же кадр рисует окно браузера под рейкой, полосой вкладок и адресом (#lumi-home-wall из js/lumi-home.uc.js, chrome.css раздел 15) —
// размытым и притемнённым по настройкам «Интерфейс над обоями»; у краёв страницы блюр нарастает (.lumi-wp-edge), шва нет.
// Видео перерисовывается в окне ~15 кадров/с.
// .lumi-wp-edge — тот же кадр, что в окне (холст во всё окно, размытый), под маской-градиентом у краёв: backdrop-filter тут не годится —
// он не видит обои за краем вкладки и у края светлел бы
const edge = Object.assign(document.createElement("div"), { className: "lumi-wp-edge" }), edgeCanvas = document.createElement("canvas");
edge.append(edgeCanvas);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
let geo = { x: 0, y: 0, W: innerWidth, H: innerHeight, k: 1 }, zoom = 1, fade = null; // fade — { old, at } на время смены слоёв
function place() { // позиция вкладки в окне; true — изменилась
  const b = window.browsingContext.embedderElement;
  if (!b?.isConnected) return false;
  if (document.hidden) { // Home в фоне (режим окна «Обои»): прямоугольника вкладки нет, меняется только размер окна
    const W = win.innerWidth, H = win.innerHeight, k = win.devicePixelRatio / devicePixelRatio;
    if (W == geo.W && H == geo.H && k == geo.k) return false;
    geo = { ...geo, W, H, k };
    root.style.setProperty("--wp-w", W * k + "px");
    root.style.setProperty("--wp-h", H * k + "px");
    return true;
  }
  const r = b.getBoundingClientRect(), k = win.devicePixelRatio / devicePixelRatio; // px окна → px страницы (масштаб страницы)
  // видимая часть вкладки: Zen в compact-режиме сдвигает страницу вверх под адресную строку (margin-top < 0), её верх обрезает контейнер
  const c = b.closest(".browserSidebarContainer")?.getBoundingClientRect() ?? r;
  const g = { x: r.x, y: r.y, W: win.innerWidth, H: win.innerHeight, k, vx: Math.max(r.x, c.x), vy: Math.max(r.y, c.y) };
  if (["x", "y", "W", "H", "k", "vx", "vy"].every(n => Math.abs(g[n] - geo[n]) < 0.01)) return false;
  geo = g;
  for (const [n, v] of [["--wp-x", g.x], ["--wp-y", g.y], ["--wp-w", g.W], ["--wp-h", g.H], ["--wp-vx", g.vx - g.x], ["--wp-vy", g.vy - g.y]])
    root.style.setProperty(n, v * k + "px");
  root.style.setProperty("--wp-ramp-l", g.vx > 0.5 ? "var(--wp-ramp)" : "0px"); // нарастание блюра — только у краёв, где интерфейс
  root.style.setProperty("--wp-ramp-t", g.vy > 0.5 ? "var(--wp-ramp)" : "0px");
  // тон интерфейса над живой сценой — только вне видимой части вкладки (chrome.css раздел 15); по прямоугольнику <browser> между ними
  // оставалась полоса без тона — светлая полоса с резким краем под адресной строкой
  wall()?.style.setProperty("--lumi-home-x", g.vx + "px");
  wall()?.style.setProperty("--lumi-home-y", g.vy + "px");
  return true;
}
const wall = () => win.document.getElementById("lumi-home-wall");
const frameOf = layer => layer?.el ?? null;
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
  if (document.hidden && !windowWall()) return;
  const { W, H } = geo, dpr = win.devicePixelRatio, cw = Math.round((W + 2 * PAD) * dpr), ch = Math.round((H + 2 * PAD) * dpr);
  if (c.width != cw || c.height != ch) Object.assign(c, { width: cw, height: ch });
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, PAD * dpr, PAD * dpr);
  g.globalAlpha = 1;
  g.clearRect(-PAD, -PAD, W + 2 * PAD, H + 2 * PAD);
  if (transparent()) return copyToWall(c); // прозрачная Home: под интерфейсом — рабочий стол, кадра нет
  fillColor(g, W, H, PAD);
  const t = fade ? clamp((performance.now() - fade.at) / 800, 0, 1) : 1;
  if (fade && t < 1) { const o = frameOf(fade.old); if (o) drawCover(g, o, W, H, PAD); }
  const src = frameOf(current);
  if (src) { g.globalAlpha = t; drawCover(g, src, W, H, PAD); g.globalAlpha = 1; }
  g.fillStyle = `rgba(0,0,0,${clamp(int("dim", 25), 0, 90) / 100})`;
  g.fillRect(-PAD, -PAD, W + 2 * PAD, H + 2 * PAD);
  if (t >= 1) fade = null;
  copyToWall(c);
}
function copyToWall(c) { // окну — копия кадра
  const wc = wall()?.querySelector("canvas");
  if (!wc) return;
  if (wc.width != c.width || wc.height != c.height) Object.assign(wc, { width: c.width, height: c.height });
  const g = wc.getContext("2d");
  g.clearRect(0, 0, wc.width, wc.height);
  g.drawImage(c, 0, 0);
}
// Перерисовка по событиям (размер/положение вкладки, окно, видимость, смена настроек). Таймер идёт, только пока что-то движется:
// смена слоёв или видео на видимой Home.
let tickTimer = 0;
const animating = () => (!document.hidden || windowWall()) && (fade || (!document.hidden && current?.el.matches?.("video"))); // скрытая Home рисует только в режиме окна «Обои»
function tick() {
  tickTimer = 0;
  if (!animating()) return;
  paint();
  tickTimer = setTimeout(tick, 66); // ~15 кадров/с
}
const kick = () => { effects(); if (animating() && !tickTimer) tickTimer = setTimeout(tick, 0); };
const relayout = () => { if (place()) effects(); };

// ---------- эффекты: затемнение, размытие обоев, интерфейс над обоями ----------
function effects() {
  place();
  const dimV = clamp(int("dim", 25), 0, 90) / 100, blur = clamp(int("blur", 0), 0, 40);
  root.style.setProperty("--wp-dim", dimV);
  root.style.setProperty("--wp-blur", blur + "px");
  // размытие у краёв окна светлеет — только при размытии чуть увеличиваем, ровно на запас под него
  zoom = blur ? 1 + (4 * blur) / Math.max(Math.min(geo.W, geo.H), 1) : 1;
  root.style.setProperty("--wp-zoom", zoom);
  const ui = clamp(int("ui.blur", 24), 0, 60), alpha = wallAlpha();
  root.style.setProperty("--wp-ui-blur", Math.hypot(ui, blur).toFixed(1) + "px");
  root.style.setProperty("--wp-alpha", alpha);
  edge.hidden = !glass(); // обои под интерфейсом — только в прозрачном режиме (chrome.css раздел 15)
  liveWant();
  root.style.setProperty("--wp-ramp", clamp(ui * 3, 32, 120) + "px");
  const box = wall();
  hue.hidden = transparent();
  const [c0, c1, c2] = tones();
  for (const [n, c, a] of [["c0", c0, 1], ["c1", c1, 1], ["c1t", c1, 0], ["c2", c2, 1], ["c2t", c2, 0]]) root.style.setProperty("--wp-" + n, `rgba(${c},${a})`);
  if (box) { // окно: размытие интерфейса поверх размытия самих обоев (гауссовы складываются по корню из суммы квадратов)
    box.style.setProperty("--lumi-home-blur", Math.hypot(ui, blur).toFixed(1) + "px");
    box.querySelector("canvas").style.opacity = alpha; // только кадр: тон стекла (::after, chrome.css раздел 15) — как на других вкладках
  }
  // у края страницы — тот же тон стекла, что над обоями в окне (bg0 окна с ползунком «Прозрачность интерфейса»), иначе на стыке ступенька
  const solid = 100 - clamp(prefs.getIntPref("luminoctis.look.transparency", 45), 0, 90);
  root.style.setProperty("--wp-ui-tint", glass() ? `color-mix(in srgb, var(--lumi-bg0, #16161e) ${solid}%, transparent)` : "transparent");
  paint();
  if (!box && wallTries++ < 20) setTimeout(effects, 500); // окно ещё не создало #lumi-home-wall
}
let wallTries = 0;
document.addEventListener("visibilitychange", () => { // видео не играет, пока Home не видна
  const v = current?.el;
  if (v?.play) document.hidden && !windowWall() ? v.pause() : v.play().catch(() => {});
  if (!document.hidden) kick();
});
addEventListener("resize", relayout);
// положение вкладки меняют рейка, полосы, compact: следим за размером <browser> и его контейнера и за окном (оно же — в фоне, режим «Обои»)
const ro = new win.ResizeObserver(relayout);
const embedder = window.browsingContext.embedderElement;
if (embedder) for (const n of [embedder, embedder.closest(".browserSidebarContainer")]) n && ro.observe(n);
let settle = 0;
const relayoutSoon = () => { clearTimeout(settle); settle = setTimeout(relayout, 80); }; // конец анимации (compact двигает вкладку без смены размера)
win.addEventListener("resize", relayout);
win.addEventListener("transitionend", relayoutSoon, true);

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

// ---------- звук обоев: громкость видео-слоёв ----------
const volume = () => (bool("muted") ? 0 : clamp(int("volume", 50), 0, 100) / 100);
function applyVolume() {
  const v = volume();
  for (const m of stage.querySelectorAll("video")) Object.assign(m, { volume: v, muted: !v });
}

// ---------- панель ⚙: громкость ----------
const panel = Object.assign(document.createElement("section"), { className: "lumi-wp-panel" });
function fillPanel() {
  const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const vol = h("input", { type: "range", min: 0, max: 100, value: int("volume", 50) }), out = h("output", { value: String(int("volume", 50)) });
  vol.addEventListener("input", () => { out.value = vol.value; prefs.setIntPref(P + "volume", Number(vol.value)); });
  const mute = h("input", { type: "checkbox", checked: bool("muted") });
  mute.addEventListener("change", () => prefs.setBoolPref(P + "muted", mute.checked));
  const close = h("button", { type: "button", className: "wp-close", textContent: "×", title: "Закрыть" });
  close.addEventListener("click", () => togglePanel(false));
  panel.replaceChildren(h("header", {}, h("b", { textContent: transparent() ? "Прозрачная Home" : "Обои" }), close),
    h("label", { className: "wp-prop" }, h("span", { textContent: "Громкость" }), h("span", { className: "wp-prop-range" }, vol, out)),
    h("label", { className: "wp-prop wp-prop-bool" }, mute, h("span", { textContent: "Без звука" })));
}
function togglePanel(on = !panel.classList.contains("open")) {
  panel.classList.toggle("open", on);
  bar.querySelector("[data-act=props]").classList.toggle("on", on);
  if (on) fillPanel();
}
document.addEventListener("keydown", e => e.key == "Escape" && panel.classList.contains("open") && togglePanel(false));

// ---------- старт ----------
const ACTS = { next: ["⟳", "Следующие обои", () => next()], fav: ["♥", "", favorite], ban: ["✕", "Больше не показывать", ban], open: ["↗", "", openSource],
  props: ["⚙", "Звук обоев", () => togglePanel()] };
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
  const keep = state.current && str("rotate", "open") != "open" && !due() && !bans.has(key(state.current)) && !hidden(state.current);
  if (!(keep && await load(state.current).then(l => (show(l), preload(), true), () => false))) await next();
  schedule();
})();

let soon = 0;
const onPref = (_, __, name) => {
  if (name.endsWith(".mode")) transparent() ? clearWall() : current ? (liveWant(), applyAccent(), syncButtons()) : next();
  else if (/\.(volume|muted)$/.test(name)) applyVolume();
  else if (/\.(src\.|nsfw|query|category|sorting|folder|favoritesOnly|favShuffle|wh\.|key\.|reddit\.)/.test(name)) { reset(); clearTimeout(soon); soon = setTimeout(() => (busy ?? Promise.resolve()).then(next), 300); } // несколько настроек подряд — одна смена, после текущей
  else if (name.endsWith(".rotate") || name.endsWith(".interval")) schedule();
  else if (name == ACCENT) applyAccent();
  else effects();
};
prefs.addObserver(P, onPref);
prefs.addObserver(ACCENT, onPref);
const onLook = () => { if (hidden(current?.item)) { reset(); next(); } effects(); }; // режим окна и прозрачность обоев (настройки «Внешний вид»)
prefs.addObserver("luminoctis.look.", onLook);
prefs.addObserver("luminoctis.palette.", onLook); // цвет фона без своего цвета — акцент палитры
window.addEventListener("unload", () => {
  prefs.removeObserver("luminoctis.look.", onLook);
  prefs.removeObserver("luminoctis.palette.", onLook);
  prefs.removeObserver(P, onPref);
  prefs.removeObserver(ACCENT, onPref);
  clearInterval(timer);
  clearTimeout(tickTimer);
  clearTimeout(settle);
  ro.disconnect();
  win.removeEventListener("resize", relayout);
  win.removeEventListener("transitionend", relayoutSoon, true);
  win.lumiHomeLive?.want(null);
});

// для проверок (dev/check-home-wallpaper.js) и будущих виджетов
window.lumiWallpaper = { next, favorite, ban, sources, sourceOn, net, nsfwOn, env, ready,
  get current() { return current; }, get state() { return state; }, get favs() { return favs; }, get bans() { return bans; } };
