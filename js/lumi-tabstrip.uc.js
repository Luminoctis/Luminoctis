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
      item.labelEl = Object.assign(document.createElement("span"), { className: "lumi-tab-label" });
      item.append(
        item.icon,
        item.labelEl,
        Object.assign(document.createElement("span"), { className: "lumi-tab-audio" }),
        Object.assign(document.createElement("span"), { className: "lumi-tab-close" })
      );
      items.set(tab, item);
    }
    return item;
  };
  const update = (item, tab, hoverCard) => {
    const icon = gBrowser.getIcon(tab), img = item.icon;
    if (img.getAttribute("src") != icon) icon ? img.setAttribute("src", icon) : img.removeAttribute("src");
    item.labelEl.textContent = tab.label;
    // родная подсказка-title дублировала бы карточку при наведении (js/lumi-hovercard.uc.js); без карточки — остаётся
    if (hoverCard) item.removeAttribute("title");
    else item.title = tab.label;
    item.toggleAttribute("selected", tab.selected);
    item.toggleAttribute("square", tab.pinned); // закреплённые вкладки пространства — квадратики
    for (const attr of ["pending", "soundplaying", "muted", "busy"]) {
      item.toggleAttribute(attr, tab.hasAttribute(attr));
    }
  };

  // Essentials — это закрепы в рейке (js/lumi-rail.uc.js), в полосе их нет
  const dying = new WeakSet(); // вкладки, у которых уже прошёл TabClose: в списке ещё есть, в полосе — уже нет
  // Home (js/lumi-home.uc.js) открывается «L» на рейке, в полосе её нет
  // Папки Zen (zen-folder, gZenFolders) — не вкладки: вместо вложенных вкладок в полосе одна «фишка» с выпадающим списком (ниже).
  // Корневая папка вкладки — самая верхняя zen-folder среди её групп (split-view-группа и подпапки тоже группы).
  const folderOf = tab => {
    let root = null;
    for (let g = tab.group; g; g = g.group) if (g.tagName == "zen-folder") root = g;
    return root;
  };
  const stripTabs = () => gBrowser.visibleTabs.filter(tab => !tab.hasAttribute("zen-essential") && !tab.hasAttribute("lumi-home") && !tab.hasAttribute("zen-empty-tab") && !dying.has(tab) && !folderOf(tab));
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
      : item.hasAttribute("split-view-group") ? item.tabs.map(tab => ({ tab, level }))
      : item.hasAttribute("zen-empty-tab") ? [] : [{ tab: item, level }]);
  const chips = new WeakMap(); // zen-folder -> фишка полосы
  const chipFor = folder => {
    let chip = chips.get(folder);
    if (!chip) {
      chip = document.createElement("div");
      chip.className = "lumi-tab lumi-folder";
      chip.folder = folder;
      chip.icon = Object.assign(document.createElement("img"), { className: "lumi-tab-icon", alt: "", src: "chrome://browser/skin/zen-icons/folder.svg" });
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
  let dragged = null, dragFrom = -1, gapPending = false;
  const liveItems = () => [...row.children].filter(el => !el.hasAttribute("closing"));
  function releaseGap(instant) {
    gapPending = false;
    luminoctis.clearGap([...row.children], instant);
    row.querySelectorAll("[dragging]").forEach(el => el.removeAttribute("dragging"));
  }
  let queued = false, shownSelected = null;
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
    const selected = items.get(gBrowser.selectedTab) ?? chips.get(folderOf(gBrowser.selectedTab));
    if (selected?.isConnected && selected !== shownSelected) row.ensureElementIsVisible(selected);
    shownSelected = selected;
  };
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(render);
    }
  };
  for (const type of ["TabOpen", "TabClose", "TabSelect", "TabMove", "TabAttrModified", "TabPinned",
    "TabUnpinned", "TabHide", "TabShow", "TabAddedToEssentials", "TabRemovedFromEssentials", "ZenWorkspacesUIUpdate",
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
  const chipOf = event => event.target.closest?.(".lumi-folder");
  const folderMenu = window.MozXULElement.parseXULToFragment(`<menupopup id="lumi-folder-menu"/>`).firstElementChild;
  document.getElementById("mainPopupSet").append(folderMenu);
  const menuItem = (label, props = {}) => Object.assign(document.createXULElement("menuitem"), { className: "menuitem-iconic", ...props }, { label });
  folderMenu.addEventListener("popupshowing", () => {
    const rows = folderRows(folderMenu.chip.folder);
    const nodes = rows.map(({ tab, folder, level }) => {
      const node = menuItem(tab ? tab.label : folder.label);
      node.setAttribute("crop", "end");
      node.setAttribute("lumi-level", level);
      if (folder) node.disabled = true; // подпапка — заголовок с отступом
      else {
        node.tab = tab;
        node.setAttribute("image", gBrowser.getIcon(tab) || "");
        node.toggleAttribute("lumi-current", tab.selected);
        node.toggleAttribute("pending", tab.hasAttribute("pending"));
        if (tab.hasAttribute("soundplaying") || tab.hasAttribute("muted")) node.setAttribute("acceltext", tab.hasAttribute("muted") ? "без звука" : "звук");
      }
      return node;
    });
    folderMenu.replaceChildren(...(rows.some(row => row.tab) ? nodes : [menuItem("Пусто", { disabled: true })]));
    folderMenu.chip.toggleAttribute("open", true);
  });
  folderMenu.addEventListener("popuphidden", event => event.target === folderMenu && folderMenu.chip?.removeAttribute("open"));
  folderMenu.addEventListener("command", event => event.target.tab && (gBrowser.selectedTab = event.target.tab));
  folderMenu.addEventListener("click", event => { // средняя кнопка — закрыть вкладку, список остаётся
    const tab = event.target.tab;
    if (!tab || event.button != 1) return;
    gBrowser.removeTab(tab, { animate: true });
    event.target.remove();
  });
  const openFolder = chip => {
    folderMenu.chip = chip;
    folderMenu.openPopup(chip, "after_start", 0, 0, false, false);
  };
  // ПКМ — родное меню Zen (zenFolderActions): оно узнаёт папку по метке спрятанного родного списка, поэтому открываем его
  // из события, брошенного на эту метку
  const openFolderActions = (chip, from) => {
    const label = chip.folder.labelElement.parentElement;
    label.addEventListener("contextmenu", event => document.getElementById("zenFolderActions").openPopupAtScreen(from.screenX, from.screenY, true, event), { once: true });
    label.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  };

  row.addEventListener("click", event => {
    const chip = chipOf(event);
    if (chip) return event.button == 0 && openFolder(chip);
    const tab = tabOf(event);
    if (!tab || event.button != 0) return;
    if (event.target.classList.contains("lumi-tab-close")) gBrowser.removeTab(tab, { animate: true });
    else if (event.target.classList.contains("lumi-tab-audio")) tab.toggleMuteAudio();
    else gBrowser.selectedTab = tab;
  });
  row.addEventListener("auxclick", event => {
    const tab = tabOf(event);
    if (tab && event.button == 1) gBrowser.removeTab(tab, { animate: true });
  });
  row.addEventListener("contextmenu", event => {
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
  const dropIndex = x => {
    // куда встанет: перед первой вкладкой, чья середина правее курсора (середины — без учёта сдвига расступившихся)
    const list = liveItems();
    const i = list.findIndex(el => {
      const r = el.getBoundingClientRect();
      return x < r.left - luminoctis.shiftOf(el, "x") + r.width / 2;
    });
    return i < 0 ? list.length : i;
  };
  row.addEventListener("dragstart", event => {
    dragged = tabOf(event);
    if (!dragged) return;
    dragFrom = liveItems().indexOf(items.get(dragged));
    setTimeout(() => dragged && items.get(dragged)?.setAttribute("dragging", "")); // гаснет, когда снимок для курсора уже сделан
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragged.linkedBrowser.currentURI.spec);
    event.dataTransfer.mozSetDataAt("application/x-moz-tabbrowser-tab", dragged, 0); // родной тип вкладки: по нему рейка делает её закрепом
  });
  row.addEventListener("dragover", event => {
    if (!dragged) return;
    event.preventDefault();
    const list = liveItems();
    const i = dropIndex(event.clientX);
    const ref = list[i] ?? list.at(-1);
    const r = ref.getBoundingClientRect();
    const x = list[i] ? r.left - 3 : r.right + 3;
    dropLine.style.left = `${x - strip.getBoundingClientRect().left}px`;
    dropLine.hidden = false;
    dropLine.toggleAttribute("quiet", !calm()); // с расступанием черта не нужна — остаётся при «уменьшить анимацию»
    if (!calm()) luminoctis.gap(list, "x", items.get(dragged).getBoundingClientRect().width + 6, dragFrom, i);
  });
  row.addEventListener("dragleave", event => {
    if (row.contains(event.relatedTarget)) return;
    dropLine.hidden = true;
    if (!gapPending) releaseGap(false); // ушли с полосы — щель плавно закрывается
  });
  row.addEventListener("drop", event => {
    if (!dragged) return;
    event.preventDefault();
    const visible = stripEntries();
    const i = dropIndex(event.clientX);
    // индекс в полосе -> индекс в gBrowser.tabs; moveTabTo сам не даёт смешать закреплённые и обычные.
    // У папки края — её первая и последняя вкладки (с пустой вкладкой Zen)
    const target = visible[i] ?? visible.at(-1);
    const edge = el => el.isZenFolder ? [...el.querySelectorAll("tab")].at(visible[i] ? 0 : -1) : el;
    let tabIndex = gBrowser.tabs.indexOf(edge(target)) + (visible[i] ? 0 : 1);
    if (gBrowser.tabs.indexOf(dragged) < tabIndex) tabIndex--; // moveTabTo ждёт итоговый индекс
    gapPending = row.querySelector("[style*=translate]") != null; // расступившиеся стоят, пока ряд не пересоберётся (render)
    if (gapPending) setTimeout(() => gapPending && releaseGap(false), 500); // порядок не изменился — пересборки не будет
    gBrowser.moveTabTo(dragged, { tabIndex });
  });
  row.addEventListener("dragend", event => {
    dropLine.hidden = true;
    const tab = dragged;
    dragged = null;
    if (!gapPending) releaseGap(false); // отмена или ушли за пределы окна
    else row.querySelectorAll("[dragging]").forEach(el => el.removeAttribute("dragging"));
    if (!tab || event.dataTransfer.dropEffect != "none") return;
    // отпустили за пределами окна — вкладка уезжает в новое окно, как в Firefox
    const outside =
      event.screenX < window.screenX || event.screenX > window.screenX + window.outerWidth ||
      event.screenY < window.screenY || event.screenY > window.screenY + window.outerHeight;
    if (outside) gBrowser.replaceTabWithWindow(tab);
  });
  dropLine.hidden = true;

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
