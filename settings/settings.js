// Панель настроек Luminoctis (chrome://userchrome/content/luminoctis/settings.html, встроена в окно справа от рейки —
// js/lumi-rail.uc.js). Страница привилегированная: читает и пишет настройки Firefox напрямую,
// закрепы (родные Essentials Zen) — через win.luminoctis, пространства — через gZenWorkspaces окна.
const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
const win = window.browsingContext.topChromeWindow; // окно браузера с этой панелью
const { ContextualIdentityService } = win;
const $ = sel => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
// цвета контейнеров — как точки на рейке
const DOT = { blue: "#7aa2f7", turquoise: "#73daca", green: "#9ece6a", yellow: "#e0af68", orange: "#ff9e64",
  red: "#f7768e", pink: "#ff007c", purple: "#bb9af7", toolbar: "#c0caf5" };

// ---------- разделы: ряд вкладок сверху, открытый раздел — в адресе (settings.html#sidebar) ----------
const tabButtons = [...document.querySelectorAll(".tabs [data-tab]")];
const showTab = () => {
  const wanted = location.hash.slice(1);
  const name = tabButtons.some(b => b.dataset.tab == wanted) ? wanted : "sidebar";
  for (const b of tabButtons) b.setAttribute("aria-selected", b.dataset.tab == name);
  for (const s of document.querySelectorAll("main > section")) s.classList.toggle("shown", s.id == name);
  document.querySelector("main").scrollTop = 0;
  Services.prefs.setStringPref("luminoctis.settings.tab", name); // панель откроется на нём и после перезапуска
};
for (const b of tabButtons) b.addEventListener("click", () => location.replace("#" + b.dataset.tab)); // без записи в историю
window.addEventListener("hashchange", showTab);
showTab();

// «Готово» и Esc закрывают панель; клик мимо — нет, рейкой можно пользоваться и при открытых настройках
const close = () => win.luminoctis.closeSettings();
$("#done").addEventListener("click", close);
window.addEventListener("keydown", event => {
  if (event.key == "Escape" && !event.defaultPrevented) close();
});

// ---------- флажки, привязанные к настройкам (data-pref, data-inverted — флажок означает «не») ----------
for (const box of document.querySelectorAll("input[data-pref]")) {
  const pref = box.dataset.pref, inverted = "inverted" in box.dataset;
  const read = () => (box.checked = Services.prefs.getBoolPref(pref, false) != inverted);
  box.addEventListener("change", () => Services.prefs.setBoolPref(pref, box.checked != inverted));
  Services.prefs.addObserver(pref, read);
  window.addEventListener("unload", () => Services.prefs.removeObserver(pref, read));
  read();
}

// ---------- выгрузка по таймеру: минуты, 0 — никогда (таймер — js/lumi-rail.uc.js) ----------
const unload = $("#unload"), UNLOAD = "luminoctis.tabs.unload-minutes";
unload.value = String(Services.prefs.getIntPref(UNLOAD, 0));
unload.addEventListener("change", () => Services.prefs.setIntPref(UNLOAD, Number(unload.value)));

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
const grip = () => el("span", { className: "grip", draggable: true, textContent: "⠿", title: "Перетащите, чтобы поменять порядок" });

// ---------- рабочие пространства ----------
function renderSpaces() {
  const spaces = win.gZenWorkspaces.getWorkspaces();
  const identities = ContextualIdentityService.getPublicIdentities();
  $("#spaces").replaceChildren(...spaces.map(ws => {
    const icon = el("button", { className: "icon", title: "Сменить иконку" });
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
    const name = el("input", { className: "name", type: "text", value: ws.name, title: "Название" });
    name.addEventListener("change", () => {
      ws.name = name.value.trim() || ws.name;
      win.gZenWorkspaces.saveWorkspace(ws);
    });
    const color = identities.find(i => i.userContextId == ws.containerTabId)?.color;
    const dot = el("span", { className: "dot" });
    dot.style.background = DOT[color] ?? "transparent";
    const container = el("select", { title: "Контейнер: новые вкладки пространства открываются в нём" },
      el("option", { value: 0, textContent: "Без контейнера" }),
      ...identities.map(i => el("option", { value: i.userContextId, textContent: ContextualIdentityService.getUserContextLabel(i.userContextId) })));
    container.value = ws.containerTabId || 0;
    container.addEventListener("change", () => {
      ws.containerTabId = Number(container.value);
      win.gZenWorkspaces.saveWorkspace(ws);
    });
    return el("div", { className: "item" }, grip(), icon, name, dot, container);
  }));
}
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
    const remove = el("button", { className: "small remove", textContent: "×", title: "Открепить" });
    remove.addEventListener("click", () => lumi.unpin(tab)); // как «Открепить» в меню закрепа: вкладка закрывается
    return el("div", { className: "item" }, grip(),
      el("span", { className: "icon" }, el("img", { src: win.gBrowser.getIcon(tab) || `page-icon:${urlOf(tab)}` })),
      site(tab.label, urlOf(tab)), remove);
  }) : [el("div", { className: "empty", textContent: "Закрепов нет — добавьте сайт кнопкой ниже" })]));
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
  current.textContent = tab ? `+ Текущий сайт: ${tab.label}` : "+ Текущий сайт";
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
    const add = el("button", { textContent: "Добавить" });
    add.addEventListener("click", () => {
      lumi.addPin(b.url.href, b.title);
      findBookmarks(); // добавленная пропадает из результатов
    });
    return el("div", { className: "item" },
      el("span", { className: "icon" }, el("img", { src: `page-icon:${b.url.href}` })), site(b.title, b.url.href), add);
  }));
};
search.addEventListener("input", findBookmarks);
