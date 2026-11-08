// Ярлыки на первом экране Home (#lumi-shortcuts): плитки из папки закладок (pref luminoctis.home.shortcuts.folder — guid папки,
// пусто — панель закладок). Плитка — закладка или подпапка (один уровень; папка раскрывается окошком). Клик — новая вкладка,
// средняя кнопка и Ctrl+клик — фоновая. Перетаскивание (pointer events): смена порядка = порядок закладок в папке; задержать над
// другой плиткой ~0,45 с — сгруппировать (папка «Папка»); ПКМ — «Изменить/Удалить» (удаление с «Отменить»).
// Папка с одним ярлыком остаётся; пустая удаляется сама; удаление папки — с подтверждением и «Отменить» (ярлыки возвращаются).
const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
const win = window.browsingContext.topChromeWindow;
const root = document.getElementById("lumi-shortcuts");
const PREF = "luminoctis.home.shortcuts.folder", PRESET = "luminoctis.home.shortcuts.preset", MAX = 24, DWELL = 450, B = PlacesUtils.bookmarks;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const wait = ms => new Promise(r => setTimeout(r, ms));

const folder = () => Services.prefs.getStringPref(PREF, "") || B.toolbarGuid;
const isLink = c => c.type == PlacesUtils.TYPE_X_MOZ_PLACE && /^https?:|^file:|^about:/.test(c.uri);
const isDir = c => c.type == PlacesUtils.TYPE_X_MOZ_PLACE_CONTAINER;
const label = n => n.title || (n.uri || "").replace(/^https?:\/\/(www\.)?/, "");
let model = new Map(), top = [], rootNode = null, seq = 0, lastSig = "", openGuid = null, drag = null, skipClick = false, menu = null;

// иконка сайта; нет иконки (или не загрузилась) — кружок в стиле мода
const icons = new Map();
function icon(uri) {
  const dot = () => el("span", "sc-dot");
  const img = el("img", "sc-icon");
  img.src = "page-icon:" + uri;
  img.alt = "";
  img.draggable = false;
  img.onerror = () => img.replaceWith(dot());
  const known = icons.get(uri);
  if (known === false) return dot();
  if (known === undefined) PlacesUtils.favicons.getFaviconForPage(Services.io.newURI(uri)).then(f => { icons.set(uri, !!f); if (!f) img.replaceWith(dot()); }, () => icons.set(uri, true));
  return img;
}

function tileOf(n) {
  const dir = isDir(n), a = el(dir ? "div" : "a", "lumi-tile" + (dir ? " sc-folder" : ""));
  a.dataset.guid = n.guid;
  const ico = el("span", dir ? "sc-ico sc-mini" : "sc-ico");
  if (dir) {
    a.tabIndex = 0;
    a.setAttribute("role", "button");
    a.title = n.title;
    ico.append(...n.kids.slice(0, 4).map(k => icon(k.uri)));
  } else {
    a.href = n.uri;
    a.dataset.url = n.uri;
    a.title = n.uri;
    ico.append(icon(n.uri));
  }
  a.append(ico, el("span", "lumi-tile-title", label(n)));
  return a;
}

async function render(force) { // force — DOM менялся руками (перетаскивание), пересобрать даже при тех же данных
  if (drag?.on) return; // после перетаскивания всё равно будет перерисовка
  const my = ++seq;
  let tree = null;
  try { tree = await PlacesUtils.promiseBookmarksTree(folder()); } catch {} // папку удалили — как пустая
  if (my != seq) return;
  model = new Map();
  top = [];
  rootNode = tree;
  if (tree) {
    const walk = (n, parent) => { n.parentGuid = parent; model.set(n.guid, n); for (const c of n.children ?? []) walk(c, n.guid); if (isDir(n)) n.kids = (n.children ?? []).filter(isLink); };
    walk(tree, null);
    top = (tree.children ?? []).filter(c => isLink(c) || isDir(c)).slice(0, MAX);
  }
  const sig = JSON.stringify([top.map(n => [n.guid, n.title, n.uri, n.kids?.map(k => [k.guid, k.title, k.uri])]), openGuid]);
  if (!force && sig == lastSig) return; // запоздалые события от своих же правок: ничего не изменилось — не дёргаем
  lastSig = sig;
  const plus = el("button", "lumi-add", "+"); // плитка «+» в конце ряда
  plus.type = "button";
  plus.title = "Добавить ярлык";
  plus.setAttribute("aria-label", "Добавить ярлык");
  if (!top.length) root.replaceChildren(el("p", "lumi-shortcuts-hint", "Здесь будут ваши ярлыки: добавьте закладки в выбранную папку или выберите другую в Настройки → Home → Ярлыки."), plus);
  else root.replaceChildren(...top.map(tileOf), ...(top.length < MAX ? [plus] : []));
  renderBox();
}

// окошко-папка поверх страницы
const boxEl = () => document.querySelector(".sc-fold-box"), gridEl = () => document.querySelector(".sc-grid");
function openBox(guid) { openGuid = guid; renderBox(); }
function closeBox() { openGuid = null; document.querySelector(".sc-fold-back")?.remove(); }
function renderBox() {
  if (!openGuid) return;
  const n = model.get(openGuid);
  if (!n || !isDir(n) || !n.kids.length) return closeBox();
  let back = document.querySelector(".sc-fold-back");
  if (!back) {
    back = el("div", "sc-fold-back");
    back.append(el("div", "sc-fold-box"));
    back.addEventListener("pointerdown", e => { if (e.target == back) closeBox(); });
    document.body.append(back);
  }
  boxEl().replaceChildren(el("h3", null, n.title), el("div", "sc-grid"));
  gridEl().append(...n.kids.map(tileOf));
}

// свои правки закладок: событиями Places они придут и позже — render() сравнивает данные и пропускает повтор
async function mutate(fn) {
  try { await fn(); } catch (e) { console.error(e); }
  await render(true);
}
const cleanup = async guid => { // пустая подпапка удаляется сама
  if (!guid || guid == folder()) return;
  try { if (!(await PlacesUtils.promiseBookmarksTree(guid)).children?.length) await B.remove(guid); } catch {}
};

// окна: «+», «Изменить», «Переименовать», подтверждение. fields: [[подпись, подсказка, значение]]; onSubmit(значения, поля) → false = остаться
const addUrl = raw => { // без схемы — https://; нужен нормальный хост (домен.зона, localhost или IP)
  const t = raw.trim();
  if (!t || /\s/.test(t)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : "https://" + t);
    return /^(localhost|\d{1,3}(\.\d{1,3}){3}|.+\..{2,})$/.test(u.hostname) ? u.href : null;
  } catch { return null; }
};
function openDialog({ head, text, fields = [], ok, onSubmit }) {
  if (document.querySelector(".lumi-add-back")) return;
  closeMenu();
  const back = el("div", "lumi-add-back"), box = el("form", "lumi-add-box");
  const inputs = fields.map(([, ph, value]) => Object.assign(el("input"), { type: "text", placeholder: ph, spellcheck: false, value: value ?? "" }));
  const okB = el("button", "lumi-add-ok", ok), no = el("button", "lumi-add-cancel", "Отмена");
  okB.type = "submit";
  no.type = "button";
  const row = el("div", "lumi-add-row");
  row.append(no, okB);
  box.append(el("h3", null, head), ...(text ? [el("p", "sc-dlg-text", text)] : []),
    ...fields.map(([l], i) => { const f = el("label", "lumi-add-field"); f.append(el("span", null, l), inputs[i]); return f; }), row);
  back.append(box);
  const done = () => { back.remove(); document.removeEventListener("keydown", esc, true); };
  const esc = e => { if (e.key == "Escape") { e.preventDefault(); e.stopPropagation(); done(); } };
  document.addEventListener("keydown", esc, true);
  back.addEventListener("mousedown", e => { if (e.target == back) done(); });
  no.onclick = done;
  for (const i of inputs) i.addEventListener("input", () => i.classList.remove("bad"));
  box.addEventListener("submit", async e => {
    e.preventDefault();
    if (await onSubmit(inputs.map(i => i.value), inputs) !== false) done();
  });
  document.body.append(back);
  (inputs[0] ?? okB).focus();
  inputs[0]?.select();
}
const domain = href => new URL(href).hostname.replace(/^www\./, "");
function openAdd() {
  openDialog({ head: "Новый ярлык", ok: "Добавить", fields: [["Адрес", "example.com"], ["Название", "можно оставить пустым"]],
    async onSubmit([u, t], [ui]) {
      const href = addUrl(u);
      if (!href) { ui.classList.add("bad"); ui.focus(); return false; }
      let ok = true;
      await mutate(async () => { try { await B.insert({ parentGuid: folder(), url: href, title: t.trim() || domain(href) }); } catch { ok = false; } });
      if (!ok) { ui.classList.add("bad"); return false; } // папки нет и т. п.
    } });
}
const edit = n => openDialog({ head: "Изменить ярлык", ok: "Сохранить", fields: [["Адрес", "example.com", n.uri], ["Название", "можно оставить пустым", n.title]],
  async onSubmit([u, t], [ui]) {
    const href = u.trim() == n.uri ? n.uri : addUrl(u);
    if (!href) { ui.classList.add("bad"); ui.focus(); return false; }
    await mutate(() => B.update({ guid: n.guid, url: href, title: t.trim() || domain(href).replace(/^$/, href) }));
  } });
const rename = n => openDialog({ head: "Переименовать папку", ok: "Сохранить", fields: [["Название", "Папка", n.title]],
  onSubmit: ([t]) => mutate(() => B.update({ guid: n.guid, title: t.trim() || "Папка" })) });

// удаление с «Отменить»
let toast = null, toastT = 0;
function undoable(msg, undo) {
  toast?.remove();
  clearTimeout(toastT);
  const t = el("div", "sc-toast"), b = el("button", null, "Отменить");
  b.type = "button";
  b.onclick = () => { t.remove(); mutate(undo); };
  t.append(el("span", null, msg), b);
  document.body.append(t);
  toast = t;
  toastT = setTimeout(() => t.remove(), 6000);
}
const snap = n => ({ guid: n.guid, parentGuid: n.parentGuid, index: n.index, title: n.title, url: n.uri, dir: isDir(n),
  kids: isDir(n) ? n.kids.map(snap) : [] });
async function restore(s) {
  const info = s.dir ? { type: B.TYPE_FOLDER, title: s.title } : { url: s.url, title: s.title };
  try { await B.insert({ guid: s.guid, parentGuid: s.parentGuid, index: s.index, ...info }); }
  catch { await B.insert({ guid: s.guid, parentGuid: s.parentGuid, ...info }); } // место занято/нет такого индекса — в конец
  for (const k of s.kids) await restore(k);
}
function remove(n, msg) {
  const s = snap(n);
  mutate(() => B.remove(n.guid));
  undoable(msg, () => restore(s));
}
function del(n) {
  const par = model.get(n.parentGuid); // последний ярлык в папке: уходит вся пустая папка, «Отменить» вернёт её с ярлыком
  const v = par && par !== rootNode && isDir(par) && par.kids.length == 1 ? par : n;
  remove(v, `Ярлык «${label(n)}» удалён`);
}
const delDir = n => n.kids.length ? openDialog({ head: "Удалить папку?", ok: "Удалить", text: `«${n.title}» и ярлыки в ней (${n.kids.length}) будут удалены. Потом можно отменить.`,
  onSubmit: () => remove(n, `Папка «${n.title}» удалена`) }) : remove(n, `Папка «${n.title}» удалена`);

// контекстное меню
function closeMenu() { menu?.remove(); menu = null; }
function showMenu(x, y, t) {
  closeMenu();
  const n = model.get(t.dataset.guid);
  if (!n) return;
  const items = isDir(n) ? [["Переименовать", () => rename(n)], ["Удалить папку", () => delDir(n), 1]] : [["Изменить", () => edit(n)], ["Удалить", () => del(n), 1]];
  const m = el("div", "sc-menu");
  m.setAttribute("role", "menu");
  for (const [l, fn, bad] of items) { const b = el("button", bad ? "bad" : null, l); b.type = "button"; b.onclick = () => { closeMenu(); fn(); }; m.append(b); }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + "px";
  m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + "px";
  menu = m;
  m.firstChild.focus();
}

// перетаскивание
const inRect = (r, e) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
const tilesOf = c => [...c.children].filter(x => x.classList.contains("lumi-tile"));
const lowMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function flip(fn) { // соседи плавно разъезжаются: мерим до и после перестановки
  const els = [...document.querySelectorAll(".lumi-tile:not(.sc-ghost), .lumi-add")], was = els.map(e => e.getBoundingClientRect());
  fn();
  if (lowMotion()) return;
  els.forEach((e, i) => {
    const r = e.getBoundingClientRect(), dx = was[i].left - r.left, dy = was[i].top - r.top;
    if (dx || dy) e.animate({ translate: [`${dx}px ${dy}px`, "0 0"] }, { duration: 150, easing: "ease-out" });
  });
}
function disarm() {
  if (!drag) return;
  clearTimeout(drag.timer);
  drag.tgt?.classList.remove("sc-merge");
  drag.tgt = drag.armed = null;
}
function arm(t) {
  if (drag.tgt == t) return;
  disarm();
  drag.tgt = t;
  drag.timer = setTimeout(() => { drag.armed = t; t.classList.add("sc-merge"); }, DWELL);
}
function startDrag(e) {
  const t = drag.t, r = t.getBoundingClientRect();
  Object.assign(drag, { on: true, dx: e.clientX - r.left, dy: e.clientY - r.top, node: model.get(t.dataset.guid), fromBox: !!t.closest(".sc-fold-box"), boxRect: boxEl()?.getBoundingClientRect() });
  const g = t.cloneNode(true);
  g.classList.add("sc-ghost");
  g.removeAttribute("href");
  g.style.width = r.width + "px";
  g.style.height = r.height + "px";
  document.body.append(g);
  drag.ghost = g;
  t.classList.add("sc-hole");
  document.body.classList.add("sc-dragging");
  closeMenu();
  try { document.documentElement.setPointerCapture(e.pointerId); } catch {} // pointerup придёт, даже если мышь ушла за страницу
}
function moveDrag(e) {
  const d = drag, hole = d.t;
  d.ghost.style.translate = `${e.clientX - d.dx}px ${e.clientY - d.dy}px`;
  const grid = gridEl();
  let cont = d.boxRect && inRect(d.boxRect, e) ? grid : root;
  if (cont == root && d.fromBox && top.length >= MAX) cont = grid; // основной ряд полон — ярлык остаётся в папке
  document.querySelector(".sc-fold-back")?.classList.toggle("away", !!d.boxRect && cont == root);
  const list = tilesOf(cont).filter(x => x != hole);
  if (hole.parentElement == cont && inRect(hole.getBoundingClientRect(), e)) return disarm(); // над своим местом
  if (!list.length) { disarm(); if (hole.parentElement != cont) flip(() => cont.insertBefore(hole, cont.querySelector(".lumi-add"))); return; }
  const dist = r => Math.hypot(Math.max(r.left - e.clientX, 0, e.clientX - r.right), Math.max(r.top - e.clientY, 0, e.clientY - r.bottom));
  let T = list[0], best = Infinity;
  for (const x of list) { const dd = dist(x.getBoundingClientRect()); if (dd < best) { best = dd; T = x; } }
  const r = T.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
  const centre = best == 0 && fx > .3 && fx < .7 && fy > .1 && fy < .9;
  if (centre && cont == root && !isDir(d.node) && T.parentElement == root) return arm(T); // задержка в центре — группировка
  disarm();
  const before = e.clientY < r.top ? true : e.clientY > r.bottom ? false : fx < .5, ref = before ? T : T.nextSibling;
  if (ref !== hole && ref !== hole.nextSibling) flip(() => cont.insertBefore(hole, ref));
}
async function endDrag(cancel) {
  const d = drag;
  drag = null;
  if (!d?.on) return;
  clearTimeout(d.timer);
  skipClick = true;
  setTimeout(() => skipClick = false, 60);
  document.body.classList.remove("sc-dragging");
  const { node, armed, t: hole, ghost } = d, inGrid = hole.parentElement == gridEl(), leftBox = d.fromBox && !inGrid;
  const next = hole.nextElementSibling?.classList.contains("lumi-tile") ? hole.nextElementSibling.dataset.guid : null;
  const dest = armed ?? hole;
  if (!cancel && dest.isConnected && !lowMotion()) { // плитка «садится» на место
    const r = dest.getBoundingClientRect();
    const a = ghost.animate({ translate: [ghost.style.translate, `${r.left}px ${r.top}px`], opacity: [1, armed ? 0 : 1], scale: [1.06, armed ? .4 : 1] }, { duration: 120, easing: "ease-out" });
    await Promise.race([a.finished.catch(() => {}), wait(250)]);
  }
  ghost.remove();
  hole.classList.remove("sc-hole");
  armed?.classList.remove("sc-merge");
  if (leftBox) closeBox();
  if (cancel || !node) return render(true);
  const parent = inGrid ? openGuid : folder(), tgt = armed && model.get(armed.dataset.guid);
  if (tgt) return group(node, tgt);
  const sibs = (model.get(node.parentGuid)?.children ?? []).filter(c => isLink(c) || isDir(c)), i = sibs.findIndex(c => c.guid == node.guid);
  if (parent == node.parentGuid && (sibs[i + 1]?.guid ?? null) == next) return render(true); // место не изменилось
  return mutate(async () => {
    let index = B.DEFAULT_INDEX;
    if (next) { const nx = await B.fetch(next); index = nx.index; if (nx.parentGuid == node.parentGuid && node.index < nx.index) index--; }
    await B.update({ guid: node.guid, parentGuid: parent, index });
    if (parent != node.parentGuid) await cleanup(node.parentGuid);
  });
}
function group(src, tgt) { // ярлык на ярлык → новая папка из двух; ярлык на папку → внутрь
  return mutate(async () => {
    let dest = tgt.guid;
    if (!isDir(tgt)) {
      const f = await B.insert({ parentGuid: folder(), type: B.TYPE_FOLDER, title: "Папка", index: (await B.fetch(tgt.guid)).index });
      await B.update({ guid: tgt.guid, parentGuid: f.guid, index: 0 });
      dest = f.guid;
    }
    await B.update({ guid: src.guid, parentGuid: dest, index: B.DEFAULT_INDEX });
    await cleanup(src.parentGuid);
  });
}

document.addEventListener("pointerdown", e => {
  if (menu && !menu.contains(e.target)) closeMenu();
  const t = e.button == 0 && e.target.closest?.(".lumi-tile");
  if (t && !t.classList.contains("sc-ghost") && !document.querySelector(".lumi-add-back")) drag = { t, x: e.clientX, y: e.clientY, on: false };
}, true);
window.addEventListener("pointermove", e => {
  if (!drag) return;
  if (!drag.on) { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return; startDrag(e); }
  moveDrag(e);
});
window.addEventListener("pointerup", () => endDrag(false));
window.addEventListener("pointercancel", () => endDrag(true));
document.addEventListener("dragstart", e => { if (e.target.closest?.(".lumi-tile")) e.preventDefault(); });
window.addEventListener("click", e => { if (skipClick) { e.preventDefault(); e.stopPropagation(); } }, true);
document.addEventListener("contextmenu", e => {
  const t = e.target.closest?.(".lumi-tile");
  if (t && !drag?.on) { e.preventDefault(); showMenu(e.clientX, e.clientY, t); }
});
document.addEventListener("keydown", e => {
  if (e.key == "Escape") {
    if (drag?.on) { e.preventDefault(); e.stopPropagation(); endDrag(true); }
    else if (menu) { e.preventDefault(); e.stopPropagation(); closeMenu(); }
    else if (openGuid && !document.querySelector(".lumi-add-back")) { e.preventDefault(); e.stopPropagation(); closeBox(); }
  } else if ((e.key == "Enter" || e.key == " ") && e.target.classList?.contains("sc-folder")) { e.preventDefault(); openBox(e.target.dataset.guid); }
}, true);
window.addEventListener("blur", closeMenu);

const open = (a, background) => win.openTrustedLinkIn(a.dataset.url, "tab", { inBackground: background });
document.addEventListener("click", e => {
  if (e.button) return; // в chrome-документе click приходит и для ПКМ. Не гасить его: preventDefault на click(2) делает mouseup «погашенным», и Windows не шлёт contextmenu
  if (e.target.closest(".lumi-add")) return openAdd();
  const a = e.target.closest(".lumi-tile");
  if (!a || a.classList.contains("sc-ghost")) return;
  e.preventDefault();
  if (a.classList.contains("sc-folder")) return openBox(a.dataset.guid);
  open(a, e.ctrlKey || e.metaKey);
  if (!(e.ctrlKey || e.metaKey) && a.closest(".sc-fold-box")) closeBox();
});
document.addEventListener("auxclick", e => {
  const a = e.target.closest(".lumi-tile");
  if (a && e.button == 1) { e.preventDefault(); if (!a.classList.contains("sc-folder")) open(a, true); }
});

// живое обновление: любые правки закладок → одна перерисовка через 200 мс (повтор после своих правок пропускает сравнение в render)
let timer = 0;
const later = () => { clearTimeout(timer); timer = setTimeout(render, 200); };
const events = ["bookmark-added", "bookmark-removed", "bookmark-moved", "bookmark-title-changed", "bookmark-url-changed"];
PlacesUtils.observers.addListener(events, later);
Services.prefs.addObserver(PREF, later);
// пресет вида (glass | minimal | dock | cards): атрибут на body, CSS в shortcuts.css; перерисовка не нужна
const applyPreset = () => document.body.setAttribute("lumi-sc-preset", Services.prefs.getStringPref(PRESET, "glass"));
Services.prefs.addObserver(PRESET, applyPreset);
applyPreset();
window.addEventListener("unload", () => {
  PlacesUtils.observers.removeListener(events, later);
  Services.prefs.removeObserver(PREF, later);
  Services.prefs.removeObserver(PRESET, applyPreset);
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) later(); });
window.lumiShortcuts = { render, folder, get tiles() { return [...root.querySelectorAll(".lumi-tile")]; }, get boxTiles() { return [...document.querySelectorAll(".sc-grid .lumi-tile")]; }, openBox, closeBox, get dragging() { return !!drag?.on; } };
render();
