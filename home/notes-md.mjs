// LumiNotes: листы = файлы <папка данных>\notes\<лист>.md, раскладка (ряды листов, цвета, размеры) — notes\boards.json.
// Общий модуль страницы Home (home/notes.js) и быстрой заметки из контекстного меню (js/lumi-notes-capture.uc.js:
// ChromeUtils.importESModule("chrome://userchrome/content/luminoctis/home/notes-md.mjs")).
//
// Формат листа (совместим с Obsidian Tasks):
//   "- [ ] задача" / "- [x] сделано" / "- заметка"   (галочка только у задач)
//   подпункты — вложенность без предела: читаем таб, 2 или 4 пробела (уровень — относительно отступа родителя), пишем один таб на уровень;
//   продолжение текста — строки без маркера, отступ пункта + 2 пробела (пустые строки внутри пункта сохраняются);
//   даты в конце первой строки: "🛫 ГГГГ-ММ-ДД" (начало) и "📅 ГГГГ-ММ-ДД" (срок) → поля start/due; остальные эмодзи Obsidian Tasks остаются в тексте.
// Строка "# Текст" … "###### Текст" в начале строки — заголовок-разделитель: пункт { text, check: null, heading: 1..6, children: [] } (без дат и подпунктов).
// Прочие посторонние строки (абзац из внешнего редактора) становятся отдельным пунктом-заметкой — ничего не теряется.
//   "1. текст" / "1) текст" — пункт-заметка с номером прямо в тексте (ol: true), пишется обратно как была; отдельной нумерации в карточках нет.
// Пункт: { text, check: null|bool, start?, due?, heading?, ol?, children: [] }.
// Лист в раскладке может быть документом (mode: "doc"): тот же .md, но показан цельным текстом (docBlocks/docToggle).
// inline(text) разбирает Markdown внутри строки в токены (без DOM: DOM строит страница).
// Чистые функции (parse, serialize, normalizeLayout) не трогают диск — их проверяет dev/check-notes-md.mjs в node.
import * as store from "./store.js";

export const DIR = "notes";
export const ORDER = "notes/boards.json";
export const DEFAULTS = ["Сегодня", "Дела", "Идеи"]; // l10n-skip: имена файлов; новому пользователю страница передаёт те же имена на его языке (seedDefaults), существующие листы не переименовываются
const TRASH_DIR = "luminoctis.notes.trash-dir"; // скрытый pref: папка вместо Корзины Windows (для проверок)
export const CHANGED = "lumi-notes-changed"; // Services.obs: файлы листов изменены не страницей Home
export const SAVED = "lumi-notes-saved"; // Services.obs: лист записан или Home его перечитала (слушает рейка); Home на него не реагирует — петли нет
// фиксированные цвета листов/рядов: не зависят от темы браузера, читаются и на тёмном, и на светлом фоне
export const COLORS = {
  red: "#e06c75", orange: "#e39b5d", yellow: "#d8b94f", green: "#7fc37f", teal: "#4fb8b0",
  blue: "#6c9fe6", purple: "#a98be0", pink: "#e281b4", gray: "#8c94a3",
};

// ---------- разбор и запись листа ----------
const MARK = /^([ \t]*)[-*+](?: |$)(?:\[([ xX])\](?: |$))?(.*)$/;
const DATE = /\s*([\u{1F6EB}\u{1F4C5}])️?\s*(\d{4}-\d{2}-\d{2})\s*$/u; // 🛫 начало, 📅 срок
const NUM = /^([ \t]*)(\d{1,9}[.)](?: .*|))$/; // «1. текст» / «1) текст»: пункт-заметка, номер остаётся в тексте
const NUMTXT = /^\d{1,9}[.)](?: |$)/;
const HEAD = /^(#{1,6})[ \t]+(\S.*?)[ \t]*$/;
const LISTLIKE = /^[ \t]*(?:[-*+](?: |$)|\d{1,9}[.)](?: |$)|#{1,6}[ \t]+\S)/m;
export const listLike = text => LISTLIKE.test(text); // в тексте маркер списка или заголовок — вставка раскладывается через parse
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
    const hd = HEAD.exec(line), m = MARK.exec(line) ?? NUM.exec(line);
    if (hd) { root.push({ text: hd[2], check: null, heading: hd[1].length, children: [] }); stack.length = 0; blanks = 0; }
    else if (m) {
      const col = cols(m[1]);
      while (stack.length && stack.at(-1).col >= col) stack.pop();
      const it = m.length == 3 ? { ...item(m[2], null), ol: true } : item(m[3], m[2] == null ? null : m[2] != " ");
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
      if (c.heading) { out.push("#".repeat(c.heading) + " " + c.text.replace(/\s*\n\s*/g, " ")); walk(c.children ?? [], d); continue; }
      const lines = c.text.split("\n");
      const first = [lines[0], c.start && `\u{1F6EB} ${c.start}`, c.due && `\u{1F4C5} ${c.due}`].filter(Boolean).join(" ");
      out.push(pad + (c.check == null ? (c.ol && NUMTXT.test(c.text) ? "" : "- ") : c.check ? "- [x] " : "- [ ] ") + first); // ol — строка с номером из документа: без «- »
      for (const l of lines.slice(1)) out.push(l ? pad + "  " + l : "");
      walk(c.children ?? [], d + 1);
    }
  };
  walk(items, 0);
  return out.join("\n") + (out.length ? "\n" : "");
}

// ---------- раскладка boards.json ----------
// { version: 2, rows: [ { color, fill, name?, sheets: [ { name, color, width, height, mode?, icon? } ] } ] }; name ряда и icon листа (эмодзи или chrome://…svg из выбора значков Zen) пишутся, только когда заданы; старый вид — массив имён листов; у старого ряда была height — переезжает в его листы без своей высоты
export function normalizeLayout(raw, files) {
  const have = new Set(files), seen = new Set();
  const num = v => (typeof v == "number" && v > 0 && isFinite(v) ? Math.round(v) : null);
  const color = v => (typeof v == "string" && Object.hasOwn(COLORS, v) ? v : null);
  const sheet = (s, rowH) => {
    const o = typeof s == "string" ? { name: s } : s;
    if (typeof o?.name != "string" || !have.has(o.name) || seen.has(o.name)) return null; // записи без файла выбрасываются
    seen.add(o.name);
    return { name: o.name, color: color(o.color), width: num(o.width), height: num(o.height) ?? rowH, ...(o.mode === "doc" && { mode: "doc" }), ...(typeof o.icon == "string" && o.icon && o.icon.length < 300 && { icon: o.icon }) };
  };
  let rows = [];
  if (Array.isArray(raw)) rows = [{ sheets: raw }];
  else if (Array.isArray(raw?.rows)) rows = raw.rows.filter(r => r && typeof r == "object");
  rows = rows.map(r => ({ color: color(r.color), fill: r.fill === true, ...(typeof r.name == "string" && r.name.trim() && { name: r.name.trim().slice(0, 80) }), sheets: (Array.isArray(r.sheets) ? r.sheets : []).map(x => sheet(x, num(r.height))).filter(Boolean) }))
    .filter(r => r.sheets.length);
  if (!rows.length) rows.push({ color: null, fill: false, sheets: [] });
  rows.at(-1).sheets.push(...files.filter(f => !seen.has(f)).sort().map(name => ({ name, color: null, width: null, height: null }))); // файлы снаружи — в конец последнего ряда
  return { version: 2, rows };
}
// ---------- Markdown внутри строки и вид документа ----------
const INLINE = /`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(\S(?:[^\n]*?\S)?)\*\*|~~(\S(?:[^\n]*?\S)?)~~|(?<![\w*])\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?![\w*])|(?<![\w_])_(\S(?:[^_\n]*?\S)?)_(?![\w_])|(https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]])/gu;
// токены: { t: "text"|"code", s } | { t: "b"|"i"|"s", c: токены } | { t: "a", href, c: токены }; plain — внутри подписи ссылки (вложенных ссылок нет)
export function inline(text, plain = false) {
  const out = [], tx = s => s && out.push({ t: "text", s });
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (plain && (m[2] !== undefined || m[8] !== undefined)) continue;
    tx(text.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[1] !== undefined) out.push({ t: "code", s: m[1] });
    else if (m[2] !== undefined) out.push({ t: "a", href: m[3], c: inline(m[2], true) });
    else if (m[4] !== undefined) out.push({ t: "b", c: inline(m[4], plain) });
    else if (m[5] !== undefined) out.push({ t: "s", c: inline(m[5], plain) });
    else if (m[6] !== undefined || m[7] !== undefined) out.push({ t: "i", c: inline(m[6] ?? m[7], plain) });
    else out.push({ t: "a", href: m[8], c: [{ t: "text", s: m[8] }] });
  }
  tx(text.slice(at));
  return out;
}
// текст документа → блоки: { k: "h", n, text, line } | { k: "p", text, line } | { k: "li", depth, check: null|bool, text, line }; line — номер строки
export function docBlocks(text) {
  const out = [], stack = []; // stack — отступы (колонки) цепочки списков
  let para = null, li = null;
  text.replace(/\r\n/g, "\n").split("\n").forEach((line, i) => {
    const hd = HEAD.exec(line), m = MARK.exec(line);
    if (hd) { out.push({ k: "h", n: hd[1].length, text: hd[2], line: i }); para = li = null; stack.length = 0; }
    else if (m) {
      const col = cols(m[1]);
      while (stack.length && stack.at(-1) >= col) stack.pop();
      stack.push(col);
      out.push((li = { k: "li", depth: stack.length - 1, check: m[2] == null ? null : m[2] != " ", text: m[3], line: i }));
      para = null;
    } else if (!line.trim()) para = li = null;
    else if (li && /^[ \t]/.test(line)) li.text += "\n" + line.trim();
    else if (para) para.text += "\n" + line.trim();
    else { out.push((para = { k: "p", text: line.trim(), line: i })); li = null; stack.length = 0; }
  });
  return out;
}
// галочка "- [ ]" ↔ "- [x]" в строке line текста документа
export function docToggle(text, line) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  lines[line] = lines[line].replace(/^([ \t]*(?:[-*+]|\d{1,9}[.)]) \[)([ xX])(\])/, (_, a, c, z) => a + (c == " " ? "x" : " ") + z);
  return lines.join("\n");
}

const sheetNames = layout => layout.rows.flatMap(r => r.sheets.map(s => s.name));

// имя листа = имя файла: без символов, запрещённых в Windows
export const cleanName = name => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 80);
const file = name => `${DIR}/${name}.md`;

export const readRaw = async name => (await store.readText(file(name), "")) ?? "";
export const readSheet = async name => parse(await readRaw(name));
export async function writeRaw(name, text) {
  await store.writeText(file(name), text);
  Services.obs.notifyObservers(null, SAVED, name);
}
export const writeSheet = (name, items) => writeRaw(name, serialize(items));
const PREV = "notes/boards.prev.json"; // прежняя раскладка: запасная, если boards.json повреждён
const parseJSON = t => { try { return JSON.parse(t); } catch { return null; } };
const usable = raw => Array.isArray(raw) || Array.isArray(raw?.rows);
const sheetsIn = raw => (Array.isArray(raw) ? raw : Array.isArray(raw?.rows) ? raw.rows.flatMap(r => (Array.isArray(r?.sheets) ? r.sheets : [])) : [])
  .map(s => (typeof s == "string" ? s : s?.name)).filter(n => typeof n == "string");
const bases = new WeakMap(); // раскладка из readLayout → текст boards.json, который лежал на диске при чтении
export const baseOf = layout => bases.get(layout);
// Запись раскладки. base — текст boards.json, который читал вызывающий (null — файла не было): если на диске уже другой, не пишем
// и возвращаем null (устаревшая страница не затирает новую раскладку; вызывающий перечитывает). base не задан — пишем безусловно.
// Прежняя раскладка, если разборчива, перед заменой копируется в boards.prev.json. Возвращает записанный текст.
// shortcut: проверка и запись не атомарны (миллисекунды между чтением и заменой), upgrade — файловая блокировка, если понадобится
export async function writeLayout(layout, base) {
  const cur = await store.readText(ORDER, null); // сбой чтения бросает — раскладку не трогаем
  const text = JSON.stringify(layout);
  if (base !== undefined && cur !== base) return null;
  if (cur === text) return text;
  if (cur != null && usable(parseJSON(cur))) await store.writeText(PREV, cur);
  await store.writeText(ORDER, text);
  return text;
}

// три листа по умолчанию, только если папка действительно пуста: ни одного .md и раскладка не помнит листов (иначе список файлов просто не прочитался;
// так затирались «Дела»/«Идеи» и раскладка схлопывалась в один ряд). Существующие файлы листов не трогает. Зовёт страница Home; true — создано
export async function seedDefaults(names = DEFAULTS, hint = "Нажми на текст, чтобы изменить; новый пункт — внизу листа") { // l10n-skip: по умолчанию русские; Home передаёт переведённые
  if ((await store.list(DIR)).some(f => /\.md$/i.test(f))) return false;
  const text = await store.readText(ORDER, null);
  if (sheetsIn(parseJSON(text)).length) return false;
  for (const n of names) if ((await store.readText(file(n), null)) == null) await writeSheet(n, n == names[0] ? [{ text: hint, check: false, children: [] }] : []);
  return (await writeLayout(normalizeLayout(names, names), text)) != null; // порядок по умолчанию, не по алфавиту
}
// раскладка по файлам: старая (массив) переписывается, новые файлы дописываются; нет ни папки, ни листов — пустая раскладка, ничего не создаётся.
// Сбой чтения boards.json (занят, нет доступа) бросает ошибку и ничего не пишет; повреждённый — берётся boards.prev.json. На диск уходит раскладка
// без выбрасывания листов, чьих файлов сейчас не видно (список файлов мог прийти неполным); из возвращаемой раскладки они выбрасываются
export async function readLayout(retry = true) {
  const files = (await store.list(DIR)).filter(f => /\.md$/i.test(f)).map(f => f.slice(0, -3));
  if (!files.length) { // раскладка помнит листы, а файлов нет — папка сейчас не читается: ошибка, а не пустая доска (иначе новый лист затёр бы раскладку)
    if (sheetsIn(parseJSON(await store.readText(ORDER, null))).length) throw new DOMException("список листов пуст, а раскладка помнит листы" /* l10n-skip */, "InvalidStateError");
    return normalizeLayout(null, []);
  }
  const text = await store.readText(ORDER, null);
  let raw = text == null ? null : parseJSON(text);
  const broken = text != null && !usable(raw);
  if (broken) raw = parseJSON(await store.readText(PREV, null));
  if (!usable(raw)) raw = null;
  const layout = normalizeLayout(raw, files), keep = normalizeLayout(raw, [...files, ...sheetsIn(raw)]);
  let base = text;
  if (broken || JSON.stringify(raw) != JSON.stringify(keep)) {
    base = await writeLayout(keep, text);
    if (base == null) return retry ? readLayout(false) : layout; // пока считали, раскладку записал кто-то другой
  }
  bases.set(layout, base);
  return layout;
}
export const boardNames = async () => sheetNames(await readLayout());

// переименование/удаление обновляют раскладку на диске; возвращают новую раскладку
export async function renameSheet(from, to) {
  const layout = await readLayout(); // до переноса файла, иначе порядок потеряется
  await IOUtils.move(store.path(file(from)), store.path(file(to)), { noOverwrite: true });
  for (const r of layout.rows) for (const s of r.sheets) if (s.name == from) s.name = to;
  bases.set(layout, await writeLayout(layout));
  return layout;
}
// файл листа — в Корзину Windows (у Firefox нет своего вызова: PowerShell + Microsoft.VisualBasic SendToRecycleBin через Subprocess; путь — в переменной окружения,
// без кавычек); не вышло — в notes/.trash/<имя> <время>.md. Возвращает "bin" | "folder" | "dir" (pref luminoctis.notes.trash-dir)
export async function trashSheet(name) {
  const p = store.path(file(name)), dir = Services.prefs.getStringPref(TRASH_DIR, "");
  if (dir) { // скрытая настройка (проверки): удалённые листы уходят в эту папку, настоящая Корзина не трогается
    await IOUtils.makeDirectory(dir, { createAncestors: true });
    await IOUtils.move(p, PathUtils.join(dir, `${name} ${Date.now()}.md`));
    return "dir";
  }
  try {
    const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
    const ps = PathUtils.join(Services.dirsvc.get("WinD", Ci.nsIFile).path, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const proc = await Subprocess.call({ command: ps, environmentAppend: true, environment: { LUMI_TRASH: p },
      arguments: ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
        "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:LUMI_TRASH, 'OnlyErrorDialogs', 'SendToRecycleBin')"] });
    if ((await proc.wait()).exitCode === 0 && !(await IOUtils.exists(p))) return "bin";
  } catch {}
  await store.ensureDir(DIR + "/.trash");
  await IOUtils.move(p, store.path(`${DIR}/.trash/${name} ${new Date().toISOString().replace(/[:.]/g, "-")}.md`));
  return "folder";
}
export async function removeSheet(name, hard = false) { // hard — стереть насовсем (только для проверок)
  const layout = await readLayout();
  if (hard) await IOUtils.remove(store.path(file(name))); else await trashSheet(name);
  for (const r of layout.rows) r.sheets = r.sheets.filter(s => s.name != name);
  layout.rows = layout.rows.filter(r => r.sheets.length);
  if (!layout.rows.length) layout.rows.push({ color: null, fill: false, sheets: [] });
  bases.set(layout, await writeLayout(layout));
  Services.obs.notifyObservers(null, SAVED, name);
  return layout;
}

// быстрая заметка: дописать пункт в конец листа и сказать открытым Home перечитать (лист-документ — строкой в конец текста)
export async function addItem(name, it) {
  const item = { children: [], ...it };
  if ((await readLayout()).rows.some(r => r.sheets.some(s => s.name == name && s.mode == "doc"))) {
    const raw = await readRaw(name);
    await writeRaw(name, raw + (raw && !raw.endsWith("\n") ? "\n" : "") + serialize([item]));
  } else {
    const items = await readSheet(name);
    items.push(item);
    await writeSheet(name, items);
  }
  Services.obs.notifyObservers(null, CHANGED, name);
}
