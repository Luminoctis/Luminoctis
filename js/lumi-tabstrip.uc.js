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
      item.append(
        Object.assign(document.createElement("img"), { className: "lumi-tab-icon", alt: "" }),
        Object.assign(document.createElement("span"), { className: "lumi-tab-label" }),
        Object.assign(document.createElement("span"), { className: "lumi-tab-audio" }),
        Object.assign(document.createElement("span"), { className: "lumi-tab-close" })
      );
      items.set(tab, item);
    }
    return item;
  };
  const update = (item, tab) => {
    const icon = gBrowser.getIcon(tab);
    const img = item.querySelector(".lumi-tab-icon");
    if (img.getAttribute("src") != icon) icon ? img.setAttribute("src", icon) : img.removeAttribute("src");
    item.querySelector(".lumi-tab-label").textContent = tab.label;
    // родная подсказка-title дублировала бы карточку при наведении (js/lumi-hovercard.uc.js); без карточки — остаётся
    if (Services.prefs.getBoolPref("luminoctis.tabs.hover-memory", true)) item.removeAttribute("title");
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
  const stripTabs = () => gBrowser.visibleTabs.filter(tab => !tab.hasAttribute("zen-essential") && !tab.hasAttribute("lumi-home") && !dying.has(tab));
  // Закрытие: вкладка улетает вверх и гаснет, потом освободившееся место схлопывается, соседи плавно занимают его.
  // Пока идёт анимация, элемент остаётся в ряду «призраком» (ghosts) на своём месте — render его не убирает.
  const ghosts = new Set();
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    const tabs = stripTabs();
    tabs.forEach(tab => update(itemFor(tab), tab));
    const wanted = tabs.map(itemFor);
    for (const ghost of [...ghosts].sort((a, b) => a.lumiSlot - b.lumiSlot)) wanted.splice(Math.min(ghost.lumiSlot, wanted.length), 0, ghost);
    const now = [...row.children];
    if (wanted.length != now.length || wanted.some((el, i) => el !== now[i])) row.replaceChildren(...wanted);
    // полная ширина вкладок (без сжатия) — для «+» сразу за вкладками (chrome.css, раздел 9): 210px, квадратики 28px, зазоры 6px.
    // «+» — как ещё одна вкладка: сжимается вместе с ними; --lumi-tabs-shrink уравнивает долю сжатия ряда и «+»
    // (зазоры не сжимаются, без поправки «+» вышла бы на пару пикселей шире вкладки)
    const full = Math.max(0, tabs.reduce((w, tab) => w + (tab.pinned ? 28 : 210) + 6, -6));
    strip.style.setProperty("--lumi-tabs-w", `${full}px`);
    strip.style.setProperty("--lumi-tabs-shrink", full ? (tabs.filter(tab => !tab.pinned).length * 210) / full : 1);
    if (gapPending) releaseGap(true);
    // к выбранной — только когда выбор сменился: иначе любая фоновая вкладка (загрузка, заголовок) сбивала прокрутку пользователя
    const selected = items.get(gBrowser.selectedTab);
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
    "TabUnpinned", "TabHide", "TabShow", "TabAddedToEssentials", "TabRemovedFromEssentials", "ZenWorkspacesUIUpdate"]) {
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
  render();

  // ---------- действия: всё через родные API ----------
  const tabOf = event => event.target.closest?.(".lumi-tab")?.tab;
  luminoctis.unloadShortcut(row, tabOf); // «Выгрузить вкладку или закреп» (js/lumi-rail.uc.js) — до клика и меню ниже
  row.addEventListener("click", event => {
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
    const visible = stripTabs();
    const i = dropIndex(event.clientX);
    // индекс в полосе -> индекс в gBrowser.tabs; moveTabTo сам не даёт смешать закреплённые и обычные
    const target = visible[i] ?? visible.at(-1);
    let tabIndex = gBrowser.tabs.indexOf(target) + (visible[i] ? 0 : 1);
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
