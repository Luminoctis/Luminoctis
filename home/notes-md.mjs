// LumiNotes: доски = файлы <папка данных>\notes\<доска>.md, порядок досок — notes\boards.json (массив имён).
// Общий модуль страницы Home (home/notes.js) и быстрой заметки из контекстного меню (js/lumi-notes-capture.uc.js:
// ChromeUtils.importESModule("chrome://userchrome/content/luminoctis/home/notes-md.mjs")).
// Формат: "- [ ] пункт" / "- [x] сделано" / "- заметка"; следующие строки карточки — с отступом 2 пробела (или таб).
// Посторонние строки (заголовок, абзац из внешнего редактора) становятся отдельной карточкой — ничего не теряется.
import * as store from "./store.js";

export const DIR = "notes";
export const ORDER = "notes/boards.json";
export const DEFAULTS = ["Сегодня", "Дела", "Идеи"];
export const CHANGED = "lumi-notes-changed"; // Services.obs: файлы досок изменены не страницей Home

export function parse(md) {
  const cards = [];
  let cur = null, blanks = 0;
  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    const m = /^[-*+](?: |$)(?:\[([ xX])\](?: |$))?(.*)$/.exec(line);
    if (m) { cur = { text: m[2], check: m[1] == null ? null : m[1] != " " }; cards.push(cur); blanks = 0; }
    else if (!line.trim()) { if (cur) blanks++; }
    else if (cur && /^(\t| {2})/.test(line)) { cur.text += "\n".repeat(blanks + 1) + line.replace(/^(\t| {2})/, ""); blanks = 0; }
    else { cur = { text: line, check: null }; cards.push(cur); blanks = 0; }
  }
  return cards;
}
export const serialize = cards => cards.map(c =>
  (c.check == null ? "- " : c.check ? "- [x] " : "- [ ] ") +
  c.text.split("\n").map((l, i) => (i && l ? "  " + l : l)).join("\n")).join("\n") + (cards.length ? "\n" : "");

// имя доски = имя файла: без символов, запрещённых в Windows
export const cleanName = name => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 80);
const file = name => `${DIR}/${name}.md`;

export const readBoard = async name => parse((await store.readText(file(name), "")) ?? "");
export const writeBoard = (name, cards) => store.writeText(file(name), serialize(cards));
export const writeOrder = names => store.writeJSON(ORDER, names);

// доски по порядку boards.json, новые файлы (созданные снаружи) — в конце; нет ни одной — создаёт три по умолчанию
export async function boardNames() {
  const files = (await store.list(DIR)).filter(f => /\.md$/i.test(f)).map(f => f.slice(0, -3));
  if (!files.length) {
    await writeBoard(DEFAULTS[0], [{ text: "Нажми на доску, чтобы редактировать", check: false }]);
    for (const n of DEFAULTS.slice(1)) await writeBoard(n, []);
    await writeOrder(DEFAULTS);
    return [...DEFAULTS];
  }
  let order = [];
  try { order = await store.readJSON(ORDER, []); } catch {} // битый порядок — не страшно, перепишется
  if (!Array.isArray(order)) order = [];
  return [...order.filter(n => files.includes(n)), ...files.filter(n => !order.includes(n)).sort()];
}

export async function renameBoard(from, to) {
  await IOUtils.move(store.path(file(from)), store.path(file(to)), { noOverwrite: true });
}
export const removeBoard = name => IOUtils.remove(store.path(file(name)));

// быстрая заметка: дописать карточку в конец доски и сказать открытым Home перечитать
export async function addCard(name, card) {
  const cards = await readBoard(name);
  cards.push(card);
  await writeBoard(name, cards);
  Services.obs.notifyObservers(null, CHANGED, name);
}
