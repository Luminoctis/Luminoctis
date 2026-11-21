// Папка данных Luminoctis Home: по умолчанию «Documents\Luminoctis Home», своя — pref luminoctis.home.dir (пусто = по умолчанию).
// Пути — относительно папки ("notes/Доска.md", "time/journal.json"). Запись атомарная (сначала .tmp, потом замена) — файл не обрежется при сбое.
// Нужен привилегированный документ (chrome://): IOUtils/PathUtils/Services. Использование: import * as store from "./store.js".
export const PREF = "luminoctis.home.dir";
// Недоступна «Документы» или своя папка — на сессию берём запасную в профиле (luminoctis-home); defaultDir() не бросает
const FB = () => PathUtils.join(PathUtils.profileDir, "luminoctis-home");
let fallback = null, fbFor = ""; // fbFor — значение pref, при котором включили запасную (другая папка в настройках — пробуем её снова)
const pref = () => Services.prefs.getStringPref(PREF, "").trim();
const cur = () => (fallback && fbFor === pref() ? fallback : null);
export const defaultDir = () => {
  try { return PathUtils.join(Services.dirsvc.get("Docs", Ci.nsIFile).path, "Luminoctis Home"); } catch { return FB(); }
};
export const dir = () => cur() || pref() || defaultDir();
export const usingFallback = () => !!cur(); // true — выбранная/стандартная папка недоступна, данные сейчас в запасной папке профиля
export const path = (rel = "") => {
  const parts = rel.split(/[\/]+/).filter(Boolean);
  if (parts.includes("..")) throw new Error(`store: путь вне папки данных: ${rel}`); // l10n-skip
  return PathUtils.join(dir(), ...parts);
};
const missing = e => DOMException.isInstance(e) && e.name == "NotFoundError";
const parent = rel => ensureDir(rel.split(/[\/]+/).slice(0, -1).join("/"));

const mk = rel => IOUtils.makeDirectory(path(rel), { createAncestors: true, ignoreExisting: true });
export async function ensureDir(rel = "") {
  try { return await mk(rel); } catch (e) {
    if (cur()) throw e;
    [fallback, fbFor] = [FB(), pref()];
    return mk(rel);
  }
}
// чтение из недоступной папки (не «нет файла») — переходим на запасную и пробуем снова
async function recover() {
  if (cur()) return false;
  try { await ensureDir(); } catch { return false; }
  return !!cur();
}

// нет файла — fb; битый JSON — ошибка (чтобы виджет не перезаписал файл пустыми данными)
export async function readJSON(rel, fb = null) {
  try { return await IOUtils.readJSON(path(rel)); } catch (e) { if (missing(e)) return fb; if (await recover()) return readJSON(rel, fb); throw e; }
}
// Файл на миг занят другой программой (антивирус, OneDrive, индексатор, Obsidian): замена файла падает NotAllowedError — пробуем ещё пару раз
const busy = e => DOMException.isInstance(e) && ["NotAllowedError", "NotReadableError"].includes(e.name);
async function again(f) {
  for (let i = 1; ; i++) try { return await f(); } catch (e) {
    if (i > 2 || !busy(e)) throw e;
    const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
    await new Promise(r => setTimeout(r, i * 200));
  }
}
// сама папка рабочая? (запасная включена — нет; иначе каталог есть и в него можно писать): отличает «папка недоступна» от «занят один файл»
export async function healthy() {
  if (usingFallback()) return false;
  try {
    await ensureDir();
    if (usingFallback()) return false;
    const p = path(".lumi-probe");
    await IOUtils.writeUTF8(p, "1");
    await IOUtils.remove(p, { ignoreAbsent: true });
    return true;
  } catch { return false; }
}
export async function writeJSON(rel, data) {
  await parent(rel);
  const p = path(rel);
  await again(() => IOUtils.writeJSON(p, data, { tmpPath: p + ".tmp" }));
}
export async function readText(rel, fb = null) {
  try { return await IOUtils.readUTF8(path(rel)); } catch (e) { if (missing(e)) return fb; if (await recover()) return readText(rel, fb); throw e; }
}
export async function writeText(rel, text) {
  await parent(rel);
  const p = path(rel);
  await again(() => IOUtils.writeUTF8(p, text, { tmpPath: p + ".tmp" }));
}
// имена файлов и папок внутри (нет папки — пусто)
export async function list(rel = "") {
  try { return (await IOUtils.getChildren(path(rel))).map(p => PathUtils.filename(p)); } catch (e) { if (missing(e)) return []; if (await recover()) return list(rel); throw e; }
}
