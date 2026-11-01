// LumiNotes — канбан-доска под первым экраном Home (#lumi-notes; до неё долистывают прокруткой). Файлы и формат — home/notes-md.mjs.
// Доска = ряды (горизонтальные полосы) → листы (колонки, файлы notes\<лист>.md) → пункты. Всё правится сразу, режима правки нет:
// галочки, строка добавления внизу листа, клик по тексту пункта — поле, перетаскивание пунктов и листов (HTML5 DnD),
// ПКМ по пустому месту ряда — меню ряда, ПКМ по листу — меню листа, высота ряда и ширина листа тянутся за край.
// Раскладка (высота/цвет/fill ряда, цвет/ширина листа) — notes\boards.json (writeLayout). Сохранение листа: через 400 мс после правки
// (атомарно, store.js); ошибка — плашкой сверху, правка остаётся в памяти. Файлы, изменённые снаружи, перечитываются при возврате на Home.
import * as md from "./notes-md.mjs";

const root = document.getElementById("lumi-notes");
const win = window.browsingContext.topChromeWindow;
const DIR = "luminoctis.home.dir";
const MIN_H = 140, MIN_W = 180;
const NAMES = { red: "Красный", orange: "Оранжевый", yellow: "Жёлтый", green: "Зелёный", teal: "Бирюзовый", blue: "Синий", purple: "Фиолетовый", pink: "Розовый", gray: "Серый" };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, cls, title) => { const b = el("button", cls, text); b.type = "button"; if (title) b.title = title; return b; };

let boards = []; // все листы всех рядов подряд: [{ name, meta, cards: [{ text, check, start?, due?, children }], dirty, timer, saving, confirm, addCheck }]
let layout = null; // раскладка boards.json; meta листа — его запись в layout.rows[].sheets
let byMeta = new Map(); // meta → лист
const box = el("div", "lumi-boards");
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
  b.saving = (b.saving ?? Promise.resolve()).then(() => md.writeSheet(name, cards))
    .catch(e => { b.dirty = true; fail(e, `сохранить «${name}»`); });
  return b.saving;
}
const flushAll = () => Promise.all(boards.map(flush));
let lp = Promise.resolve(); // записи раскладки идут цепочкой
const saveLayout = () => (lp = lp.then(() => md.writeLayout(layout)).catch(e => fail(e, "сохранить раскладку")));
const sync = () => { boards = layout.rows.flatMap(r => r.sheets).map(m => byMeta.get(m)); }; // плоский список — по раскладке
const rowOf = b => layout.rows.find(r => r.sheets.includes(b.meta));

// ---------- чтение ----------
let loading = null;
async function load() {
  if (root.querySelector(".lumi-note-editor, .lumi-sheet-rename, .lumi-add-input:not(:placeholder-shown)") || drag) return; // идёт ввод — не мешаем
  try {
    await lp;
    const lay = await md.readLayout();
    const old = new Map(boards.map(b => [b.name, b])), map = new Map();
    await Promise.all(lay.rows.flatMap(r => r.sheets).map(async meta => {
      const b = old.get(meta.name);
      if (b?.dirty) return map.set(meta, Object.assign(b, { meta }));
      const cards = await md.readSheet(meta.name);
      map.set(meta, b ? Object.assign(b, { cards, meta }) : { name: meta.name, meta, cards });
    }));
    layout = lay;
    byMeta = map;
    sync();
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
function subList(items) { // подпункты пока только показываются (правка — этап 3C)
  const ul = el("ul", "lumi-sub");
  for (const c of items) {
    const li = el("li", c.check ? "done" : null, (c.check == null ? "" : c.check ? "☑ " : "☐ ") + c.text);
    if (c.children?.length) li.append(subList(c.children));
    ul.append(li);
  }
  return ul;
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
  const dates = [c.start && "🛫 " + c.start, c.due && "📅 " + c.due].filter(Boolean).join(" ");
  if (dates) t.append(el("span", "lumi-card-dates", " " + dates));
  if (c.children?.length) t.append(subList(c.children));
  const tools = el("span", "lumi-card-tools");
  tools.append(btn(c.check == null ? "☐" : "≡", "lumi-card-kind", c.check == null ? "Сделать пунктом с галочкой" : "Сделать обычной заметкой"),
    btn("×", "lumi-card-del", "Удалить пункт"));
  li.append(t, tools);
  return li;
}
const grip = (cls, title) => { const g = el("div", cls); g.title = title; return g; };
function sheetEl(b, row) {
  const s = el("section", "lumi-sheet");
  s._b = b;
  const color = b.meta.color ?? row.color;
  if (color) { s.classList.add("colored"); s.style.setProperty("--c", md.COLORS[color]); }
  s.style.setProperty("--w", (b.meta.width ?? 280) + "px");
  const head = el("header", "lumi-sheet-head");
  head.draggable = true;
  const tools = el("span", "lumi-sheet-tools");
  tools.append(btn("●", "lumi-sheet-color", "Цвет листа"));
  if (boards.length > 1) tools.append(btn("×", "lumi-sheet-del", "Удалить лист"));
  head.append(el("h3", "lumi-sheet-title", b.name), el("span", "lumi-sheet-count", b.cards.length || ""), tools);
  s.append(head);
  if (b.confirm) {
    const c = el("div", "lumi-confirm");
    c.append(el("span", null, `Удалить лист «${b.name}» вместе с файлом?`), btn("Удалить", "lumi-confirm-yes"), btn("Отмена", "lumi-confirm-no"));
    s.append(c);
  }
  const list = el("ul", "lumi-cards");
  list.append(...b.cards.map(cardEl));
  const foot = el("footer", "lumi-sheet-foot"), input = el("input", "lumi-add-input");
  input.placeholder = "Новый пункт…";
  input.spellcheck = false;
  foot.append(btn(b.addCheck ? "☐" : "≡", "lumi-add-kind", b.addCheck ? "Добавлять пункты с галочкой (нажми — заметки)" : "Добавлять заметки (нажми — пункты с галочкой)"), input);
  s.append(list, foot, grip("lumi-sheet-grip", "Ширина листа"));
  return s;
}
function rowEl(r) {
  const row = el("div", "lumi-row"), scroll = el("div", "lumi-row-scroll");
  row._r = r;
  row.classList.toggle("fill", r.fill);
  row.style.setProperty("--rc", r.color ? md.COLORS[r.color] : "transparent");
  row.style.height = (r.height ?? 360) + "px";
  scroll.append(...r.sheets.map(m => sheetEl(byMeta.get(m), r)), btn("+ лист", "lumi-add-sheet", "Новый лист в этом ряду"));
  row.append(scroll, grip("lumi-row-grip", "Высота ряда"));
  return row;
}
function render() {
  const keep = new Map([...box.querySelectorAll(".lumi-sheet")].map(s => [s._b, s.querySelector(".lumi-cards").scrollTop]));
  const left = new Map([...box.querySelectorAll(".lumi-row")].map(r => [r._r, r.firstChild.scrollLeft]));
  box.replaceChildren(...layout.rows.map(rowEl), btn("+ ряд", "lumi-add-row", "Новый ряд"));
  for (const s of box.querySelectorAll(".lumi-sheet")) s.querySelector(".lumi-cards").scrollTop = keep.get(s._b) ?? 0;
  for (const r of box.querySelectorAll(".lumi-row")) r.firstChild.scrollLeft = left.get(r._r) ?? 0;
}
const sheetNode = b => [...box.querySelectorAll(".lumi-sheet")].find(s => s._b == b);

// ---------- меню (своё, внутри страницы) ----------
let menu = null, menuAt = null;
const closeMenu = () => { menu?.remove(); menu = null; };
function setMenu(fill) {
  menu.replaceChildren();
  fill(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(menuAt.x, innerWidth - r.width - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(menuAt.y, innerHeight - r.height - 8)) + "px";
}
function openMenu(x, y, fill) {
  closeMenu();
  menu = el("div", "lumi-menu");
  menu.setAttribute("role", "menu");
  menuAt = { x, y };
  document.body.append(menu);
  setMenu(fill);
}
const item = (label, fn, off, title) => { const b = btn(label, "lumi-menu-item", title); b.disabled = !!off; b.onclick = fn; return b; };
const confirmView = (text, yes) => m => m.append(el("div", "lumi-menu-text", text), item("Удалить", yes), item("Отмена", closeMenu));
const palette = (cur, pick) => m => {
  const w = el("div", "lumi-swatches");
  for (const [k, hex] of Object.entries(md.COLORS)) {
    const b = btn("", "lumi-swatch" + (k == cur ? " on" : ""), NAMES[k]);
    b.style.background = hex;
    b.onclick = () => pick(k);
    w.append(b);
  }
  const none = btn("⊘", "lumi-swatch none" + (cur == null ? " on" : ""), "Без цвета");
  none.onclick = () => pick(null);
  w.append(none);
  m.append(w);
};
const changed = () => { closeMenu(); saveLayout(); render(); };

function rowMenu(r, x, y) {
  openMenu(x, y, m => m.append(
    item("Toggle fill mode", () => { r.fill = !r.fill; changed(); }),
    item("Цвет ряда", () => setMenu(palette(r.color, k => { r.color = k; changed(); }))),
    item("Добавить лист", () => addSheet(r)),
    item("Удалить ряд", () => setMenu(confirmView("Удалить ряд? Его листы переедут в соседний ряд.", () => deleteRow(r))), layout.rows.length < 2, "Единственный ряд удалить нельзя")));
}
function sheetMenu(b, x, y) {
  openMenu(x, y, m => m.append(
    item("Цвет листа", () => setMenu(palette(b.meta.color, k => { b.meta.color = k; changed(); }))),
    item("Переименовать", () => { closeMenu(); openRename(b); }),
    item("Удалить лист", () => { closeMenu(); b.confirm = true; render(); }, boards.length < 2, "Последний лист удалить нельзя")));
}

// ---------- правка ----------
function openEditor(b, j) {
  const li = sheetNode(b)?.querySelector(`.lumi-card[data-j="${j}"]`);
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
  const h = sheetNode(b)?.querySelector(".lumi-sheet-title");
  if (!h) return;
  const input = el("input", "lumi-sheet-rename");
  input.value = b.name;
  input.spellcheck = false;
  h.replaceWith(input);
  let done = false;
  const commit = async ok => {
    if (done) return;
    done = true;
    const name = md.cleanName(input.value);
    if (ok && name && name != b.name) {
      if (boards.some(o => o != b && o.name.toLowerCase() == name.toLowerCase())) fail(new Error("такой лист уже есть"), `переименовать в «${name}»`);
      else {
        try {
          await flush(b);
          await lp;
          await md.renameSheet(b.name, name); // сам обновляет boards.json на диске
          b.name = b.meta.name = name;
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

async function newSheet() {
  let name = "Новый лист";
  for (let k = 2; boards.some(b => b.name.toLowerCase() == name.toLowerCase()); k++) name = `Новый лист ${k}`;
  await md.writeSheet(name, []);
  const meta = { name, color: null, width: null }, b = { name, meta, cards: [] };
  byMeta.set(meta, b);
  return b;
}
async function addSheet(r, newRow) {
  closeMenu();
  let b;
  try { b = await newSheet(); } catch (e) { return fail(e, "создать лист"); }
  if (newRow) layout.rows.push((r = { height: null, color: null, fill: false, sheets: [] }));
  r.sheets.push(b.meta);
  sync();
  saveLayout();
  render();
  sheetNode(b)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  openRename(b);
}
async function deleteSheet(b) {
  clearTimeout(b.timer);
  try { await b.saving; await lp; await md.removeSheet(b.name); } catch (e) { b.confirm = false; render(); return fail(e, `удалить «${b.name}»`); }
  for (const r of layout.rows) r.sheets = r.sheets.filter(m => m != b.meta);
  layout.rows = layout.rows.filter(r => r.sheets.length);
  byMeta.delete(b.meta);
  sync();
  render();
}
function deleteRow(r) { // листы не пропадают: уезжают в соседний ряд (выше, иначе ниже)
  const i = layout.rows.indexOf(r), up = i > 0, to = layout.rows[up ? i - 1 : i + 1];
  if (up) to.sheets.push(...r.sheets); else to.sheets.unshift(...r.sheets);
  layout.rows.splice(i, 1);
  sync();
  changed();
}

function moveCard(from, j, to, k) {
  const [c] = from.cards.splice(j, 1);
  if (from == to && k > j) k--;
  to.cards.splice(k, 0, c);
  save(from);
  if (to != from) save(to);
  render();
}
function moveSheet(b, r, k) { // лист в ряд r на место k (индексы считаются с самим b)
  const from = rowOf(b), i = from.sheets.indexOf(b.meta);
  from.sheets.splice(i, 1);
  if (from == r && k > i) k--;
  r.sheets.splice(k, 0, b.meta);
  layout.rows = layout.rows.filter(x => x.sheets.length);
  sync();
  changed();
}

// ---------- события ----------
box.addEventListener("click", e => {
  const t = e.target;
  const a = t.closest("a.lumi-card-link");
  if (a) { e.preventDefault(); return win.openTrustedLinkIn(a.href, "tab"); }
  if (t.closest(".lumi-add-row")) return addSheet(null, true);
  const row = t.closest(".lumi-row")?._r, s = t.closest(".lumi-sheet"), b = s?._b;
  if (t.closest(".lumi-add-sheet")) return addSheet(row);
  if (!b || t.matches("input, textarea")) return;
  const j = Number(t.closest(".lumi-card")?.dataset.j);
  if (t.closest(".lumi-card-del")) { b.cards.splice(j, 1); save(b); render(); }
  else if (t.closest(".lumi-card-kind")) { b.cards[j].check = b.cards[j].check == null ? false : null; save(b); render(); }
  else if (t.closest(".lumi-card-text")) openEditor(b, j);
  else if (t.closest(".lumi-add-kind")) { b.addCheck = !b.addCheck; render(); sheetNode(b).querySelector(".lumi-add-input").focus(); }
  else if (t.closest(".lumi-sheet-color")) { const r = t.getBoundingClientRect(); openMenu(r.left, r.bottom + 4, palette(b.meta.color, k => { b.meta.color = k; changed(); })); }
  else if (t.closest(".lumi-sheet-del")) { b.confirm = true; render(); }
  else if (t.closest(".lumi-confirm-yes")) deleteSheet(b);
  else if (t.closest(".lumi-confirm-no")) { b.confirm = false; render(); }
});
box.addEventListener("dblclick", e => {
  const b = e.target.closest(".lumi-sheet-title")?.closest(".lumi-sheet")?._b;
  if (b) openRename(b);
});
box.addEventListener("change", e => {
  if (!e.target.matches(".lumi-card input[type=checkbox]")) return;
  const b = e.target.closest(".lumi-sheet")._b, j = Number(e.target.closest(".lumi-card").dataset.j);
  b.cards[j].check = e.target.checked;
  e.target.closest(".lumi-card").classList.toggle("done", e.target.checked);
  save(b);
});
box.addEventListener("keydown", e => { // строка добавления внизу листа
  if (e.key != "Enter" || !e.target.matches(".lumi-add-input")) return;
  const b = e.target.closest(".lumi-sheet")._b, text = e.target.value.trim();
  if (!text) return;
  b.cards.push({ text, check: b.addCheck ? false : null, children: [] });
  save(b);
  render();
  const s = sheetNode(b);
  s.querySelector(".lumi-add-input").focus();
  s.querySelector(".lumi-cards").scrollTop = 1e6;
});
box.addEventListener("contextmenu", e => {
  if (e.target.matches("input, textarea")) return;
  const s = e.target.closest(".lumi-sheet"), r = e.target.closest(".lumi-row")?._r;
  if (!r) return;
  e.preventDefault();
  if (s) sheetMenu(s._b, e.clientX, e.clientY); else rowMenu(r, e.clientX, e.clientY);
});
document.addEventListener("pointerdown", e => { if (menu && !menu.contains(e.target)) closeMenu(); }, true);
addEventListener("scroll", closeMenu, { passive: true });
document.addEventListener("keydown", e => {
  if (e.key == "Escape" && menu) { e.preventDefault(); closeMenu(); }
});

// растягивание: высота ряда — за нижний край, ширина листа — за правый (pointer events, значение пишется в раскладку по отпусканию)
box.addEventListener("pointerdown", e => {
  const g = e.target.closest(".lumi-row-grip, .lumi-sheet-grip");
  if (!g || e.button) return;
  e.preventDefault();
  const rowG = g.classList.contains("lumi-row-grip"), node = g.parentNode, x0 = e.clientX, y0 = e.clientY;
  const size0 = rowG ? node.offsetHeight : node.offsetWidth, set = rowG ? node._r : node._b.meta;
  let v = size0;
  try { g.setPointerCapture(e.pointerId); } catch {} // синтетические события проверок не имеют активного указателя
  g.classList.add("active");
  g.onpointermove = ev => {
    v = Math.round(Math.max(rowG ? MIN_H : MIN_W, size0 + (rowG ? ev.clientY - y0 : ev.clientX - x0)));
    if (rowG) node.style.height = v + "px"; else node.style.setProperty("--w", v + "px");
  };
  g.onpointerup = g.onpointercancel = () => {
    g.onpointermove = g.onpointerup = g.onpointercancel = null;
    g.classList.remove("active");
    if (rowG) set.height = v; else set.width = v;
    saveLayout();
  };
});

// перетаскивание: пункты — внутри листа, между листами и рядами; листы — за шапку, внутри ряда и в другой ряд
let drag = null; // { card: true, b, j } | { b }
const clearMarks = () => box.querySelectorAll(".drop-before, .drop-end, .drop-left, .drop-right, .dragging").forEach(n => n.classList.remove("drop-before", "drop-end", "drop-left", "drop-right", "dragging"));
function dropTarget(e) {
  if (drag.card) {
    const s = e.target.closest?.(".lumi-sheet");
    if (!s) return null;
    const lis = [...s.querySelectorAll(".lumi-card")];
    let k = lis.findIndex(li => e.clientY < li.getBoundingClientRect().top + li.offsetHeight / 2);
    if (k < 0) k = lis.length;
    return { to: s._b, k, mark: lis[k] ?? s.querySelector(".lumi-cards"), cls: lis[k] ? "drop-before" : "drop-end" };
  }
  const row = e.target.closest?.(".lumi-row");
  if (!row) return null;
  const secs = [...row.querySelectorAll(".lumi-sheet")];
  let k = secs.findIndex(s => { const r = s.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; });
  if (k < 0) k = secs.length;
  return { r: row._r, k, mark: secs[k] ?? secs.at(-1), cls: secs[k] ? "drop-left" : "drop-right" };
}
box.addEventListener("dragstart", e => {
  const li = e.target.closest?.(".lumi-card"), b = e.target.closest?.(".lumi-sheet")?._b;
  if (!b || (!li && !e.target.closest?.(".lumi-sheet-head"))) return e.preventDefault();
  drag = li ? { card: true, b, j: Number(li.dataset.j) } : { b };
  e.dataTransfer.setData("text/plain", li ? b.cards[drag.j].text : b.name);
  e.dataTransfer.effectAllowed = "move";
  (li ?? e.target.closest(".lumi-sheet")).classList.add("dragging");
});
box.addEventListener("dragover", e => {
  if (!drag) return;
  const t = dropTarget(e);
  if (!t) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  box.querySelectorAll(".drop-before, .drop-end, .drop-left, .drop-right").forEach(n => n.classList.remove("drop-before", "drop-end", "drop-left", "drop-right"));
  t.mark.classList.add(t.cls);
});
box.addEventListener("drop", e => {
  if (!drag) return;
  const t = dropTarget(e), d = drag;
  e.preventDefault();
  drag = null;
  clearMarks();
  if (!t) return;
  if (d.card) moveCard(d.b, d.j, t.to, t.k); else moveSheet(d.b, t.r, t.k);
});
box.addEventListener("dragend", () => { drag = null; clearMarks(); });

// возврат на Home — перечитать (файл могли поправить снаружи); уход — дописать несохранённое
document.addEventListener("visibilitychange", () => (document.hidden ? flushAll() : reload()));
window.addEventListener("focus", reload);
window.addEventListener("pagehide", flushAll);
const onDir = () => flushAll().then(() => { boards = []; reload(); });
const onChanged = () => reload();
Services.prefs.addObserver(DIR, onDir);
Services.obs.addObserver(onChanged, md.CHANGED);
window.addEventListener("unload", () => {
  Services.prefs.removeObserver(DIR, onDir);
  Services.obs.removeObserver(onChanged, md.CHANGED);
});

// для dev/check-home-notes.js
window.lumiNotes = { get boards() { return boards; }, get layout() { return layout; }, reload, flushAll, moveCard, moveSheet };
reload();
