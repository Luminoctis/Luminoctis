// LumiNotes: листы = файлы <папка данных>\notes\<лист>.md, раскладка (ряды листов, цвета, размеры) — notes\boards.json.
// Общий модуль страницы Home (home/notes.js) и быстрой заметки из контекстного меню (js/lumi-notes-capture.uc.js:
// ChromeUtils.importESModule("chrome://userchrome/content/luminoctis/home/notes-md.mjs")).
//
// Формат листа (совместим с Obsidian Tasks):
//   "- [ ] задача" / "- [x] сделано" / "- заметка"   (галочка только у задач)
//   подпункты — вложенность без предела: читаем таб, 2 или 4 пробела (уровень — относительно отступа родителя), пишем один таб на уровень;
//   продолжение текста — строки без маркера, отступ пункта + 2 пробела (пустые строки внутри пункта сохраняются);
//   даты в конце первой строки: "🛫 ГГГГ-ММ-ДД" (начало) и "📅 ГГГГ-ММ-ДД" (срок) → поля start/due; остальные эмодзи Obsidian Tasks остаются в тексте.
// Посторонние строки (заголовок, абзац из внешнего редактора) становятся отдельным пунктом-заметкой — ничего не теряется.
// Пункт: { text, check: null|bool, start?, due?, children: [] }.
// Чистые функции (parse, serialize, normalizeLayout) не трогают диск — их проверяет dev/check-notes-md.mjs в node.
import * as store from "./store.js";

export const DIR = "notes";
export const ORDER = "notes/boards.json";
export const DEFAULTS = ["Сегодня", "Дела", "Идеи"];
export const CHANGED = "lumi-notes-changed"; // Services.obs: файлы листов изменены не страницей Home
// фиксированные цвета листов/рядов: не зависят от темы браузера, читаются и на тёмном, и на светлом фоне
export const COLORS = {
  red: "#e06c75", orange: "#e39b5d", yellow: "#d8b94f", green: "#7fc37f", teal: "#4fb8b0",
  blue: "#6c9fe6", purple: "#a98be0", pink: "#e281b4", gray: "#8c94a3",
};

// ---------- разбор и запись листа ----------
const MARK = /^([ \t]*)[-*+](?: |$)(?:\[([ xX])\](?: |$))?(.*)$/;
const DATE = /\s*([\u{1F6EB}\u{1F4C5}])️?\s*(\d{4}-\d{2}-\d{2})\s*$/u; // 🛫 начало, 📅 срок
const cols = ws => { let c = 0; for (const ch of ws) c += ch == "\t" ? 4 : 1; return c; };
// снять отступ хозяина (в колонках: таб = 4) и ещё один уровень продолжения (таб или 2 пробела)
function strip(line, n) {
  let i = 0, c = 0;
  while (c < n && (line[i] == " " || line[i] == "\t")) c += line[i++] == "\t" ? 4 : 1;
  return line.slice(i).replace(/^(\t| {2})/, "");
}
function item(first, check) {
  const f = {};
  for (let d; (d = DATE.exec(first)); ) { // даты с конца первой строки в любом порядке; повтор того же поля — остаётся текстом
    const k = d[1] == "\u{1F6EB}" ? "start" : "due";
    if (f[k]) break;
    f[k] = d[2];
    first = first.slice(0, d.index);
  }
  return { text: first, check, ...(f.start && { start: f.start }), ...(f.due && { due: f.due }), children: [] };
}
export function parse(md) {
  const root = [], stack = []; // stack — цепочка предков последнего пункта: { col, item }
  let blanks = 0;
  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    const m = MARK.exec(line);
    if (m) {
      const col = cols(m[1]);
      while (stack.length && stack.at(-1).col >= col) stack.pop();
      const it = item(m[3], m[2] == null ? null : m[2] != " ");
      (stack.length ? stack.at(-1).item.children : root).push(it);
      stack.push({ col, item: it });
      blanks = 0;
    } else if (!line.trim()) { if (stack.length) blanks++; }
    else {
      const col = cols(/^[ \t]*/.exec(line)[0]);
      const host = stack.findLast(s => s.col < col); // глубже маркера пункта — продолжение его текста
      if (host) host.item.text += "\n".repeat(blanks + 1) + strip(line, host.col);
      else { const it = item(line.trimStart(), null); root.push(it); stack.length = 0; stack.push({ col: 0, item: it }); }
      blanks = 0;
    }
  }
  return root;
}
// shortcut: строка продолжения, начинающаяся с "- ", при чтении станет подпунктом; upgrade — экранировать, если понадобится
export function serialize(items) {
  const out = [];
  const walk = (list, d) => {
    const pad = "\t".repeat(d);
    for (const c of list) {
      const lines = c.text.split("\n");
      const first = [lines[0], c.start && `\u{1F6EB} ${c.start}`, c.due && `\u{1F4C5} ${c.due}`].filter(Boolean).join(" ");
      out.push(pad + (c.check == null ? "- " : c.check ? "- [x] " : "- [ ] ") + first);
      for (const l of lines.slice(1)) out.push(l ? pad + "  " + l : "");
      walk(c.children ?? [], d + 1);
    }
  };
  walk(items, 0);
  return out.join("\n") + (out.length ? "\n" : "");
}

// ---------- раскладка boards.json ----------
// { version: 2, rows: [ { height, color, fill, sheets: [ { name, color, width } ] } ] }; старый вид — массив имён листов
export function normalizeLayout(raw, files) {
  const have = new Set(files), seen = new Set();
  const num = v => (typeof v == "number" && v > 0 && isFinite(v) ? Math.round(v) : null);
  const color = v => (typeof v == "string" && Object.hasOwn(COLORS, v) ? v : null);
  const sheet = s => {
    const o = typeof s == "string" ? { name: s } : s;
    if (typeof o?.name != "string" || !have.has(o.name) || seen.has(o.name)) return null; // записи без файла выбрасываются
    seen.add(o.name);
    return { name: o.name, color: color(o.color), width: num(o.width) };
  };
  let rows = [];
  if (Array.isArray(raw)) rows = [{ sheets: raw }];
  else if (Array.isArray(raw?.rows)) rows = raw.rows.filter(r => r && typeof r == "object");
  rows = rows.map(r => ({ height: num(r.height), color: color(r.color), fill: r.fill === true, sheets: (Array.isArray(r.sheets) ? r.sheets : []).map(sheet).filter(Boolean) }))
    .filter(r => r.sheets.length);
  if (!rows.length) rows.push({ height: null, color: null, fill: false, sheets: [] });
  rows.at(-1).sheets.push(...files.filter(f => !seen.has(f)).sort().map(name => ({ name, color: null, width: null }))); // файлы снаружи — в конец последнего ряда
  return { version: 2, rows };
}
export const sheetNames = layout => layout.rows.flatMap(r => r.sheets.map(s => s.name));

// имя листа = имя файла: без символов, запрещённых в Windows
export const cleanName = name => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 80);
const file = name => `${DIR}/${name}.md`;

export const readSheet = async name => parse((await store.readText(file(name), "")) ?? "");
export const writeSheet = (name, items) => store.writeText(file(name), serialize(items));
export const writeLayout = layout => store.writeJSON(ORDER, layout);

// раскладка по файлам: старый/битый boards.json переписывается; нет ни одного листа — создаются три по умолчанию
export async function readLayout() {
  const files = (await store.list(DIR)).filter(f => /\.md$/i.test(f)).map(f => f.slice(0, -3));
  let raw = null;
  if (!files.length) {
    raw = DEFAULTS; // порядок по умолчанию, не по алфавиту
    await writeSheet(DEFAULTS[0], [{ text: "Нажми на доску, чтобы редактировать", check: false, children: [] }]);
    for (const n of DEFAULTS.slice(1)) await writeSheet(n, []);
    files.push(...DEFAULTS);
  }
  else try { raw = await store.readJSON(ORDER, null); } catch {} // битый JSON — не страшно, соберём из файлов
  const layout = normalizeLayout(raw, files);
  if (JSON.stringify(raw) != JSON.stringify(layout)) await writeLayout(layout);
  return layout;
}
export const boardNames = async () => sheetNames(await readLayout());

// переименование/удаление обновляют раскладку на диске; возвращают новую раскладку
export async function renameSheet(from, to) {
  const layout = await readLayout(); // до переноса файла, иначе порядок потеряется
  await IOUtils.move(store.path(file(from)), store.path(file(to)), { noOverwrite: true });
  for (const r of layout.rows) for (const s of r.sheets) if (s.name == from) s.name = to;
  await writeLayout(layout);
  return layout;
}
export async function removeSheet(name) {
  const layout = await readLayout();
  await IOUtils.remove(store.path(file(name)));
  for (const r of layout.rows) r.sheets = r.sheets.filter(s => s.name != name);
  layout.rows = layout.rows.filter(r => r.sheets.length);
  if (!layout.rows.length) layout.rows.push({ height: null, color: null, fill: false, sheets: [] });
  await writeLayout(layout);
  return layout;
}

// быстрая заметка: дописать пункт в конец листа и сказать открытым Home перечитать
export async function addItem(name, it) {
  const items = await readSheet(name);
  items.push({ children: [], ...it });
  await writeSheet(name, items);
  Services.obs.notifyObservers(null, CHANGED, name);
}
