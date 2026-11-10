// ==UserScript==
// @name           Luminoctis: полоса вкладок
// @description    Своя полоса вкладок сверху — зеркало gBrowser. Родной вертикальный список Zen остаётся рабочим, но спрятан (chrome.css, раздел 9).
// ==/UserScript==

// Новые вкладки (Ctrl+T, «+») должны вставать в конец. Zen при zen.view.show-newtab-button-top (по умолчанию true — «+» вверху
// родного списка) вставляет их в НАЧАЛО обычных вкладок (Tabbrowser::addTab при атрибуте zen-newtab у адресной строки),
// и в нашей полосе они оказывались слева. Настройка читается при каждом открытии вкладки — достаточно выставить её здесь.
Services.prefs.setBoolPref("zen.view.show-newtab-button-top", false);

UC_API.Windows.waitWindowLoading(window).then(() => {
  const strip = document.createElement("div");
  strip.id = "lumi-tabstrip";
  // родной горизонтальный прокручиваемый ряд Firefox: колесо, прокрутка к вкладке, кнопки при переполнении
  const row = document.createXULElement("arrowscrollbox");
  row.id = "lumi-tabs";
  row.setAttribute("orient", "horizontal");
  row.setAttribute("clicktoscroll", "true");
  const dropLine = document.createElement("div");
  dropLine.id = "lumi-tab-dropline";
  // «+» — та же родная команда, что у кнопки «Новая вкладка» Firefox (cmd_newNavigatorTab); дальше черта и кнопки окна.
  // Место «+» (в конце полосы или сразу за вкладками) — только CSS, настройка luminoctis.tabs.newtab-position (chrome.css, раздел 9)
  const newTab = document.createXULElement("toolbarbutton");
  newTab.id = "lumi-newtab-button";
  newTab.className = "toolbarbutton-1";
  newTab.setAttribute("command", "cmd_newNavigatorTab");
  newTab.setAttribute("tooltiptext", "Новая вкладка");
  const separator = document.createElement("div");
  separator.id = "lumi-strip-separator";
  strip.append(row, dropLine, newTab, separator);
  document.getElementById("zen-appcontent-wrapper").prepend(strip);

  // ---------- зеркало вкладок ----------
  const items = new WeakMap(); // tab -> элемент полосы
  const itemFor = tab => {
    let item = items.get(tab);
    if (!item) {
      item = document.createElement("div");
      item.className = "lumi-tab";
      item.draggable = true;
      item.tab = tab; // по .tab родное меню вкладки (TabContextMenu) узнаёт, для какой вкладки оно открыто
      item.icon = Object.assign(document.createElement("img"), { className: "lumi-tab-icon", alt: "" });
      item.glanceEl = Object.assign(document.createElement("img"), { className: "lumi-tab-glance", alt: "", title: "Показать Glance" }); // значок сайта из Glance
      item.labelEl = Object.assign(document.createElement("span"), { className: "lumi-tab-label" });
      item.append(
        item.icon,
        item.labelEl,
        item.glanceEl,
        Object.assign(document.createElement("span"), { className: "lumi-tab-audio" }),
        Object.assign(document.createElement("span"), { className: "lumi-tab-unload", title: "Выгрузить из памяти" }),
        Object.assign(document.createElement("span"), { className: "lumi-tab-close", title: "Закрыть вкладку" })
      );
      items.set(tab, item);
    }
    return item;
  };
  // Кнопки вкладки: «×» (закрыть) всегда, «−» (выгрузить; выбранную — после перехода на Home) слева от неё, только если вкладку можно выгрузить
  // (about:-страницы, кроме about:blank; нет процесса)
  const unloadable = tab => {
    if (tab.hasAttribute("pending")) return false;
    const b = tab.linkedBrowser, uri = b?.currentURI;
    return !!b?.isRemoteBrowser && !!uri && (!uri.schemeIs("about") || uri.spec == "about:blank");
  };
  // выбранную сперва уводим на Home (иначе Zen выберет соседа), потом выгружаем
  const unloadTab = tab => luminoctis.unload(tab); // с выбранной вкладки уводит на Home (js/lumi-rail.uc.js)
  const update = (item, tab, hoverCard) => {
    luminoctis.setIcon(item.icon, gBrowser.getIcon(tab)); // нет значка / грузится — точка
    // Glance (Alt+клик по ссылке): его вкладка живёт внутри родительской (tab.glanceTab) и в полосе не рисуется, а родитель получает маленький значок сайта
    const glance = tab.glanceTab;
    item.toggleAttribute("glance", !!glance);
    if (glance) luminoctis.setIcon(item.glanceEl, gBrowser.getIcon(glance));
    if (item.labelEl.textContent != tab.label) item.labelEl.textContent = tab.label;
    // родная подсказка-title дублировала бы карточку при наведении (js/lumi-hovercard.uc.js); без карточки — остаётся
    const title = hoverCard ? null : tab.label;
    if (item.getAttribute("title") != title) title == null ? item.removeAttribute("title") : item.setAttribute("title", title);
    item.toggleAttribute("selected", tab.selected || !!glance?.selected); // пока открыт Glance, выбрана его вкладка — подсвечиваем родителя
    item.toggleAttribute("multiselected", tab.multiselected || (tab.selected && gBrowser.multiSelectedTabsCount > 0)); // Ctrl/Shift+клик
    item.toggleAttribute("unloadable", unloadable(tab));
    item.toggleAttribute("square", tab.pinned); // закреплённые вкладки пространства — квадратики
    for (const attr of ["pending", "soundplaying", "muted", "busy"]) {
      item.toggleAttribute(attr, tab.hasAttribute(attr));
    }
  };

  // Essentials — это закрепы в рейке (js/lumi-rail.uc.js), в полосе их нет
  const dying = new WeakSet(); // вкладки, у которых уже прошёл TabClose: в списке ещё есть, в полосе — уже нет
  // Home (js/lumi-home.uc.js) открывается «L» на рейке, в полосе её нет; так же скрыта вкладка LumiTime целиком (lumi-time-full, js/lumi-rail.uc.js)
  // Папки Zen (zen-folder, gZenFolders) — не вкладки: вместо вложенных вкладок в полосе одна «фишка» с выпадающим списком (ниже).
  // Корневая папка вкладки — самая верхняя zen-folder среди её групп (split-view-группа и подпапки тоже группы).
  const folderOf = tab => {
    let root = null;
    for (let g = tab.group; g; g = g.group) if (g.tagName == "zen-folder") root = g;
    return root;
  };
  const stripTabs = () => gBrowser.visibleTabs.filter(tab => !tab.hasAttribute("zen-essential") && !tab.hasAttribute("lumi-home") && !tab.hasAttribute("lumi-time-full") && !tab.hasAttribute("zen-empty-tab") && !tab.hasAttribute("zen-glance-tab") && !dying.has(tab) && !folderOf(tab));
  // Вкладки полосы и папки пространства в порядке документа: фишка стоит там, где в списке Zen стоит папка
  const stripEntries = () => {
    const entries = stripTabs();
    const space = gZenWorkspaces.activeWorkspace;
    for (const folder of document.querySelectorAll("zen-folder")) {
      if (folder.getAttribute("zen-workspace-id") != space || folder.group) continue;
      const at = entries.findIndex(el => folder.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      entries.splice(at < 0 ? entries.length : at, 0, folder);
    }
    return entries;
  };
  // Обычные вкладки папки подряд, подпапки — заголовком с отступом; split-view-группа раскрывается в свои вкладки
  const folderRows = (folder, level = 0) => folder.allItems.flatMap(item =>
    item.isZenFolder ? [{ folder: item, level }, ...folderRows(item, level + 1)]
      : item.hasAttribute("split-view-group") ? item.tabs.filter(tab => !dying.has(tab)).map(tab => ({ tab, level }))
      : item.hasAttribute("zen-empty-tab") || dying.has(item) ? [] : [{ tab: item, level }]);
  const FOLDER_ICON = "chrome://browser/skin/zen-icons/folder.svg";
  const chips = new WeakMap(); // zen-folder -> фишка полосы
  const chipFor = folder => {
    let chip = chips.get(folder);
    if (!chip) {
      chip = document.createElement("div");
      chip.className = "lumi-tab lumi-folder";
      chip.draggable = true; // папку можно переставлять по полосе, как вкладку
      chip.folder = folder;
      chip.icon = Object.assign(document.createElement("img"), { className: "lumi-tab-icon", alt: "", src: FOLDER_ICON });
      chip.labelEl = Object.assign(document.createElement("span"), { className: "lumi-tab-label" });
      chip.countEl = Object.assign(document.createElement("span"), { className: "lumi-folder-count" });
      chip.append(chip.icon, chip.labelEl, chip.countEl);
      chips.set(folder, chip);
    }
    return chip;
  };
  const updateChip = chip => {
    const { folder } = chip;
    chip.labelEl.textContent = folder.label;
    chip.countEl.textContent = folderRows(folder).filter(row => row.tab).length;
    chip.title = folder.label;
    const icon = folder.iconURL || FOLDER_ICON; // значок, выбранный в родном выборе значков Zen (хранится в самой папке)
    if (chip.icon.getAttribute("src") != icon) chip.icon.setAttribute("src", icon);
    chip.toggleAttribute("selected", folder.contains(gBrowser.selectedTab)); // выбранная вкладка папки в полосе не рисуется — «активна» фишка
  };
  const entryItem = entry => entry.isZenFolder ? chipFor(entry) : itemFor(entry);
  // Закрытие: вкладка улетает вверх и гаснет, потом освободившееся место схлопывается, соседи плавно занимают его.
  // Пока идёт анимация, элемент остаётся в ряду «призраком» (ghosts) на своём месте — render его не убирает.
  const ghosts = new Set();
  const calm = () => luminoctis.calm();
  const fly = (tab) => {
    dying.add(tab);
    const item = items.get(tab);
    if (!item?.isConnected || calm()) return;
    const { width } = item.getBoundingClientRect();
    item.lumiSlot = [...row.children].indexOf(item);
    item.toggleAttribute("closing", true); // не кликается, не перетаскивается
    ghosts.add(item);
    item.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(-48px)", opacity: 0 }],
      { duration: 170, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
    const shrink = { flexGrow: 0, flexShrink: 0, minWidth: 0, paddingInline: "0px" };
    const collapse = { delay: 140, duration: 220, easing: "cubic-bezier(0.3, 0, 0.2, 1)", fill: "both" };
    // «+» сразу за вкладками (ширина ряда = --lumi-tabs-w): ряд сужается вместе с призраком, а не сразу при закрытии —
    // иначе все вкладки на миг сжимались и снова расширялись, а «+» прыгал
    const basis = getComputedStyle(row).flexBasis;
    const rowAnim = Services.prefs.getStringPref("luminoctis.tabs.newtab-position", "end") == "after-tabs" && basis.endsWith("px")
      ? row.animate([{ flexBasis: basis }, { flexBasis: `${Math.max(0, parseFloat(basis) - (tab.pinned ? 28 : 210) - 6)}px` }], collapse)
      : null;
    item.animate([
      { ...shrink, flexBasis: `${width}px`, maxWidth: `${width}px`, marginLeft: "6px" },
      { ...shrink, flexBasis: "0px", maxWidth: "0px", marginLeft: "0px" },
    ], collapse).finished.then(() => {
      ghosts.delete(item);
      item.removeAttribute("closing");
      item.getAnimations().forEach(a => a.cancel());
      rowAnim?.cancel();
      schedule();
    }, () => (ghosts.delete(item), rowAnim?.cancel()));
  };
  // Появление: новая вкладка разворачивается из нуля и въезжает сверху. fresh — только что открытые (TabOpen); если их
  // сразу много (восстановление сессии, «открыть все») — не анимируем.
  const fresh = new Set();
  let burst = 0, burstTimer;
  window.addEventListener("TabOpen", event => {
    clearTimeout(burstTimer);
    burstTimer = setTimeout(() => (burst = 0), 300);
    if (++burst <= 3) fresh.add(event.target);
    else fresh.clear();
  });
  const grow = (item, rowFrom) => {
    const { width } = item.getBoundingClientRect();
    if (!width) return;
    const shrink = { flexGrow: 0, flexShrink: 0, minWidth: 0, paddingInline: "0px" };
    const margin = getComputedStyle(item).marginLeft;
    const timing = { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "both" };
    const rowTo = getComputedStyle(row).flexBasis;
    const rowAnim = rowFrom?.endsWith("px") && rowTo.endsWith("px") ? row.animate([{ flexBasis: rowFrom }, { flexBasis: rowTo }], timing) : null;
    const done = () => (item.getAnimations().forEach(a => a.cancel()), rowAnim?.cancel());
    item.animate([
      { ...shrink, flexBasis: "0px", maxWidth: "0px", marginLeft: "0px", opacity: 0, transform: "translateY(-24px)" },
      { ...shrink, flexBasis: `${width}px`, maxWidth: `${width}px`, marginLeft: margin, opacity: 1, transform: "none" },
    ], timing).finished.then(done, done);
  };
  // перетаскивание вкладок (ниже): расступившиеся остаются сдвинутыми после броска, пока render не пересоберёт ряд
  let dragged = null, dragSet = [], dragGhost = null, gapPending = false; // dragSet: тянущиеся вкладки в порядке полосы или [папка]
  const liveItems = () => [...row.children].filter(el => !el.hasAttribute("closing"));
  function releaseGap(instant) {
    gapPending = false;
    luminoctis.clearGap([...row.children], instant);
    row.querySelectorAll("[dragging]").forEach(el => el.removeAttribute("dragging"));
  }
  let dragOpened = false, panelGapPending = false; // список папки раскрыт наведением с вкладкой; строки списка ещё раздвинуты после броска
  let releasePanelGap = () => {};
  let queued = false, shownSelected = null;
  let refreshPanel = () => {}; // список папки (ниже) обновляется вместе с полосой
  const render = () => {
    queued = false;
    const entries = stripEntries(), tabs = entries.filter(el => !el.isZenFolder);
    const hoverCard = window.lumiHover?.enabled() ?? true;
    tabs.forEach(tab => update(itemFor(tab), tab, hoverCard));
    entries.filter(el => el.isZenFolder).forEach(folder => updateChip(chipFor(folder)));
    const wanted = entries.map(entryItem);
    for (const ghost of [...ghosts].sort((a, b) => a.lumiSlot - b.lumiSlot)) wanted.splice(Math.min(ghost.lumiSlot, wanted.length), 0, ghost);
    // «+» сразу за вкладками: ряд растёт вместе с новой вкладкой (прежняя ширина — до смены --lumi-tabs-w)
    const rowFrom = fresh.size && Services.prefs.getStringPref("luminoctis.tabs.newtab-position", "end") == "after-tabs" ? getComputedStyle(row).flexBasis : null;
    const now = [...row.children];
    if (wanted.length != now.length || wanted.some((el, i) => el !== now[i])) row.replaceChildren(...wanted);
    // полная ширина вкладок (без сжатия) — для «+» сразу за вкладками (chrome.css, раздел 9): 210px, квадратики 28px, зазоры 6px.
    // «+» — как ещё одна вкладка: сжимается вместе с ними; --lumi-tabs-shrink уравнивает долю сжатия ряда и «+»
    // (зазоры не сжимаются, без поправки «+» вышла бы на пару пикселей шире вкладки)
    // фишка папки — 150px (chrome.css), сжимается как обычная вкладка
    const baseOf = el => el.isZenFolder ? 150 : el.pinned ? 28 : 210;
    const full = Math.max(0, entries.reduce((w, el) => w + baseOf(el) + 6, -6));
    strip.style.setProperty("--lumi-tabs-w", `${full}px`);
    strip.style.setProperty("--lumi-tabs-shrink", full ? entries.filter(el => el.isZenFolder || !el.pinned).reduce((w, el) => w + baseOf(el), 0) / full : 1);
    if (gapPending) releaseGap(true);
    if (!calm()) for (const tab of tabs) if (fresh.has(tab) && !now.includes(items.get(tab))) grow(items.get(tab), rowFrom);
    fresh.clear();
    // к выбранной — только когда выбор сменился: иначе любая фоновая вкладка (загрузка, заголовок) сбивала прокрутку пользователя
    const sel = gZenGlanceManager.getTabOrGlanceParent(gBrowser.selectedTab); // открыт Glance — выбрана его вкладка, показываем родителя
    const selected = items.get(sel) ?? chips.get(folderOf(sel));
    if (selected?.isConnected && selected !== shownSelected) row.ensureElementIsVisible(selected);
    shownSelected = selected;
    refreshPanel();
  };
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(render);
    }
  };
  for (const type of ["TabOpen", "TabClose", "TabSelect", "TabMove", "TabAttrModified", "TabPinned",
    "TabUnpinned", "TabMultiSelect", "TabHide", "TabShow", "TabAddedToEssentials", "TabRemovedFromEssentials", "ZenWorkspacesUIUpdate",
    // папки Zen: вложение/выход вкладок, создание/удаление, имя, подпапки, смена пространства папки
    "TabGrouped", "TabUngrouped", "TabGroupCreate", "TabGroupRemoved", "TabGroupUpdate", "TabGroupCollapse", "TabGroupExpand",
    "FolderGrouped", "FolderUngrouped", "ZenFolderRenamed", "ZenFolderChangedWorkspace"]) {
    window.addEventListener(type, schedule);
  }
  // Смена пространства не шлёт ни TabShow/TabHide (Zen меняет активный список, а не скрывает вкладки), ни TabSelect,
  // если в обоих пространствах выбрана общая пустая вкладка Zen (так сразу после запуска). Родной хук смены — этот.
  gZenWorkspaces.addChangeListeners(schedule);
  Services.prefs.addObserver("luminoctis.tabs.hover-memory", schedule);
  window.addEventListener("unload", () => Services.prefs.removeObserver("luminoctis.tabs.hover-memory", schedule), { once: true });
  // закрытая вкладка ещё в gBrowser.visibleTabs во время своего TabClose — перерисовываем после её ухода
  window.addEventListener("TabClose", event => {
    fly(event.target);
    setTimeout(schedule, 0);
  });
  // Zen убирает удалённую папку из документа с анимацией, уже после TabGroupRemoved — перерисовываем ещё раз после неё
  window.addEventListener("TabGroupRemoved", () => setTimeout(schedule, 400));
  render();

  // ---------- действия: всё через родные API ----------
  const tabOf = event => event.target.closest?.(".lumi-tab")?.tab;
  luminoctis.unloadShortcut(row, tabOf); // «Выгрузить вкладку или закреп» (js/lumi-rail.uc.js) — до клика и меню ниже
  // ---------- папки: выпадающий список и родное меню Zen ----------
  // Список — panel с обычными html-строками (в menupopup нельзя ни кнопок в строке, ни перетаскивания): значок, имя, звук,
  // «выгрузить», «×» — те же родные действия, что у вкладки полосы.
  const chipOf = event => event.target.closest?.(".lumi-folder");
  const folderPanel = window.MozXULElement.parseXULToFragment(`<panel id="lumi-folder-panel" noautofocus="true" consumeoutsideclicks="never"/>`).firstElementChild;
  const fList = Object.assign(document.createElement("div"), { id: "lumi-folder-list" });
  folderPanel.append(fList);
  document.getElementById("mainPopupSet").append(folderPanel);
  const emptyRow = Object.assign(document.createElement("div"), { className: "lumi-fr lumi-fr-head", textContent: "Пусто" });
  const rowEls = new WeakMap(); // tab | folder -> строка списка
  const rowFor = ({ tab, folder }) => {
    const key = tab ?? folder;
    let el = rowEls.get(key);
    if (!el) {
      el = document.createElement("div");
      el.className = tab ? "lumi-fr" : "lumi-fr lumi-fr-head";
      if (tab) {
        el.tab = tab;
        el.draggable = true;
        el.icon = Object.assign(document.createElement("img"), { className: "lumi-fr-icon", alt: "" });
        el.labelEl = Object.assign(document.createElement("span"), { className: "lumi-fr-label" });
        el.glanceEl = Object.assign(document.createElement("img"), { className: "lumi-fr-glance", alt: "", title: "Показать Glance" });
        el.append(el.icon, el.labelEl, el.glanceEl,
          Object.assign(document.createElement("span"), { className: "lumi-fr-btn lumi-fr-audio" }),
          Object.assign(document.createElement("span"), { className: "lumi-fr-btn lumi-fr-unload", title: "Выгрузить" }),
          Object.assign(document.createElement("span"), { className: "lumi-fr-btn lumi-fr-close", title: "Закрыть" }));
      }
      rowEls.set(key, el);
    }
    return el;
  };
  const updateRow = (el, level, folder) => {
    el.style.setProperty("--lumi-level", level);
    if (!el.tab) return void (el.textContent = folder.label);
    const { tab } = el, glance = tab.glanceTab;
    luminoctis.setIcon(el.icon, gBrowser.getIcon(tab));
    el.toggleAttribute("glance", !!glance);
    if (glance) luminoctis.setIcon(el.glanceEl, gBrowser.getIcon(glance));
    el.labelEl.textContent = tab.label;
    el.toggleAttribute("selected", tab.selected || !!glance?.selected);
    for (const attr of ["pending", "soundplaying", "muted"]) el.toggleAttribute(attr, tab.hasAttribute(attr));
  };
  // Перестраивает только если набор строк изменился: пересборка во время перетаскивания строки оборвала бы его
  const fillPanel = () => {
    const rows = folderRows(folderPanel.chip.folder);
    const wanted = rows.some(r => r.tab) ? rows.map(rowFor) : [emptyRow];
    rows.forEach((r, i) => wanted[i] && wanted[i] !== emptyRow && updateRow(wanted[i], r.level, r.folder));
    const now = [...fList.children];
    if (wanted.length != now.length || wanted.some((el, i) => el !== now[i])) fList.replaceChildren(...wanted);
  };
  refreshPanel = () => {
    if (folderPanel.state == "closed" || folderPanel.state == "hiding") return;
    if (folderPanel.chip?.folder.isConnected) fillPanel();
    else folderPanel.hidePopup();
    if (panelGapPending) releasePanelGap(true); // бросок в список: порядок строк уже пересобран — сдвиги снимаем без прыжка
  };
  // Закрытие с анимацией: любое закрытие (клик мимо, по фишке, выбор строки) откладывается на время ухода, потом — настоящее
  const hideFolder = () => {
    // во время popuphiding state уже «hiding» (после preventDefault вернётся в «open») — пускаем и его
    if ((folderPanel.state != "open" && folderPanel.state != "hiding") || folderPanel.hasAttribute("closing")) return;
    if (calm()) return void (folderPanel.forceHide = true, folderPanel.hidePopup());
    folderPanel.setAttribute("closing", "");
    setTimeout(() => { folderPanel.forceHide = true; folderPanel.hidePopup(); }, 150);
  };
  folderPanel.addEventListener("popuphiding", event => {
    if (event.target !== folderPanel || folderPanel.forceHide || calm() || !folderPanel.chip?.folder.isConnected) return;
    event.preventDefault(); // не закрываем сразу — сначала уходящая анимация
    hideFolder();
  });
  folderPanel.addEventListener("popupshowing", () => {
    folderPanel.forceHide = false;
    folderPanel.removeAttribute("closing");
    fillPanel();
    folderPanel.chip.toggleAttribute("open", true);
  });
  folderPanel.addEventListener("popuphidden", event => event.target === folderPanel && (folderPanel.chip?.removeAttribute("open"), (dragOpened = false)));
  fList.addEventListener("click", event => {
    const tab = event.target.closest(".lumi-fr")?.tab, { classList } = event.target;
    if (!tab || event.button != 0) return;
    if (classList.contains("lumi-fr-glance")) { if (tab.glanceTab) gBrowser.selectedTab = tab.glanceTab; hideFolder(); }
    else if (classList.contains("lumi-fr-close")) gBrowser.removeTab(tab, { animate: true }); // список остаётся, строка уходит с обновлением
    else if (classList.contains("lumi-fr-unload")) unloadTab(tab);
    else if (classList.contains("lumi-fr-audio")) tab.toggleMuteAudio();
    else {
      gBrowser.selectedTab = tab;
      hideFolder();
    }
  });
  fList.addEventListener("auxclick", event => {
    const tab = event.target.closest(".lumi-fr")?.tab;
    if (tab && event.button == 1) gBrowser.removeTab(tab, { animate: true });
  });
  let lastHidden = { chip: null, time: 0 };
  folderPanel.addEventListener("popuphidden", event => event.target === folderPanel && (lastHidden = { chip: folderPanel.chip, time: performance.now() }));
  const openFolder = chip => {
    // второй клик по той же фишке закрывает список (клик мимо уже закрыл его — не открываем заново)
    if (folderPanel.chip === chip && folderPanel.state != "closed" && folderPanel.state != "hiding") return hideFolder();
    if (lastHidden.chip === chip && performance.now() - lastHidden.time < 300) return;
    showFolder(chip);
  };
  const showFolder = chip => {
    folderPanel.chip = chip;
    folderPanel.openPopup(chip, "after_start", 0, 0, false, false);
  };
  // ПКМ — родное меню Zen (zenFolderActions): оно узнаёт папку по метке спрятанного родного списка, поэтому открываем его
  // из события, брошенного на эту метку
  const openFolderActions = (chip, from) => {
    const label = chip.folder.labelElement.parentElement;
    label.addEventListener("contextmenu", event => document.getElementById("zenFolderActions").openPopupAtScreen(from.screenX, from.screenY, true, event), { once: true });
    label.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  };

  // ---------- папки: Zen работает со спрятанным родным списком — правим в корне, один раз ----------
  // zen-folder и gZenFolders Zen определяет позже запуска скриптов — ставим правки, когда они появятся
  const hookZenFolders = ZenFolder => {
    // 1. «Распаковать»: вкладки папки остаются закреплёнными (pinned) и стали бы квадратиками полосы — возвращаем их в обычные
    const unpackTabs = ZenFolder.prototype.unpackTabs;
    ZenFolder.prototype.unpackTabs = async function () {
      const tabs = this.allItemsRecursive.filter(item => item.tagName == "tab" && !item.hasAttribute("zen-empty-tab"));
      await unpackTabs.call(this);
      for (const tab of tabs) if (tab.isConnected && tab.pinned && !tab.group && !tab.hasAttribute("zen-essential")) gBrowser.unpinTab(tab);
    };
    // 2. Переименование: Zen правит имя во встроенном спрятанном списке (и вовсе отказывается, пока тот «свёрнут») — правим в фишке
    const renameChip = chip => {
      if (chip.editing) return;
      chip.editing = true;
      chip.draggable = false;
      const { folder } = chip;
      const input = Object.assign(document.createElement("input"), { className: "lumi-folder-edit", value: folder.label });
      chip.labelEl.hidden = true;
      chip.labelEl.after(input);
      const finish = save => {
        if (!chip.editing) return;
        chip.editing = false;
        chip.draggable = true;
        const name = input.value.trim() || "Folder";
        input.remove();
        chip.labelEl.hidden = false;
        if (save && name != folder.label) {
          folder.name = name; // сохраняется вместе с сессией
          folder.dispatchEvent(new CustomEvent("ZenFolderRenamed", { bubbles: true }));
        }
        schedule();
      };
      input.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.key == "Enter") finish(true);
        else if (event.key == "Escape") finish(false);
      });
      input.addEventListener("blur", () => finish(true));
      const focus = () => (input.focus(), input.select());
      const actions = document.getElementById("zenFolderActions"); // пока меню закрывается, оно забирает фокус обратно
      if (actions.state == "closed") focus();
      else actions.addEventListener("popuphidden", () => setTimeout(focus, 50), { once: true });
    };
    const rename = ZenFolder.prototype.rename;
    ZenFolder.prototype.rename = function () {
      const chip = chips.get(this);
      return chip?.isConnected ? renameChip(chip) : rename.call(this);
    };
    // 3. Значок: родной выбор значков привязан к значку спрятанного списка — привязываем к фишке (хранит его сама папка)
    const changeFolderUserIcon = gZenFolders.changeFolderUserIcon;
    gZenFolders.changeFolderUserIcon = function (group) {
      const chip = chips.get(group);
      if (!chip?.isConnected) return changeFolderUserIcon.call(this, group);
      gZenEmojiPicker.open(chip.icon, {
        onlySvgIcons: true,
        allowNone: Boolean(group.iconURL),
        closeOnSelect: false,
        onSelect: icon => {
          this.setFolderUserIcon(group, icon);
          group.dispatchEvent(new CustomEvent("TabGroupUpdate", { bubbles: true }));
        },
      });
    };
  };
  customElements.whenDefined("zen-folder").then(ZenFolder => {
    const install = () => window.gZenFolders ? hookZenFolders(ZenFolder) : setTimeout(install, 200);
    install();
  });

  const inEdit = event => event.target.closest?.(".lumi-folder-edit");
  row.addEventListener("click", event => {
    if (inEdit(event)) return;
    const chip = chipOf(event);
    if (chip) return event.button == 0 && openFolder(chip);
    const tab = tabOf(event);
    if (!tab || event.button != 0) return;
    if (event.target.classList.contains("lumi-tab-glance")) { if (tab.glanceTab) gBrowser.selectedTab = tab.glanceTab; } // снова показать Glance
    else if (event.target.classList.contains("lumi-tab-close")) gBrowser.removeTab(tab, { animate: true });
    else if (event.target.classList.contains("lumi-tab-unload")) { if (unloadable(tab)) unloadTab(tab); }
    else if (event.target.classList.contains("lumi-tab-audio")) tab.toggleMuteAudio();
    else if (event.ctrlKey || event.metaKey) toggleSelect(tab);
    else if (event.shiftKey) selectRange(tab);
    else {
      gBrowser.clearMultiSelectedTabs();
      gBrowser.selectedTab = tab;
    }
  });
  // Выделение нескольких вкладок — родное (gBrowser.selectedTabs): Ctrl+клик добавляет/убирает, Shift+клик — диапазон от выбранной
  const toggleSelect = tab => {
    if (tab.multiselected) gBrowser.removeFromMultiSelectedTabs(tab);
    else if (!tab.selected) (gBrowser.addToMultiSelectedTabs(tab), (gBrowser.lastMultiSelectedTab = tab));
  };
  const selectRange = tab => {
    const list = stripTabs(), anchor = list.indexOf(list.includes(gBrowser.selectedTab) ? gBrowser.selectedTab : gBrowser.lastMultiSelectedTab), to = list.indexOf(tab);
    gBrowser.clearMultiSelectedTabs();
    if (anchor < 0) return toggleSelect(tab);
    for (const t of list.slice(Math.min(anchor, to), Math.max(anchor, to) + 1)) if (!t.selected) gBrowser.addToMultiSelectedTabs(t);
  };
  row.addEventListener("auxclick", event => {
    const tab = tabOf(event);
    if (tab && event.button == 1) gBrowser.removeTab(tab, { animate: true });
  });
  row.addEventListener("contextmenu", event => {
    if (inEdit(event)) return;
    const chip = chipOf(event);
    if (chip) {
      event.preventDefault();
      return openFolderActions(chip, event);
    }
    if (!tabOf(event)) return;
    event.preventDefault();
    gBrowser.translateTabContextMenu(); // подписи меню Firefox подгружает по первому ПКМ над родным списком — он спрятан
    document.getElementById("tabContextMenu").openPopupAtScreen(event.screenX, event.screenY, true, event);
  });

  // ---------- перетаскивание внутри полосы ----------
  // Остальные вкладки расступаются (luminoctis.gap, js/lumi-rail.uc.js), показывая, куда встанет перетаскиваемая;
  // бросили — расступившиеся стоят, пока ряд не пересоберётся (render), потом встают на место без прыжка.
  // Тащить можно и строку списка папки (источник — folderPanel): бросок на полосу выводит вкладку из папки в обычные.
  // Бросок на фишку папки (середина, не крайние 12px) кладёт вкладку в папку родным folder.addTabs (закрепляет её, как Zen).
  const dropIndex = x => {
    // куда встанет: перед первой вкладкой, чья середина правее курсора (середины — без учёта сдвига расступившихся)
    const list = liveItems();
    let i = list.findIndex(el => {
      const r = el.getBoundingClientRect();
      return x < r.left - luminoctis.shiftOf(el, "x") + r.width / 2;
    });
    if (i < 0) i = list.length;
    // обычная вкладка (в т.ч. вышедшая из папки) не встаёт среди закрепов и фишек — они всегда левее обычных; папка и закреп — наоборот, не правее
    const first = list.findIndex(el => el.tab && !el.tab.pinned), end = first < 0 ? list.length : first;
    return dragged?.isZenFolder || (dragged?.pinned && !folderOf(dragged)) ? Math.min(i, end) : Math.max(i, end); // закреп с рейки (dragged нет) — как обычная вкладка
  };
  // фишка под курсором, если бросок на неё положит вкладку в папку (та же папка — нет)
  const folderTarget = event => {
    const chip = (dragged || luminoctis.dragPin) && !dragged?.isZenFolder && chipOf(event);
    if (!chip || (dragged && folderOf(dragged) === chip.folder)) return null;
    const r = chip.getBoundingClientRect(), edge = Math.min(12, r.width / 4);
    return event.clientX > r.left + edge && event.clientX < r.right - edge ? chip : null;
  };
  const clearTarget = () => row.querySelectorAll("[drop-into]").forEach(el => el.removeAttribute("drop-into"));
  // Выделенные вкладки тянутся вместе (одна из них — за курсором); не из выделения — выделение снимается. В полосе-источнике уже нет папок и Home
  const dragGroup = tab => {
    const sel = gBrowser.selectedTabs;
    if (gBrowser.multiSelectedTabsCount && !sel.includes(tab)) gBrowser.clearMultiSelectedTabs();
    const group = gBrowser.multiSelectedTabsCount ? stripTabs().filter(t => sel.includes(t) && t.pinned == tab.pinned) : [];
    return group.length > 1 && group.includes(tab) ? group : [tab];
  };
  const beginDrag = (event, primary, set, inPanel) => {
    dragged = primary;
    dragSet = set;
    setTimeout(() => dragged && dragSet.forEach(e => (inPanel ? rowEls.get(e) : entryItem(e))?.setAttribute("dragging", ""))); // гаснет, когда снимок для курсора уже сделан
    const dt = event.dataTransfer;
    dt.effectAllowed = "move";
    dt.setData("text/plain", primary.isZenFolder ? primary.label : primary.linkedBrowser.currentURI.spec);
    if (!primary.isZenFolder) dt.mozSetDataAt("application/x-moz-tabbrowser-tab", primary, 0); // родной тип вкладки: по нему рейка делает её закрепом
    if (set.length > 1) { // у курсора — вкладка с числом тянущихся
      dragGhost = Object.assign(document.createElement("div"), { id: "lumi-drag-ghost", textContent: primary.label });
      dragGhost.dataset.count = set.length;
      strip.append(dragGhost);
      dt.setDragImage(dragGhost, 16, 14);
    }
  };
  row.addEventListener("dragstart", event => {
    const chip = chipOf(event), tab = tabOf(event);
    if (chip && !chip.editing) beginDrag(event, chip.folder, [chip.folder], false);
    else if (tab) beginDrag(event, tab, dragGroup(tab), false);
  });
  fList.addEventListener("dragstart", event => {
    const tab = event.target.closest?.(".lumi-fr")?.tab;
    if (tab) beginDrag(event, tab, [tab], true); // не из полосы — остальные просто раздвигаются
  });
  // Остальные расступаются: сдвиг = место тянущихся, которое оказалось слева от элемента после броска, минус то, что было слева до.
  // movers — тянущиеся элементы ряда (пусто — тянут из списка папки, тогда место extra); возвращает центр дыры на месте броска
  const spread = (list, movers, i, extra) => {
    const size = el => el.getBoundingClientRect().width + 6;
    const total = extra + [...movers].reduce((w, el) => w + size(el), 0);
    const t = list.slice(0, i).filter(el => !movers.has(el)).length; // перед каким из остальных встанут
    const rest = list.filter(el => !movers.has(el));
    let before = 0, k = 0, hole = null;
    for (const el of list) {
      if (movers.has(el)) { before += size(el); el.style.translate = ""; continue; }
      const d = (k++ < t ? 0 : total) - before, r = el.getBoundingClientRect(), base = r.left - luminoctis.shiftOf(el, "x");
      el.style.translate = d ? `${d}px 0` : "";
      if (el === rest[t]) hole = base + d - total / 2 - 3;
      else if (!rest[t] && el === rest.at(-1)) hole = base + d + r.width + 6 + total / 2 - 3;
    }
    return hole ?? list.at(-1).getBoundingClientRect().right;
  };
  // Закреп с рейки (luminoctis.dragPin, js/lumi-rail.uc.js): бросок на полосу открывает НОВУЮ вкладку с начальным адресом закрепа
  // (закреп остаётся на месте); тянется он с тем же расступанием и чертой, что вкладка из списка папки. На сайт и Home закреп не бросается.
  row.addEventListener("dragover", event => {
    if (!dragged && !luminoctis.dragPin) return;
    event.preventDefault();
    clearTarget();
    const list = liveItems();
    const into = folderTarget(event);
    hoverFolder(chipOf(event));
    if (into) { // на фишку: подсветка, щель и черта не нужны
      into.toggleAttribute("drop-into", true);
      dropLine.hidden = true;
      luminoctis.clearGap(list, false);
      return;
    }
    const i = dropIndex(event.clientX);
    const ref = list[i] ?? list.at(-1);
    const r = ref.getBoundingClientRect();
    let x = list[i] ? r.left - 3 : r.right + 3;
    const movers = new Set(dragSet.map(entryItem).filter(el => list.includes(el)));
    if (!calm()) {
      const hole = spread(list, movers, i, movers.size ? 0 : 216); // 216 — место под вкладку из списка папки
      if (dragSet.length > 1) x = hole; // число у метки — по центру дыры
    }
    dropLine.style.left = `${x - strip.getBoundingClientRect().left}px`;
    dropLine.hidden = false;
    dropLine.toggleAttribute("quiet", !calm()); // с расступанием черта не нужна — остаётся при «уменьшить анимацию»
    dropLine.dataset.count = dragSet.length > 1 ? dragSet.length : ""; // у нескольких вкладок на метке число
  });
  row.addEventListener("dragleave", event => {
    if (row.contains(event.relatedTarget)) return;
    hoverFolder(null);
    clearTarget();
    dropLine.hidden = true;
    if (!gapPending) releaseGap(false); // ушли с полосы — щель плавно закрывается
  });
  let pinDropped = false;
  row.addEventListener("drop", event => {
    if (dragged || !luminoctis.dragPin) return;
    const url = luminoctis.pinStartURL(luminoctis.dragPin);
    dragged = gBrowser.addTrustedTab(url); // дальше — обычный бросок вкладки на это место
    gBrowser.selectedTab = dragged;
    dragSet = [dragged];
    pinDropped = true;
  });
  row.addEventListener("drop", event => {
    if (!dragged) return;
    event.preventDefault();
    const into = folderTarget(event);
    clearTarget();
    endHover();
    if (into) {
      const tabs = dragSet;
      dragged = null; // у вкладки, ушедшей в папку, из полосы пропадёт элемент — dragend до row не дойдёт
      dragSet = [];
      dragGhost?.remove();
      dropLine.hidden = true;
      releaseGap(true);
      into.folder.addTabs(tabs);
      folderPanel.hidePopup();
      return;
    }
    if (dragOpened) hideFolder(); // список раскрылся наведением, бросили на полосу — закрываем
    const visible = stripEntries();
    const i = dropIndex(event.clientX);
    if (dragSet.length > 1 || dragged.isZenFolder) { // папка или несколько вкладок: встают подряд перед первым из остальных правее места броска
      const rest = visible.filter(e => !dragSet.includes(e)), target = rest[visible.slice(0, i).filter(e => !dragSet.includes(e)).length];
      gapPending = row.querySelector("[style*=translate]") != null;
      if (gapPending) setTimeout(() => gapPending && releaseGap(false), 500);
      // папка живёт только среди закрепов: перед первой обычной вкладкой её ставят после последнего закрепа, а не перед обычной
      const pinnedEnd = dragged.isZenFolder && target && !target.isZenFolder && !target.pinned;
      if (target && !pinnedEnd) dragSet.forEach(e => gBrowser.moveTabBefore(e, target));
      else {
        let at = pinnedEnd ? rest[rest.indexOf(target) - 1] : rest.at(-1);
        for (const e of dragSet) if (at) (gBrowser.moveTabAfter(e, at), (at = e));
      }
      return;
    }
    const target = visible[i] ?? visible.at(-1);
    if (folderOf(dragged)) { // из папки — в обычные вкладки того же пространства (Zen оставил бы их закреплёнными)
      gBrowser.ungroupTab(dragged);
      if (dragged.pinned) gBrowser.unpinTab(dragged);
      folderPanel.hidePopup();
    }
    // индекс в полосе -> индекс в gBrowser.tabs; moveTabTo сам не даёт смешать закреплённые и обычные.
    // У папки края — её первая и последняя вкладки (с пустой вкладкой Zen)
    const edge = el => el.isZenFolder ? [...el.querySelectorAll("tab")].at(visible[i] ? 0 : -1) : el;
    let tabIndex = gBrowser.tabs.indexOf(edge(target)) + (visible[i] ? 0 : 1);
    if (gBrowser.tabs.indexOf(dragged) < tabIndex) tabIndex--; // moveTabTo ждёт итоговый индекс
    gapPending = row.querySelector("[style*=translate]") != null; // расступившиеся стоят, пока ряд не пересоберётся (render)
    if (gapPending) setTimeout(() => gapPending && releaseGap(false), 500); // порядок не изменился — пересборки не будет
    gBrowser.moveTabTo(dragged, { tabIndex });
  });
  row.addEventListener("drop", () => { // бросок закрепа: у новой вкладки нет dragend, сбрасываем сами
    if (!pinDropped) return;
    pinDropped = false;
    dragged = null;
    dragSet = [];
  });
  const dragEnd = event => {
    clearTarget();
    dropLine.hidden = true;
    const tab = dragged, set = dragSet;
    dragged = null;
    dragSet = [];
    dragGhost?.remove();
    if (!gapPending) releaseGap(false); // отмена или ушли за пределы окна
    else row.querySelectorAll("[dragging]").forEach(el => el.removeAttribute("dragging"));
    fList.querySelectorAll("[dragging]").forEach(el => el.removeAttribute("dragging"));
    endHover();
    if (!panelGapPending) releasePanelGap(false);
    if (dragOpened) hideFolder(); // отмена (Esc, мимо) — список, раскрытый наведением, закрывается
    if (!tab || tab.isZenFolder || event.dataTransfer.dropEffect != "none") return;
    // отпустили за пределами окна — вкладка уезжает в новое окно, как в Firefox
    const outside =
      event.screenX < window.screenX || event.screenX > window.screenX + window.outerWidth ||
      event.screenY < window.screenY || event.screenY > window.screenY + window.outerHeight;
    if (outside) set.length > 1 ? gBrowser.replaceTabsWithWindow(set) : gBrowser.replaceTabWithWindow(tab);
  };
  row.addEventListener("dragend", dragEnd);
  fList.addEventListener("dragend", dragEnd);
  dropLine.hidden = true;

  // ---------- перетаскивание в списке папки ----------
  // 1) вкладка над фишкой ~350мс — список раскрывается сам (dragOpened); ушли с фишки и списка — закрывается через 450мс.
  // 2) над списком строки расступаются (luminoctis.gap по оси y), бросок ставит вкладку на это место родными moveTabBefore/After
  //    (они сами переносят между папкой и подпапкой); при «уменьшить анимацию» вместо сдвигов — метка места [drop-before/after].
  let hoverTimer = 0, hoverChip = null, closeTimer = 0;
  const disarmClose = () => (clearTimeout(closeTimer), (closeTimer = 0));
  const armClose = () => {
    if (!dragOpened || closeTimer) return;
    closeTimer = setTimeout(() => { closeTimer = 0; if (dragOpened) hideFolder(); }, 450);
  };
  const endHover = () => {
    clearTimeout(hoverTimer);
    hoverTimer = 0;
    hoverChip = null;
    disarmClose();
  };
  const hoverFolder = chip => { // chip — фишка под курсором (или null)
    const shown = chip && folderPanel.chip === chip && folderPanel.state != "closed";
    if (shown) disarmClose();
    else armClose();
    if (!chip || shown || dragged?.isZenFolder || folderOf(dragged) === chip.folder) {
      clearTimeout(hoverTimer);
      hoverTimer = 0;
      hoverChip = null;
      return;
    }
    if (hoverChip === chip) return;
    clearTimeout(hoverTimer);
    hoverChip = chip;
    hoverTimer = setTimeout(() => {
      hoverTimer = 0;
      hoverChip = null;
      if (!dragged) return;
      if (folderPanel.state == "closed") (dragOpened = true, showFolder(chip));
      else if (folderPanel.state == "open") hideFolder(); // открыт другой — следующий dragover запустит таймер заново
    }, 350);
  };
  const panelKids = () => [...fList.children];
  const clearMarks = () => fList.querySelectorAll("[drop-before], [drop-after]").forEach(el => (el.removeAttribute("drop-before"), el.removeAttribute("drop-after")));
  releasePanelGap = instant => {
    panelGapPending = false;
    luminoctis.clearGap(panelKids(), instant);
    clearMarks();
  };
  // перед какой строкой встанет вкладка (индекс в fList; длина — в конец): первая, чья середина (без сдвига) ниже курсора
  const panelDropIndex = y => {
    const i = panelKids().findIndex(el => {
      const r = el.getBoundingClientRect();
      return y < r.top - luminoctis.shiftOf(el, "y") + r.height / 2;
    });
    return i < 0 ? fList.children.length : i;
  };
  const inPanelList = () => panelKids()[0] !== emptyRow;
  folderPanel.addEventListener("dragover", event => {
    if (!dragged) return;
    event.preventDefault();
    disarmClose();
    if (!inPanelList()) return;
    const kids = panelKids(), to = panelDropIndex(event.clientY), own = rowEls.get(dragged);
    clearMarks();
    if (calm()) (kids[to] ?? kids.at(-1)).toggleAttribute(kids[to] ? "drop-before" : "drop-after", true);
    else luminoctis.gap(kids, "y", ((own?.offsetHeight || 32) + 2) * dragSet.length, kids.indexOf(own), to);
  });
  folderPanel.addEventListener("dragleave", event => {
    if (!dragged || folderPanel.contains(event.relatedTarget)) return;
    if (!panelGapPending) releasePanelGap(false); // ушли со списка — строки плавно встают на место
    armClose();
  });
  // вкладку на место `to` (индекс строки списка): сначала в папку (addTabs закрепляет, как Zen), затем на место перед следующей строкой
  const placeInFolder = (tabs, folder, data, to) => {
    const next = data.map((d, i) => ({ ...d, i })).find(d => d.i >= to && !tabs.includes(d.tab));
    const fresh = tabs.filter(tab => tab.group !== folder);
    if (fresh.length) folder.addTabs(fresh);
    if (next) return tabs.forEach(tab => gBrowser.moveTabBefore(tab, next.tab ?? next.folder));
    let at = folder.allItems.filter(item => !tabs.includes(item)).at(-1);
    if (at) for (const tab of tabs) (gBrowser.moveTabAfter(tab, at), (at = tab));
  };
  folderPanel.addEventListener("drop", event => {
    if (!dragged || !folderPanel.chip) return;
    event.preventDefault();
    const tabs = dragSet, { folder } = folderPanel.chip;
    const listed = inPanelList();
    const to = listed ? panelDropIndex(event.clientY) : 0, data = listed ? folderRows(folder) : [];
    dragged = null; // строка/плитка вкладки пересоберётся — dragend может не прийти
    dragSet = [];
    dragGhost?.remove();
    clearTarget();
    dropLine.hidden = true;
    releaseGap(true);
    endHover();
    clearMarks();
    panelGapPending = listed && !calm() && panelKids().some(el => el.style.translate); // сдвиги стоят, пока render не пересоберёт список
    if (panelGapPending) setTimeout(() => panelGapPending && releasePanelGap(false), 500);
    placeInFolder(tabs, folder, data, to);
    if (dragOpened) hideFolder();
  });

  // ---------- кнопки окна: родные, в правом конце полосы ----------
  // Zen переставляет их при каждой смене раскладки (compact mode, настройка панелей) — возвращаем обратно.
  const windowButtons = gZenVerticalTabsManager.actualWindowButtons;
  const keepButtons = () => {
    if (windowButtons.parentNode !== strip) strip.append(windowButtons);
  };
  for (const root of [gNavToolbox, document.getElementById("zen-appcontent-navbar-container")]) {
    new MutationObserver(keepButtons).observe(root, { childList: true, subtree: true });
  }
  keepButtons();
});
