// LumiNotes — канбан-доска под первым экраном Home (#lumi-notes; до неё долистывают прокруткой). Файлы и формат — home/notes-md.mjs.
// Доска = ряды (горизонтальные полосы) → листы (колонки, файлы notes\<лист>.md) → пункты. Всё правится сразу, режима правки нет:
// галочки, строка добавления внизу листа, клик по тексту пункта — поле, перетаскивание пунктов и листов (HTML5 DnD),
// ПКМ по пустому месту ряда — меню ряда, ПКМ по листу — меню листа, высота ряда и ширина листа тянутся за край.
// Markdown в тексте пунктов рисует renderInline (md.inline → createElement). Лист в режиме "doc" (меню листа) — цельный Markdown-текст: оформленный вид, клик — правка всего листа. Удаление пункта/листа — плашка «Отменить» (pushUndo, Ctrl+Z); файл листа уходит в Корзину.
// Пункт — задача (check — bool, есть галочка и даты) или заметка (check — null). Подпункты — любой глубины: на экране дерево лежит плоским
// списком (.lumi-card, отступ --d), путь пункта — индексы от корня листа ("0.2.1" в data-p). Свёрнутые пункты помнит только память.
// Раскладка (высота/цвет/fill ряда, цвет/ширина листа) — notes\boards.json (writeLayout). Сохранение листа: через 400 мс после правки
// (атомарно, store.js); ошибка — плашкой сверху, правка остаётся в памяти. Файлы, изменённые снаружи, перечитываются при возврате на Home.
import * as md from "./notes-md.mjs";
import { JS } from "./paths.js";
const { locale } = ChromeUtils.importESModule(JS("lumi-i18n.sys.mjs"));

const root = document.getElementById("lumi-notes");
const win = window.browsingContext.topChromeWindow;
const DIR = "luminoctis.home.dir", NEW = "luminoctis.home.notes.new"; // NEW: "task" | "note" — чем становится новый пункт
const MIN_H = 140, MIN_W = 180;
const NAMES = { red: "Красный", orange: "Оранжевый", yellow: "Жёлтый", green: "Зелёный", teal: "Бирюзовый", blue: "Синий", purple: "Фиолетовый", pink: "Розовый", gray: "Серый" };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, cls, title) => { const b = el("button", cls, text); b.type = "button"; if (title) b.title = title; return b; };

let boards = []; // все листы всех рядов подряд: [{ name, meta, cards: [{ text, check, start?, due?, children }], dirty, timer, saving, confirm, kind, draft }]
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
  const doc = isDoc(b), data = doc ? b.text ?? "" : b.cards.map(c => ({ ...c })), name = b.name;
  b.saving = (b.saving ?? Promise.resolve()).then(() => (doc ? md.writeRaw(name, data) : md.writeSheet(name, data)))
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
  if (root.querySelector(".lumi-note-editor, .lumi-doc-editor, .lumi-sheet-rename, .lumi-sub-input, .lumi-add-input:not(:placeholder-shown)") || drag) return; // идёт ввод — не мешаем
  try {
    await lp;
    const lay = await md.readLayout();
    const old = new Map(boards.map(b => [b.name, b])), map = new Map();
    await Promise.all(lay.rows.flatMap(r => r.sheets).map(async meta => {
      const b = old.get(meta.name);
      if (b?.dirty) return map.set(meta, Object.assign(b, { meta }));
      if (meta.mode == "doc") return map.set(meta, Object.assign(b ?? { name: meta.name, cards: [] }, { meta, cards: [], text: await md.readRaw(meta.name) }));
      const cards = await md.readSheet(meta.name);
      const same = b && md.serialize(cards) == md.serialize(b.cards); // не менялось — оставить объекты (на них держится «свёрнуто»)
      map.set(meta, b ? Object.assign(b, { cards: same ? b.cards : cards, meta }) : { name: meta.name, meta, cards });
    }));
    layout = lay;
    byMeta = map;
    sync();
  } catch (e) { return fail(e, "прочитать заметки"); }
  render();
  Services.obs.notifyObservers(null, md.SAVED); // рейка пересчитывает точку задач; Home на SAVED не подписана
}
const reload = () => (loading ??= load().finally(() => (loading = null)));

// ---------- отрисовка ----------
// Markdown внутри строки (md.inline) → DOM-узлы; только createElement/textContent. Ссылки открываются во вкладке (обработчик click ниже)
const TAGS = { b: "strong", i: "em", s: "del" };
function renderInline(node, text) {
  const put = (parent, tokens) => {
    for (const t of tokens) {
      if (t.t == "text") parent.append(t.s);
      else if (t.t == "code") parent.append(el("code", "lumi-code", t.s));
      else if (t.t == "a") { const a = el("a", "lumi-card-link"); a.href = a.title = t.href; put(a, t.c); parent.append(a); }
      else { const n = el(TAGS[t.t]); put(n, t.c); parent.append(n); }
    }
  };
  put(node, md.inline(text));
}
// ---------- дерево пунктов: пути, даты ----------
const collapsed = new WeakSet(); // свёрнутые пункты (только память)
const pathOf = li => li.dataset.p.split(".").map(Number);
const inside = (p, root) => root.every((v, i) => p[i] === v); // p — это root или его потомок
const listAt = (b, p) => p.reduce((l, i) => l[i].children, b.cards); // список, в котором лежит пункт с путём p + [i]
const itemAt = (b, p) => listAt(b, p.slice(0, -1))[p.at(-1)];
function flat(items, path = [], depth = 0, out = []) { // дерево → строки экрана (свёрнутые потомки пропущены)
  items.forEach((c, i) => {
    out.push([c, [...path, i], depth]);
    if (!collapsed.has(c)) flat(c.children, [...path, i], depth + 1, out);
  });
  return out;
}
function tally(c) { // [выполнено, всего] задач среди всех потомков
  let done = 0, all = 0;
  for (const k of c.children) {
    if (k.check != null) { all++; if (k.check) done++; }
    const [d, a] = tally(k);
    done += d; all += a;
  }
  return [done, all];
}
const pad2 = n => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
function fmtDate(s) { // «5 нояб.», год — только если не текущий
  const [y, m, d] = s.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", ...(y != new Date().getFullYear() && { year: "numeric" }) }).format(new Date(y, m - 1, d));
}
// цвет меток: off — задача выполнена; late — срок прошёл (красный); today — сегодня срок (жёлтый); wait — начало впереди (серый); go — идёт (голубой)
function dateState(c, today) {
  if (c.check === true) return "off";
  if (c.due && today > c.due) return "late";
  if (c.due && today == c.due) return "today";
  return c.start && today < c.start ? "wait" : "go";
}
const wantTask = () => Services.prefs.getStringPref(NEW, "task") != "note";
const freshDraft = b => ({ task: b.kind ?? wantTask(), start: "", due: "" });
const newItem = (text, d) => ({ text, check: d.task ? false : null, ...(d.task && d.start && { start: d.start }), ...(d.task && d.due && { due: d.due }), children: [] });
// текст из поля ввода → пункты: список/заголовки (в том числе вставленные) раскладываются через parse, иначе один пункт (многострочный)
const itemsFrom = (text, d) => (md.listLike(text) ? md.parse(text) : [newItem(text, d)]);
const unhead = items => { for (const c of items) { if (c.heading) { c.text = "#".repeat(c.heading) + " " + c.text; delete c.heading; } unhead(c.children); } return items; }; // подпункты заголовками быть не могут
const grow = ta => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, 140) + "px"; };
function inputBox(cls) { // строка ввода: textarea в одну строку, растёт по тексту; Enter — добавить, Shift+Enter — перенос
  const ta = el("textarea", cls);
  ta.rows = 1;
  ta.spellcheck = false;
  ta.addEventListener("input", () => grow(ta));
  return ta;
}

function cardEl(c, p, depth, today) {
  const li = el("li", "lumi-card");
  li.dataset.p = p.join(".");
  li.style.setProperty("--d", depth);
  li.draggable = true;
  if (c.heading) { // заголовок-разделитель: без галочки, свёртки и подпунктов
    li.classList.add("lumi-heading");
    li.dataset.level = c.heading;
    const t = el("div", "lumi-card-text"), body = el("span", "lumi-card-body");
    renderInline(body, c.text);
    t.append(body);
    const tools = el("span", "lumi-card-tools");
    tools.append(btn("×", "lumi-card-del", "Удалить заголовок"));
    li.append(t, tools);
    return li;
  }
  li.append(c.children.length ? btn(collapsed.has(c) ? "▸" : "▾", "lumi-fold", collapsed.has(c) ? "Развернуть" : "Свернуть") : el("span", "lumi-fold"));
  if (c.check != null) {
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = c.check;
    li.append(cb);
    li.classList.toggle("done", c.check);
  }
  const t = el("div", "lumi-card-text"), body = el("span", "lumi-card-body");
  renderInline(body, c.text);
  t.append(body);
  if (c.start || c.due) {
    const dates = el("span", "lumi-card-dates");
    dates.dataset.state = dateState(c, today);
    for (const [k, icon] of [["start", "🛫"], ["due", "📅"]]) if (c[k]) { const s = el("span", null, `${icon} ${fmtDate(c[k])}`); s.title = c[k]; dates.append(s); }
    t.append(dates);
  }
  const [done, all] = c.check == null ? [0, 0] : tally(c);
  if (all) t.append(el("span", "lumi-card-count", `${done}/${all}`));
  const tools = el("span", "lumi-card-tools");
  tools.append(btn("+", "lumi-card-add-sub", "Добавить подпункт"), btn("×", "lumi-card-del", "Удалить пункт"));
  li.append(t, tools);
  return li;
}

// строка ввода (новый пункт внизу листа, подпункт, поле правки): переключатель задача ↔ заметка, у задачи — кнопки дат.
// d = { task, start, due } меняется на месте; field — input или textarea; onKind(task) — запомнить выбор.
function composer(d, field, onKind) {
  const wrap = el("div", "lumi-comp"), main = el("div", "lumi-comp-main"), dates = el("div", "lumi-comp-dates");
  const kind = btn("", "lumi-kind"), parts = [];
  main.append(kind, field);
  for (const [key, icon, name] of [["start", "🛫", "начало"], ["due", "📅", "срок"]]) {
    const w = el("span", "lumi-date"), b = btn("", "lumi-date-btn"), clear = btn("×", "lumi-date-clear", "Убрать дату"), inp = el("input");
    inp.type = "date";
    inp.tabIndex = -1;
    b.onclick = () => { try { inp.showPicker(); } catch { inp.focus(); } };
    inp.onchange = () => { d[key] = inp.value; refresh(); field.focus(); };
    clear.onclick = () => { d[key] = ""; refresh(); };
    w.append(b, inp, clear);
    dates.append(w);
    parts.push({ key, icon, name, b, inp, clear });
  }
  function refresh() {
    kind.textContent = d.task ? "☐" : "•";
    kind.title = d.task ? "Задача с галочкой. Нажми — сделать заметкой" : "Заметка без галочки. Нажми — сделать задачей";
    dates.hidden = !d.task;
    wrap.classList.toggle("has-date", !!(d.task && (d.start || d.due)));
    for (const { key, icon, name, b, inp, clear } of parts) {
      b.textContent = d[key] ? `${icon} ${fmtDate(d[key])}` : `${icon} ${name}`;
      b.title = d[key] ? `${name[0].toUpperCase()}${name.slice(1)}: ${d[key]}` : `Дата: ${name}`;
      inp.value = d[key];
      clear.hidden = !d[key];
    }
  }
  kind.onclick = () => {
    d.task = !d.task;
    if (!d.task) d.start = d.due = ""; // у заметок дат нет
    onKind?.(d.task);
    refresh();
    field.focus();
  };
  wrap.addEventListener("mousedown", e => { if (e.target.closest("button")) e.preventDefault(); }); // фокус остаётся в поле
  wrap.append(main, dates);
  refresh();
  return wrap;
}
const grip = (cls, title) => { const g = el("div", cls); g.title = title; return g; };
const isDoc = b => b.meta.mode == "doc";
function docEl(b) { // оформленный текст листа: заголовки, абзацы, списки с галочками (data-line — строка текста для docToggle)
  const doc = el("div", "lumi-cards lumi-doc");
  doc.title = "Нажми, чтобы править";
  const blocks = md.docBlocks(b.text ?? "");
  if (!blocks.length) doc.append(el("div", "lumi-doc-empty", "Нажми, чтобы писать…"));
  for (const k of blocks) {
    if (k.k == "li") {
      const row = el("div", "lumi-doc-li");
      row.style.setProperty("--d", k.depth);
      if (k.check == null) row.append(el("span", "lumi-doc-bullet", "•"));
      else {
        const cb = el("input");
        cb.type = "checkbox";
        cb.checked = k.check;
        cb.dataset.line = k.line;
        row.append(cb);
        row.classList.toggle("done", k.check);
      }
      const t = el("span", "lumi-doc-text");
      renderInline(t, k.text);
      row.append(t);
      doc.append(row);
    } else {
      const n = el(k.k == "h" ? "div" : "p", k.k == "h" ? "lumi-doc-h" : "lumi-doc-p");
      if (k.k == "h") n.dataset.level = k.n;
      renderInline(n, k.text);
      doc.append(n);
    }
  }
  return doc;
}
function openDocEdit(b) { // правка всего листа: исходный Markdown в textarea; клик мимо / Esc — сохранить
  const sn = sheetNode(b), doc = sn?.querySelector(".lumi-doc");
  if (!doc) return;
  const ta = el("textarea", "lumi-doc-editor");
  ta.value = b.text ?? "";
  ta.spellcheck = false;
  doc.replaceWith(ta);
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    if (ta.value != (b.text ?? "")) { b.text = ta.value; save(b); }
    render();
  };
  ta.addEventListener("blur", commit);
  ta.addEventListener("keydown", e => { if (e.key == "Escape") { e.preventDefault(); e.stopPropagation(); commit(); } });
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}
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
  if (isDoc(b)) { // лист-документ: цельный оформленный текст, без строки добавления
    s.classList.add("is-doc");
    s.append(docEl(b), grip("lumi-sheet-grip", "Ширина листа"));
    return s;
  }
  const list = el("ul", "lumi-cards"), today = todayStr();
  list.append(...flat(b.cards).map(([c, p, depth]) => cardEl(c, p, depth, today)));
  const foot = el("footer", "lumi-sheet-foot"), input = inputBox("lumi-add-input"), d = (b.draft ??= freshDraft(b));
  input.placeholder = "Новый пункт…";
  input.addEventListener("keydown", e => {
    const text = input.value.trim();
    if (e.key != "Enter" || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    if (!text) return;
    b.cards.push(...itemsFrom(text, d));
    b.draft = null;
    save(b);
    render();
    const s = sheetNode(b);
    s.querySelector(".lumi-add-input").focus();
    s.querySelector(".lumi-cards").scrollTop = 1e6;
  });
  foot.append(composer(d, input, task => (b.kind = task)));
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
  const keep = new Map([...box.querySelectorAll(".lumi-sheet")].map(s => [s._b, s.querySelector(".lumi-cards")?.scrollTop ?? 0]));
  const left = new Map([...box.querySelectorAll(".lumi-row")].map(r => [r._r, r.firstChild.scrollLeft]));
  box.replaceChildren(...layout.rows.map(rowEl), btn("+ ряд", "lumi-add-row", "Новый ряд"));
  for (const s of box.querySelectorAll(".lumi-sheet")) { const c = s.querySelector(".lumi-cards"); if (c) c.scrollTop = keep.get(s._b) ?? 0; }
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
    item(isDoc(b) ? "Сделать карточками" : "Сделать документом", () => setMode(b, !isDoc(b))),
    item("Удалить лист", () => { closeMenu(); b.confirm = true; render(); }, boards.length < 2, "Последний лист удалить нельзя")));
}

// ---------- правка ----------
const cardLi = (b, p) => sheetNode(b)?.querySelector(`.lumi-card[data-p="${p.join(".")}"]`);
function indent(b, p) { // подпункт предыдущего соседа; новый путь или null
  const i = p.at(-1);
  if (!i || itemAt(b, p).heading || itemAt(b, [...p.slice(0, -1), i - 1]).heading) return null; // заголовки подпунктов не берут и сами не вкладываются
  const sib = listAt(b, p.slice(0, -1)), [c] = sib.splice(i, 1), host = sib[i - 1];
  host.children.push(c);
  collapsed.delete(host);
  return [...p.slice(0, -1), i - 1, host.children.length - 1];
}
function outdent(b, p) { // соседом родителя сразу после него; новый путь или null
  if (p.length < 2) return null;
  const up = p.slice(0, -1), [c] = listAt(b, up).splice(p.at(-1), 1);
  listAt(b, up.slice(0, -1)).splice(up.at(-1) + 1, 0, c);
  return [...up.slice(0, -1), up.at(-1) + 1];
}

function openEditor(b, p, keep) { // keep — { text } черновик, который переезжает вместе с пунктом (Tab / Shift+Tab)
  const c = itemAt(b, p), li = cardLi(b, p);
  if (!c || !li) return;
  const ta = el("textarea", "lumi-note-editor"), d = { task: c.check != null, start: c.start ?? "", due: c.due ?? "" };
  ta.value = keep?.text ?? (c.heading ? "#".repeat(c.heading) + " " + c.text : c.text); // у заголовка в поле виден и маркер #
  ta.rows = Math.min(8, ta.value.split("\n").length + 1);
  li.draggable = false;
  const comp = c.heading ? ta : composer(d, ta);
  li.querySelector(".lumi-card-text").replaceWith(comp);
  let done = false;
  const clean = () => ta.value.replace(/\s+$/, "").replace(/^\n+/, "");
  const apply = text => {
    c.text = text;
    delete c.heading;
    c.check = d.task ? c.check ?? false : null;
    for (const k of ["start", "due"]) if (d[k]) c[k] = d[k]; else delete c[k];
  };
  const commit = () => {
    if (done) return;
    done = true;
    const text = clean(), list = listAt(b, p.slice(0, -1));
    if (text && md.listLike(text)) { // список или заголовок (в том числе вставленный) → несколько пунктов на месте этого; подпункты старого — последнему из них
      const items = md.parse(text), host = items.findLast(x => !x.heading);
      if (host) host.children.push(...c.children); else items.push(...c.children);
      list.splice(p.at(-1), 1, ...(p.length > 1 ? unhead(items) : items));
    }
    else if (text) apply(text);
    else if (!c.children.length) list.splice(p.at(-1), 1); // пустой текст убирает пункт, но не целое дерево
    save(b);
    render();
  };
  const move = fn => { // Tab / Shift+Tab: правка сохраняется и поле открывается на новом месте
    const text = clean();
    if (!text || md.listLike(text)) return;
    apply(text);
    const np = fn(b, p);
    if (!np) return; // некуда двигаться — поле остаётся открытым
    done = true;
    save(b);
    render();
    openEditor(b, np, { text: ta.value });
  };
  ta.addEventListener("blur", e => { if (!comp.contains(e.relatedTarget)) commit(); });
  ta.addEventListener("input", () => (ta.rows = Math.min(8, ta.value.split("\n").length + 1)));
  ta.addEventListener("keydown", e => {
    if (e.key == "Tab") { e.preventDefault(); e.stopPropagation(); move(e.shiftKey ? outdent : indent); }
    else if ((e.key == "Enter" && !e.shiftKey) || e.key == "Escape") { e.preventDefault(); e.stopPropagation(); commit(); }
  });
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function openAdd(b, p) { // строка ввода подпункта под пунктом p (и под всеми его подпунктами)
  const c = itemAt(b, p);
  if (collapsed.delete(c)) render();
  let li = cardLi(b, p);
  if (!c || !li) return;
  const depth = Number(li.style.getPropertyValue("--d")) + 1, prefix = p.join(".") + ".";
  while (li.nextElementSibling?.dataset.p?.startsWith(prefix)) li = li.nextElementSibling;
  const row = el("li", "lumi-card-adding"), input = inputBox("lumi-sub-input"), d = freshDraft(b);
  row.style.setProperty("--d", depth);
  input.placeholder = "Подпункт…";
  row.append(composer(d, input));
  li.after(row);
  let done = false;
  const finish = again => {
    if (done) return;
    done = true;
    const text = input.value.trim();
    if (text) { c.children.push(...unhead(itemsFrom(text, d))); save(b); render(); if (again) openAdd(b, p); } else row.remove();
  };
  input.addEventListener("blur", e => { if (!row.contains(e.relatedTarget)) finish(false); });
  input.addEventListener("keydown", e => {
    if (e.key == "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (input.value.trim()) finish(true); }
    else if (e.key == "Escape") { e.preventDefault(); e.stopPropagation(); input.value = ""; finish(false); }
  });
  input.focus();
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
async function deleteSheet(b) { // файл — в Корзину Windows (md.trashSheet); в памяти остаётся текст и место в ряду для «Отменить»
  const row = rowOf(b), rowIndex = layout.rows.indexOf(row), index = row.sheets.indexOf(b.meta), meta = { ...b.meta };
  clearTimeout(b.timer);
  let text;
  try { b.dirty = true; await flush(b); await b.saving; await lp; text = await md.readRaw(b.name); await md.removeSheet(b.name); }
  catch (e) { b.confirm = false; render(); return fail(e, `удалить «${b.name}»`); }
  b.dirty = false;
  for (const r of layout.rows) r.sheets = r.sheets.filter(m => m != b.meta);
  layout.rows = layout.rows.filter(r => r.sheets.length);
  const gone = !layout.rows.includes(row); // лист был единственным в ряду — ряд исчез
  byMeta.delete(b.meta);
  sync();
  render();
  pushUndo(`лист «${b.name}»`, async () => {
    let name = meta.name;
    for (let k = 2; boards.some(o => o.name.toLowerCase() == name.toLowerCase()); k++) name = `${meta.name} ${k}`; // имя заняли — берём соседнее
    await md.writeRaw(name, text);
    const nm = { ...meta, name }, nb = { name, meta: nm, cards: meta.mode == "doc" ? [] : md.parse(text), ...(meta.mode == "doc" && { text }) };
    let r = gone ? null : layout.rows.includes(row) ? row : layout.rows[Math.min(rowIndex, layout.rows.length - 1)]; // раскладку могли перечитать — тогда ряд ищем по месту
    if (!r) { r = row; r.sheets = []; layout.rows.splice(Math.min(rowIndex, layout.rows.length), 0, r); } // исчезнувший ряд возвращается тем же (цвет, высота)
    r.sheets.splice(Math.min(index, r.sheets.length), 0, nm);
    byMeta.set(nm, nb);
    sync();
    saveLayout();
    render();
  });
}
async function setMode(b, doc) { // лист ↔ документ: файл тот же, меняется только вид (mode в boards.json)
  closeMenu();
  try {
    await flush(b);
    await b.saving;
    if (doc) { b.text = await md.readRaw(b.name); b.cards = []; } else { b.cards = md.parse(b.text ?? ""); delete b.text; }
  } catch (e) { return fail(e, `переключить «${b.name}»`); }
  if (doc) b.meta.mode = "doc"; else delete b.meta.mode;
  b.confirm = false;
  saveLayout();
  render();
}

// ---------- «Отменить» после удаления ----------
const undoStack = []; // { label, restore }; Ctrl+Z (вне полей ввода) и кнопка плашки откатывают последнее удаление
let undoBar = null, undoTimer = 0;
function pushUndo(what, restore) {
  undoStack.push({ what, restore });
  undoStack.splice(0, undoStack.length - 10);
  clearTimeout(undoTimer);
  undoBar?.remove();
  undoBar = el("div", "lumi-undo");
  const label = el("span", null, `Удалено: ${what}`.slice(0, 80)), yes = btn("Отменить", "lumi-undo-btn");
  yes.onclick = () => undo();
  undoBar.append(label, yes);
  document.body.append(undoBar);
  undoTimer = setTimeout(hideUndo, 6000);
}
function hideUndo() { clearTimeout(undoTimer); undoBar?.remove(); undoBar = null; }
async function undo() {
  const u = undoStack.pop();
  hideUndo();
  if (!u) return;
  try { await u.restore(); } catch (e) { fail(e, `вернуть ${u.what}`); }
}
function deleteRow(r) { // листы не пропадают: уезжают в соседний ряд (выше, иначе ниже)
  const i = layout.rows.indexOf(r), up = i > 0, to = layout.rows[up ? i - 1 : i + 1];
  if (up) to.sheets.push(...r.sheets); else to.sheets.unshift(...r.sheets);
  layout.rows.splice(i, 1);
  sync();
  changed();
}

function moveItem(from, p, to, tp) { // пункт p (с подпунктами) встаёт соседом перед пунктом tp листа to; tp = null — в конец верхнего уровня
  if (from == to && tp && inside(tp, p)) return; // в самого себя или своего потомка нельзя
  if (tp && tp.length > 1 && itemAt(from, p).heading) tp = tp.slice(0, 1); // заголовок живёт только на верхнем уровне
  const target = tp ? itemAt(to, tp) : null, list = tp ? listAt(to, tp.slice(0, -1)) : to.cards; // ссылки до удаления: индексы сдвинутся
  const [c] = listAt(from, p.slice(0, -1)).splice(p.at(-1), 1);
  list.splice(target ? list.indexOf(target) : list.length, 0, c);
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
  if (t.closest(".lumi-doc")) return openDocEdit(b);
  const li = t.closest(".lumi-card"), p = li && pathOf(li), c = p && itemAt(b, p);
  if (t.closest(".lumi-fold")) { if (c.children.length) { if (!collapsed.delete(c)) collapsed.add(c); render(); } }
  else if (t.closest(".lumi-card-add-sub")) openAdd(b, p);
  else if (t.closest(".lumi-card-del")) {
    const del = t.closest(".lumi-card-del");
    if (c.children.length && !del.classList.contains("armed")) { // дерево удаляется целиком — второй клик подтверждает
      del.classList.add("armed");
      del.textContent = "Удалить с подпунктами?";
      return;
    }
    const up = p.slice(0, -1), at = p.at(-1);
    listAt(b, up).splice(at, 1);
    save(b);
    render();
    pushUndo(`«${c.text.split(String.fromCharCode(10))[0].slice(0, 40)}»`, () => { // на прежнее место (с подпунктами); место исчезло — в конец листа
      let list;
      try { list = listAt(b, up); } catch {}
      if (!Array.isArray(list)) list = b.cards;
      list.splice(Math.min(at, list.length), 0, c);
      save(b);
      render();
    });
  }
  else if (t.closest(".lumi-card-text")) openEditor(b, p);
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
  if (e.target.matches(".lumi-doc input[type=checkbox]")) { // галочка в документе: [ ] ↔ [x] в тексте листа
    const b = e.target.closest(".lumi-sheet")._b;
    b.text = md.docToggle(b.text ?? "", Number(e.target.dataset.line));
    save(b);
    return render();
  }
  if (!e.target.matches(".lumi-card input[type=checkbox]")) return;
  const b = e.target.closest(".lumi-sheet")._b;
  itemAt(b, pathOf(e.target.closest(".lumi-card"))).check = e.target.checked;
  save(b);
  render(); // зачёркивание, счётчики и цвет дат зависят от галочки
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
  const f = e.target;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code == "KeyZ" && undoStack.length && !f.matches?.("input, textarea, [contenteditable]")) { e.preventDefault(); undo(); }
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
let drag = null; // { card: true, b, p (путь) } | { b }
const clearMarks = () => box.querySelectorAll(".drop-before, .drop-end, .drop-left, .drop-right, .dragging").forEach(n => n.classList.remove("drop-before", "drop-end", "drop-left", "drop-right", "dragging"));
function dropTarget(e) {
  if (drag.card) {
    const s = e.target.closest?.(".lumi-sheet");
    if (!s || isDoc(s._b)) return null; // в документ карточки не кладутся
    const lis = [...s.querySelectorAll(".lumi-card")];
    const li = lis.find(li => e.clientY < li.getBoundingClientRect().top + li.offsetHeight / 2), tp = li && pathOf(li);
    if (tp && s._b == drag.b && inside(tp, drag.p)) return null; // внутрь самого себя нельзя
    return { to: s._b, tp: tp ?? null, mark: li ?? s.querySelector(".lumi-cards"), cls: li ? "drop-before" : "drop-end" };
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
  drag = li ? { card: true, b, p: pathOf(li) } : { b };
  e.dataTransfer.setData("text/plain", li ? itemAt(b, drag.p).text : b.name);
  e.dataTransfer.effectAllowed = "move";
  if (!li) return e.target.closest(".lumi-sheet").classList.add("dragging");
  for (const o of li.parentNode.querySelectorAll(".lumi-card")) if (inside(pathOf(o), drag.p)) o.classList.add("dragging"); // пункт и его подпункты
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
  if (d.card) moveItem(d.b, d.p, t.to, t.tp); else moveSheet(d.b, t.r, t.k);
});
box.addEventListener("dragend", () => { drag = null; clearMarks(); });

// возврат на Home — перечитать (файл могли поправить снаружи); уход — дописать несохранённое
document.addEventListener("visibilitychange", () => (document.hidden ? flushAll() : reload()));
window.addEventListener("focus", reload);
window.addEventListener("pagehide", flushAll);
const onDir = () => flushAll().then(() => { boards = []; reload(); });
const onChanged = () => reload();
const onNew = () => { for (const b of boards) { b.kind = undefined; b.draft = null; } reload(); }; // новый вид по умолчанию — всем строкам ввода
Services.prefs.addObserver(DIR, onDir);
Services.prefs.addObserver(NEW, onNew);
Services.obs.addObserver(onChanged, md.CHANGED);
window.addEventListener("unload", () => {
  Services.prefs.removeObserver(DIR, onDir);
  Services.prefs.removeObserver(NEW, onNew);
  Services.obs.removeObserver(onChanged, md.CHANGED);
});

// для dev/check-home-notes.js
window.lumiNotes = { get boards() { return boards; }, get layout() { return layout; }, get undoDepth() { return undoStack.length; }, reload, flushAll, moveItem, moveSheet, undo };
reload();
