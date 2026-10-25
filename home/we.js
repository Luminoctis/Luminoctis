// Wallpaper Engine для Luminoctis Home: папка мастерской Steam (431960), список обоев из <id>\project.json,
// виды обоев "web" (страница в изолированном iframe + API Wallpaper Engine) и "scene" (статичный кадр из scene.pkg, кеш в папке Home; не вышло — превью).
// Видео-обои Wallpaper Engine — обычный вид "video" из wallpaper.js. Импортируют: home/wallpaper.js (Home) и settings.js (выбор обоев).
import * as store from "./store.js";
import { extract } from "./we-scene.js";
export { extract }; // для проверок
const prefs = Services.prefs;
export const PREF = "luminoctis.home.wallpaper.we.folder"; // пусто — найти Steam самим
const APP = ["steamapps", "workshop", "content", "431960"];
const norm = p => p.replace(/\//g, "\\"); // SteamPath в реестре — с прямыми слэшами

// Steam: HKCU\Software\Valve\Steam\SteamPath + все библиотеки из steamapps\libraryfolders.vdf
async function libraries() {
  const libs = [];
  try {
    const k = Cc["@mozilla.org/windows-registry-key;1"].createInstance(Ci.nsIWindowsRegKey);
    k.open(k.ROOT_KEY_CURRENT_USER, "Software\\Valve\\Steam", k.ACCESS_READ);
    try { libs.push(norm(k.readStringValue("SteamPath"))); } finally { k.close(); }
  } catch { return []; } // Steam не установлен
  try {
    const vdf = await IOUtils.readUTF8(PathUtils.join(libs[0], "steamapps", "libraryfolders.vdf"));
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(norm(m[1].replace(/\\\\/g, "\\")));
  } catch {}
  return libs;
}
async function firstExisting(...rel) {
  for (const lib of await libraries()) {
    try { const d = PathUtils.join(lib, ...rel); if (await IOUtils.exists(d)) return d; } catch {}
  }
  return null;
}
export const detectDir = () => firstExisting(...APP);
// программа Wallpaper Engine (для живых сцен в своём окне — js/lumi-home-live.uc.js)
const WE_APP = ["steamapps", "common", "wallpaper_engine"];
export const exePath = async () => (await firstExisting(...WE_APP, "wallpaper64.exe")) ?? firstExisting(...WE_APP, "wallpaper32.exe");
let detected = null;
export const folder = async () => prefs.getStringPref(PREF, "").trim() || (detected ??= detectDir());

// ---------- синхронизация с программой Wallpaper Engine: её config.json хранит обои рабочего стола ----------
export const CONFIG_PREF = "luminoctis.home.wallpaper.we.config"; // путь к config.json; пусто — steamapps\common\wallpaper_engine в библиотеках Steam
let detectedConfig = null;
export async function configPath() {
  const p = prefs.getStringPref(CONFIG_PREF, "").trim();
  if (p) return (await IOUtils.exists(p)) ? p : null;
  return (detectedConfig ??= firstExisting("steamapps", "common", "wallpaper_engine", "config.json"));
}
// обои первого монитора: <пользователь>.general.wallpaperconfig.selectedwallpapers.<монитор>.file — ключ ищем на любой глубине
// (вложенность у версий WE разная); file — project.json или главный файл обоев, папка обоев — ближайшая сверху с project.json
export async function selected(cfg) {
  cfg ??= await configPath();
  if (!cfg) return null;
  // в настоящем config.json ключ вложен дважды: general.selectedwallpapers.selectedwallpapers.Monitor0 — берём тот, где мониторы с file
  const monitors = s => s && typeof s == "object" && Object.values(s).some(v => typeof v?.file == "string") ? s : null;
  const find = o => o && typeof o == "object" ? (monitors(o.selectedwallpapers) ?? Object.values(o).map(find).find(Boolean)) : null;
  const sel = find(await IOUtils.readJSON(cfg));
  const file = sel && Object.keys(sel).sort().map(k => sel[k]?.file).find(f => typeof f == "string" && f);
  if (!file) return null;
  let dir = PathUtils.parent(norm(file));
  for (let i = 0; i < 3 && dir && !(await IOUtils.exists(PathUtils.join(dir, "project.json"))); i++) dir = PathUtils.parent(dir);
  return dir ? item(dir) : null;
}

// обои папки: { source:"we", id, kind (video|web|scene), type, title, file, page, preview, props, loc (подписи из localization) }
// scene/application — file = preview (кадр сцены достаёт kinds.scene); битые и неполные папки пропускаются
export async function list(dir) {
  dir ??= await folder();
  if (!dir) return [];
  let kids;
  try { kids = await IOUtils.getChildren(dir); } catch { return []; }
  const items = await Promise.all(kids.map(item));
  return items.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
}
// одни обои по их папке; битые и неполные — null
export async function item(d) {
  try {
    const p = await IOUtils.readJSON(PathUtils.join(d, "project.json"));
    const type = String(p.type ?? "scene").toLowerCase();
    const kind = type == "video" || type == "web" ? type : "scene";
    const preview = p.preview ? PathUtils.joinRelative(d, String(p.preview)) : null;
    const file = kind == "scene" ? preview : p.file ? PathUtils.joinRelative(d, String(p.file)) : null;
    if (!file) return null;
    return { source: "we", id: PathUtils.filename(d), kind, type, title: String(p.title || PathUtils.filename(d)), file, page: d, preview,
      props: p.general?.properties ?? {}, loc: pickLoc(p.general?.localization ?? p.localization) };
  } catch { return null; }
}

// ---------- свойства обоев (project.json general.properties, как в WE): свои значения — wallpapers/we-props/<id>.json ----------
// подписи: localization обоев (ru-ru поверх en-us; нет — первый язык)
function pickLoc(l) {
  if (!l || typeof l != "object") return {};
  const lc = Object.fromEntries(Object.entries(l).map(([k, v]) => [k.toLowerCase(), v]));
  return { ...(lc["en-us"] ?? (lc["ru-ru"] ? {} : Object.values(lc)[0])), ...lc["ru-ru"] };
}
const propsFile = item => `wallpapers/we-props/${String(item.id).replace(/[^\w.-]+/g, "_")}.json`;
export const savedProps = item => store.readJSON(propsFile(item), {}).catch(() => ({}));
export const saveProps = (item, values) => Object.keys(values).length ? store.writeJSON(propsFile(item), values)
  : IOUtils.remove(store.path(propsFile(item)), { ignoreAbsent: true });
export const defaults = props => Object.fromEntries(Object.entries(props).filter(([, p]) => p && "value" in p).map(([k, p]) => [k, p.value]));
// project.json + свои значения — для applyUserProperties веб-обоев ({ key: { ...свойство, value } })
export const withSaved = (props, values) => Object.fromEntries(Object.entries(props).map(([k, p]) => [k, k in values ? { ...p, value: values[k] } : p]));
// значение свойства, проверенное по его описанию в project.json; не подходит — undefined (в CLI не попадёт)
export function cliValue(p, v) {
  switch (String(p?.type).toLowerCase()) {
    case "slider": {
      const n = Number(v), lo = Number(p.min), hi = Number(p.max);
      return Number.isFinite(n) ? Math.min(Number.isFinite(hi) ? hi : n, Math.max(Number.isFinite(lo) ? lo : n, n)) : undefined;
    }
    case "bool": return typeof v == "boolean" ? v : undefined;
    case "color": return typeof v == "string" && /^\s*\d*\.?\d+(\s+\d*\.?\d+){2}\s*$/.test(v) ? v.trim() : undefined; // «r g b», 0..1
    case "combo": return (p.options ?? []).find(o => String(o?.value) == String(v))?.value;
    case "textinput": return typeof v == "string" ? v.replace(/["\\~\x00-\x1f]/g, "").slice(0, 200) : undefined; // без кавычек, \ и ~ (RAW~(…)~END)
  }
}
// аргумент -properties для -control applyProperties: RAW~({"key":value,…})~END; ключи — только \w, значения — через cliValue
export function propsArg(props, values) {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    const c = /^\w{1,64}$/.test(k) ? cliValue(props[k], v) : undefined;
    if (c !== undefined) out[k] = c;
  }
  return Object.keys(out).length ? `RAW~(${JSON.stringify(out)})~END` : null;
}

// ---------- вид "scene": статичный кадр из scene.pkg (home/we-scene.js) ----------
// кадр сцены (байты scene.pkg) → OffscreenCanvas размера видимой части главной текстуры
export async function sceneCanvas(bytes) {
  const t = extract(bytes), c = new OffscreenCanvas(t.width, t.height), g = c.getContext("2d");
  if (t.image) g.drawImage(await createImageBitmap(new Blob([t.image.bytes], { type: t.image.mime })), 0, 0);
  else g.putImageData(new ImageData(t.rgba, t.texW), 0, 0); // texW×texH обрезается по холсту до imgW×imgH
  return c;
}
// file://-адрес кадра в кеше wallpapers/we-cache/<id>.jpg (время изменения кеша = времени scene.pkg — так видно, что сцену обновили);
// не вышло — null. Папку Steam только читаем.
// shortcut: разбор и DXT-декодирование идут в потоке страницы (~0.1–0.3 с на 4K, один раз на обои — дальше кеш); подвиснет заметно — вынести в worker
const scenes = new Map();
export function sceneImage(item) {
  if (!scenes.has(item.page)) scenes.set(item.page, sceneFrame(item).catch(e => (console.warn("Luminoctis WE: кадр сцены", item.page, e), null)));
  return scenes.get(item.page);
}
async function sceneFrame(item) {
  const pkg = PathUtils.join(item.page, "scene.pkg"), { lastModified } = await IOUtils.stat(pkg);
  const rel = `wallpapers/we-cache/${String(item.id).replace(/[^\w.-]+/g, "_")}.jpg`, out = store.path(rel), url = () => `${PathUtils.toFileURI(out)}?${lastModified}`;
  if ((await IOUtils.stat(out).catch(() => null))?.lastModified == lastModified) return url();
  const blob = await (await sceneCanvas(await IOUtils.read(pkg))).convertToBlob({ type: "image/jpeg", quality: 0.92 });
  await store.ensureDir("wallpapers/we-cache");
  await IOUtils.write(out, new Uint8Array(await blob.arrayBuffer()), { tmpPath: out + ".tmp" });
  await IOUtils.setModificationTime(out, lastModified);
  return url();
}

// ---------- вид "web": страница обоев без прав браузера ----------
// file:// в iframe страницы Home не грузится (Gecko хочет для него отдельный процесс), поэтому папка мастерской отдаётся как
// resource://lumi-we/<id>/… (подстановка видна только привилегированным страницам — сайтам недоступна).
// iframe sandbox="allow-scripts allow-same-origin": свой принципал resource://lumi-we (свои скрипты/картинки и localStorage работают),
// IOUtils/Services/ChromeUtils недоступны, к Home не достаёт, на chrome:// перейти не может, чужие файлы fetch не читает, окна и
// переход верхнего окна запрещены. API Wallpaper Engine (wallpaperRegisterAudioListener и др.) ставим в её окно до её скриптов.
const HOST = "lumi-we";
function webURL(item) {
  const root = PathUtils.toFileURI(PathUtils.parent(item.page)) + "/", file = PathUtils.toFileURI(item.file);
  if (!file.startsWith(root)) throw new Error("веб-обои вне папки мастерской: " + item.file);
  Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler).setSubstitution(HOST, Services.io.newURI(root));
  return `resource://${HOST}/${file.slice(root.length)}`;
}
const NOOP_API = ["wallpaperRegisterMediaStatusListener", "wallpaperRegisterMediaPropertiesListener", "wallpaperRegisterMediaThumbnailListener",
  "wallpaperRegisterMediaPlaybackListener", "wallpaperRegisterMediaTimelineListener"];
function install(w, f) {
  const cbs = f.lumiAudio = [];
  Cu.exportFunction(cb => { if (typeof cb == "function") cbs.push(cb); }, w, { defineAs: "wallpaperRegisterAudioListener" });
  for (const n of NOOP_API) Cu.exportFunction(() => {}, w, { defineAs: n });
  // громкость: у окна iframe своей громкости в Gecko нет — запоминаем играющие audio/video (событие play — элементы в документе,
  // обёртка play() — и созданные кодом new Audio()) и ставим им громкость Home. Звук WebAudio не регулируется.
  const media = f.lumiMedia = new Set(), proto = w.wrappedJSObject.HTMLMediaElement?.prototype, play = proto?.play;
  const track = el => { media.add(el); setMediaVolume(el, f.lumiVolume ?? 1); };
  w.addEventListener("play", e => track(e.target), true);
  if (play) Cu.exportFunction(function () { track(this); return play.call(this); }, proto, { defineAs: "play" });
}
function setMediaVolume(el, v) { try { el.volume = v; el.muted = !v; } catch {} }
// громкость веб-обоев страницы Home (0..1) — их audio/video
export function setVolume(v) {
  for (const f of webFrames()) {
    f.lumiVolume = v;
    for (const el of f.lumiMedia ?? []) setMediaVolume(el, v);
  }
}
const ours = f => f?.classList?.contains("lumi-wp-web") && f.ownerDocument == document;
const onGlobal = w => { try { const f = w.browsingContext?.embedderElement; if (ours(f)) install(w, f); } catch (e) { console.warn("Luminoctis WE:", e); } };
const listener = w => w.wrappedJSObject?.wallpaperPropertyListener;
function onLoad(f) {
  const w = f.contentWindow;
  if (!w) return;
  const l = listener(w);
  try { l?.applyGeneralProperties?.(Cu.cloneInto({ fps: 30 }, w)); } catch (e) { console.warn("Luminoctis WE: applyGeneralProperties", e); }
  try { l?.applyUserProperties?.(Cu.cloneInto(f.lumiProps ?? {}, w)); } catch (e) { console.warn("Luminoctis WE: applyUserProperties", e); }
  // клик по обоям и Esc должны доходить до Home (выход из правки LumiNotes)
  w.addEventListener("click", () => f.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  w.addEventListener("keydown", e => e.key == "Escape" && document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
}
const webFrames = () => document.querySelectorAll("iframe.lumi-wp-web");
// спектр 128 чисел (64 левый + 64 правый канал, 0..1) — всем веб-обоям, которые подписались
export function feed(arr) {
  for (const f of webFrames()) {
    const w = f.contentWindow;
    if (!w || !f.lumiAudio?.length) continue;
    const data = Cu.cloneInto(arr, w);
    for (const cb of f.lumiAudio) try { cb(data); } catch (e) { console.warn("Luminoctis WE: audio listener", e); }
  }
}
export const hasListeners = () => [...webFrames()].some(f => f.lumiAudio?.length);

export const kinds = {
  web: {
    create(src, item) {
      const f = document.createElement("iframe");
      f.className = "lumi-wp-web";
      f.setAttribute("sandbox", "allow-scripts allow-same-origin");
      f.lumiProps = item?.props ?? {};
      f.lumiItem = item;
      f.addEventListener("load", () => onLoad(f));
      f.src = webURL(item);
      return f;
    },
    // iframe грузится, только когда слой вставлен в страницу; до этого — свои значения свойств поверх project.json
    ready: async f => { if (f.lumiItem) f.lumiProps = withSaved(f.lumiItem.props, await savedProps(f.lumiItem)); },
  },
  scene: { // сцена — её главная картинка из scene.pkg; не вышло (или «программа») — превью с подписью
    create(src, item) {
      const box = Object.assign(document.createElement("div"), { className: "lumi-wp-scene" });
      box.lumiPreview = src;
      box.lumiItem = item;
      box.append(Object.assign(new Image(), { decoding: "async", alt: "" }));
      return box;
    },
    async ready(box) {
      const img = box.firstChild, frame = box.lumiItem?.type == "scene" && (await sceneImage(box.lumiItem));
      if (frame) {
        img.src = frame;
        try { return await img.decode(); } catch (e) { console.warn("Luminoctis WE: кадр сцены не открылся", e); }
      }
      box.append(Object.assign(document.createElement("span"), { className: "lumi-wp-hint",
        textContent: box.lumiItem?.type == "application" ? "Программа — только превью" : "Сцена — только превью" }));
      img.src = box.lumiPreview;
      return img.decode();
    },
  },
};

// только на странице Home: перехват окон веб-обоев и пауза, пока Home не видна
export function init() {
  Services.obs.addObserver(onGlobal, "content-document-global-created");
  document.addEventListener("visibilitychange", () => {
    for (const f of webFrames()) try { listener(f.contentWindow)?.setPaused?.(document.hidden); } catch {}
  });
  window.addEventListener("unload", () => Services.obs.removeObserver(onGlobal, "content-document-global-created"));
}
