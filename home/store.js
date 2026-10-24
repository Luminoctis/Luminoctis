// Папка данных Luminoctis Home: по умолчанию «Documents\Luminoctis Home», своя — pref luminoctis.home.dir (пусто = по умолчанию).
// Пути — относительно папки ("notes/Доска.md", "time/journal.json"). Запись атомарная (сначала .tmp, потом замена) — файл не обрежется при сбое.
// Нужен привилегированный документ (chrome://): IOUtils/PathUtils/Services. Использование: import * as store from "./store.js".
export const PREF = "luminoctis.home.dir";
export const defaultDir = () => PathUtils.join(Services.dirsvc.get("Docs", Ci.nsIFile).path, "Luminoctis Home");
export const dir = () => Services.prefs.getStringPref(PREF, "").trim() || defaultDir();
export const path = (rel = "") => {
  const parts = rel.split(/[\/]+/).filter(Boolean);
  if (parts.includes("..")) throw new Error(`store: путь вне папки данных: ${rel}`);
  return PathUtils.join(dir(), ...parts);
};
const missing = e => DOMException.isInstance(e) && e.name == "NotFoundError";
const parent = rel => ensureDir(rel.split(/[\/]+/).slice(0, -1).join("/"));

export const ensureDir = (rel = "") => IOUtils.makeDirectory(path(rel), { createAncestors: true, ignoreExisting: true });

// нет файла — fallback; битый JSON — ошибка (чтобы виджет не перезаписал файл пустыми данными)
export async function readJSON(rel, fallback = null) {
  try { return await IOUtils.readJSON(path(rel)); } catch (e) { if (missing(e)) return fallback; throw e; }
}
export async function writeJSON(rel, data) {
  await parent(rel);
  const p = path(rel);
  await IOUtils.writeJSON(p, data, { tmpPath: p + ".tmp" });
}
export async function readText(rel, fallback = null) {
  try { return await IOUtils.readUTF8(path(rel)); } catch (e) { if (missing(e)) return fallback; throw e; }
}
export async function writeText(rel, text) {
  await parent(rel);
  const p = path(rel);
  await IOUtils.writeUTF8(p, text, { tmpPath: p + ".tmp" });
}
// имена файлов и папок внутри (нет папки — пусто)
export async function list(rel = "") {
  try { return (await IOUtils.getChildren(path(rel))).map(p => PathUtils.filename(p)); } catch (e) { if (missing(e)) return []; throw e; }
}
