// LumiNotes — канбан-доска под первым экраном Home (#lumi-notes; до неё долистывают прокруткой). Файлы и формат — home/notes-md.mjs.
// Доска = ряды (горизонтальные полосы) → листы (колонки, файлы notes\<лист>.md) → пункты. Всё правится сразу, режима правки нет:
// галочки, строка добавления внизу листа, клик по тексту пункта — поле, перетаскивание пунктов и листов (HTML5 DnD),
// шапка ряда (название, «⋯», перетаскивание ряда) и ПКМ по пустому месту — меню ряда, ПКМ по листу — меню листа, размер листа тянется за правый край, нижний край и угол (у каждого листа своя высота, ряд — по самому высокому).
// Markdown в тексте пунктов рисует renderInline (md.inline → createElement). Лист в режиме "doc" (меню листа) — цельный Markdown-текст: живой редактор notes-live.mjs (всегда оформлен, разметка видна у каретки, как Live Preview в Obsidian). Удаление пункта/листа — плашка «Отменить» (pushUndo, Ctrl+Z); файл листа уходит в Корзину (или в папку из pref luminoctis.notes.trash-dir — для проверок).
// Пункт — задача (check — bool, есть галочка и даты) или заметка (check — null). Подпункты — любой глубины: на экране дерево лежит плоским
// списком (.lumi-card, отступ --d), путь пункта — индексы от корня листа ("0.2.1" в data-p). Свёрнутые пункты помнит только память.
// Раскладка (имя/цвет/fill ряда, цвет/ширина/высота/иконка листа) — notes\boards.json (writeLayout). Сохранение листа: через 400 мс после правки
// (атомарно, store.js); ошибка — плашкой сверху, правка остаётся в памяти. Файлы, изменённые снаружи, перечитываются при возврате на Home.
import * as md from "./notes-md.mjs";
import { createLive } from "./notes-live.mjs";
import { JS } from "./paths.js";
const { locale, t } = ChromeUtils.importESModule(JS("lumi-i18n.sys.mjs"));

const root = document.getElementById("lumi-notes");
const win = window.browsingContext.topChromeWindow;
const DIR = "luminoctis.home.dir", NEW = "luminoctis.home.notes.new"; // NEW: "task" | "note" — чем становится новый пункт
const MIN_H = 140, MIN_W = 180, DEF_W = 320, DEF_H = 420, IND = 28; // IND — отступ подпункта, как --ind в notes.css
const NAMES = { red: t("Красный"), orange: t("Оранжевый"), yellow: t("Жёлтый"), green: t("Зелёный"), teal: t("Бирюзовый"), blue: t("Синий"), purple: t("Фиолетовый"), pink: t("Розовый"), gray: t("Серый") };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, cls, title) => { const b = el("button", cls, text); b.type = "button"; if (title) b.title = title; return b; };
// значки — встроенные SVG (контуры 24x24, цвет — currentColor из notes.css), без внешних файлов
const ICONS = {
  x: ["M6 6l12 12M18 6L6 18"], plus: ["M12 5v14M5 12h14"], chev: ["M9 6l6 6-6 6"],
  start: ["M6 21V4M6 5h11l-2.5 4 2.5 4H6"],
  due: ["M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4"],
  task: ["M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM8.5 12.2l2.4 2.4 4.6-5"],
  note: ["M5 7h14M5 12h14M5 17h9"], more: ["M5 12h.01M12 12h.01M19 12h.01"],
};
function svg(name) {
  const NS = "http://www.w3.org/2000/svg", s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", "lumi-ico");
  for (const d of ICONS[name]) { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); s.append(p); }
  return s;
}
const ibtn = (icon, cls, title, text) => { const b = btn("", cls, title); b.append(svg(icon)); if (text) b.append(text); return b; };

let boards = []; // все листы всех рядов подряд: [{ name, meta, cards: [{ text, check, start?, due?, children }], dirty, timer, saving, confirm, kind, draft }]
let layout = null; // раскладка boards.json; meta листа — его запись в layout.rows[].sheets
let byMeta = new Map(); // meta → лист
const box = el("div", "lumi-boards");
const errBox = el("div", "lumi-notes-error");
errBox.hidden = true;
errBox.title = t("Скрыть");
errBox.onclick = () => (errBox.hidden = true);
root.replaceChildren(box, errBox);

function fail(e, what) {
  console.error("LumiNotes:", what, e);
  const io = e instanceof DOMException; // ошибка диска — спокойная подсказка вместо текста ошибки
  errBox.classList.toggle("calm", io);
  errBox.textContent = io ? t("Не удалось открыть папку данных — выберите её в настройках") : t("LumiNotes: не удалось {0} — {1}", what, e?.message ?? e);
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
    .then(() => (lastSig = null)) // диск изменили мы — следующее чтение перерисует
    .catch(e => { b.dirty = true; fail(e, t("сохранить «{0}»", name)); });
  return b.saving;
}
const flushAll = () => Promise.all(boards.map(flush));
let lp = Promise.resolve(), layoutBase; // записи раскладки идут цепочкой; layoutBase — текст boards.json, на котором стоит наша раскладка
// на диске уже другая раскладка (записала другая страница) — не затираем её: перечитываем и просим повторить правку
const saveLayout = () => (lp = lp.then(async () => {
  const text = await md.writeLayout(layout, layoutBase);
  lastSig = null;
  if (text != null) return void (layoutBase = text);
  reload().then(() => {
    errBox.classList.add("calm");
    errBox.textContent = t("Раскладка изменилась в другом окне — правка не сохранена, повтори её");
    errBox.hidden = false;
  });
}).catch(e => fail(e, t("сохранить раскладку"))));
const sync = () => { boards = layout.rows.flatMap(r => r.sheets).map(m => byMeta.get(m)); }; // плоский список — по раскладке
const rowOf = b => layout.rows.find(r => r.sheets.includes(b.meta));

// ---------- чтение ----------
let loading = null, lastSig = null; // lastSig — что лежало на диске при прошлом чтении (то же самое — не перерисовываем)
const SHOW_NOTES = "luminoctis.home.show.notes";
const wanted = () => !window.browsingContext.usePrivateBrowsing && Services.prefs.getBoolPref(SHOW_NOTES, true); // в приватном окне и при выключенном блоке заметки не читаем
async function load() {
  if (!wanted()) return;
  if (root.querySelector(".lumi-note-editor, .lumi-sheet-rename, .lumi-row-rename, .lumi-sub-input, .lumi-add-input:not(:placeholder-shown)") || document.activeElement?.closest?.(".lumi-live") || drag) return; // идёт ввод — не мешаем (перерисовка убила бы каретку)
  try {
    await lp;
    let lay = await md.readLayout();
    if (!lay.rows.some(r => r.sheets.length) && await md.seedDefaults([t("Сегодня"), t("Дела"), t("Идеи")], t("Нажми на текст, чтобы изменить; новый пункт — внизу листа"))) lay = await md.readLayout(); // пусто из-за сбоя чтения — ничего не создаём
    const old = new Map(boards.map(b => [b.name, b])), map = new Map();
    const raws = new Map(await Promise.all(lay.rows.flatMap(r => r.sheets).map(async m => [m.name, await md.readRaw(m.name)])));
    const sig = JSON.stringify([lay, [...raws]]);
    errBox.hidden = true;
    if (sig == lastSig && !boards.some(b => b.dirty)) return;
    lastSig = sig;
    await Promise.all(lay.rows.flatMap(r => r.sheets).map(async meta => {
      const b = old.get(meta.name);
      if (b?.dirty) return map.set(meta, Object.assign(b, { meta }));
      if (meta.mode == "doc") return map.set(meta, Object.assign(b ?? { name: meta.name, cards: [] }, { meta, cards: [], text: raws.get(meta.name) }));
      const cards = md.parse(raws.get(meta.name));
      const same = b && md.serialize(cards) == md.serialize(b.cards); // не менялось — оставить объекты (на них держится «свёрнуто»)
      map.set(meta, b ? Object.assign(b, { cards: same ? b.cards : cards, meta }) : { name: meta.name, meta, cards });
    }));
    layout = lay;
    layoutBase = md.baseOf(lay);
    byMeta = map;
    sync();
  } catch (e) { return fail(e, t("прочитать заметки")); }
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
function flat(items, path = [], depth = 0, out = [], more = []) { // дерево → строки экрана (свёрнутые потомки пропущены); more[k] — у предка на уровне k (у самого пункта — more[depth]) есть следующий сосед: нужен линиям дерева
  items.forEach((c, i) => {
    const m = [...more, i < items.length - 1];
    out.push([c, [...path, i], depth, m]);
    if (!collapsed.has(c)) flat(c.children, [...path, i], depth + 1, out, m);
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
const grow = ta => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, 160) + "px"; };
function inputBox(cls) { // строка ввода: textarea в одну строку, растёт по тексту; Enter — добавить, Shift+Enter — перенос
  const ta = el("textarea", cls);
  ta.rows = 1;
  ta.spellcheck = false;
  ta.addEventListener("input", () => grow(ta));
  return ta;
}

function cardEl(c, p, depth, today, more) {
  const li = el("li", "lumi-card");
  li.dataset.p = p.join(".");
  li.style.setProperty("--d", depth);
  li.draggable = true;
  if (c.heading) { // заголовок-разделитель: без галочки, свёртки и подпунктов
    li.classList.add("lumi-heading");
    li.dataset.level = c.heading;
    const txt = el("div", "lumi-card-text"), body = el("span", "lumi-card-body");
    renderInline(body, c.text);
    txt.append(body);
    const tools = el("span", "lumi-card-tools");
    tools.append(ibtn("x", "lumi-card-del", t("Удалить заголовок")));
    li.append(txt, tools);
    return li;
  }
  for (let j = 0; j < depth; j++) { // линии дерева: колонка j — вертикаль детей предка j; последняя колонка — ветка к самому пункту
    if (j < depth - 1 && !more[j + 1]) continue;
    const g = el("span", "lumi-guide" + (j == depth - 1 ? " elbow" : ""));
    g.style.setProperty("--j", j);
    g.style.setProperty("--dd", depth);
    li.append(g);
    if (j == depth - 1 && more[depth]) { const v = el("span", "lumi-guide"); v.style.setProperty("--j", j); v.style.setProperty("--dd", depth); li.append(v); }
  }
  li.append(c.children.length ? ibtn("chev", "lumi-fold" + (collapsed.has(c) ? "" : " open"), collapsed.has(c) ? t("Развернуть") : t("Свернуть")) : el("span", "lumi-fold"));
  if (c.check != null) {
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = c.check;
    li.append(cb);
    li.classList.toggle("done", c.check);
  }
  const txt = el("div", "lumi-card-text"), body = el("span", "lumi-card-body");
  renderInline(body, c.text);
  txt.append(body);
  if (c.start || c.due) {
    const dates = el("span", "lumi-card-dates");
    dates.dataset.state = dateState(c, today);
    for (const k of ["start", "due"]) if (c[k]) { const s = el("span"); s.append(svg(k), fmtDate(c[k])); s.title = c[k]; dates.append(s); }
    txt.append(dates);
  }
  const [done, all] = c.check == null ? [0, 0] : tally(c);
  if (all) txt.append(el("span", "lumi-card-count", `${done}/${all}`));
  const tools = el("span", "lumi-card-tools");
  tools.append(ibtn("plus", "lumi-card-add-sub", t("Добавить подпункт")), ibtn("x", "lumi-card-del", t("Удалить пункт")));
  li.append(txt, tools);
  return li;
}

// строка ввода (новый пункт внизу листа, подпункт, поле правки): переключатель задача ↔ заметка, у задачи — кнопки дат.
// d = { task, start, due } меняется на месте; field — input или textarea; onKind(task) — запомнить выбор.
function composer(d, field, onKind) {
  const wrap = el("div", "lumi-comp"), main = el("div", "lumi-comp-main"), dates = el("div", "lumi-comp-dates");
  const kind = btn("", "lumi-kind"), parts = [];
  main.append(kind, field);
  for (const [key, icon, name] of [["start", "start", t("начало")], ["due", "due", t("срок")]]) {
    const w = el("span", "lumi-date"), b = btn("", "lumi-date-btn"), clear = ibtn("x", "lumi-date-clear", t("Убрать дату")), inp = el("input");
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
    kind.replaceChildren(svg(d.task ? "task" : "note"));
    kind.dataset.kind = d.task ? "task" : "note";
    kind.title = d.task ? t("Задача с галочкой. Нажми — сделать заметкой") : t("Заметка без галочки. Нажми — сделать задачей");
    dates.hidden = !d.task;
    wrap.classList.toggle("has-date", !!(d.task && (d.start || d.due)));
    for (const { key, icon, name, b, inp, clear } of parts) {
      b.replaceChildren(svg(icon), d[key] ? fmtDate(d[key]) : name);
      b.title = d[key] ? (key == "start" ? t("Начало: {0}", d[key]) : t("Срок: {0}", d[key])) : (key == "start" ? t("Дата: начало") : t("Дата: срок"));
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
function grip(cls, title) { const g = el("div", cls); g.title = title; return g; }
const grips = s => s.append(grip("lumi-sheet-grip", t("Ширина листа")), grip("lumi-sheet-grip-b", t("Высота листа")), grip("lumi-sheet-grip-c", t("Размер листа")));
const isDoc = b => b.meta.mode == "doc";
function docEl(b) { // живой редактор: правка сразу в b.text, запись — save(b); при уходе фокуса — сразу
  return createLive({ text: b.text ?? "", onChange: t => { b.text = t; save(b); }, onLink: href => win.openTrustedLinkIn(href, "tab"), onBlur: () => flush(b) }).el;
}
function sheetEl(b, row) {
  const s = el("section", "lumi-sheet");
  s._b = b;
  const color = b.meta.color ?? row.color;
  if (color) { s.classList.add("colored"); s.style.setProperty("--c", md.COLORS[color]); }
  s.style.setProperty("--w", (b.meta.width ?? DEF_W) + "px");
  s.style.setProperty("--h", (b.meta.height ?? DEF_H) + "px");
  const head = el("header", "lumi-sheet-head");
  head.draggable = true;
  const tools = el("span", "lumi-sheet-tools");
  const dot = btn("", "lumi-sheet-color", t("Цвет листа"));
  dot.append(el("span", "lumi-dot"));
  tools.append(dot);
  if (boards.length > 1) tools.append(ibtn("x", "lumi-sheet-del", t("Удалить лист")));
  if (b.meta.icon) head.append(sheetIcon(b.meta.icon));
  head.append(el("h3", "lumi-sheet-title", b.name), el("span", "lumi-sheet-count", b.cards.length || ""), tools);
  s.append(head);
  if (b.confirm) {
    const c = el("div", "lumi-confirm");
    c.append(el("span", null, t("Удалить лист «{0}» вместе с файлом?", b.name)), btn(t("Удалить"), "lumi-confirm-yes"), btn(t("Отмена"), "lumi-confirm-no"));
    s.append(c);
  }
  if (isDoc(b)) { // лист-документ: цельный оформленный текст, без строки добавления
    s.classList.add("is-doc");
    s.append(docEl(b));
    grips(s);
    return s;
  }
  const list = el("ul", "lumi-cards"), today = todayStr();
  list.append(...flat(b.cards).map(([c, p, depth, more]) => cardEl(c, p, depth, today, more)));
  const foot = el("footer", "lumi-sheet-foot"), input = inputBox("lumi-add-input"), d = (b.draft ??= freshDraft(b));
  input.placeholder = t("Новый пункт…");
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
  s.append(list, foot);
  grips(s);
  return s;
}
function rowHead(r) { // шапка ряда: цветная точка, название (пусто — приглушённое «Без названия»), «⋯»; за неё ряд перетаскивается
  const h = el("div", "lumi-row-head"), name = el("span", "lumi-row-name" + (r.name ? "" : " empty"), r.name || t("Без названия"));
  h.draggable = true;
  name.title = t("Двойной клик — переименовать. Шапку можно перетащить, чтобы переставить ряд");
  h.append(el("span", "lumi-row-dot"), name, ibtn("plus", "lumi-add-sheet", t("Новый лист в этом ряду")), ibtn("more", "lumi-row-more", t("Меню ряда")));
  return h;
}
function sheetIcon(v) { // эмодзи — текстом, значок Zen (chrome://…svg) — маской, чтобы красился в цвет текста
  const s = el("span", "lumi-sheet-icon");
  if (/^(chrome|resource|data|https?):/.test(v)) { s.classList.add("img"); s.style.setProperty("--ic", "url(" + JSON.stringify(v) + ")"); } else s.textContent = v;
  return s;
}
function rowEl(r) {
  const row = el("div", "lumi-row"), scroll = el("div", "lumi-row-scroll");
  row._r = r;
  row.classList.toggle("fill", r.fill);
  row.style.setProperty("--rc", r.color ? md.COLORS[r.color] : "transparent");
  scroll.append(...r.sheets.map(m => sheetEl(byMeta.get(m), r)));
  row.append(rowHead(r), scroll);
  return row;
}
function render() {
  const keep = new Map([...box.querySelectorAll(".lumi-sheet")].map(s => [s._b, s.querySelector(".lumi-cards")?.scrollTop ?? 0]));
  const left = new Map([...box.querySelectorAll(".lumi-row")].map(r => [r._r, r.querySelector(".lumi-row-scroll").scrollLeft]));
  for (const e of box.querySelectorAll(".lumi-live")) e.lumiDestroy?.();
  box.replaceChildren(...layout.rows.map(rowEl), ibtn("plus", "lumi-add-row", t("Новый ряд"), t("ряд")));
  for (const s of box.querySelectorAll(".lumi-sheet")) { const c = s.querySelector(".lumi-cards"); if (c) c.scrollTop = keep.get(s._b) ?? 0; }
  for (const r of box.querySelectorAll(".lumi-row")) r.querySelector(".lumi-row-scroll").scrollLeft = left.get(r._r) ?? 0;
}
const rowNode = r => [...box.querySelectorAll(".lumi-row")].find(n => n._r == r);
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
const confirmView = (text, yes) => m => m.append(el("div", "lumi-menu-text", text), item(t("Удалить"), yes), item(t("Отмена"), closeMenu));
const palette = (cur, pick) => m => {
  const w = el("div", "lumi-swatches");
  for (const [k, hex] of Object.entries(md.COLORS)) {
    const b = btn("", "lumi-swatch" + (k == cur ? " on" : ""), NAMES[k]);
    b.style.background = hex;
    b.onclick = () => pick(k);
    w.append(b);
  }
  const none = btn("⊘", "lumi-swatch none" + (cur == null ? " on" : ""), t("Без цвета"));
  none.onclick = () => pick(null);
  w.append(none);
  m.append(w);
};
const changed = () => { closeMenu(); saveLayout(); render(); };

function rowMenu(r, x, y) {
  const i = layout.rows.indexOf(r);
  openMenu(x, y, m => m.append(
    item(t("Переименовать ряд"), () => { closeMenu(); openRowRename(r); }),
    item(t("Цвет ряда"), () => setMenu(palette(r.color, k => { r.color = k; changed(); }))),
    item((r.fill ? "✓ " : "") + t("Растянуть листы по ширине"), () => { r.fill = !r.fill; changed(); }),
    item(t("Добавить лист"), () => addSheet(r)),
    item(t("Выше"), () => moveRow(r, i - 1), i < 1),
    item(t("Ниже"), () => moveRow(r, i + 2), i > layout.rows.length - 2),
    item(t("Удалить ряд"), () => setMenu(confirmView(t("Удалить ряд? Его листы переедут в соседний ряд."), () => deleteRow(r))), layout.rows.length < 2, t("Единственный ряд удалить нельзя"))));
}
function sheetMenu(b, x, y) {
  openMenu(x, y, m => m.append(
    item(t("Цвет листа"), () => setMenu(palette(b.meta.color, k => { b.meta.color = k; changed(); }))),
    item(t("Переименовать"), () => { closeMenu(); openRename(b); }),
    item(t("Иконка…"), () => pickIcon(b, x, y)),
    ...(b.meta.icon ? [item(t("Убрать иконку"), () => { delete b.meta.icon; changed(); })] : []),
    item(isDoc(b) ? t("Сделать карточками") : t("Сделать документом"), () => setMode(b, !isDoc(b))),
    item(t("Удалить лист"), () => { closeMenu(); b.confirm = true; render(); }, boards.length < 2, t("Последний лист удалить нельзя"))));
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
  input.placeholder = t("Подпункт…");
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
  h.closest(".lumi-sheet-head").draggable = false; // иначе в поле нельзя ставить каретку и выделять мышью
  h.replaceWith(input);
  let done = false;
  const commit = async ok => {
    if (done) return;
    done = true;
    const name = md.cleanName(input.value);
    if (ok && name && name != b.name) {
      if (boards.some(o => o != b && o.name.toLowerCase() == name.toLowerCase())) fail(new Error(t("такой лист уже есть")), t("переименовать в «{0}»", name));
      else {
        try {
          await flush(b);
          await lp;
          layoutBase = md.baseOf(await md.renameSheet(b.name, name)); // сам обновляет boards.json на диске
          b.name = b.meta.name = name;
        } catch (e) { fail(e, t("переименовать «{0}»", b.name)); }
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

function openRowRename(r) {
  const row = rowNode(r), name = row?.querySelector(".lumi-row-name");
  if (!name) return;
  const input = el("input", "lumi-row-rename");
  input.value = r.name ?? "";
  input.placeholder = t("Название ряда");
  input.spellcheck = false;
  row.querySelector(".lumi-row-head").draggable = false;
  name.replaceWith(input);
  let done = false;
  const commit = ok => {
    if (done) return;
    done = true;
    if (ok) { const v = input.value.replace(/\s+/g, " ").trim().slice(0, 80); if (v) r.name = v; else delete r.name; saveLayout(); }
    render();
  };
  input.addEventListener("blur", () => commit(true));
  input.addEventListener("keydown", e => {
    if (e.key == "Enter" || e.key == "Escape") { e.preventDefault(); e.stopPropagation(); commit(e.key == "Enter"); }
  });
  input.focus();
  input.select();
}
// иконка листа: родной выбор значков Zen (gZenEmojiPicker окна браузера); якорь — невидимая точка окна на месте клика
function pickIcon(b, x, y) {
  closeMenu();
  if (!win.gZenEmojiPicker) return fail(new Error(t("в окне нет выбора значков Zen")), t("открыть выбор иконки"));
  const d = win.document, NS = "http://www.w3.org/1999/xhtml", br = window.browsingContext.embedderElement.getBoundingClientRect();
  const wrap = d.createElementNS(NS, "div"), a = d.createElementNS(NS, "div");
  wrap.style.cssText = `position:fixed;left:${br.left + x}px;top:${br.top + y}px;width:1px;height:1px;pointer-events:none`;
  wrap.append(a);
  (d.body ?? d.documentElement).append(wrap);
  const p = win.gZenEmojiPicker.open(a, { allowNone: !!b.meta.icon, onSelect: v => { if (v) b.meta.icon = v; else delete b.meta.icon; changed(); } });
  win.focus();
  (p ?? Promise.resolve()).catch(() => {}).then(() => wrap.remove());
}

async function newSheet() {
  let name = t("Новый лист");
  for (let k = 2; boards.some(b => b.name.toLowerCase() == name.toLowerCase()); k++) name = t("Новый лист {0}", k);
  await md.writeSheet(name, []);
  const meta = { name, color: null, width: null, height: null }, b = { name, meta, cards: [] };
  byMeta.set(meta, b);
  return b;
}
async function addSheet(r, newRow) {
  closeMenu();
  let b;
  try { b = await newSheet(); } catch (e) { return fail(e, t("создать лист")); }
  if (newRow) layout.rows.push((r = { color: null, fill: false, sheets: [] }));
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
  try { b.dirty = true; await flush(b); await b.saving; await lp; text = await md.readRaw(b.name); layoutBase = md.baseOf(await md.removeSheet(b.name)); }
  catch (e) { b.confirm = false; render(); return fail(e, t("удалить «{0}»", b.name)); }
  b.dirty = false;
  for (const r of layout.rows) r.sheets = r.sheets.filter(m => m != b.meta);
  layout.rows = layout.rows.filter(r => r.sheets.length);
  const gone = !layout.rows.includes(row); // лист был единственным в ряду — ряд исчез
  byMeta.delete(b.meta);
  sync();
  render();
  pushUndo(t("лист «{0}»", b.name), async () => {
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
  } catch (e) { return fail(e, t("переключить «{0}»", b.name)); }
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
  const label = el("span", null, t("Удалено: {0}", what).slice(0, 80)), yes = btn(t("Отменить"), "lumi-undo-btn");
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
  try { await u.restore(); } catch (e) { fail(e, t("вернуть {0}", u.what)); }
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
function moveRow(r, k) { // ряд на место k (индексы считаются с самим r)
  const i = layout.rows.indexOf(r);
  layout.rows.splice(i, 1);
  layout.rows.splice(k > i ? k - 1 : k, 0, r);
  sync();
  changed();
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
  const tg = e.target;
  const a = tg.closest("a.lumi-card-link");
  if (a) { e.preventDefault(); return win.openTrustedLinkIn(a.href, "tab"); }
  if (tg.closest(".lumi-add-row")) return addSheet(null, true);
  const row = tg.closest(".lumi-row")?._r, s = tg.closest(".lumi-sheet"), b = s?._b;
  const more = tg.closest(".lumi-row-more");
  if (more) { const q = more.getBoundingClientRect(); return rowMenu(row, q.left, q.bottom + 4); }
  if (tg.closest(".lumi-add-sheet")) return addSheet(row);
  if (!b || tg.matches("input, textarea")) return;
  const li = tg.closest(".lumi-card"), p = li && pathOf(li), c = p && itemAt(b, p);
  if (tg.closest(".lumi-fold")) { if (c.children.length) { if (!collapsed.delete(c)) collapsed.add(c); render(); } }
  else if (tg.closest(".lumi-card-add-sub")) openAdd(b, p);
  else if (tg.closest(".lumi-card-del")) {
    const del = tg.closest(".lumi-card-del");
    if (c.children.length && !del.classList.contains("armed")) { // дерево удаляется целиком — второй клик подтверждает
      del.classList.add("armed");
      del.replaceChildren(t("Удалить с подпунктами?"));
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
  else if (tg.closest(".lumi-card-text")) openEditor(b, p);
  else if (tg.closest(".lumi-sheet-color")) { const r = tg.getBoundingClientRect(); openMenu(r.left, r.bottom + 4, palette(b.meta.color, k => { b.meta.color = k; changed(); })); }
  else if (tg.closest(".lumi-sheet-del")) { b.confirm = true; render(); }
  else if (tg.closest(".lumi-confirm-yes")) deleteSheet(b);
  else if (tg.closest(".lumi-confirm-no")) { b.confirm = false; render(); }
});
box.addEventListener("dblclick", e => {
  const rn = e.target.closest(".lumi-row-name");
  if (rn) return openRowRename(rn.closest(".lumi-row")._r);
  const b = e.target.closest(".lumi-sheet-title")?.closest(".lumi-sheet")?._b;
  if (b) openRename(b);
});
box.addEventListener("change", e => {
  if (!e.target.matches(".lumi-card input[type=checkbox]")) return;
  const b = e.target.closest(".lumi-sheet")._b;
  const path = pathOf(e.target.closest(".lumi-card"));
  itemAt(b, path).check = e.target.checked;
  save(b);
  render(); // зачёркивание, счётчики и цвет дат зависят от галочки
  cardLi(b, path)?.querySelector("input[type=checkbox]")?.classList.add("pop");
});
box.addEventListener("contextmenu", e => {
  if (e.target.matches("input, textarea") || e.target.closest(".lumi-live")) return; // в тексте документа — родное меню (копировать/вставить)
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

// растягивание листа: правый край — ширина, нижний — высота, угол — обе (pointer events, размер пишется в раскладку по отпусканию)
box.addEventListener("pointerdown", e => {
  const g = e.target.closest(".lumi-sheet-grip, .lumi-sheet-grip-b, .lumi-sheet-grip-c");
  if (!g || e.button) return;
  e.preventDefault();
  const wide = !g.matches(".lumi-sheet-grip-b"), tall = !g.matches(".lumi-sheet-grip"), node = g.parentNode, meta = node._b.meta;
  const x0 = e.clientX, y0 = e.clientY, w0 = node.offsetWidth, h0 = node.offsetHeight;
  let w = w0, h = h0, moved = false;
  try { g.setPointerCapture(e.pointerId); } catch {} // синтетические события проверок не имеют активного указателя
  g.classList.add("active");
  g.onpointermove = ev => {
    moved = true;
    if (wide) { w = Math.round(Math.max(MIN_W, w0 + ev.clientX - x0)); node.style.setProperty("--w", w + "px"); }
    if (tall) { h = Math.round(Math.max(MIN_H, h0 + ev.clientY - y0)); node.style.setProperty("--h", h + "px"); }
  };
  g.onpointerup = g.onpointercancel = () => {
    g.onpointermove = g.onpointerup = g.onpointercancel = null;
    g.classList.remove("active");
    if (!moved) return;
    if (wide) meta.width = w;
    if (tall) meta.height = h;
    saveLayout();
  };
});

// перетаскивание (HTML5 DnD): пункты — внутри листа, между листами и рядами; листы — за шапку, внутри ряда и в другой ряд.
// Под курсором — копия (setDragImage); исходное место — невидимая «дырка» (.lumi-hole); соседи раздвигаются через translate (150 мс), место вставки — рамка .lumi-slot.
// Место вставки считается по естественным координатам (offsetTop/Left), а не по сдвинутым — иначе пункты «убегали» бы из-под курсора. prefers-reduced-motion: без сдвигов, место — тонкая линия.
let drag = null; // { rowMove: true, r, node } | { card: true, b, p (путь), nodes (пункт и его подпункты на экране), h (высота с зазором), heading } | { b, node, w }
let slot = null, shifted = new Map(), lastKey = ""; // shifted: узел → сдвиг в px
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const after = (a, n) => !!(a.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING); // n идёт после a
function shiftTo(next, axis) {
  for (const n of shifted.keys()) if (!next.has(n)) n.style.translate = "";
  for (const [n, v] of next) n.style.translate = v ? (axis == "y" ? `0 ${v}px` : `${v}px 0`) : "";
  shifted = next;
}
// автопрокрутка при перетаскивании: у края окна — страница (по y), у краёв .lumi-row-scroll — ряд (по x); цикл rAF живёт только пока идёт перетаскивание
let pt = null, raf = 0;
const edge = (v, lo, hi, z = 70) => v < lo + z ? -Math.min(1, (lo + z - v) / z) : v > hi - z ? Math.min(1, (v - (hi - z)) / z) : 0; // -1…1, растёт к краю
let tPrev = 0;
function autoTick(now) {
  raf = 0;
  const k = Math.min(now - tPrev, 50) * 1.3; // до 1300 px/с независимо от частоты кадров
  tPrev = now;
  if (!drag || !pt) return;
  const dy = edge(pt.y, 0, innerHeight) * k, el0 = document.elementFromPoint(pt.x, pt.y), sc = !drag.rowMove && !drag.card ? el0?.closest?.(".lumi-row")?.querySelector(".lumi-row-scroll") : null;
  let dx = 0;
  if (sc) { const r = sc.getBoundingClientRect(); dx = edge(pt.x, r.left, r.right) * k; }
  if (!dy && !dx) return;
  const page = document.scrollingElement, y0 = page.scrollTop, x0 = sc?.scrollLeft;
  page.scrollTop += dy; // scroll-behavior: smooth у html на время перетаскивания снят (см. dragover)
  if (dx) sc.scrollLeft += dx;
  if (page.scrollTop != y0 || (sc && sc.scrollLeft != x0)) { // линия вставки по ходу прокрутки
    const ev = { target: el0, clientX: pt.x, clientY: pt.y }, t = drag.rowMove ? rowTarget(ev) : drag.card ? cardTarget(ev) : sheetTarget(ev);
    showDrag(t);
  }
  raf = requestAnimationFrame(autoTick);
}
document.addEventListener("dragover", e => { if (!drag) return; pt = { x: e.clientX, y: e.clientY }; document.scrollingElement.style.scrollBehavior = "auto"; if (!raf) { tPrev = performance.now(); raf = requestAnimationFrame(autoTick); } }, true);
document.addEventListener("wheel", e => { if (drag) document.scrollingElement.scrollTop += e.deltaY; }, { passive: true });
function endDrag() {
  cancelAnimationFrame(raf);
  raf = 0;
  document.scrollingElement.style.scrollBehavior = "";
  pt = null;
  shiftTo(new Map());
  slot?.remove();
  slot = null;
  lastKey = "";
  box.querySelectorAll(".lumi-hole").forEach(n => n.classList.remove("lumi-hole"));
  drag = null;
}
function setImage(dt, g, e, from) { // копия под курсором: клон элемента вне экрана
  document.body.append(g);
  const r = from.getBoundingClientRect();
  try { dt.setDragImage(g, Math.max(0, e.clientX - r.left), Math.max(0, e.clientY - r.top)); } catch {}
  setTimeout(() => g.remove());
}
function cardGhost(nodes, s) {
  const g = el("section", "lumi-ghost"), ul = el("ul", "lumi-cards"), d0 = Number(nodes[0].style.getPropertyValue("--d"));
  if (s.classList.contains("colored")) g.style.setProperty("--c", s.style.getPropertyValue("--c"));
  g.style.width = nodes[0].offsetWidth + "px";
  for (const n of nodes) {
    const c = n.cloneNode(true);
    c.classList.remove("lumi-hole");
    c.style.setProperty("--d", Number(n.style.getPropertyValue("--d")) - d0);
    c.querySelectorAll(".lumi-guide").forEach(x => x.remove());
    ul.append(c);
  }
  g.append(ul);
  return g;
}
function sheetGhost(s) {
  const g = s.cloneNode(true);
  g.classList.add("lumi-ghost");
  g.style.width = s.offsetWidth + "px";
  g.style.height = s.offsetHeight + "px";
  return g;
}
function cardTarget(e) { // лист, в который бросаем, и пункт, перед которым встанет перетаскиваемый (null — в конец верхнего уровня)
  const s = e.target.closest?.(".lumi-sheet");
  if (!s || isDoc(s._b)) return null; // в документ карточки не кладутся
  const ul = s.querySelector(".lumi-cards"), y = e.clientY - ul.getBoundingClientRect().top + ul.scrollTop, all = [...ul.querySelectorAll(".lumi-card")];
  const mine = s._b == drag.b, last = drag.nodes.at(-1);
  if (mine && y >= drag.nodes[0].offsetTop && y <= last.offsetTop + last.offsetHeight) return null; // над своей «дыркой» (и своими подпунктами) — никуда
  const li = all.find(n => !(mine && drag.nodes.includes(n)) && y < n.offsetTop + n.offsetHeight / 2) ?? null;
  return { all, li, to: s._b, tp: li && pathOf(li), ul };
}
function rowTarget(e) { // место ряда: перед первым рядом, чья середина ниже курсора (кроме самого перетаскиваемого)
  const rows = [...box.querySelectorAll(".lumi-row")], y = e.clientY - box.getBoundingClientRect().top;
  const nxt = rows.find(n => n != drag.node && y < n.offsetTop + n.offsetHeight / 2) ?? null;
  return { rows, nxt, k: nxt ? layout.rows.indexOf(nxt._r) : layout.rows.length };
}
function rowGhost(h) {
  const g = h.cloneNode(true);
  g.classList.add("lumi-row-ghost");
  g.style.width = h.offsetWidth + "px";
  g.style.setProperty("--rc", h.parentNode.style.getPropertyValue("--rc"));
  return g;
}
function sheetTarget(e) {
  const row = e.target.closest?.(".lumi-row");
  if (!row) return null;
  const scroll = row.querySelector(".lumi-row-scroll"), x = e.clientX - scroll.getBoundingClientRect().left + scroll.scrollLeft;
  const items = [...scroll.children].filter(n => n.matches(".lumi-sheet")), secs = items;
  const nxt = secs.find(n => n != drag.node && x < n.offsetLeft + n.offsetWidth / 2) ?? null;
  return { row, scroll, items, nxt, r: row._r, k: nxt ? secs.indexOf(nxt) : secs.length }; // k считается с самим перетаскиваемым листом
}
function showSlot(parent, css, line) {
  slot ??= el("div", "lumi-slot");
  slot.classList.toggle("line", line);
  if (slot.parentNode != parent) parent.append(slot);
  Object.assign(slot.style, css);
}
function showDrag(t) { // сдвиги соседей и метка места под текущую цель (null — всё на место)
  const key = !t ? "" : drag.rowMove ? `row:${t.k}` : drag.card ? `${t.to.name}|${t.tp?.join(".") ?? "end"}` : `${layout.rows.indexOf(t.r)}:${t.k}`;
  if (key == lastKey) return;
  lastKey = key;
  const map = new Map(), moving = !calm();
  if (!t) { shiftTo(map); slot?.remove(); slot = null; return; }
  const dy = n => map.get(n) ?? 0;
  if (drag.rowMove) { // между рядами — линия вставки
    shiftTo(map);
    const e = t.rows.findLast(n => n != drag.node);
    showSlot(box, { left: "24px", right: "24px", width: "auto", top: (t.nxt ? t.nxt.offsetTop - 10 : e ? e.offsetTop + e.offsetHeight + 6 : 0) + "px", height: "4px" }, true);
  } else if (drag.card) {
    const H = drag.h, first = drag.nodes[0], last = drag.nodes.at(-1), depth = t.tp ? (drag.heading && t.tp.length > 1 ? 0 : t.tp.length - 1) : 0;
    if (moving) {
      for (const n of first.parentNode.querySelectorAll(".lumi-card")) if (after(last, n)) map.set(n, -H); // исходное место смыкается
      if (t.li) for (const n of t.all) if (!drag.nodes.includes(n) && (n == t.li || after(t.li, n))) map.set(n, dy(n) + H); // место вставки раскрывается
    }
    shiftTo(map, "y");
    let top;
    if (t.li) top = t.li.offsetTop + dy(t.li) - (moving ? H : 5);
    else { const e = t.all.findLast(n => !drag.nodes.includes(n)); top = e ? e.offsetTop + e.offsetHeight + dy(e) + (moving ? 6 : 2) : 0; }
    showSlot(t.ul, { left: depth * IND + "px", right: "2px", width: "auto", top: top + "px", height: moving ? H - 6 + "px" : "3px" }, !moving);
  } else {
    const W = drag.w, node = drag.node;
    if (moving) {
      for (const n of [...node.parentNode.children]) if (n.matches(".lumi-sheet") && after(node, n)) map.set(n, -W);
      for (const n of t.items) if (n != node && t.nxt && (n == t.nxt || after(t.nxt, n))) map.set(n, dy(n) + W);
    }
    shiftTo(map, "x");
    let left;
    if (t.nxt) left = t.nxt.offsetLeft + dy(t.nxt) - (moving ? W : 9);
    else { const e = t.items.findLast(n => n != node); left = e ? e.offsetLeft + e.offsetWidth + dy(e) + (moving ? 14 : 5) : 20; }
    showSlot(t.scroll, { left: left + "px", right: "auto", top: "12px", width: moving ? W - 14 + "px" : "3px", height: node.offsetHeight + "px" }, !moving);
  }
}
box.addEventListener("dragstart", e => {
  const rh = e.target.closest?.(".lumi-row-head");
  if (rh) {
    const node = rh.parentNode;
    e.dataTransfer.setData("text/plain", node._r.name ?? "");
    e.dataTransfer.effectAllowed = "move";
    drag = { rowMove: true, r: node._r, node };
    setImage(e.dataTransfer, rowGhost(rh), e, rh);
    node.classList.add("lumi-hole");
    return;
  }
  const li = e.target.closest?.(".lumi-card"), s = e.target.closest?.(".lumi-sheet"), b = s?._b;
  if (!b || (!li && !e.target.closest?.(".lumi-sheet-head"))) return e.preventDefault();
  e.dataTransfer.setData("text/plain", li ? itemAt(b, pathOf(li)).text : b.name);
  e.dataTransfer.effectAllowed = "move";
  if (li) {
    const p = pathOf(li), nodes = [...li.parentNode.querySelectorAll(".lumi-card")].filter(o => inside(pathOf(o), p)), last = nodes.at(-1);
    drag = { card: true, b, p, nodes, h: last.offsetTop + last.offsetHeight - li.offsetTop + 6, heading: !!itemAt(b, p).heading };
    setImage(e.dataTransfer, cardGhost(nodes, s), e, li);
    nodes.forEach(n => n.classList.add("lumi-hole"));
  } else {
    drag = { b, node: s, w: s.offsetWidth + 14 };
    setImage(e.dataTransfer, sheetGhost(s), e, s);
    s.classList.add("lumi-hole");
  }
});
box.addEventListener("dragover", e => {
  if (!drag) return;
  const t = drag.rowMove ? rowTarget(e) : drag.card ? cardTarget(e) : sheetTarget(e);
  if (t) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }
  showDrag(t);
});
box.addEventListener("dragleave", e => { if (drag && !box.contains(e.relatedTarget)) showDrag(null); });
box.addEventListener("drop", e => {
  if (!drag) return;
  const d = drag, t = d.rowMove ? rowTarget(e) : d.card ? cardTarget(e) : sheetTarget(e);
  e.preventDefault();
  endDrag();
  if (!t) return;
  if (d.rowMove) moveRow(d.r, t.k); else if (d.card) moveItem(d.b, d.p, t.to, t.tp); else moveSheet(d.b, t.r, t.k);
});
box.addEventListener("dragend", endDrag); // Esc или мимо — всё плавно возвращается

// возврат на Home — перечитать (файл могли поправить снаружи); уход — дописать несохранённое
document.addEventListener("visibilitychange", () => (document.hidden ? flushAll() : reload()));
window.addEventListener("focus", reload);
window.addEventListener("pagehide", flushAll);
const onDir = () => flushAll().then(() => { boards = []; lastSig = null; reload(); });
const onShow = () => reload();
const onChanged = () => reload();
const onNew = () => { for (const b of boards) { b.kind = undefined; b.draft = null; } lastSig = null; reload(); }; // новый вид по умолчанию — всем строкам ввода
Services.prefs.addObserver(DIR, onDir);
Services.prefs.addObserver(NEW, onNew);
Services.prefs.addObserver(SHOW_NOTES, onShow);
Services.obs.addObserver(onChanged, md.CHANGED);
window.addEventListener("unload", () => {
  Services.prefs.removeObserver(DIR, onDir);
  Services.prefs.removeObserver(NEW, onNew);
  Services.prefs.removeObserver(SHOW_NOTES, onShow);
  Services.obs.removeObserver(onChanged, md.CHANGED);
});

// для dev/check-home-notes.js
window.lumiNotes = { get boards() { return boards; }, get layout() { return layout; }, get undoDepth() { return undoStack.length; }, reload, flushAll, moveItem, moveSheet, moveRow, undo };
reload();
