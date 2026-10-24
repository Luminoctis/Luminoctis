// Wallpaper Engine для Luminoctis Home: папка мастерской Steam (431960), список обоев из <id>\project.json,
// виды обоев "web" (страница в изолированном iframe + API Wallpaper Engine) и "scene" (только превью).
// Видео-обои Wallpaper Engine — обычный вид "video" из wallpaper.js. Импортируют: home/wallpaper.js (Home) и settings.js (выбор обоев).
const prefs = Services.prefs;
export const PREF = "luminoctis.home.wallpaper.we.folder"; // пусто — найти Steam самим
const APP = ["steamapps", "workshop", "content", "431960"];
const norm = p => p.replace(/\//g, "\\"); // SteamPath в реестре — с прямыми слэшами

// Steam: HKCU\Software\Valve\Steam\SteamPath + все библиотеки из steamapps\libraryfolders.vdf
export async function detectDir() {
  const libs = [];
  try {
    const k = Cc["@mozilla.org/windows-registry-key;1"].createInstance(Ci.nsIWindowsRegKey);
    k.open(k.ROOT_KEY_CURRENT_USER, "Software\\Valve\\Steam", k.ACCESS_READ);
    try { libs.push(norm(k.readStringValue("SteamPath"))); } finally { k.close(); }
  } catch { return null; } // Steam не установлен
  try {
    const vdf = await IOUtils.readUTF8(PathUtils.join(libs[0], "steamapps", "libraryfolders.vdf"));
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(norm(m[1].replace(/\\\\/g, "\\")));
  } catch {}
  for (const lib of libs) {
    try { const d = PathUtils.join(lib, ...APP); if (await IOUtils.exists(d)) return d; } catch {}
  }
  return null;
}
let detected = null;
export const folder = async () => prefs.getStringPref(PREF, "").trim() || (detected ??= detectDir());

// обои папки: { source:"we", id, kind (video|web|scene), type, title, file, page, preview, props }
// scene/application — показываем превью (file = preview); битые и неполные папки пропускаются
export async function list(dir) {
  dir ??= await folder();
  if (!dir) return [];
  let kids;
  try { kids = await IOUtils.getChildren(dir); } catch { return []; }
  const items = await Promise.all(kids.map(async d => {
    try {
      const p = await IOUtils.readJSON(PathUtils.join(d, "project.json"));
      const type = String(p.type ?? "scene").toLowerCase();
      const kind = type == "video" || type == "web" ? type : "scene";
      const preview = p.preview ? PathUtils.joinRelative(d, String(p.preview)) : null;
      const file = kind == "scene" ? preview : p.file ? PathUtils.joinRelative(d, String(p.file)) : null;
      if (!file) return null;
      return { source: "we", id: PathUtils.filename(d), kind, type, title: String(p.title || PathUtils.filename(d)), file, page: d, preview,
        props: p.general?.properties ?? {} };
    } catch { return null; }
  }));
  return items.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
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
      f.addEventListener("load", () => onLoad(f));
      f.src = webURL(item);
      return f;
    },
    ready: () => Promise.resolve(), // iframe грузится, только когда слой вставлен в страницу
  },
  scene: {
    create(src, item) {
      const box = Object.assign(document.createElement("div"), { className: "lumi-wp-scene" });
      const hint = Object.assign(document.createElement("span"), { className: "lumi-wp-hint",
        textContent: item?.type == "application" ? "Программа — только превью" : "Сцена — только превью" });
      box.append(Object.assign(new Image(), { src, decoding: "async", alt: "" }), hint);
      return box;
    },
    ready: el => el.firstChild.decode(),
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
