// ==UserScript==
// @name           Luminoctis: обновление мода
// @description    Проверка новой версии в GitHub Releases раз в сутки и по кнопке; обновление = скачать релиз, проверить SHA-256, запустить installer\update.ps1 и перезапустить Zen.
// ==/UserScript==

// Один экземпляр (chrome://userscripts/content/lumi-update.sys.mjs): грузится при старте, им пользуется панель настроек.
// Работает только если мод поставлен установщиком (<профиль>\luminoctis-install.json) — у dev-профиля (dev\run.ps1) состояния нет, сети нет.
// Настройки luminoctis.update.*: url (откуда), auto-check, relaunch (поднять Zen после обновления), available (найденная версия, "" — нет),
// page (адрес страницы релиза), last-check (секунды).
import { setTimeout, setInterval } from "resource://gre/modules/Timer.sys.mjs";

const P = "luminoctis.update.";
const defaults = Services.prefs.getDefaultBranch(P);
defaults.setStringPref("url", "https://api.github.com/repos/LaithsShadow/Luminoctis/releases/latest");
defaults.setBoolPref("auto-check", true);
defaults.setBoolPref("relaunch", true);
defaults.setStringPref("available", "");
defaults.setStringPref("page", "");
const DAY = 86400;

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
  try { x = new URL(u); } catch { throw new Error("неверный адрес обновления: " + u); }
  if (x.protocol !== "https:" || !HOSTS.includes(x.hostname)) throw new Error("адрес обновления не разрешён: " + u);
  return u;
}

async function latest() {
  const r = await fetch(checkUrl(Services.prefs.getStringPref(P + "url")), { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
  if (!r.ok) throw new Error("GitHub ответил " + r.status);
  const rel = await r.json();
  const version = String(rel.tag_name || "").replace(/^v/, "");
  if (!/^\d+(\.\d+)*$/.test(version)) throw new Error("странный тег релиза: " + rel.tag_name); // версия идёт в имена файлов и папок
  return { ...rel, version };
}

// -> { available: "версия" | "" } или { error }. Без состояния установки в сеть не ходит.
export async function check() {
  const have = await installedVersion();
  if (!have) return { error: "мод не установлен установщиком" };
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
  const r = await fetch(checkUrl(url), { cache: "no-store" });
  checkUrl(r.url); // после перенаправлений тоже
  if (!r.ok) throw new Error("не скачалось: " + url + " (" + r.status + ")");
  return r;
}

// Скачивает релиз, проверяет SHA-256, распаковывает, запускает installer\update.ps1 и закрывает Zen.
// Любая ошибка до запуска скрипта — исключение, ничего в профиле не меняется.
export async function apply() {
  const have = await installedVersion();
  if (!have) throw new Error("мод не установлен установщиком");
  const rel = await latest();
  if (!newer(rel.version, have)) throw new Error("новой версии нет");
  const name = `Luminoctis-${rel.version}.zip`;
  const asset = n => rel.assets?.find(a => a.name == n)?.browser_download_url;
  if (!asset(name) || !asset(name + ".sha256")) throw new Error("в релизе нет " + name + " или .sha256");

  const zip = await (await download(asset(name))).arrayBuffer();
  const want = (await (await download(asset(name + ".sha256"))).text()).trim().split(/\s+/)[0].toLowerCase();
  if (hex(await crypto.subtle.digest("SHA-256", zip)) != want) throw new Error("SHA-256 не совпал — обновление отменено");

  const dir = PathUtils.join(PathUtils.tempDir, "luminoctis-update-" + rel.version);
  await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
  await IOUtils.makeDirectory(dir);
  const zipPath = PathUtils.join(dir, name);
  await IOUtils.write(zipPath, new Uint8Array(zip));
  const out = PathUtils.join(dir, "release");
  const zr = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(Ci.nsIZipReader);
  zr.open(file(zipPath));
  try {
    for (const entry of zr.findEntries("*")) {
      const rel2 = entry.replaceAll("\\", "/");
      if (rel2.split("/").includes("..")) throw new Error("в архиве недопустимый путь: " + entry);
      if (rel2.endsWith("/")) { await IOUtils.makeDirectory(PathUtils.join(out, ...rel2.split("/")), { createAncestors: true }); continue; }
      const target = PathUtils.join(out, ...rel2.split("/"));
      await IOUtils.makeDirectory(PathUtils.parent(target), { createAncestors: true });
      zr.extract(entry, file(target));
    }
  } finally {
    zr.close();
  }
  const script = PathUtils.join(out, "installer", "update.ps1");
  if (!(await IOUtils.exists(script))) throw new Error("в архиве нет installer\\update.ps1");

  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script,
    "-ZenPid", String(Services.appinfo.processID), "-ProfileDir", PathUtils.profileDir,
    "-ZenExe", Services.dirsvc.get("XREExeF", Ci.nsIFile).path];
  if (Services.prefs.getBoolPref(P + "relaunch")) args.push("-Relaunch");
  const ps = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  ps.init(file(PathUtils.join(Services.env.get("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")));
  ps.runw(false, args, args.length); // не ждём: скрипт сам дождётся выхода Zen
  Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
}

// после обновления сохранённая «доступная» версия уже установлена — сбрасываем (точка на шестерёнке гаснет)
installedVersion().then(have => {
  const found = Services.prefs.getStringPref(P + "available", "");
  if (found && have && !newer(found, have)) Services.prefs.setStringPref(P + "available", "");
});
// раз в сутки: первая проверка через минуту после старта, дальше раз в час смотрим, не пора ли
const due = () => Services.prefs.getBoolPref(P + "auto-check") && Date.now() / 1000 - Services.prefs.getIntPref(P + "last-check", 0) > DAY;
const tick = () => { if (due()) check(); };
setTimeout(tick, 60000);
setInterval(tick, 3600000);
