// LumiNotes — доски внизу Home (#lumi-notes). Файлы и формат — home/notes-md.mjs.
// Покой: из-под нижнего края видна шапка и первая карточка (pref luminoctis.notes.peek: 0/1/2 карточки).
// Наведение: доска выезжает целиком и «парит» (CSS). Клик по доске — режим редактирования (#lumi-notes.editing):
// все доски подняты, карточки правятся/перетаскиваются, доски добавляются/переименовываются/удаляются/переставляются.
// Выход — клик по обоям или Esc. Смена режима — только класс: подъём/спуск доски — CSS-переход (~0.26 с).
// render() пересобирает DOM — доски "летят" со старого места на новое (FLIP, Web Animations); при перетаскивании доски
// остальные раздвигаются свойством translate, отпущенная встаёт на готовое место.
// Сохранение: каждая доска пишется через 400 мс после правки (атомарно, store.js); ошибка — плашкой сверху, правка остаётся в памяти.
// Файлы, изменённые снаружи, перечитываются при возврате на Home (кроме досок с несохранёнными правками).
import * as md from "./notes-md.mjs";

const root = document.getElementById("lumi-notes");
const win = window.browsingContext.topChromeWindow;
const PEEK = "luminoctis.notes.peek", DIR = "luminoctis.home.dir";
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, cls, title) => { const b = el("button", cls, text); b.type = "button"; if (title) b.title = title; return b; };

let boards = []; // [{ name, cards: [{ text, check: null|bool }], dirty, timer, saving, confirm }]
const box = el("div", "lumi-boards");
const addBoardBtn = btn("+ Доска", "lumi-add-board lumi-edit-only", "Новая доска");
const errBox = el("div", "lumi-notes-error");
errBox.hidden = true;
errBox.title = "Скрыть";
errBox.onclick = () => (errBox.hidden = true);
root.replaceChildren(box, errBox);

function fail(e, what) {
  console.error("LumiNotes:", what, e);
  errBox.textContent = `LumiNotes: не удалось ${what} — ${e?.message ?? e}`;
  errBox.hidden = false;
}

// ---------- сохранение ----------
function save(b) {
  b.dirty = true;
  clearTimeout(b.timer);
  b.timer = setTimeout(() => flush(b), 400);
}
function flush(b) {
  clearTimeout(b.timer);
  if (!b.dirty) return b.saving;
  b.dirty = false;
  const cards = b.cards.map(c => ({ ...c })), name = b.name;
  b.saving = (b.saving ?? Promise.resolve()).then(() => md.writeBoard(name, cards))
    .catch(e => { b.dirty = true; fail(e, `сохранить «${name}»`); });
  return b.saving;
}
const flushAll = () => Promise.all(boards.map(flush));
const saveOrder = () => md.writeOrder(boards.map(b => b.name)).catch(e => fail(e, "сохранить порядок досок"));

// ---------- чтение ----------
let loading = null;
async function load() {
  if (root.querySelector(".lumi-note-editor, .lumi-board-rename") || drag) return; // идёт ввод — не мешаем
  try {
    const names = await md.boardNames();
    const old = new Map(boards.map(b => [b.name, b]));
    const next = await Promise.all(names.map(async name => {
      const b = old.get(name);
      if (b?.dirty) return b;
      const cards = await md.readBoard(name);
      return b ? Object.assign(b, { cards }) : { name, cards };
    }));
    boards = next;
  } catch (e) { return fail(e, "прочитать заметки"); }
  render();
}
const reload = () => (loading ??= load().finally(() => (loading = null)));

// ---------- отрисовка ----------
function linkify(node, text) { // [подпись](https://…) — ссылка (так пишет быстрая заметка)
  const re = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    node.append(text.slice(at, m.index));
    const a = el("a", "lumi-card-link", m[1]);
    a.href = m[2];
    a.title = m[2];
    node.append(a);
    at = m.index + m[0].length;
  }
  node.append(text.slice(at));
}
function cardEl(c, j) {
  const li = el("li", "lumi-card");
  li.dataset.j = j;
  li.draggable = true;
  if (c.check != null) {
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = c.check;
    li.append(cb);
    li.classList.toggle("done", c.check);
  }
  const t = el("div", "lumi-card-text");
  linkify(t, c.text);
  const tools = el("span", "lumi-card-tools lumi-edit-only");
  tools.append(btn(c.check == null ? "☐" : "≡", "lumi-card-kind", c.check == null ? "Сделать пунктом с галочкой" : "Сделать обычной заметкой"),
    btn("×", "lumi-card-del", "Удалить карточку"));
  li.append(t, tools);
  return li;
}
function boardEl(b, i) {
  const s = el("section", "lumi-board");
  s.dataset.i = i;
  s._b = b; // для FLIP в render()
  const body = el("div", "lumi-board-body");
  const head = el("header", "lumi-board-head");
  head.draggable = true;
  head.append(el("h3", "lumi-board-title", b.name), el("span", "lumi-board-count", b.cards.length || ""));
  if (boards.length > 1) head.append(btn("×", "lumi-board-del lumi-edit-only", "Удалить доску"));
  body.append(head);
  if (b.confirm) {
    const c = el("div", "lumi-confirm");
    c.append(el("span", null, `Удалить доску «${b.name}» вместе с файлом?`), btn("Удалить", "lumi-confirm-yes"), btn("Отмена", "lumi-confirm-no"));
    body.append(c);
  }
  const list = el("ul", "lumi-cards");
  list.append(...b.cards.map(cardEl));
  const foot = el("footer", "lumi-board-foot lumi-edit-only");
  const add = (text, kind, title) => { const a = btn(text, "lumi-add", title); a.dataset.kind = kind; return a; };
  foot.append(add("+ Заметка", "text", "Новая карточка с текстом"), add("+ Пункт", "check", "Новый пункт с галочкой"));
  body.append(list, foot);
  s.append(body);
  return s;
}
const calm = () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function render() {
  const scroll = [...box.querySelectorAll(".lumi-cards")].map(l => l.scrollTop);
  const old = new Map([...box.querySelectorAll(".lumi-board")].map(s => [s._b, { x: s.getBoundingClientRect().left, t: getComputedStyle(s).transform }]));
  box.replaceChildren(...boards.map(boardEl), addBoardBtn);
  box.querySelectorAll(".lumi-cards").forEach((l, i) => (l.scrollTop = scroll[i] ?? 0));
  peek();
  if (!calm()) for (const s of box.querySelectorAll(".lumi-board")) { // FLIP: с прежнего места (по горизонтали и высоте подъёма) на новое
    const o = old.get(s._b), t = getComputedStyle(s).transform;
    if (!o) continue;
    const dx = o.x - s.getBoundingClientRect().left;
    if (o.t == t && Math.abs(dx) < 1) continue;
    s.animate({ transform: [`translateX(${dx}px) ${o.t == "none" ? "" : o.t}`.trim(), t] }, { duration: 240, easing: "cubic-bezier(.2, .9, .25, 1)" });
  }
}
// сколько доски видно в покое: шапка + N первых карточек (в покое карточки обрезаны до 3 строк)
function peek() {
  if (root.classList.contains("editing")) return;
  const n = Number(Services.prefs.getStringPref(PEEK, "1")) || 0;
  for (const s of box.querySelectorAll(".lumi-board")) {
    const cards = s.querySelectorAll(".lumi-card");
    const last = cards[Math.min(n, cards.length) - 1] ?? s.querySelector(".lumi-board-head");
    const top = s.getBoundingClientRect().top;
    s.style.setProperty("--peek", `${Math.ceil(last.getBoundingClientRect().bottom - top + 12)}px`);
  }
}

// ---------- режим редактирования ----------
function setEditing(on) {
  if (root.classList.contains("editing") == on) return;
  root.querySelector(".lumi-note-editor, .lumi-board-rename")?.blur();
  root.classList.toggle("editing", on);
  if (!on) {
    for (const b of boards) b.confirm = false;
    flushAll();
    render();
  }
}
const editing = () => root.classList.contains("editing");
const boardOf = node => boards[node.closest(".lumi-board")?.dataset.i];

function openEditor(b, j) {
  const li = box.querySelector(`.lumi-board[data-i="${boards.indexOf(b)}"] .lumi-card[data-j="${j}"]`);
  if (!li) return;
  const ta = el("textarea", "lumi-note-editor");
  ta.value = b.cards[j].text;
  ta.rows = Math.min(8, ta.value.split("\n").length + 1);
  li.draggable = false;
  li.querySelector(".lumi-card-text").replaceWith(ta);
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const text = ta.value.replace(/\s+$/, "").replace(/^\n+/, "");
    if (text) b.cards[j].text = text; else b.cards.splice(j, 1);
    save(b);
    render();
  };
  ta.addEventListener("blur", commit);
  ta.addEventListener("input", () => (ta.rows = Math.min(8, ta.value.split("\n").length + 1)));
  ta.addEventListener("keydown", e => {
    if ((e.key == "Enter" && !e.shiftKey) || e.key == "Escape") { e.preventDefault(); e.stopPropagation(); commit(); }
  });
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function openRename(b) {
  const h = box.querySelector(`.lumi-board[data-i="${boards.indexOf(b)}"] .lumi-board-title`);
  const input = el("input", "lumi-board-rename");
  input.value = b.name;
  input.spellcheck = false;
  h.replaceWith(input);
  let done = false;
  const commit = async ok => {
    if (done) return;
    done = true;
    const name = md.cleanName(input.value);
    if (ok && name && name != b.name) {
      if (boards.some(o => o != b && o.name.toLowerCase() == name.toLowerCase())) fail(new Error("такая доска уже есть"), `переименовать в «${name}»`);
      else {
        try {
          await flush(b);
          await md.renameBoard(b.name, name);
          b.name = name;
          await saveOrder();
        } catch (e) { fail(e, `переименовать «${b.name}»`); }
      }
    }
    render();
  };
  input.addEventListener("blur", () => commit(true));
  input.addEventListener("keydown", e => {
    if (e.key == "Enter" || e.key == "Escape") { e.preventDefault(); e.stopPropagation(); commit(e.key == "Enter"); }
  });
  input.focus();
  input.select();
}

async function addBoard() {
  let name = "Новая доска";
  for (let k = 2; boards.some(b => b.name.toLowerCase() == name.toLowerCase()); k++) name = `Новая доска ${k}`;
  try { await md.writeBoard(name, []); } catch (e) { return fail(e, "создать доску"); }
  boards.push({ name, cards: [] });
  await saveOrder();
  render();
  box.lastElementChild.previousElementSibling?.scrollIntoView({ inline: "nearest", behavior: "smooth" });
  openRename(boards.at(-1));
}
async function deleteBoard(b) {
  clearTimeout(b.timer);
  try { await b.saving; await md.removeBoard(b.name); } catch (e) { b.confirm = false; render(); return fail(e, `удалить «${b.name}»`); }
  boards.splice(boards.indexOf(b), 1);
  await saveOrder();
  render();
}

function moveCard(from, j, to, k) {
  const [c] = from.cards.splice(j, 1);
  if (from == to && k > j) k--;
  to.cards.splice(k, 0, c);
  save(from);
  if (to != from) save(to);
  render();
}
function moveBoard(i, k) {
  const [b] = boards.splice(i, 1);
  if (k > i) k--;
  boards.splice(k, 0, b);
  saveOrder();
  render();
}

// ---------- события ----------
box.addEventListener("click", e => {
  const t = e.target;
  const a = t.closest("a.lumi-card-link");
  if (a) { e.preventDefault(); return win.openTrustedLinkIn(a.href, "tab"); }
  if (t == addBoardBtn) return addBoard();
  const b = boardOf(t);
  if (!b || t.matches("input[type=checkbox], textarea, input")) return;
  if (!editing()) return setEditing(true);
  const li = t.closest(".lumi-card"), j = Number(li?.dataset.j);
  if (t.closest(".lumi-card-del")) { b.cards.splice(j, 1); save(b); render(); }
  else if (t.closest(".lumi-card-kind")) { b.cards[j].check = b.cards[j].check == null ? false : null; save(b); render(); }
  else if (t.closest(".lumi-card-text")) openEditor(b, j);
  else if (t.closest(".lumi-add")) {
    b.cards.push({ text: "", check: t.dataset.kind == "check" ? false : null });
    render();
    openEditor(b, b.cards.length - 1);
    box.querySelector(".lumi-note-editor")?.scrollIntoView({ block: "nearest" });
  }
  else if (t.closest(".lumi-board-title")) openRename(b);
  else if (t.closest(".lumi-board-del")) { b.confirm = true; render(); }
  else if (t.closest(".lumi-confirm-yes")) deleteBoard(b);
  else if (t.closest(".lumi-confirm-no")) { b.confirm = false; render(); }
});
box.addEventListener("change", e => {
  if (!e.target.matches(".lumi-card input[type=checkbox]")) return;
  const b = boardOf(e.target), j = Number(e.target.closest(".lumi-card").dataset.j);
  b.cards[j].check = e.target.checked;
  e.target.closest(".lumi-card").classList.toggle("done", e.target.checked);
  save(b);
});

// перетаскивание: карточки — внутри доски и между досками, доски — за шапку
let drag = null; // { card: true, b, j } | { b, i, base: [{ left, width }], k }
const clearMarks = () => box.querySelectorAll(".drop-before, .drop-end, .dragging").forEach(n => n.classList.remove("drop-before", "drop-end", "dragging"));
const clearShift = () => box.querySelectorAll(".lumi-board").forEach(s => (s.style.translate = ""));
// доски раздвигаются: перетаскиваемая встаёт на новое место (k — куда вставить), остальные съезжают на её ширину
function shiftBoards(k) {
  const secs = [...box.querySelectorAll(".lumi-board")], { i, base } = drag, order = secs.map((_, n) => n);
  order.splice(i, 1);
  order.splice(k > i ? k - 1 : k, 0, i);
  const gap = base.length > 1 ? base[1].left - base[0].left - base[0].width : 14;
  let x = base[0].left;
  for (const n of order) { secs[n].style.translate = `${x - base[n].left}px 0`; x += base[n].width + gap; }
}
function dropTarget(e) {
  const s = e.target.closest?.(".lumi-board");
  if (drag.card) {
    if (!s) return null;
    const lis = [...s.querySelectorAll(".lumi-card")];
    let k = lis.findIndex(li => e.clientY < li.getBoundingClientRect().top + li.offsetHeight / 2);
    if (k < 0) k = lis.length;
    return { to: boards[s.dataset.i], k, mark: lis[k] ?? s.querySelector(".lumi-cards"), cls: lis[k] ? "drop-before" : "drop-end" };
  }
  let k = drag.base.findIndex(r => e.clientX < r.left + r.width / 2); // по положению до сдвигов, иначе дрожит
  if (k < 0) k = drag.base.length;
  return { k };
}
box.addEventListener("dragstart", e => {
  const li = e.target.closest?.(".lumi-card"), b = boardOf(e.target);
  if (!editing() || !b || (!li && !e.target.closest?.(".lumi-board-head"))) return e.preventDefault();
  drag = li ? { card: true, b, j: Number(li.dataset.j) }
    : { b, i: boards.indexOf(b), k: -1, base: [...box.querySelectorAll(".lumi-board")].map(s => { const r = s.getBoundingClientRect(); return { left: r.left, width: r.width }; }) };
  e.dataTransfer.setData("text/plain", li ? b.cards[drag.j].text : b.name);
  e.dataTransfer.effectAllowed = "move";
  (li ?? e.target.closest(".lumi-board")).classList.add("dragging");
});
box.addEventListener("dragover", e => {
  if (!drag) return;
  const t = dropTarget(e);
  if (!t) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  if (!drag.card) { if (t.k != drag.k) shiftBoards((drag.k = t.k)); return; }
  box.querySelectorAll(".drop-before, .drop-end").forEach(n => n.classList.remove("drop-before", "drop-end"));
  t.mark.classList.add(t.cls);
});
box.addEventListener("drop", e => {
  if (!drag) return;
  const t = dropTarget(e), d = drag;
  e.preventDefault();
  drag = null;
  clearMarks();
  if (!t) return clearShift();
  if (d.card) moveCard(d.b, d.j, t.to, t.k);
  else moveBoard(boards.indexOf(d.b), t.k);
});
box.addEventListener("dragend", () => { drag = null; clearMarks(); clearShift(); });

// выход из редактирования: клик мимо досок (обои, часы) или Esc
document.addEventListener("click", e => {
  // isConnected: клик по карточке, пересобранной после ввода, — не «мимо»
  if (editing() && e.target.isConnected && !e.target.closest(".lumi-board, .lumi-add-board, .lumi-notes-error, #lumi-time")) setEditing(false);
});
document.addEventListener("keydown", e => {
  if (e.key == "Escape" && editing() && !e.defaultPrevented) setEditing(false);
});

// возврат на Home — перечитать (файл могли поправить снаружи); уход — дописать несохранённое
document.addEventListener("visibilitychange", () => (document.hidden ? flushAll() : reload()));
window.addEventListener("focus", reload);
window.addEventListener("pagehide", flushAll);
window.addEventListener("resize", peek);
const onPeek = () => peek();
const onDir = () => flushAll().then(() => { boards = []; reload(); });
const onChanged = () => reload();
Services.prefs.addObserver(PEEK, onPeek);
Services.prefs.addObserver(DIR, onDir);
Services.obs.addObserver(onChanged, md.CHANGED);
window.addEventListener("unload", () => {
  Services.prefs.removeObserver(PEEK, onPeek);
  Services.prefs.removeObserver(DIR, onDir);
  Services.obs.removeObserver(onChanged, md.CHANGED);
});

// для dev/check-home-notes.js
window.lumiNotes = { get boards() { return boards; }, reload, flushAll, setEditing, editing, moveCard, moveBoard, peek };
reload();
