// Панель настроек Luminoctis (chrome://userchrome/content/luminoctis/settings/settings.html, встроена в окно справа от рейки —
// js/lumi-rail.uc.js). Страница привилегированная: читает и пишет настройки Firefox напрямую,
// закрепы (родные Essentials Zen) — через win.luminoctis, пространства — через gZenWorkspaces окна.
import { JS } from "../home/paths.js";
const { t, localize, locale } = ChromeUtils.importESModule(JS("lumi-i18n.sys.mjs"));
localize(document); // до всего, что строится из текста страницы (плитки, чипы, поиск)
const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
const win = window.browsingContext.topChromeWindow; // окно браузера с этой панелью
const { ContextualIdentityService } = win;
const $ = sel => document.querySelector(sel);
// следить за настройкой: read() сразу и при каждой смене, снять наблюдателя при закрытии страницы
const watchPref = (pref, read) => {
  Services.prefs.addObserver(pref, read);
  window.addEventListener("unload", () => Services.prefs.removeObserver(pref, read));
  read();
};
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
// цвета контейнеров — токены палитры, как точки на рейке
const DOT = { blue: "blue", turquoise: "teal", green: "green", yellow: "yellow", orange: "orange",
  red: "red", pink: "pink", purple: "purple", toolbar: "fg" };
// палитра: цвета ставятся и на эту страницу (она отдельный документ и не наследует переменные окна)
const palette = ChromeUtils.importESModule(JS("lumi-palette.sys.mjs"));
palette.watch(document, { glass: true });
const keys = ChromeUtils.importESModule(JS("lumi-keys.sys.mjs"));

let onPanelShown = null; // (видна) — для превью часов: скрытая панель их не тикает
// ---------- стекло: сквозь панель видно то, что за окном ----------
// Панель лежит над сайтом (<browser> другого процесса), который не размыть и не сделать прозрачным. В прозрачном режиме и в «Обоях»
// область сайтов (#tabbrowser-tabpanels) маскируется дыркой ровно под панелью (chrome.css, раздел 14, [lumi-hole]) —
// как вырез сайта под выехавшей рейкой в Compacting. Размер дырки считаем по живому прямоугольнику панели, пока идёт её анимация.
{
  const box = window.frameElement?.parentNode, panels = win.document.getElementById("tabbrowser-tabpanels"), root = win.document.documentElement;
  let until = 0, running = false;
  const hole = () => {
    const on = box && !box.hidden && root.hasAttribute("lumi-glass") && root.getAttribute("inDOMFullscreen") != "true";
    const r = box?.getBoundingClientRect(), p = panels.getBoundingClientRect();
    panels.toggleAttribute("lumi-hole", !!on);
    win.lumiSiteBlur?.set("settings", on ? r : null); // где размытие сайта возможно (корню [lumi-site-blur]), дырка отключена CSS, а под панелью виден размытый сайт
    if (on) for (const [v, n] of [["x", r.left - p.left], ["y", r.top - p.top], ["w", r.width], ["h", r.height]]) panels.style.setProperty(`--lumi-hole-${v}`, n + "px");
  };
  const frame = () => { hole(); if (Date.now() < until) win.requestAnimationFrame(frame); else running = false; };
  const kick = () => { until = Date.now() + 450; if (!running) { running = true; win.requestAnimationFrame(frame); } };
  if (box && panels) {
    const mo = new win.MutationObserver(() => { kick(); onPanelShown?.(!box.hidden); });
    mo.observe(box, { attributes: true });
    mo.observe(root, { attributes: true, attributeFilter: ["lumi-glass", "inDOMFullscreen"] });
    win.addEventListener("resize", kick);
    window.addEventListener("unload", () => { mo.disconnect(); win.removeEventListener("resize", kick); panels.removeAttribute("lumi-hole"); win.lumiSiteBlur?.set("settings", null); }, { once: true });
    kick();
  }
}

// ---------- разделы: колонка плиток слева, открытый раздел — в адресе (settings.html#look или #раздел/группа) ----------
const tabButtons = [...document.querySelectorAll(".tabs [data-tab]")];
const sections = [...document.querySelectorAll("main > section")];
const mainEl = $("main");
// плитка: полное название в title (если в разметке нет своего), связь вкладки и раздела для скринридеров
for (const b of tabButtons) {
  b.id = "tab-" + b.dataset.tab;
  b.title ||= b.querySelector("span").textContent;
  document.getElementById(b.dataset.tab).setAttribute("aria-labelledby", b.id);
}
// старые имена разделов (запомненные в luminoctis.settings.tab, внешние вызовы openSettings) → раздел[/группа]
// схема 2026-11-01: panels→tabs, menu и keys→control; схема 2026-11-12: «Строгий режим» и «Звуки» стали группами других разделов
const ALIASES = { panels: "tabs", menu: "control", keys: "control", strict: "tabs/g-strict", sounds: "look/g-sounds" };
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- поиск по настройкам ----------
// Ищет по видимому тексту (textContent) строк, их подсказок-title и заголовков групп; словаря нет, поэтому работает на любом языке.
// Строка (блок) = прямой потомок раздела (или обёртки #glass-options / details); подходит, если все слова запроса есть в «заголовок группы + текст + title».
// Регистр и диакритика не важны (ё = е). Раздел с совпадениями показывается со своим заголовком (.res-head), остальное прячет класс .nomatch.
const finder = $("#find"), findEmpty = $("#find-empty");
const norm = s => s.toLocaleLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const searching = () => document.body.classList.contains("searching");
let scrollBeforeFind = 0;
for (const section of sections) {
  const head = el("button", { className: "res-head", type: "button" }, el("span"));
  head.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m4 2 4 4-4 4"/></svg>');
  head.addEventListener("click", () => openSection(section.id));
  section.prepend(head);
}
function clearFind(restoreScroll) {
  finder.value = "";
  if (!searching()) return;
  document.body.classList.remove("searching");
  for (const n of document.querySelectorAll(".nomatch")) n.classList.remove("nomatch");
  for (const d of document.querySelectorAll("main details")) { d.open = d.dataset.wasOpen == "1"; delete d.dataset.wasOpen; }
  findEmpty.hidden = true;
  mainEl.scrollTop = restoreScroll ? scrollBeforeFind : 0;
}
function runFind() {
  const q = norm(finder.value.trim());
  if (!q) return clearFind(true);
  if (!searching()) { scrollBeforeFind = mainEl.scrollTop; document.body.classList.add("searching"); }
  const words = q.split(/\s+/);
  for (const n of document.querySelectorAll(".nomatch")) n.classList.remove("nomatch");
  for (const d of document.querySelectorAll("main details")) { d.dataset.wasOpen ??= d.open ? "1" : ""; d.open = true; } // свёрнутое «Ещё» тоже ищется
  let total = 0;
  for (const section of sections) {
    const groups = [], rows = []; // группа: заголовок h2 и её блоки; rows — все блоки раздела с признаком совпадения
    let cur = { h2: null, blocks: [] };
    groups.push(cur);
    const walk = parent => {
      for (const c of parent.children) {
        if (c.matches("h2")) { cur = { h2: c, blocks: [] }; groups.push(cur); }
        else if (c.matches(".chips, .res-head, .reset-wrap, .note, summary, p.hint")) continue;
        else if (c.matches("#glass-options, details")) walk(c);
        else cur.blocks.push(c);
      }
    };
    walk(section);
    let any = false;
    for (const g of groups) {
      const title = g.h2 ? g.h2.textContent : "";
      let hit = false;
      for (const b of g.blocks) {
        const text = norm(title + " " + b.textContent + " " + (b.title || ""));
        const ok = b.getClientRects().length > 0 && words.every(w => text.includes(w));
        rows.push([b, ok]);
        hit ||= ok;
      }
      if (g.h2 && !hit) g.h2.classList.add("nomatch");
      any ||= hit;
    }
    for (const [b, ok] of rows) if (!ok) b.classList.add("nomatch");
    for (const d of section.querySelectorAll("details")) if (!d.querySelector(":scope > :not(summary):not(.nomatch)")) d.classList.add("nomatch");
    section.classList.toggle("nomatch", !any);
    if (any) { total++; section.querySelector(".res-head span").textContent = tabButtons.find(t => t.dataset.tab == section.id).querySelector("span").textContent; }
  }
  findEmpty.hidden = total > 0;
  mainEl.scrollTop = 0;
}
finder.addEventListener("input", runFind);

// ---------- оглавление длинного раздела: чипы-группы (из h2, без .hint), липнут к верху ----------
for (const section of sections) {
  const heads = [...section.querySelectorAll(":scope > h2")];
  if (heads.length < 4 || "nochips" in section.dataset) continue;
  const chips = el("div", { className: "chips" });
  for (const h of heads) {
    const copy = h.cloneNode(true);
    copy.querySelector(".hint")?.remove();
    const chip = el("button", { type: "button", textContent: copy.textContent.trim() });
    chip.addEventListener("click", () => scrollToGroup(h, calm() ? "auto" : "smooth"));
    chips.append(chip);
  }
  section.prepend(chips);
  section.dataset.chips = "";
}
function scrollToGroup(h, behavior = "auto") {
  const chips = h.parentNode.querySelector(":scope > .chips");
  if (chips) h.parentNode.style.setProperty("--chips-h", chips.offsetHeight + 6 + "px"); // чипы могут занять две строки
  h.scrollIntoView({ block: "start", behavior });
}

const showTab = () => {
  clearFind();
  const [hashName, hashGroup] = location.hash.slice(1).split("/");
  const [aliasName, aliasGroup] = (ALIASES[hashName] ?? hashName).split("/");
  const name = tabButtons.some(b => b.dataset.tab == aliasName) ? aliasName : "look";
  for (const b of tabButtons) { b.setAttribute("aria-selected", b.dataset.tab == name); b.tabIndex = b.dataset.tab == name ? 0 : -1; }
  for (const s of sections) s.classList.toggle("shown", s.id == name);
  mainEl.scrollTop = 0;
  const group = document.getElementById(hashGroup ?? aliasGroup);
  if (group?.parentNode.id == name) scrollToGroup(group); // «#strict» → раздел «Вкладки», сразу к блокировке сайтов
  Services.prefs.setStringPref("luminoctis.settings.tab", name); // панель откроется на нём и после перезапуска
};
window.lumiShowTab = showTab; // для js/lumi-rail.uc.js: тот же адрес hashchange не шлёт
// открыть раздел: replaceState, а не location.replace — переход к «#якорю» сбрасывал бы фокус с плитки (стрелки по колонке); hashchange при этом не приходит, показываем сами
function openSection(name) {
  const changed = location.hash != "#" + name;
  history.replaceState(null, "", "#" + name);
  if (changed || searching()) showTab();
}
for (const b of tabButtons) b.addEventListener("click", () => openSection(b.dataset.tab));
// стрелки вверх/вниз по колонке разделов (по кругу), Home/End — первый/последний
$(".tabs").addEventListener("keydown", event => {
  const i = tabButtons.indexOf(document.activeElement), n = tabButtons.length;
  const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[event.key];
  if (i < 0 || to === undefined) return;
  event.preventDefault();
  const b = tabButtons[(to + n) % n];
  b.focus();
  b.click();
});
window.addEventListener("hashchange", showTab);
// ссылки «Настроить обои →» и т.п.: data-goto="раздел"
document.addEventListener("click", event => {
  const a = event.target.closest("[data-goto]");
  if (!a) return;
  event.preventDefault();
  openSection(a.dataset.goto);
});
showTab();

// «Готово» и Esc закрывают панель; клик мимо — нет, рейкой можно пользоваться и при открытых настройках. Esc при непустом поиске сначала очищает его
const close = () => win.luminoctis.closeSettings();
$("#done").addEventListener("click", close);
window.addEventListener("keydown", event => {
  if (event.key != "Escape" || event.defaultPrevented) return;
  if (searching()) { event.preventDefault(); clearFind(true); } else close();
});

// ---------- флажки, привязанные к настройкам (data-pref, data-inverted — флажок означает «не») ----------
for (const box of document.querySelectorAll("input[type=checkbox][data-pref]")) {
  const pref = box.dataset.pref, inverted = "inverted" in box.dataset;
  const read = () => (box.checked = Services.prefs.getBoolPref(pref, box.dataset.default == "true") != inverted);
  box.addEventListener("change", () => Services.prefs.setBoolPref(pref, box.checked != inverted));
  watchPref(pref, read);
}

// LumiTime целиком — вкладкой (мини-окно таймера и плитка живут на рейке, js/lumi-rail.uc.js)
$("#time-open").addEventListener("click", () => { win.luminoctis.closeSettings(); win.luminoctis.openTime(); });

// ---------- выбор из нескольких значений (data-pref, data-default; кнопки data-value; data-int — числовая настройка) ----------
for (const seg of document.querySelectorAll("div[data-pref]")) {
  const pref = seg.dataset.pref, int = "int" in seg.dataset;
  const read = () => {
    const v = int ? String(Services.prefs.getIntPref(pref, Number(seg.dataset.default))) : Services.prefs.getStringPref(pref, seg.dataset.default);
    for (const b of seg.querySelectorAll("[data-value]")) b.classList.toggle("on", b.dataset.value == v);
  };
  seg.addEventListener("click", event => {
    const b = event.target.closest("[data-value]");
    if (b) int ? Services.prefs.setIntPref(pref, Number(b.dataset.value)) : Services.prefs.setStringPref(pref, b.dataset.value);
  });
  watchPref(pref, read);
}

// режим окна: body[data-mode] прячет лишние строки (settings.css); «Обои» доступны, только пока у Home режим обоев (lumi-palette откатывает сам)
{
  const WIN = "luminoctis.look.window", MODE = "luminoctis.home.wallpaper.mode", btn = $("#mode-wallpaper"), pr = Services.prefs;
  const show = () => {
    const m = pr.getStringPref(WIN, "");
    document.body.dataset.mode = m == "transparent" || m == "wallpaper" ? m : "opaque";
    const ok = pr.getStringPref(MODE, "wallpaper") == "wallpaper";
    btn.disabled = !ok;
    btn.title = ok ? "" : t("Нужен режим «Обои» у Главной");
  };
  for (const n of [WIN, MODE]) watchPref(n, show);
}

// прозрачность окна даёт Windows (Zen: widget.windows.mica); если её нет — предупреждаем
$("#glass-off").hidden = win.matchMedia("(-moz-windows-mica)").matches;

// настройки цвета Windows, мешающие прозрачности (js/lumi-win-colors.sys.mjs): подсказка с кнопками, пока что-то не исправлено, — только в прозрачных режимах и независимо от «Не напоминать»
{
  const W = ChromeUtils.importESModule(JS("lumi-win-colors.sys.mjs")), hint = $("#win-hint");
  const show = () => { const c = W.lumiWinColors.check(); hint.hidden = !(c.active && c.issues.length); };
  $("#win-fix").addEventListener("click", () => { W.lumiWinColors.fix(); show(); });
  $("#win-open").addEventListener("click", () => W.lumiWinColors.openSettings());
  watchPref(W.MODE, show);
  Services.obs.addObserver(show, W.TOPIC);
  win.addEventListener("focus", show); // вернулся из настроек Windows
  window.addEventListener("unload", () => { Services.obs.removeObserver(show, W.TOPIC); win.removeEventListener("focus", show); });
}

// ---------- выгрузка по таймеру: минуты, 0 — никогда (таймер — js/lumi-rail.uc.js) ----------
const unload = $("#unload"), UNLOAD = "luminoctis.tabs.unload-minutes";
unload.addEventListener("change", () => Services.prefs.setIntPref(UNLOAD, Number(unload.value)));
watchPref(UNLOAD, () => (unload.value = String(Services.prefs.getIntPref(UNLOAD, 0))));

// ---------- перетаскивание строк списка (пространства, закрепы) ----------
// Тянуть за ручку ⠿; черта показывает место. onMove(откуда, куда) — индексы итогового места в списке.
function sortable(list, onMove) {
  let from = -1;
  const rows = () => [...list.querySelectorAll(":scope > .item")];
  const slot = y => {
    const i = rows().findIndex(r => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
    return i < 0 ? rows().length : i;
  };
  const mark = i => rows().forEach((r, k) => {
    r.classList.toggle("drop-before", k == i);
    r.classList.toggle("drop-after", i == rows().length && k == rows().length - 1);
  });
  list.addEventListener("dragstart", event => {
    const row = event.target.closest?.(".item");
    if (!row || !event.target.classList.contains("grip")) return;
    from = rows().indexOf(row);
    row.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(from));
    event.dataTransfer.setDragImage(row, 20, row.offsetHeight / 2);
  });
  list.addEventListener("dragover", event => {
    if (from < 0) return;
    event.preventDefault();
    mark(slot(event.clientY));
  });
  list.addEventListener("drop", event => {
    if (from < 0) return;
    event.preventDefault();
    const to = slot(event.clientY);
    const final = to > from ? to - 1 : to;
    if (final != from) onMove(from, final);
  });
  list.addEventListener("dragend", () => {
    from = -1;
    mark(-1);
    list.querySelector(".dragging")?.classList.remove("dragging");
  });
}
const grip = () => el("span", { className: "grip", draggable: true, textContent: "⠿", title: t("Перетащите, чтобы поменять порядок") });

// ---------- рабочие пространства ----------
function renderSpaces() {
  const spaces = win.gZenWorkspaces.getWorkspaces();
  const identities = ContextualIdentityService.getPublicIdentities();
  $("#spaces").replaceChildren(...spaces.map(ws => {
    const icon = el("button", { className: "icon", title: t("Сменить иконку") });
    if (ws.icon?.endsWith(".svg")) icon.append(el("img", { src: ws.icon }));
    else icon.textContent = ws.icon || "•";
    // родной выбор иконки Zen, рядом с кнопкой пространства в рейке
    icon.addEventListener("click", () => {
      const anchor = win.document.querySelector(`#zen-workspaces-button toolbarbutton[zen-workspace-id="${ws.uuid}"]`);
      win.gZenEmojiPicker.open(anchor, {
        onSelect: async value => {
          ws.icon = value;
          await win.gZenWorkspaces.saveWorkspace(ws);
        },
      });
      win.focus();
    });
    const name = el("input", { className: "name", type: "text", value: ws.name, title: t("Название") });
    name.addEventListener("change", () => {
      ws.name = name.value.trim() || ws.name;
      win.gZenWorkspaces.saveWorkspace(ws);
    });
    const color = identities.find(i => i.userContextId == ws.containerTabId)?.color;
    const dot = el("span", { className: "dot" });
    dot.style.background = DOT[color] ? `var(--lumi-${DOT[color]})` : "transparent";
    const container = el("select", { title: t("Контейнер: новые вкладки пространства открываются в нём") },
      el("option", { value: 0, textContent: t("Без контейнера") }),
      ...identities.map(i => el("option", { value: i.userContextId, textContent: ContextualIdentityService.getUserContextLabel(i.userContextId) })));
    container.value = ws.containerTabId || 0;
    if (container.selectedIndex < 0) container.value = 0; // контейнер удалён — иначе список пустой
    container.addEventListener("change", () => {
      ws.containerTabId = Number(container.value);
      win.gZenWorkspaces.saveWorkspace(ws);
    });
    // удалить — родным removeWorkspace Zen (вкладки пространства закрываются), после подтверждения под строкой; последнее — нельзя
    const remove = el("button", { className: "small remove", textContent: "×", disabled: spaces.length < 2,
      title: spaces.length < 2 ? t("Последнее пространство удалить нельзя") : t("Удалить пространство") });
    const row = el("div", { className: "item" }, grip(), icon, name, dot, container, remove);
    remove.addEventListener("click", () => {
      if (row.nextElementSibling?.classList.contains("confirm")) return row.nextElementSibling.remove();
      const yes = el("button", { className: "danger", textContent: t("Удалить") });
      const no = el("button", { textContent: t("Отмена") });
      const ask = el("div", { className: "confirm" },
        el("span", { textContent: t("Удалить «{0}»? Его вкладки закроются.", ws.name) }), yes, no);
      yes.addEventListener("click", () => {
        if (win.gZenWorkspaces.getWorkspaces().length > 1) win.gZenWorkspaces.removeWorkspace(ws.uuid);
        ask.remove();
      });
      no.addEventListener("click", () => ask.remove());
      row.after(ask);
      no.focus();
    });
    return row;
  }));
}
// новое — родным createAndSaveWorkspace Zen, в конце списка, без переключения на него; сразу можно ввести название
$("#space-add").addEventListener("click", async () => {
  await win.gZenWorkspaces.createAndSaveWorkspace(t("Новое пространство"), undefined, true);
  renderSpaces();
  const name = $("#spaces .item:last-child .name");
  name?.focus();
  name?.select();
});
// родная перестановка пространств Zen (ей же пользуется перетаскивание кнопок пространств)
sortable($("#spaces"), (from, to) => win.gZenWorkspaces.reorderWorkspace(win.gZenWorkspaces.getWorkspaces()[from].uuid, to));
for (const type of ["ZenWorkspacesUIUpdate", "ZenWorkspaceDataChanged"]) {
  win.addEventListener(type, renderSpaces);
  window.addEventListener("unload", () => win.removeEventListener(type, renderSpaces));
}
renderSpaces();

// ---------- закрепы = родные Essentials Zen (js/lumi-rail.uc.js) ----------
const lumi = win.luminoctis;
const urlOf = tab => tab.linkedBrowser.currentURI.spec;
const readable = url => { try { return decodeURI(url); } catch { return url; } }; // %D0%9A… → кириллица
// название над адресом — в узкой панели так помещается больше
const site = (title, url) => el("span", { className: "site", title: url },
  el("span", { className: "title", textContent: title || url }), el("span", { className: "url", textContent: readable(url) }));
function renderPins() {
  const pins = lumi.pins();
  $("#pins").replaceChildren(...(pins.length ? pins.map(tab => {
    const remove = el("button", { className: "small remove", textContent: "×", title: t("Открепить") });
    remove.addEventListener("click", () => lumi.unpin(tab)); // как «Открепить» в меню закрепа: вкладка закрывается
    return el("div", { className: "item" }, grip(),
      el("span", { className: "icon" }, el("img", { src: win.gBrowser.getIcon(tab) || `page-icon:${urlOf(tab)}` })),
      site(tab.label, urlOf(tab)), remove);
  }) : [el("div", { className: "empty", textContent: t("Закрепов нет — добавьте сайт кнопкой ниже") })]));
}
sortable($("#pins"), (from, to) => lumi.movePin(lumi.pins()[from], to));
// перерисовка — только когда меняются сами закрепы (TabAttrModified у загружающихся вкладок идёт постоянно)
let pinTimer;
const onPinEvent = event => {
  if (event.type != "TabRemovedFromEssentials" && !event.target.hasAttribute?.("zen-essential")) return;
  clearTimeout(pinTimer);
  pinTimer = setTimeout(renderPins, 100);
};
const pinEvents = ["TabAddedToEssentials", "TabRemovedFromEssentials", "TabClose", "TabMove", "TabAttrModified"];
for (const type of pinEvents) win.addEventListener(type, onPinEvent);
window.addEventListener("unload", () => pinEvents.forEach(type => win.removeEventListener(type, onPinEvent)));
renderPins();

// «Текущий сайт» — выбранная вкладка (или последняя открытая) с обычной страницей; она сама становится закрепом
const lastSite = () => win.gBrowser.visibleTabs
  .filter(t => !t.hasAttribute("zen-essential") && /^https?:/.test(urlOf(t)))
  .sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
const current = $("#pin-current");
const showCurrent = () => {
  const tab = lastSite();
  current.disabled = !tab;
  current.textContent = tab ? t("+ Текущий сайт: {0}", tab.label) : t("+ Текущий сайт");
};
current.addEventListener("click", () => {
  const tab = lastSite();
  if (tab) lumi.pinTab(tab);
  showCurrent();
});
for (const type of ["TabSelect", "TabAddedToEssentials"]) {
  win.addEventListener(type, showCurrent);
  window.addEventListener("unload", () => win.removeEventListener(type, showCurrent));
}
showCurrent();

// «Из закладок» — поиск по закладкам; закреп — новая ленивая вкладка с адресом закладки (сама закладка остаётся на месте)
const search = $("#pin-search");
const findBookmarks = async () => {
  const query = search.value.trim();
  const pinned = new Set(lumi.pins().map(urlOf));
  const found = query.length < 2 ? [] : (await PlacesUtils.bookmarks.search(query)).filter(b => b.url && !pinned.has(b.url.href)).slice(0, 8);
  $("#pin-results").replaceChildren(...found.map(b => {
    const add = el("button", { textContent: t("Добавить") });
    add.addEventListener("click", () => {
      lumi.addPin(b.url.href, b.title);
      findBookmarks(); // добавленная пропадает из результатов
    });
    return el("div", { className: "item" },
      el("span", { className: "icon" }, el("img", { src: `page-icon:${b.url.href}` })), site(b.title, b.url.href), add);
  }));
};
search.addEventListener("input", findBookmarks);

// ---------- меню «⋯» и меню вкладки: какие пункты видны (в настройке — id скрытых через запятую; прячет js/lumi-appmenu.uc.js) ----------
// luminoctis.appmenu.hidden — меню «⋯», luminoctis.tabmenu.hidden — меню вкладки (#tabContextMenu)
async function renderMenuList(list, pref, getItems) {
  const hiddenItems = () => Services.prefs.getStringPref(pref, "").split(",").filter(Boolean);
  const hidden = hiddenItems();
  list.replaceChildren(...(await getItems()).map(({ id, label }) => {
    const box = el("input", { type: "checkbox", checked: !hidden.includes(id) });
    box.dataset.item = id;
    box.addEventListener("change", () => {
      const rest = hiddenItems().filter(x => x != id);
      Services.prefs.setStringPref(pref, (box.checked ? rest : [...rest, id]).join(","));
    });
    return el("label", { className: "row slim" }, el("span", { textContent: label }), box);
  }));
  // настройку поменяли не флажком (например «Сбросить раздел») — обновить флажки на месте
  watchPref(pref, () => { const h = hiddenItems(); for (const b of list.querySelectorAll("input")) b.checked = !h.includes(b.dataset.item); });
}
renderMenuList($("#appmenu"), "luminoctis.appmenu.hidden", () => lumi.appMenuItems());
renderMenuList($("#tabmenu"), "luminoctis.tabmenu.hidden", () => lumi.tabMenuItems());

// ---------- шорткаты: клик по сочетанию — запись нового (js/lumi-keys.sys.mjs), Esc — отмена, ↺ — по умолчанию ----------
// Мышь: нужен Ctrl, Alt или Shift — иначе обычный клик по вкладке перестал бы работать; нажатие без них отменяет запись.
let recording = null; // { name, bind }
function renderKeys() {
  for (const row of document.querySelectorAll("[data-key]")) {
    const name = row.dataset.key;
    row.querySelector(".bind").textContent = keys.label(keys.get(name));
    row.querySelector(".reset").hidden = !Services.prefs.prefHasUserValue(keys.pref(name));
  }
}
const stopRecording = () => {
  recording?.bind.classList.remove("recording");
  recording = null;
  renderKeys();
};
function record(name) {
  stopRecording();
  const bind = document.querySelector(`[data-key="${name}"] .bind`);
  recording = { name, bind };
  bind.classList.add("recording");
  bind.textContent = t("Нажмите…"); // подсказка — в описании строки
}
for (const row of document.querySelectorAll("[data-key]")) {
  const name = row.dataset.key;
  row.querySelector(".bind").addEventListener("click", event => {
    if (!recording) record(name);
  });
  row.querySelector(".reset").addEventListener("click", () => Services.prefs.clearUserPref(keys.pref(name)));
  watchPref(keys.pref(name), renderKeys);
}
// нажатие, которым записали сочетание, дальше не идёт: ни клик по кнопке под мышью, ни меню правой кнопки
let swallow = false;
window.addEventListener("mousedown", event => {
  swallow = !!recording;
  if (!recording) return;
  event.preventDefault();
  event.stopPropagation();
  const combo = keys.KEYS[recording.name].mouse && keys.mouseCombo(event);
  if (combo && /^(ctrl|alt|shift|meta)\+/.test(combo)) Services.prefs.setStringPref(keys.pref(recording.name), combo);
  stopRecording();
}, true);
for (const type of ["click", "auxclick", "contextmenu"]) {
  window.addEventListener(type, event => {
    if (!swallow) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
}
window.addEventListener("keydown", event => {
  swallow = false;
  if (!recording) return;
  event.preventDefault();
  event.stopPropagation(); // Esc не закрывает панель, Tab не уводит фокус
  const { name } = recording;
  if (event.key == "Escape") return stopRecording();
  if (keys.KEYS[name].mouse) return;
  const combo = keys.keyCombo(event);
  if (!combo) return; // пока зажат только модификатор
  Services.prefs.setStringPref(keys.pref(name), combo);
  stopRecording();
}, true);
window.addEventListener("blur", stopRecording); // ушли из панели (или её закрыли) — запись не висит до следующего открытия
renderKeys();

// ---------- палитра: готовые палитры и правка каждого цвета (js/lumi-palette.sys.mjs) ----------
const SAMPLE = ["bg0", "bg1", "surface", "raised", "fg", "accent", "red", "green"];
const chips = c => el("span", { className: "swatches" }, ...SAMPLE.map(t => {
  const i = el("i");
  i.style.background = c[t];
  return i;
}));
// своя тема: строка-div (внутри кнопки кнопок не бывает) с ✎ и 🗑; имя / подтверждение удаления — прямо в строке
let pending = null; // { mode: "create" } | { mode: "rename"|"delete", id }
const small = (text, title, fn) => {
  const b = el("button", { className: "small", textContent: text, title });
  b.addEventListener("click", event => { event.stopPropagation(); fn(); });
  return b;
};
function nameInput(value, commit) {
  const input = el("input", { className: "name-in", type: "text", value, maxLength: 40, spellcheck: false });
  const done = ok => { pending = null; if (ok) commit(input.value); else renderPresets(); };
  input.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.key == "Enter") done(true);
    else if (event.key == "Escape") { event.preventDefault(); done(false); }
  });
  input.addEventListener("click", event => event.stopPropagation());
  input.addEventListener("blur", () => { if (pending) done(true); });
  requestAnimationFrame(() => { input.focus(); input.select(); });
  return input;
}
function renderPresets() {
  const id = palette.presetId(), items = [];
  const builtin = Object.entries(palette.PRESETS).map(([key, { name }]) => ({ key, name }));
  const custom = palette.customThemes().map(t => ({ key: "custom:" + t.id, name: t.name, custom: true }));
  for (const { key, name, custom: mine } of [...builtin, ...custom]) {
    const row = el(mine ? "div" : "button", { className: "preset" + (key == id ? " on" : "") + (mine ? " mine" : "") });
    const renaming = mine && pending?.mode == "rename" && pending.id == key;
    row.append(renaming ? nameInput(name, v => palette.renameTheme(key, v)) : el("span", { className: "name", textContent: name }));
    if (palette.edited(key).length) row.append(el("span", { className: "badge", textContent: t("изменена") }));
    if (mine && !renaming) row.append(small("✎", t("Переименовать"), () => { pending = { mode: "rename", id: key }; renderPresets(); }),
      small("🗑", t("Удалить тему оформления"), () => { pending = { mode: "delete", id: key }; renderPresets(); }));
    row.append(chips(palette.colors(key)));
    row.dataset.preset = key;
    row.setAttribute("aria-pressed", key == id);
    if (mine) { row.tabIndex = 0; row.setAttribute("role", "button"); }
    row.addEventListener("click", () => palette.choose(key));
    items.push(row);
    if (mine && pending?.mode == "delete" && pending.id == key) {
      const yes = el("button", { className: "danger", textContent: t("Удалить") }), no = el("button", { textContent: t("Отмена") });
      yes.addEventListener("click", () => { pending = null; palette.deleteTheme(key); });
      no.addEventListener("click", () => { pending = null; renderPresets(); });
      items.push(el("div", { className: "confirm" }, el("span", { textContent: t("Удалить тему «{0}»?", name) }), yes, no));
    }
  }
  if (pending?.mode == "create") {
    items.push(el("div", { className: "preset on creating" }, nameInput(palette.defaultThemeName(), v => palette.createTheme(v)), el("span", { className: "badge", textContent: "Enter" })));
  }
  $("#presets").replaceChildren(...items);
  const edits = !palette.isCustom(id) && palette.edited().length > 0;
  $("#theme-create").hidden = !!pending?.mode && pending.mode == "create";
  $("#theme-create").textContent = edits ? t("Сохранить правки как свою тему") : t("+ Создать тему");
  $("#theme-create").title = t("Копия текущих цветов станет вашей темой");
  $("#theme-save-hint").hidden = !edits;
}
$("#theme-create").addEventListener("click", () => { pending = { mode: "create" }; renderPresets(); });
$("#theme-save-hint").addEventListener("click", () => { pending = { mode: "create" }; renderPresets(); $("#presets").scrollIntoView({ block: "center" }); });

// пересчёт цветов: HSV (квадрат и полоса оттенка) ↔ RGB ↔ hex
const hsv2rgb = (h, s, v) => [5, 3, 1].map(n => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); });
const rgb2hsv = (r, g, b) => {
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d && (max == r ? (g - b) / d % 6 : max == g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return [(h + 360) % 360, max && d / max, max / 255];
};
const toHex = rgb => "#" + rgb.map(x => x.toString(16).padStart(2, "0")).join("");
const fromHex = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const parseHex = text => {
  let t = text.trim().toLowerCase().replace(/^#?/, "#");
  if (/^#[0-9a-f]{3}$/.test(t)) t = "#" + [...t.slice(1)].map(c => c + c).join("");
  return /^#[0-9a-f]{6}$/.test(t) ? t : null;
};
// у серого и чёрного нет оттенка — оставляем прежний, иначе полоса оттенка прыгала бы в красный
const hsvOf = (hex, keepHue) => { const hsv = rgb2hsv(...fromHex(hex)); return hsv[1] && hsv[2] ? hsv : [keepHue, hsv[1], hsv[2]]; };
window.lumiColorMath = { hsv2rgb, rgb2hsv, toHex, fromHex, parseHex }; // для dev\check-look.js

let editor = null; // открытый редактор цвета (один на всю палитру)
function openEditor(token) {
  const same = editor?.token == token;
  editor?.node.remove();
  editor = same ? null : makeEditor(token); // повторный клик по строке — закрыть
  for (const row of document.querySelectorAll(".color")) {
    const open = row.dataset.token == editor?.token;
    row.classList.toggle("open", open);
    row.setAttribute("aria-expanded", open);
    if (open) row.after(editor.node);
  }
}
function makeEditor(token) {
  const sv = el("div", { className: "sv", tabIndex: 0 }, el("div", { className: "mark" }));
  sv.setAttribute("aria-label", t("Насыщенность и яркость"));
  const hue = el("input", { className: "hue", type: "range", min: 0, max: 360, step: 1, title: t("Оттенок") });
  hue.setAttribute("aria-label", t("Оттенок"));
  const hexIn = el("input", { className: "hexin", type: "text", spellcheck: false, title: t("Цвет: #rrggbb или #rgb") });
  const rgbIn = [0, 1, 2].map(() => el("input", { type: "number", min: 0, max: 255 }));
  const reset = el("button", { textContent: t("Сбросить"), title: t("Вернуть цвет палитры") });
  const node = el("div", { className: "editor" }, sv, hue,
    el("div", { className: "fields" }, hexIn, ...rgbIn.map((input, i) => el("label", {}, "RGB"[i], input)), reset));
  const ed = { token, node, hex: "", hsv: [0, 0, 0], frame: 0 };
  // показать состояние; поле, которое сейчас правят, не трогаем
  const show = except => {
    const [h, s, v] = ed.hsv;
    sv.style.setProperty("--hue", h);
    sv.firstChild.style.left = s * 100 + "%";
    sv.firstChild.style.top = (1 - v) * 100 + "%";
    if (except != hue) hue.value = h;
    if (except != hexIn) { hexIn.value = ed.hex; hexIn.classList.remove("bad"); }
    fromHex(ed.hex).forEach((x, i) => { if (except != rgbIn[i]) rgbIn[i].value = x; });
  };
  // значение из настройки: открытие, смена палитры, сброс, правка из другого окна
  ed.sync = () => {
    ed.hex = palette.colors()[token];
    ed.hsv = hsvOf(ed.hex, ed.hsv[0]);
    show();
  };
  // своя правка: сразу в редакторе, в настройку — не чаще раза за кадр (её наблюдатель перекрашивает все окна)
  const set = (hex, hsv, except) => {
    ed.hex = hex;
    ed.hsv = hsv;
    show(except);
    ed.frame ||= requestAnimationFrame(() => { ed.frame = 0; palette.setColor(token, ed.hex); });
  };
  const fromHsv = (hsv, except) => set(toHex(hsv2rgb(...hsv)), hsv, except);
  const clamp = x => Math.min(1, Math.max(0, x));
  const pick = event => {
    const b = sv.getBoundingClientRect();
    fromHsv([ed.hsv[0], clamp((event.clientX - b.left) / b.width), 1 - clamp((event.clientY - b.top) / b.height)]);
  };
  sv.addEventListener("pointerdown", event => { sv.setPointerCapture(event.pointerId); pick(event); });
  sv.addEventListener("pointermove", event => { if (sv.hasPointerCapture(event.pointerId)) pick(event); });
  sv.addEventListener("keydown", event => {
    const step = event.shiftKey ? 0.1 : 0.01, [h, s, v] = ed.hsv;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key];
    if (!move) return;
    event.preventDefault();
    fromHsv([h, clamp(s + move[0]), clamp(v + move[1])]);
  });
  hue.addEventListener("input", () => fromHsv([Number(hue.value), ed.hsv[1], ed.hsv[2]], hue));
  hexIn.addEventListener("input", () => {
    const hex = parseHex(hexIn.value);
    hexIn.classList.toggle("bad", !hex); // неверное значение не сохраняется
    if (hex) set(hex, hsvOf(hex, ed.hsv[0]), hexIn);
  });
  hexIn.addEventListener("change", () => show()); // после ввода — привести к #rrggbb
  rgbIn.forEach(input => input.addEventListener("input", () => {
    const hex = toHex(rgbIn.map(i => Math.min(255, Math.max(0, Math.round(Number(i.value) || 0)))));
    set(hex, hsvOf(hex, ed.hsv[0]), input);
  }));
  reset.addEventListener("click", () => palette.resetColor(token));
  ed.sync();
  return ed;
}

// строки цветов строятся один раз; при смене цветов только обновляются — редактор под строкой не пересоздаётся
// (иначе посреди перетаскивания по квадрату терялся бы захват мыши)
const colorRows = [];
for (const [group, labels] of palette.GROUPS) {
  colorRows.push(el("div", { className: "group", textContent: group }));
  for (const [token, label] of Object.entries(labels)) {
    const undo = el("button", { className: "small", textContent: "↺", title: t("Вернуть цвет палитры") });
    undo.addEventListener("click", event => { event.stopPropagation(); palette.resetColor(token); });
    const row = el("div", { className: "color", tabIndex: 0, title: t("Изменить цвет") },
      el("span", { className: "chip" }), el("span", { className: "label", textContent: label }), el("span", { className: "hex" }), undo);
    row.dataset.token = token;
    row.setAttribute("role", "button");
    row.setAttribute("aria-expanded", false);
    row.addEventListener("click", () => openEditor(token));
    row.addEventListener("keydown", event => {
      if (event.target == row && (event.key == "Enter" || event.key == " ")) { event.preventDefault(); openEditor(token); }
    });
    colorRows.push(row);
  }
}
$("#colors").append(...colorRows);
function renderColors() {
  const c = palette.colors(), changed = palette.edited();
  for (const row of document.querySelectorAll(".color")) {
    const t = row.dataset.token;
    row.querySelector(".chip").style.background = c[t];
    row.querySelector(".hex").textContent = c[t];
    row.querySelector(".small").hidden = !changed.includes(t);
  }
  $("#palette-reset").disabled = !changed.length;
}
$("#palette-reset").addEventListener("click", () => palette.resetPalette());
const renderPalette = () => {
  // настройку поменяли не из редактора — показать новый цвет; во время своей правки (ждёт кадра) — не мешать
  if (editor && !editor.frame && palette.colors()[editor.token] != editor.hex) editor.sync();
  renderPresets();
  renderColors();
};
let paletteQueued = false; // «Сбросить палитру» меняет много настроек — перерисовка одна
const onPalette = () => {
  if (paletteQueued) return;
  paletteQueued = true;
  Promise.resolve().then(() => { paletteQueued = false; renderPalette(); });
};
Services.prefs.addObserver("luminoctis.palette", onPalette);
Services.prefs.addObserver(palette.THEMES, onPalette);
window.addEventListener("unload", () => {
  Services.prefs.removeObserver("luminoctis.palette", onPalette);
  Services.prefs.removeObserver(palette.THEMES, onPalette);
});
renderPalette();

// ---------- Luminoctis Home: папка данных (home/store.js; пусто — Documents\Luminoctis Home) ----------
{
  const store = await import("../home/store.js");
  const box = $("#home-dir");
  box.placeholder = store.defaultDir();
  const read = () => (box.value = Services.prefs.getStringPref(store.PREF, ""));
  box.addEventListener("change", () => {
    const v = box.value.trim();
    v ? Services.prefs.setStringPref(store.PREF, v) : Services.prefs.clearUserPref(store.PREF);
  });
  watchPref(store.PREF, read);
}

// ---------- Luminoctis Home: часы и обои (home/clock.js, home/wallpaper.js; docs/areas/home.md) ----------
{
  const { Clock } = await import("../home/clock.js");
  const clockPrev = [...document.querySelectorAll(".clock-styles [data-value]")].map(b => ({ root: b.querySelector(".clock-prev"), style: b.dataset.value, clock: null })); // живые превью
  // скрытая панель не тикает 10 превью: часы убираются из общего списка, при показе создаются заново
  const setPreviews = on => { for (const p of clockPrev) { if (on && !p.clock) p.clock = new Clock(p.root, p.style); else if (!on && p.clock) (p.clock.remove(), p.clock = null); } };
  window.lumiSettingsClocks = () => clockPrev.filter(p => p.clock).length; // для проверок
  onPanelShown = setPreviews;
  setPreviews(!(window.frameElement?.parentNode?.hidden));
  for (const p of document.querySelectorAll(".sc-prev")) p.append(...[t("Почта"), t("Видео"), t("Карты"), t("Игры")].map(name => el("span", { className: "sc-pv" }, el("i"), el("b", { textContent: name })))); // превью стилей ярлыков (settings.css)
  // подписи форматов даты — пример на языке интерфейса (те же параметры, что у home/clock.js)
  for (const [v, o] of Object.entries({ long: { weekday: "long", day: "numeric", month: "long" }, medium: { weekday: "short", day: "numeric", month: "short" }, short: { day: "2-digit", month: "2-digit", year: "numeric" } })) {
    const text = new Date(2026, 9, 31).toLocaleDateString(locale, o); // 31 октября 2026 — суббота
    $(`[data-pref="luminoctis.home.clock.datefmt"] [data-value="${v}"]`).textContent = v == "long" ? text.replace(/^./u, c => c.toLocaleUpperCase(locale)) : text;
  }

  // числа: ползунки (рядом <output>) и списки
  for (const input of document.querySelectorAll("[data-int-pref]")) {
    const pref = input.dataset.intPref, out = input.nextElementSibling?.matches("output") ? input.nextElementSibling : null;
    input.addEventListener("input", () => Services.prefs.setIntPref(pref, Number(input.value)));
    watchPref(pref, () => { input.value = String(Services.prefs.getIntPref(pref, Number(input.dataset.default))); if (out) out.value = input.value; });
  }
  // ползунок прозрачности выехавших панелей действует только в прозрачном режиме окна
  watchPref("luminoctis.look.window", () => {
    const on = palette.windowMode() != "opaque";
    $("#compact-transparency").classList.toggle("off", !on);
    $("#compact-transparency input").disabled = !on;
  });
  // строки: поиск, папка (пусто — сброс)
  for (const input of document.querySelectorAll("[data-str-pref]")) {
    const pref = input.dataset.strPref;
    input.addEventListener("change", () => {
      const v = input.value.trim();
      v ? Services.prefs.setStringPref(pref, v) : Services.prefs.clearUserPref(pref);
    });
    watchPref(pref, () => (input.value = Services.prefs.getStringPref(pref, "")));
  }
  $("#wp-pick").addEventListener("click", () => {
    const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window.browsingContext, t("Папка с обоями"), Ci.nsIFilePicker.modeGetFolder);
    fp.open(r => {
      if (r != Ci.nsIFilePicker.returnOK) return;
      Services.prefs.setStringPref("luminoctis.home.wallpaper.folder", fp.file.path);
      Services.prefs.setBoolPref("luminoctis.home.wallpaper.src.local", true); // выбрали папку — значит, её и показывать
    });
  });
  const WP = "luminoctis.home.wallpaper.";
  // источники и отметки, которым нужен ключ: пока ключа нет — выключены, рядом подсказка «нужен ключ»
  for (const box of document.querySelectorAll("[data-need-key]")) {
    const kp = WP + "key." + box.dataset.needKey, hint = box.closest("label").querySelector(".need-key");
    watchPref(kp, () => { const has = !!Services.prefs.getStringPref(kp, "").trim(); box.disabled = !has; hint.hidden = has; });
  }
  // своя папка: состояние, превью файлов, «Открыть в проводнике»
  const { IMG, VID, localDir, HOMES } = await import("../home/wallpaper-sources.js");
  // ↗ у источника: его сайт — в новой вкладке (клик не переключает флажок)
  const ARROW = '<svg viewBox="0 0 12 12"><path d="M4.5 2H2v8h8V7.5M7 2h3v3M10 2 5.5 6.5"/></svg>';
  for (const box of document.querySelectorAll('input[data-pref*="wallpaper.src."]')) {
    const url = HOMES[box.dataset.pref.split(".src.")[1]];
    if (!url) continue;
    const a = el("a", { className: "src-link", href: url, title: t("Открыть сайт"), role: "button", tabIndex: 0 });
    a.dataset.src = box.dataset.pref.split(".src.")[1];
    a.innerHTML = ARROW;
    a.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); win.openTrustedLinkIn(url, "tab"); });
    box.closest("label").append(a);
  }
  // NSFW: включение — только после подтверждения; отказ оставляет переключатель выключенным
  const nsfw = $("#wp-nsfw"), NS = WP + "nsfw", nsfwBox = $("#nsfw-confirm");
  const nsfwHint = () => {
    const on = Services.prefs.getBoolPref(NS, false), hasKey = !!Services.prefs.getStringPref(WP + "key.wallhaven", "").trim();
    nsfw.checked = on;
    $("#nsfw-hint").textContent = on && !hasKey ? t("Wallhaven покажет 18+ только с ключом доступа (в «Ещё»). Yande.re и Konachan — без ключа") : t("Не показывается в приватном окне и в режиме окна «Обои»");
  };
  nsfw.addEventListener("change", () => {
    if (!nsfw.checked) return Services.prefs.clearUserPref(NS);
    nsfw.checked = false; // пока не подтвердили — выключен
    const yes = el("button", { id: "nsfw-yes", className: "danger", textContent: t("Включить") }), no = el("button", { id: "nsfw-no", textContent: t("Отмена") });
    yes.addEventListener("click", () => { nsfwBox.replaceChildren(); Services.prefs.setBoolPref(NS, true); });
    no.addEventListener("click", () => nsfwBox.replaceChildren());
    nsfwBox.replaceChildren(el("div", { className: "confirm" }, el("span", { textContent: t("Обои 18+. Включить?") }), yes, no));
  });
  watchPref(NS, nsfwHint);
  watchPref(WP + "key.wallhaven", nsfwHint);
  const grid = $("#wp-previews"), info = $("#wp-folder-state");
  let seen = "";
  const previews = async () => {
    const dir = localDir();
    let files = null;
    try { files = (await IOUtils.getChildren(dir)).filter(f => IMG.test(f) || VID.test(f)).sort(); } catch {}
    const sig = dir + "|" + files?.join("|");
    if (sig == seen) return;
    seen = sig;
    grid.replaceChildren();
    info.textContent = files ? t("{0} — файлов: {1}", dir, files.length) : t("Папки нет: {0}. «Открыть в проводнике» создаст её", dir);
    for (const f of files?.slice(0, 30) ?? []) {
      const name = PathUtils.filename(f);
      grid.append(VID.test(f) ? el("span", { className: "wp-video", title: name, textContent: "▶ " + name })
        : el("img", { src: PathUtils.toFileURI(f), title: name, loading: "lazy", decoding: "async", alt: "" }));
    }
    if (files?.length > 30) grid.append(el("span", { className: "wp-video", textContent: t("+ ещё {0}", files.length - 30) }));
  };
  watchPref(WP + "folder", previews);
  window.addEventListener("focus", previews); // вернулись из проводника — список обновился
  $("#wp-open").addEventListener("click", async () => {
    const dir = localDir();
    await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(dir);
    f.launch();
    previews();
  });
  // цвет фона без обоев: пусто — акцент палитры
  const color = $("#wp-color");
  watchPref(WP + "color", () => (color.value = Services.prefs.getStringPref(WP + "color", "") || palette.colors().accent));
  color.addEventListener("input", () => Services.prefs.setStringPref(WP + "color", color.value));
  $("#wp-color-reset").addEventListener("click", () => Services.prefs.clearUserPref(WP + "color"));
}

// ---------- Luminoctis Home: свой цвет часов и папка закладок для ярлыков (home/clock.js, home/shortcuts.js) ----------
{
  const CC = "luminoctis.home.clock.", input = $("#clock-color");
  watchPref(CC + "custom", () => (input.value = Services.prefs.getStringPref(CC + "custom", "#ffffff")));
  input.addEventListener("input", () => { // выбрали цвет — значит, «Свой»
    Services.prefs.setStringPref(CC + "custom", input.value);
    Services.prefs.setStringPref(CC + "color", "custom");
  });

  const SC = "luminoctis.home.shortcuts.folder", sel = $("#shortcuts-folder");
  const B = PlacesUtils.bookmarks, ROOT = { [B.toolbarGuid]: t("Панель закладок"), [B.menuGuid]: t("Меню закладок"), [B.unfiledGuid]: t("Другие закладки") }; // у корневых папок название внутреннее
  const folders = (node, depth, out) => { // все папки закладок деревом (кроме мобильных)
    for (const c of node.children ?? []) {
      if (c.type != PlacesUtils.TYPE_X_MOZ_PLACE_CONTAINER || c.guid == PlacesUtils.bookmarks.mobileGuid) continue;
      out.push({ guid: c.guid, title: "\u00a0\u00a0".repeat(depth) + (ROOT[c.guid] || c.title || c.guid) });
      folders(c, depth + 1, out);
    }
    return out;
  };
  const fill = async () => {
    const list = folders(await PlacesUtils.promiseBookmarksTree(PlacesUtils.bookmarks.rootGuid), 0, []);
    sel.replaceChildren(...list.map(f => el("option", { value: f.guid, textContent: f.title })));
    sel.value = Services.prefs.getStringPref(SC, "") || PlacesUtils.bookmarks.toolbarGuid;
  };
  sel.addEventListener("change", () => Services.prefs.setStringPref(SC, sel.value));
  watchPref(SC, () => { if (sel.options.length) sel.value = Services.prefs.getStringPref(SC, "") || PlacesUtils.bookmarks.toolbarGuid; });
  window.addEventListener("focus", fill); // вернулись в окно — папки могли добавить
  await fill();
}

// ---------- обновления мода (js/lumi-update.sys.mjs) ----------
const upd = ChromeUtils.importESModule(JS("lumi-update.sys.mjs"));
const UPD = "luminoctis.update.";
const updStatus = text => ($("#update-status").textContent = text);
watchPref(UPD + "available", () => {
  const v = Services.prefs.getStringPref(UPD + "available", "");
  $("#update-avail").hidden = !v;
  $("#update-new").textContent = v && "v" + v;
});
$("#update-page").addEventListener("click", event => {
  event.preventDefault();
  const url = Services.prefs.getStringPref(UPD + "page", "");
  if (/^https?:/.test(url)) win.openTrustedLinkIn(url, "tab");
});
$("#update-check").addEventListener("click", async () => {
  updStatus(t("Проверяю…"));
  const r = await upd.check();
  updStatus(r.error ? t("Не удалось проверить: {0}", r.error) : r.available ? "" : t("Установлена последняя версия"));
});
$("#update-apply").addEventListener("click", async event => {
  event.target.disabled = true;
  updStatus(t("Скачиваю и проверяю…"));
  try { await upd.apply(); updStatus(t("Перезапускаю Zen…")); }
  catch (e) { updStatus(t("Ошибка: {0}", e.message)); event.target.disabled = false; }
});
for (const a of document.querySelectorAll("#about a.row.link")) a.addEventListener("click", event => { // ссылка — вкладкой браузера, а не внутри панели
  event.preventDefault();
  win.openTrustedLinkIn(event.currentTarget.href, "tab");
});
upd.installedVersion().then(v => {
  $("#about-version").textContent = v ? "v" + v : t("не определена");
  // самообновление — только у мода, поставленного установщиком (под Sine обновляет сам Sine)
  $("#update-none").hidden = !!v;
  if (!v) for (const el of [$("#update-title"), $("#update-row"), $("#update-auto").closest("label")]) el.style.display = "none";
});

// ---------- сохранить настройки в файл / загрузить из файла (вкладка «О моде») ----------
// Формат: { luminoctis: версия, date, prefs: { имя: bool | число | строка } }. Служебное (миграции, пути, ключи доступа, состояние обновлений) не входит.
{
  const pr = Services.prefs, ZEN = ["zen.view.compact.hide-toolbar"]; // Zen-настройки, которые меняются в «Автоскрытии»
  const SKIP = /\.(migrated|seeded)$|-cut$|\.key\.|^luminoctis\.(toolbar\.layout|settings\.tab|home\.dir|home\.wallpaper\.folder|notes\.trash-dir)$|^luminoctis\.(dev|update)\./;
  const allowed = name => ZEN.includes(name) || name == "luminoctis.update.auto-check" || (name.startsWith("luminoctis.") && !SKIP.test(name));
  const read = name => {
    switch (pr.getPrefType(name)) {
      case pr.PREF_BOOL: return pr.getBoolPref(name);
      case pr.PREF_INT: return pr.getIntPref(name);
      case pr.PREF_STRING: return pr.getStringPref(name);
    }
  };
  const mine = () => [...new Set([...pr.getChildList("luminoctis."), ...ZEN, "luminoctis.update.auto-check"])].filter(n => allowed(n) && (ZEN.includes(n) ? pr.getPrefType(n) != pr.PREF_INVALID : pr.prefHasUserValue(n))); // Zen-настройки — всегда: значение «как по умолчанию» тоже выбор
  const status = text => ($("#backup-status").textContent = text);
  const confirmBox = $("#backup-confirm");
  const backup = window.lumiBackup = {
    allowed,
    async build() {
      const prefs = {};
      for (const n of mine().sort()) prefs[n] = read(n);
      return { luminoctis: (await upd.installedVersion()) || "", date: new Date().toISOString(), prefs };
    },
    async saveTo(path) {
      await IOUtils.writeUTF8(path, JSON.stringify(await backup.build(), null, 2));
      status(t("Сохранено: {0}", path));
    },
    // проверка формата и типов; ошибка — понятная строка
    parse(text) {
      let data;
      try { data = JSON.parse(text); } catch { return { error: t("Это не файл настроек Luminoctis: не читается как JSON") }; }
      if (!data || typeof data != "object" || !("luminoctis" in data) || !data.prefs || typeof data.prefs != "object" || Array.isArray(data.prefs))
        return { error: t("Это не файл настроек Luminoctis: нет раздела prefs") };
      const prefs = {};
      for (const [name, v] of Object.entries(data.prefs)) {
        if (!allowed(name)) return { error: t("В файле неизвестная настройка: {0}", name) };
        const kind = pr.getPrefType(name), type = typeof v;
        const ok = kind == pr.PREF_BOOL ? type == "boolean" : kind == pr.PREF_INT ? Number.isInteger(v) : kind == pr.PREF_STRING ? type == "string"
          : type == "boolean" || Number.isInteger(v) || (type == "string" && v.length < 100000);
        if (!ok) return { error: t("Неверный тип значения у настройки {0}", name) };
        prefs[name] = v;
      }
      return { prefs };
    },
    async loadFrom(path) {
      confirmBox.replaceChildren();
      let text;
      try { text = await IOUtils.readUTF8(path); } catch { return status(t("Не удалось прочитать файл")); }
      const r = backup.parse(text);
      if (r.error) return status(r.error);
      status("");
      const yes = el("button", { id: "backup-yes", className: "danger", textContent: t("Заменить") }), no = el("button", { id: "backup-no", textContent: t("Отмена") });
      yes.addEventListener("click", () => { confirmBox.replaceChildren(); backup.apply(r.prefs); });
      no.addEventListener("click", () => confirmBox.replaceChildren());
      confirmBox.replaceChildren(el("div", { className: "confirm" }, el("span", { textContent: t("Заменить текущие настройки? В файле: {0}", Object.keys(r.prefs).length) }), yes, no));
    },
    apply(prefs) { // чего в файле нет — возвращается к значению по умолчанию; страница сама подхватывает новые значения (наблюдатели настроек)
      for (const n of mine()) if (!(n in prefs)) pr.clearUserPref(n);
      for (const [n, v] of Object.entries(prefs)) typeof v == "boolean" ? pr.setBoolPref(n, v) : typeof v == "number" ? pr.setIntPref(n, v) : pr.setStringPref(n, v);
      status(t("Загружено настроек: {0}", Object.keys(prefs).length));
    },
  };
  const pick = (save, done) => {
    const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window.browsingContext, save ? t("Сохранить настройки Luminoctis") : t("Загрузить настройки Luminoctis"), save ? Ci.nsIFilePicker.modeSave : Ci.nsIFilePicker.modeOpen);
    fp.appendFilter(t("Настройки Luminoctis (*.json)"), "*.json");
    fp.defaultString = "luminoctis-settings.json"; fp.defaultExtension = "json";
    fp.open(r => { if (r == Ci.nsIFilePicker.returnOK || r == Ci.nsIFilePicker.returnReplace) done(fp.file.path); });
  };
  $("#open-debug").addEventListener("click", () => win.lumiDebug?.open());
  $("#backup-save").addEventListener("click", () => pick(true, p => backup.saveTo(p).catch(e => status(t("Ошибка: {0}", e.message)))));
  $("#backup-load").addEventListener("click", () => pick(false, p => backup.loadFrom(p)));
}

// ---------- «Строгий режим»: списки сайтов по расписанию (js/lumi-strict.sys.mjs), сохраняются сразу ----------
{
  const strict = ChromeUtils.importESModule(JS("lumi-strict.sys.mjs"));
  const DAYS = [...Array(7).keys()].map(i => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: "short" }).replace(/^./u, c => c.toLocaleUpperCase(locale))); // 1 января 2024 — понедельник
  const FOCUS = { off: t("Нет"), focus: t("Фокус"), "focus+breaks": t("Фокус и перерывы") };
  const box = $("#strict-lists");
  const render = () => {
    box.replaceChildren(...strict.lists().map(l => {
      const card = el("div", { className: "row stack strict-list" + (l.on ? "" : " off") });
      card.dataset.id = l.id;
      // собрать список из полей карточки и сохранить (id, порядок — как в карточках)
      const commit = () => {
        const sites = card.querySelector("textarea").value.split(/[\s,]+/);
        const mine = {
          id: l.id, name: card.querySelector(".name").value.trim(), sites,
          days: [...card.querySelectorAll(".days button")].flatMap((b, i) => (b.getAttribute("aria-pressed") == "true" ? [i] : [])),
          from: card.querySelector(".from").value || l.from, to: card.querySelector(".to").value || l.to,
          focus: card.querySelector("select").value, on: card.querySelector(".on").checked,
        };
        strict.save(strict.lists().map(x => (x.id == l.id ? mine : x)));
        const saved = strict.lists().find(x => x.id == l.id);
        card.querySelector("textarea").value = saved.sites.join("\n");
        card.classList.toggle("off", !saved.on);
      };
      const name = el("input", { type: "text", className: "name", value: l.name, placeholder: t("Название списка"), spellcheck: false });
      const on = el("input", { type: "checkbox", className: "on", checked: l.on, title: t("Список включён") });
      const del = el("button", { className: "remove", textContent: "✕", title: t("Удалить список") });
      del.addEventListener("click", () => { strict.save(strict.lists().filter(x => x.id != l.id)); render(); });
      const sites = el("textarea", { value: l.sites.join("\n"), placeholder: "youtube.com\nreddit.com", spellcheck: false, rows: 4, title: t("Сайты по одному в строке; поддомены закрываются тоже") });
      const days = el("div", { className: "days" }, ...DAYS.map((d, i) => {
        const b = el("button", { textContent: d, type: "button" });
        b.setAttribute("aria-pressed", l.days.includes(i));
        b.addEventListener("click", () => { b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") != "true"); commit(); });
        return b;
      }));
      const [pre, mid, post] = t("с {0} до {1}", "|", "|").split("|"); // порядок слов зависит от языка
      const when = el("div", { className: "when" }, pre.trim(), el("input", { type: "time", className: "from", value: l.from }), mid.trim(), el("input", { type: "time", className: "to", value: l.to }), post.trim(),
        el("span", { textContent: t("через полночь — можно (22:00–07:00)") }));
      const focus = el("select", {}, ...Object.entries(FOCUS).map(([v, t]) => el("option", { value: v, textContent: t, selected: v == l.focus })));
      const focusRow = el("div", { className: "when" }, t(t("Ещё и во время фокуса LumiTime:")), focus);
      card.append(el("div", { className: "head" }, on, name, del), sites, days, when, focusRow);
      for (const c of [name, on, sites, focus, ...card.querySelectorAll("input[type=time]")]) c.addEventListener("change", commit);
      return card;
    }));
  };
  $("#strict-add").addEventListener("click", () => { strict.save([...strict.lists(), strict.newList(strict.lists().length + 1)]); render(); });
  render();
}

// ---------- «Звуки»: ▶ прослушать (строки .snd в «Звуки» и «Звук глитча» в «Вид») ----------
for (const row of document.querySelectorAll(".snd")) {
  row.querySelector(".snd-play").addEventListener("click", () => win.lumiSounds?.play(row.dataset.sound, { force: true, ignoreFocus: true }));
}

// ---------- «Сбросить раздел»: в конце каждого раздела, кроме «О моде»; объединённые разделы сбрасываются целиком ----------
// Возвращает флажки, ползунки и выборы раздела (data-pref, data-int-pref, select[data-str-pref], [data-reset], шорткаты).
// Не трогает пространства, закрепы, список и цвета тем, списки блокировки сайтов, текстовые поля (поиск, папки, ключи). Строки с data-no-reset (общий выключатель строгого режима) тоже остаются как есть.
// Значение по умолчанию — сброс пользовательской настройки; data-reset-to (bool) — если мод сам поставил другое (zen.view.compact.hide-toolbar).
function resetTab(section) {
  const todo = new Map(); // настройка → значение или null (сброс)
  for (const e of section.querySelectorAll("[data-pref], [data-int-pref], select[data-str-pref], [data-reset], [data-key]")) {
    if (e.closest("[data-no-reset]")) continue;
    const pref = e.dataset.pref ?? e.dataset.intPref ?? (e.matches("select") ? e.dataset.strPref : null);
    if (pref) todo.set(pref, e.dataset.resetTo ?? null);
    if (e.dataset.key) todo.set(keys.pref(e.dataset.key), null);
    for (const p of (e.dataset.reset ?? "").split(" ").filter(Boolean)) todo.set(p, null);
  }
  for (const [pref, to] of todo) to == null ? Services.prefs.clearUserPref(pref) : Services.prefs.setBoolPref(pref, to == "true");
}
for (const section of document.querySelectorAll("main > section:not(#about)")) {
  const button = el("button", { className: "reset-tab", textContent: t("Сбросить раздел"), title: t("Вернуть настройки этого раздела к значениям по умолчанию") });
  const box = el("div", { className: "reset-wrap" }, button);
  button.addEventListener("click", () => {
    const name = tabButtons.find(b => b.dataset.tab == section.id).querySelector("span").textContent;
    const yes = el("button", { className: "danger", textContent: t("Сбросить") }), no = el("button", { textContent: t("Отмена") });
    yes.addEventListener("click", () => { resetTab(section); box.replaceChildren(button); });
    no.addEventListener("click", () => { box.replaceChildren(button); button.focus(); });
    box.replaceChildren(el("div", { className: "confirm" },
      el("span", { textContent: t("Вернуть настройки раздела «{0}» по умолчанию? Пространства, закрепы, темы, списки блокировки, ключи и пути не изменятся.", name) }), yes, no));
    no.focus();
  });
  section.append(box);
}
