// ==UserScript==
// @name           Luminoctis: обновление мода
// @description    Проверка новой версии в GitHub Releases при каждом запуске (нашлась — сразу ставится), раз в сутки и по кнопке; обновление = скачать релиз, проверить SHA-256, запустить installer\update.ps1 (своё окно прогресса) и перезапустить Zen.
// ==/UserScript==

// Один экземпляр (chrome://userscripts/content/lumi-update.sys.mjs): грузится при старте, им пользуется панель настроек.
// Работает только если мод поставлен установщиком (<профиль>\luminoctis-install.json) — у dev-профиля (dev\run.ps1) состояния нет, сети нет.
// Настройки luminoctis.update.*: url (откуда), auto-check (проверять и ставить при запуске), relaunch (поднять Zen после обновления),
// available (найденная версия, "" — нет), page (адрес страницы релиза), last-check (секунды),
// attempt (версия, до которой начали обновляться), failed (версия, до которой обновление упало: сама при запуске больше не ставится, кнопка работает).
import { setTimeout, setInterval } from "resource://gre/modules/Timer.sys.mjs";
import { PrivateBrowsingUtils } from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
const { t, lang } = ChromeUtils.importESModule(new URL("lumi-i18n.sys.mjs", import.meta.url).href);

const P = "luminoctis.update.";
const defaults = Services.prefs.getDefaultBranch(P);
defaults.setStringPref("url", "https://api.github.com/repos/Luminoctis/Luminoctis/releases/latest");
defaults.setBoolPref("auto-check", true);
defaults.setBoolPref("relaunch", true);
defaults.setStringPref("available", "");
defaults.setStringPref("page", "");
defaults.setStringPref("attempt", "");
defaults.setStringPref("failed", "");
const DAY = 86400;

// ход скачивания и подготовки для панели настроек: { phase: "" | "download" | "verify" | "prepare" | "restart", pct };
// смена — наблюдателю "luminoctis-update-status"
export const status = { phase: "", pct: 0 };
const setStatus = (phase, pct = 0) => {
  status.phase = phase;
  status.pct = pct;
  Services.obs.notifyObservers(null, "luminoctis-update-status", phase);
};

const STATE = () => PathUtils.join(PathUtils.profileDir, "luminoctis-install.json");
export async function installedVersion() {
  try { return (await IOUtils.readJSON(STATE())).version || null; } catch { return null; }
}

// "0.4.1" > "0.4.0"; нечисловые хвосты считаем нулём
const parts = v => v.split(".").map(n => parseInt(n) || 0);
const newer = (a, b) => {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) != (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

// только https и хосты GitHub: адрес релиза лежит в настройках, а скачанное потом запускается
const HOSTS = ["api.github.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];
export function checkUrl(u) {
  let x;
  try { x = new URL(u); } catch { throw new Error(t("неверный адрес обновления: {0}", u)); }
  if (x.protocol !== "https:" || !HOSTS.includes(x.hostname)) throw new Error(t("адрес обновления не разрешён: {0}", u));
  return u;
}

// сеть через net.fetch — проверки подменяют её (dev\check-update.js)
export const net = { fetch: (...a) => fetch(...a) };

async function latest() {
  const r = await net.fetch(checkUrl(Services.prefs.getStringPref(P + "url")), { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
  if (!r.ok) {
    const reset = +r.headers.get("x-ratelimit-reset");
    if ((r.status == 403 || r.status == 429) && r.headers.get("x-ratelimit-remaining") == "0" && reset) {
      const d = new Date(reset * 1000), p = n => String(n).padStart(2, "0");
      throw new Error(t("GitHub временно ограничил проверки — попробуйте после {0}", p(d.getHours()) + ":" + p(d.getMinutes())));
    }
    throw new Error(t("GitHub ответил {0}", r.status));
  }
  const rel = await r.json();
  const version = String(rel.tag_name || "").replace(/^v/, "");
  if (!/^\d+(\.\d+)*$/.test(version)) throw new Error(t("странный тег релиза: {0}", rel.tag_name)); // версия идёт в имена файлов и папок
  return { ...rel, version };
}

// -> { available: "версия" | "" } или { error }. Без состояния установки в сеть не ходит.
export async function check() {
  const have = await installedVersion();
  if (!have) return { error: t("мод не установлен установщиком") };
  try {
    const rel = await latest();
    const found = rel.version && newer(rel.version, have) ? rel.version : "";
    Services.prefs.setIntPref(P + "last-check", Math.floor(Date.now() / 1000));
    Services.prefs.setStringPref(P + "page", found ? rel.html_url || "" : "");
    Services.prefs.setStringPref(P + "available", found);
    return { available: found };
  } catch (e) {
    return { error: e.message };
  }
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const file = path => {
  const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  f.initWithPath(path);
  return f;
};

async function download(url) {
  const r = await net.fetch(checkUrl(url), { cache: "no-store" });
  checkUrl(r.url); // после перенаправлений тоже
  if (!r.ok) throw new Error(t("не скачалось: {0} ({1})", url, r.status));
  return r;
}

// тело ответа кусками: пока качается, в настройках виден процент, а интерфейс не стоит
async function bytes(r, onPct) {
  if (!r.body?.getReader) return new Uint8Array(await r.arrayBuffer());
  const total = +r.headers.get("content-length") || 0, reader = r.body.getReader(), chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    if (total) onPct(Math.min(99, Math.floor((n * 100) / total)));
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// Скачивает релиз, проверяет SHA-256, достаёт из архива только installer\ (остальное распакует update.ps1 в своём окне — не в потоке Zen)
// и запускает его без окна консоли; потом закрывает Zen. Любая ошибка до запуска скрипта — исключение, ничего в профиле не меняется.
// Один вызов за раз: повторный (кнопка во время автообновления) получает тот же результат.
let job = null, stage = "";
export const apply = () => (job ??= run().then(() => { job = null; }, e => { job = null; setStatus(""); throw e; })); // успех: статус «Перезапускаю Zen…» остаётся до закрытия окна

async function run() {
  stage = "download";
  const have = await installedVersion();
  if (!have) throw new Error(t("мод не установлен установщиком"));
  setStatus("download", 0);
  const pair = async (zipUrl, shaUrl) => ({
    zip: await bytes(await download(zipUrl), p => setStatus("download", p)),
    want: (await (await download(shaUrl)).text()).trim().split(/\s+/)[0].toLowerCase(),
  });
  // версия уже найдена проверкой — качаем прямо с github.com (без лимита API); не вышло — старый путь через API
  const known = Services.prefs.getStringPref(P + "available", "");
  const repo = Services.prefs.getStringPref(P + "url").match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\//)?.[1];
  let version = known, got;
  if (repo && /^\d+(\.\d+)*$/.test(known) && newer(known, have)) {
    const direct = `https://github.com/${repo}/releases/download/v${known}/Luminoctis-${known}.zip`;
    try { got = await pair(direct, direct + ".sha256"); } catch {}
  }
  if (!got) {
    const rel = await latest();
    if (!newer(rel.version, have)) throw new Error(t("новой версии нет"));
    version = rel.version;
    const n = `Luminoctis-${version}.zip`;
    const asset = a => rel.assets?.find(x => x.name == a)?.browser_download_url;
    if (!asset(n) || !asset(n + ".sha256")) throw new Error(t("в релизе нет {0} или .sha256", n));
    got = await pair(asset(n), asset(n + ".sha256"));
  }
  const { zip, want } = got;
  const name = `Luminoctis-${version}.zip`;
  stage = "verify";
  setStatus("verify");
  if (hex(await crypto.subtle.digest("SHA-256", zip)) != want) throw new Error(t("SHA-256 не совпал — обновление отменено"));

  stage = "prepare";
  setStatus("prepare");
  let dir = PathUtils.join(PathUtils.tempDir, "luminoctis-update-" + version);
  try { await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true }); } catch { dir += "-" + Date.now(); } // остаток прошлого обновления занят — берём другую папку
  await IOUtils.makeDirectory(dir);
  const zipPath = PathUtils.join(dir, name);
  await IOUtils.write(zipPath, zip);
  // из архива сразу берём только installer\ (несколько маленьких файлов); остальное распаковывает update.ps1 уже при закрытом Zen, в своём окне
  const out = PathUtils.join(dir, "release");
  const zr = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(Ci.nsIZipReader);
  zr.open(file(zipPath));
  try {
    for (const entry of zr.findEntries("installer/*")) {
      const rel2 = entry.replaceAll("\\", "/");
      if (rel2.split("/").includes("..")) throw new Error(t("в архиве недопустимый путь: {0}", entry));
      if (rel2.endsWith("/")) continue;
      const target = PathUtils.join(out, ...rel2.split("/"));
      await IOUtils.makeDirectory(PathUtils.parent(target), { createAncestors: true });
      zr.extract(entry, file(target));
    }
  } finally {
    zr.close();
  }
  const script = PathUtils.join(out, "installer", "update.ps1");
  if (!(await IOUtils.exists(script))) throw new Error(t("в архиве нет installer\\update.ps1"));

  const psArgs = ["-ZenPid", String(Services.appinfo.processID), "-ProfileDir", PathUtils.profileDir,
    "-ZenExe", Services.dirsvc.get("XREExeF", Ci.nsIFile).path, "-Lang", lang, "-Zip", zipPath];
  const relaunch = Services.prefs.getBoolPref(P + "relaunch");
  if (relaunch) psArgs.push("-Relaunch");
  // wscript.exe (без консоли) запускает powershell сразу скрытым окном: прямой запуск powershell.exe из Zen на миг показывает консоль
  const sys = PathUtils.join(Services.env.get("SystemRoot"), "System32");
  const vbs = PathUtils.join(out, "installer", "update.vbs"), wscript = PathUtils.join(sys, "wscript.exe");
  let exe, args;
  if ((await IOUtils.exists(vbs)) && (await IOUtils.exists(wscript))) {
    exe = wscript;
    args = ["//B", "//NoLogo", vbs, ...psArgs];
  } else {
    exe = PathUtils.join(sys, "WindowsPowerShell", "v1.0", "powershell.exe");
    args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script, ...psArgs];
  }
  Services.prefs.setStringPref(P + "attempt", version);
  if (relaunch) Services.prefs.setBoolPref("browser.sessionstore.resume_session_once", true); // вкладки вернутся, даже если «открывать прошлую сессию» выключено
  setStatus("restart");
  const ps = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  ps.init(file(exe));
  ps.runw(false, args, args.length); // не ждём: скрипт сам дождётся выхода Zen
  Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
}

// Запуск браузера: проверка и, если есть новая версия, сразу установка. Тихо при любой неудаче (нет сети, лимит GitHub, нет установки).
// failed == найденной версии — не пробуем (иначе падающее обновление шло бы по кругу при каждом запуске); кнопка в настройках работает всегда.
// Ошибку скачивания (нет сети) failed не помечает: она не про эту версию.
export async function startupCheck(applyFn = apply) {
  if (!Services.prefs.getBoolPref(P + "auto-check")) return "off";
  if (!(await installedVersion())) return "none-installed";
  const r = await check();
  if (r.error) return "check-error";
  if (!r.available) return "uptodate";
  if (Services.prefs.getStringPref(P + "failed", "") == r.available) return "failed-before";
  try {
    await applyFn();
    return "applied";
  } catch {
    if (stage != "download") Services.prefs.setStringPref(P + "failed", r.available);
    return "error";
  }
}

// После запуска: обновление, начатое в прошлый раз, либо дошло (версия в состоянии стала новой), либо нет — тогда не повторяем его само
installedVersion().then(have => {
  const found = Services.prefs.getStringPref(P + "available", "");
  if (found && have && !newer(found, have)) Services.prefs.setStringPref(P + "available", ""); // установленная «доступная» версия — точка на шестерёнке гаснет
  const attempt = Services.prefs.getStringPref(P + "attempt", "");
  if (attempt && have) {
    if (newer(attempt, have)) Services.prefs.setStringPref(P + "failed", attempt);
    else Services.prefs.setStringPref(P + "failed", "");
    Services.prefs.setStringPref(P + "attempt", "");
  }
});

// Один раз за запуск приложения: ждём первое обычное (не приватное) окно с восстановленной сессией и ещё немного, чтобы не мешать старту
const normalWindow = () => {
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  return w && !w.closed && w.gBrowserInit?.delayedStartupFinished && !PrivateBrowsingUtils.isWindowPrivate(w);
};
(async () => {
  try { await ChromeUtils.importESModule("resource:///modules/sessionstore/SessionStore.sys.mjs").SessionStore.promiseAllWindowsRestored; } catch {}
  for (let i = 0; i < 30 && !normalWindow(); i++) await new Promise(r => setTimeout(r, 2000));
  await new Promise(r => setTimeout(r, 10000));
  if (normalWindow()) await startupCheck();
})();
// и раз в сутки, пока браузер не закрывали: только проверка (точка на шестерёнке), ставит пользователь кнопкой
const due = () => Services.prefs.getBoolPref(P + "auto-check") && Date.now() / 1000 - Services.prefs.getIntPref(P + "last-check", 0) > DAY;
setInterval(() => { if (due()) check(); }, 3600000);
