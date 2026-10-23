// ==UserScript==
// @name           Luminoctis: полоса вкладок
// @description    Своя полоса вкладок сверху — зеркало gBrowser. Родной вертикальный список Zen остаётся рабочим, но спрятан (chrome.css, раздел 9).
// ==/UserScript==

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
  // «+» — та же родная команда, что у кнопки «Новая вкладка» Firefox (cmd_newNavigatorTab); дальше черта и кнопки окна
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
    item.title = tab.label;
    item.toggleAttribute("selected", tab.selected);
    item.toggleAttribute("square", tab.pinned); // Essentials и закреплённые — квадратики
    for (const attr of ["pending", "soundplaying", "muted", "busy"]) {
      item.toggleAttribute(attr, tab.hasAttribute(attr));
    }
  };

  let queued = false;
  const render = () => {
    queued = false;
    const tabs = gBrowser.visibleTabs;
    tabs.forEach(tab => update(itemFor(tab), tab));
    const wanted = tabs.map(itemFor);
    const now = [...row.children];
    if (wanted.length != now.length || wanted.some((el, i) => el !== now[i])) row.replaceChildren(...wanted);
    const selected = items.get(gBrowser.selectedTab);
    if (selected?.isConnected) row.ensureElementIsVisible(selected);
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
  // закрытая вкладка ещё в gBrowser.visibleTabs во время своего TabClose — перерисовываем после её ухода
  window.addEventListener("TabClose", () => setTimeout(schedule, 0));
  render();

  // ---------- действия: всё через родные API ----------
  const tabOf = event => event.target.closest?.(".lumi-tab")?.tab;
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
    document.getElementById("tabContextMenu").openPopupAtScreen(event.screenX, event.screenY, true, event);
  });

  // ---------- перетаскивание внутри полосы ----------
  let dragged = null;
  const dropIndex = x => {
    // куда встанет: перед первой вкладкой, чья середина правее курсора
    const list = [...row.children];
    const i = list.findIndex(el => {
      const r = el.getBoundingClientRect();
      return x < r.left + r.width / 2;
    });
    return i < 0 ? list.length : i;
  };
  row.addEventListener("dragstart", event => {
    dragged = tabOf(event);
    if (!dragged) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragged.linkedBrowser.currentURI.spec);
  });
  row.addEventListener("dragover", event => {
    if (!dragged) return;
    event.preventDefault();
    const list = [...row.children];
    const i = dropIndex(event.clientX);
    const ref = list[i] ?? list.at(-1);
    const r = ref.getBoundingClientRect();
    const x = list[i] ? r.left - 3 : r.right + 3;
    dropLine.style.left = `${x - strip.getBoundingClientRect().left}px`;
    dropLine.hidden = false;
  });
  row.addEventListener("dragleave", event => {
    if (!row.contains(event.relatedTarget)) dropLine.hidden = true;
  });
  row.addEventListener("drop", event => {
    if (!dragged) return;
    event.preventDefault();
    const visible = gBrowser.visibleTabs;
    const i = dropIndex(event.clientX);
    // индекс в полосе -> индекс в gBrowser.tabs; moveTabTo сам не даёт смешать закреплённые и обычные
    const target = visible[i] ?? visible.at(-1);
    let tabIndex = gBrowser.tabs.indexOf(target) + (visible[i] ? 0 : 1);
    if (gBrowser.tabs.indexOf(dragged) < tabIndex) tabIndex--; // moveTabTo ждёт итоговый индекс
    gBrowser.moveTabTo(dragged, { tabIndex });
  });
  row.addEventListener("dragend", event => {
    dropLine.hidden = true;
    const tab = dragged;
    dragged = null;
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
