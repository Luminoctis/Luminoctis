// Сборка словарей: node dev/build-l10n.mjs. dev/l10n/*.json → js/lumi-l10n-<код>.sys.mjs (9 языков, без ru: ключ и есть русский текст).
// Формат файла области: { "Русский текст {0}": { "en": "...", "zh": "...", ... } }. Падает со списком ошибок, ничего не записывая.
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LANGS = ["en", "zh", "es", "ar", "pt", "id", "fr", "ja", "de"];
const subs = s => [...new Set(s.match(/\{\d+\}/g) ?? [])].sort().join();

// → { files: { "lumi-l10n-en.sys.mjs": текст }, errors: [], keys: число }
export function build() {
  const dir = path.join(root, "dev", "l10n"), errors = [], merged = {}, from = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8").replace(/^\uFEFF/, "")); } catch (e) { errors.push(`${f}: не читается JSON (${e.message})`); continue; }
    for (const [key, tr] of Object.entries(data)) {
      if (!tr || typeof tr != "object") { errors.push(`${f}: «${key}» — не объект с переводами`); continue; }
      for (const l of Object.keys(tr)) if (!LANGS.includes(l)) errors.push(`${f}: «${key}» — лишний язык ${l} (ru не нужен)`);
      for (const l of LANGS) {
        if (typeof tr[l] != "string" || !tr[l].trim()) errors.push(`${f}: «${key}» — нет перевода ${l}`);
        else if (subs(tr[l]) != subs(key)) errors.push(`${f}: «${key}» — подстановки ${l} (${subs(tr[l]) || "нет"}) не совпадают с ключом (${subs(key) || "нет"})`);
      }
      if (key in merged) {
        for (const l of LANGS) if (merged[key][l] !== tr[l]) { errors.push(`«${key}» переведён по-разному в ${from[key]} и ${f} (${l})`); break; }
      } else { merged[key] = tr; from[key] = f; }
    }
  }
  const keys = Object.keys(merged).sort();
  const files = {};
  for (const l of LANGS) {
    const body = keys.map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(merged[k][l] ?? "")},\n`).join("");
    files[`lumi-l10n-${l}.sys.mjs`] = `// Сгенерировано dev/build-l10n.mjs из dev/l10n/*.json — не править руками.\nexport const strings = {\n${body}};\n`;
  }
  return { files, errors, keys: keys.length };
}

if (process.argv[1] && import.meta.url == pathToFileURL(process.argv[1]).href) {
  const { files, errors, keys } = build();
  if (errors.length) { console.error(errors.join("\n") + `\nОшибок: ${errors.length}. Файлы не записаны.`); process.exit(1); }
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, "js", name), text, "utf8");
  console.log(`ключей: ${keys}, файлов: ${Object.keys(files).length}`);
}
