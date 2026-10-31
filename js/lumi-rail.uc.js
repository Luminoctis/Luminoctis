// ==UserScript==
// @name           Luminoctis: боковая рейка
// @description    Рейка 48px слева: иконка Luminoctis, рабочие пространства Zen, закрепы (родные Essentials Zen) с мини-окном, плееры; меню по правой кнопке, панель настроек мода и таймер выгрузки вкладок.
// ==/UserScript==

(() => {
  const { jsUrl, pageUrl } = ChromeUtils.importESModule(Components.stack.filename.replace(/[^/]*$/, "lumi-paths.sys.mjs"));
  // палитра — сразу, до отрисовки окна (скрипт идёт на DOMContentLoaded): без вспышки цветов Tokyo Night
  ChromeUtils.importESModule(jsUrl("lumi-palette.sys.mjs")).watch(document, { glass: true });
  const keys = ChromeUtils.importESModule(jsUrl("lumi-keys.sys.mjs"));
  const h = (tag, className, props = {}) =>
    Object.assign(document.createElement(tag), { className }, props);
  const labeled = (el, text) => {
    el.setAttribute("aria-label", text);
    el.title = text;
    return el;
  };

  // Настройки Luminoctis — панель справа от рейки (концепт, вид «edit»). Внутри — страница настроек
  // (Luminoctis\settings → профиль chrome\resources\luminoctis, адрес даёт fx-autoconfig), раздел — в её адресе (#sidebar).
  // Панель грузится при первом открытии, потом только прячется: раздел и прокрутка остаются как были.
  const SETTINGS_URL = pageUrl("settings/settings.html");
  let settings;
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches; // «уменьшить анимацию» — общая для рейки и полосы
  window.luminoctis = {
    // tab — раздел (sidebar, look, tabs…)
    openSettings(tab) {
      const hash = tab && "#" + tab;
      if (!settings) {
        settings = h("div", "", { id: "lumi-settings" });
        settings.setAttribute("role", "dialog");
        settings.setAttribute("aria-label", "Настройки Luminoctis");
        tab ||= Services.prefs.getStringPref("luminoctis.settings.tab", "sidebar"); // последний открытый раздел (пишет страница)
        settings.append(h("iframe", "", { src: SETTINGS_URL + (hash || "#" + tab) }));
        document.getElementById("lumi-rail").before(settings); // до рейки: раскрытые плееры рисуются поверх панели
      } else {
        // полный адрес: короткий «#раздел» браузер достроил бы от адреса окна (browser.xhtml), а не страницы
        const page = settings.firstChild.contentWindow;
        if (tab) {
          page.location.replace(SETTINGS_URL + hash);
          page.lumiShowTab?.(); // тот же адрес hashchange не шлёт — прокрутку к месту делаем сами
        }
        settings.hidden = false;
      }
      settings.firstChild.focus(); // чтобы Esc сразу закрывал
    },
    closeSettings() {
      if (settings) settings.hidden = true;
    },
    // закрепы — для панели настроек и самопроверок (dev\check-pins.js)
    pins: pinTabs, addPin, pinTab, movePin, unpin, showPin, hidePin, migratePins, unloadIdleTabs,
    unload, unloadShortcut, gap, clearGap, shiftOf, calm,
  };

  // ---------- Перетаскивание: остальные расступаются, показывая место, куда встанет вкладка или закреп ----------
  // items — элементы ряда в порядке списка, axis — "x" (полоса вкладок) или "y" (рейка), size — место под перетаскиваемую (размер + зазор),
  // from — индекс перетаскиваемой в items (−1: её нет в ряду, например вкладка из полосы над закрепами), to — «вставить перед items[to]».
  // Сдвиг — свойство translate (плавность даёт CSS), раскладка не меняется: перетаскиваемая остаётся на месте, но невидима.
  function gap(items, axis, size, from, to) {
    const final = from >= 0 && to > from ? to - 1 : to; // итоговое место среди остальных
    items.forEach((el, k) => {
      const d = from < 0 ? (k >= final ? size : 0)
        : k == from ? 0
        : final > from && k > from && k <= final ? -size
        : final < from && k >= final && k < from ? size : 0;
      el.style.translate = d ? (axis == "x" ? `${d}px 0` : `0 ${d}px`) : "";
    });
  }
  // убрать сдвиги: плавно (отмена, ушли с ряда) или сразу (бросили — ряд только что пересобран, прыжка быть не должно)
  function clearGap(items, instant) {
    for (const el of items) {
      if (instant) el.style.transition = "none";
      el.style.translate = "";
      if (instant) requestAnimationFrame(() => requestAnimationFrame(() => (el.style.transition = "")));
    }
  }
  // сдвиг элемента сейчас (в пикселях по оси) — нужен, чтобы по getBoundingClientRect найти его место без сдвига
  function shiftOf(el, axis) {
    const t = getComputedStyle(el).translate;
    const parts = t == "none" ? [0, 0] : t.split(" ").map(parseFloat);
    return (axis == "x" ? parts[0] : parts[1]) || 0;
  }

  UC_API.Windows.waitWindowLoading(window).then(() => {
    const rail = h("nav", "", { id: "lumi-rail" });
    rail.setAttribute("aria-label", "Боковая панель Luminoctis");

    // Клик — Luminoctis Home: открыть / вернуться (js/lumi-home.uc.js; подсветку lumi-home-open ставит он же)
    const logo = labeled(h("button", "", { id: "lumi-logo", textContent: "L" }), "Luminoctis Home");
    logo.addEventListener("click", () => window.lumiHome?.toggle());

    const pins = h("div", "", { id: "lumi-pins" });
    const players = h("div", "", { id: "lumi-players" });
    rail.append(
      logo,
      h("div", "lumi-sep"),
      h("div", "lumi-sep"),
      pins,
      h("div", "lumi-spacer"),
      players
    );
    document.getElementById("navigator-toolbox").before(rail);

    initWorkspaces(rail);
    initPins(rail, pins);
    initPlayers(players);
    initRailMenu(rail);
    setInterval(unloadIdleTabs, 60000);
    gZenWorkspaces.promiseInitialized
      .then(() => SessionStore.promiseAllWindowsRestored)
      .then(migratePins)
      .catch(console.error);
  });

  // ---------- Меню по правой кнопке на рейке ----------
  // Рейка — область перетаскивания окна; без своего меню Windows показывает системное меню окна.
  // У кнопок пространств своё родное меню Zen, у закрепов — своё (initPins).
  function initRailMenu(rail) {
    const menu = window.MozXULElement.parseXULToFragment(`
      <menupopup id="lumi-rail-menu">
        <menuitem id="lumi-rail-menu-settings" label="Настройки мода Luminoctis"/>
        <menuseparator/>
        <menuitem label="Управление пространствами" command="cmd_zenManageWorkspaces"/>
        <menuseparator/>
        <menuitem label="Настроить панель инструментов" command="cmd_CustomizeToolbars"/>
      </menupopup>`).firstElementChild;
    document.getElementById("mainPopupSet").append(menu);
    menu.querySelector("#lumi-rail-menu-settings").addEventListener("command", () => luminoctis.openSettings());
    rail.addEventListener("contextmenu", event => {
      if (event.target.closest("#zen-workspaces-button toolbarbutton, .lumi-pin")) return;
      event.preventDefault();
      menu.openPopupAtScreen(event.screenX, event.screenY, true, event);
    });
  }

  // ---------- Рабочие пространства: родной переключатель Zen, перенесённый в рейку ----------
  function initWorkspaces(rail) {
    const icons = document.getElementById("zen-workspaces-button");
    // Элемент Zen подключается один раз (#hasConnected), перенос его не ломает.
    rail.querySelector(".lumi-sep").after(icons);

    // Кнопка под «L»: родная Библиотека Zen (zen-library) на разделе «Пространства».
    // cmd_zenManageWorkspaces = ZenLibrary.toggle("spaces"): открыта — закроет.
    const manage = labeled(h("button", "", { id: "lumi-spaces-button" }), "Библиотека Zen: пространства");
    manage.addEventListener("click", () => document.getElementById("cmd_zenManageWorkspaces").doCommand());
    rail.querySelector("#lumi-logo").after(manage);

    // Цветная точка контейнера Firefox: цвет берём из контейнера пространства.
    const paintDots = () => {
      for (const btn of icons.querySelectorAll("toolbarbutton[zen-workspace-id]")) {
        const ws = gZenWorkspaces.getWorkspaceFromId(btn.getAttribute("zen-workspace-id"));
        const color = ws?.containerTabId
          ? ContextualIdentityService.getPublicIdentityFromId(ws.containerTabId)?.color
          : null;
        if (color) btn.setAttribute("lumi-container", color);
        else btn.removeAttribute("lumi-container");
      }
    };
    window.addEventListener("ZenWorkspacesUIUpdate", () => setTimeout(paintDots));
    paintDots();
  }

  // ---------- Закрепы: родные Essentials Zen — постоянные вкладки, общие для всех пространств ----------
  // Zen сам хранит их между перезапусками и повторяет во всех окнах (ZenWindowSync), порядок — порядок Essentials.
  // Общие для всех пространств они при zen.workspaces.separate-essentials = false (иначе у каждого контейнера свои).
  const TAB_DROP_TYPE = "application/x-moz-tabbrowser-tab"; // родной тип перетаскивания вкладки, его ставит и полоса вкладок
  const isPin = tab => !!tab?.hasAttribute("zen-essential");
  const pinURL = tab => tab.linkedBrowser.currentURI.spec;
  const pinIcon = tab => gBrowser.getIcon(tab) || `page-icon:${pinURL(tab)}`;
  function pinTabs() {
    return gBrowser.tabs.filter(isPin);
  }
  // Сделать вкладку закрепом; false — Zen не взял (предел zen.tabs.essentials.max, по умолчанию 12)
  function pinTab(tab) {
    return gZenPinnedTabManager.addToEssentials(tab);
  }
  // Новый закреп по адресу — ленивая вкладка: не грузится, пока её не откроют
  function addPin(url, title) {
    const tab = gBrowser.addTrustedTab(url, {
      createLazyBrowser: true, lazyTabTitle: title, inBackground: true, skipAnimation: true,
      skipRoute: true, userContextId: 0, // без контейнера пространства: закреп общий
    });
    // у ленивой вкладки Zen пускает подпись только с этим флагом (как при восстановлении сессии)
    if (title) gBrowser._setTabLabel(tab, title, { isContentTitle: true, _zenChangeLabelFlag: true });
    if (pinTab(tab)) return tab;
    gBrowser.removeTab(tab);
    return null;
  }
  // index — итоговое место среди закрепов (moveTabTo держит Essentials в их части списка вкладок)
  function movePin(tab, index) {
    const target = pinTabs()[index];
    if (target && target !== tab) gBrowser.moveTabTo(tab, { tabIndex: gBrowser.tabs.indexOf(target) });
  }
  function unloadPin(tab) {
    if (tab.selected) hidePin();
    gBrowser.explicitUnloadTabs([tab]);
  }
  // Выгрузить вкладку полосы или закреп. Выбранную вкладку родная выгрузка сама сначала сменяет соседней.
  function unload(tab) {
    if (isPin(tab)) unloadPin(tab);
    else if (!tab.hasAttribute("pending")) gBrowser.explicitUnloadTabs([tab]);
  }
  // Шорткат «Выгрузить вкладку или закреп» (luminoctis.keys.unload, по умолчанию Shift+ПКМ; меняется в настройках — читаем при каждом нажатии).
  // Ловим до своих обработчиков элемента (клик, меню): сочетание их заменяет. tabOf(event) — вкладка под мышью.
  function unloadShortcut(el, tabOf) {
    for (const type of ["click", "auxclick", "contextmenu"]) {
      el.addEventListener(type, event => {
        const tab = tabOf(event);
        if (!tab || !keys.matches("unload", event)) return;
        event.preventDefault();
        event.stopPropagation();
        unload(tab);
      }, true);
    }
  }
  // «Открепить» — закреп улетает влево и гаснет, вкладка закрывается совсем
  async function unpin(tab) {
    if (tab.selected) hidePin();
    const btn = pinButtons.get(tab);
    if (btn?.isConnected && !calm()) {
      btn.setAttribute("unpinning", "");
      await new Promise(r => setTimeout(r, 300));
    }
    gBrowser.removeTab(tab);
    if (!tab.closing) btn?.removeAttribute("unpinning"); // страница спросила «покинуть?» — закреп возвращается на место
  }

  // Разовый перенос закрепов прежней версии (закладки папки «Luminoctis») в ленивые закрепы, по порядку. Папку не трогаем.
  async function migratePins() {
    if (Services.prefs.getBoolPref("luminoctis.pins.migrated", false)) return;
    Services.prefs.setBoolPref("luminoctis.pins.migrated", true); // сразу: другие окна не повторят
    const { bookmarks } = PlacesUtils;
    const folder = (await bookmarks.search({ title: "Luminoctis" })).find(
      b => b.type == bookmarks.TYPE_FOLDER && [bookmarks.toolbarGuid, bookmarks.menuGuid].includes(b.parentGuid)
    );
    if (!folder) return;
    const pinned = new Set(pinTabs().map(pinURL));
    for (const { uri, title } of (await PlacesUtils.promiseBookmarksTree(folder.guid)).children ?? []) {
      if (uri && !pinned.has(uri)) addPin(uri, title);
    }
  }

  // ---------- Мини-окно закрепа (концепт, экран 3) ----------
  // Закреп выбирается обычной вкладкой (фокус, клавиатура, загрузка — родные), но его панель — окошко на треть экрана
  // у рейки, а прежняя вкладка остаётся видна под ним, как фон у Glance Zen (deck-selected + zenModeActive).
  // Клик мимо — снова выбрана прежняя вкладка, закреп остаётся загруженным. «Открыть во вкладке» — закреп во весь экран.
  let shown = null; // { pin, prev, mini }: выбранный нами закреп, вкладка под ним, окошком ли он
  let frame, backdrop, keepBehind;
  const pinButtons = new WeakMap(); // вкладка закрепа -> плитка в рейке
  const panelOf = tab => tab?.linkedBrowser?.closest(".browserSidebarContainer");

  // Закрытие окошка — обратное появлению (chrome.css, lumi-pin-in/lumi-fade-in): then() вызывается после анимации и всё снимает.
  // При «уменьшить анимацию» — сразу. smooth только у действий пользователя; программные hidePin() (выгрузка, открепление) — мгновенные.
  let leaving = false;
  async function leave(then, withPanel = true) {
    if (!shown?.mini || leaving || calm()) return then();
    leaving = true;
    const cur = shown;
    const fade = (el, ms, easing, shift) => el.animate(
      [{ opacity: 1, translate: "0 0" }, { opacity: 0, translate: shift ? "-12px 0" : "0 0" }], { duration: ms, easing, fill: "forwards" });
    const anims = [fade(backdrop, 200, "cubic-bezier(0.4, 0, 1, 1)"), fade(frame, 200, "cubic-bezier(0.4, 0, 1, 1)", true)];
    if (withPanel && panelOf(cur.pin)) anims.push(fade(panelOf(cur.pin), 200, "cubic-bezier(0.4, 0, 1, 1)", true));
    await Promise.allSettled(anims.map(a => a.finished));
    leaving = false;
    if (shown === cur) then(); // иначе за это время выбрали другую вкладку — release уже был
    anims.forEach(a => a.cancel());
  }

  function showPin(pin) {
    if (leaving || (shown?.mini && shown.pin === pin)) return;
    const old = shown?.mini ? shown.pin : null; // окошко другого закрепа: прежняя вкладка под ним остаётся та же
    const prev = old ? shown.prev : gBrowser.selectedTab === pin ? gBrowser._findTabToBlurTo(pin) : gBrowser.selectedTab;
    if (!old) release();
    shown = { pin, prev, mini: true };
    gBrowser.selectedTab = pin;
    const oldPanel = panelOf(old);
    oldPanel?.classList.remove("lumi-pin-window", "deck-selected");
    const behind = panelOf(prev);
    if (!old && behind) {
      prev.linkedBrowser.zenModeActive = true; // переключатель вкладок не гасит её, пока она под окошком
      prev.linkedBrowser.docShellIsActive = true;
      // deck-selected — видимая панель; tabpanels снимает его со старой вкладки, когда закреп готов
      const keep = () => behind.classList.contains("deck-selected") || behind.classList.add("deck-selected");
      keep();
      keepBehind = new MutationObserver(keep);
      keepBehind.observe(behind, { attributeFilter: ["class"] });
    }
    panelOf(pin)?.classList.add("lumi-pin-window");
    frame.hidden = backdrop.hidden = false;
    updateFrame();
    gBrowser.selectedBrowser.focus(); // клавиатура — сразу сайту закрепа, а не плитке рейки
  }
  // Спрятать закреп (окошком или во весь экран): снова выбрана вкладка, что была до него
  function hidePin(smooth) {
    if (smooth === true && shown?.mini) return leave(() => hidePin());
    const pin = shown?.pin ?? gBrowser.selectedTab, prev = shown?.prev;
    const to = prev?.isConnected && !prev.closing && prev !== pin ? prev : gBrowser._findTabToBlurTo(pin);
    if (to) gBrowser.selectedTab = to;
    release();
    gBrowser.selectedBrowser.focus();
  }
  function expandNow() {
    const { pin, prev } = shown;
    release();
    shown = { pin, prev, mini: false };
  }
  const expandPin = () => shown?.mini && leave(expandNow, false);
  // Средний клик по закрепу: сразу обычная вкладка, без окошка
  function openPinAsTab(pin) {
    if (leaving) return;
    if (!(shown?.pin === pin && !shown.mini)) showPin(pin);
    if (shown?.mini) expandNow();
  }
  // окошко → обычный вид: панели закрепа и прежней вкладки — как у всех вкладок
  function release() {
    if (!shown) return;
    const { pin, prev } = shown;
    shown = null;
    keepBehind?.disconnect();
    keepBehind = null;
    frame.hidden = backdrop.hidden = true;
    const win = panelOf(pin);
    win?.classList.remove("lumi-pin-window");
    if (!pin.selected) win?.classList.remove("deck-selected");
    if (prev?.linkedBrowser && prev !== pin) {
      prev.linkedBrowser.zenModeActive = false;
      if (!prev.selected) {
        prev.linkedBrowser.docShellIsActive = false;
        panelOf(prev)?.classList.remove("deck-selected");
      }
    }
  }
  function updateFrame() {
    if (!shown?.mini) return;
    frame.querySelector("img").src = pinIcon(shown.pin);
    frame.querySelector(".lumi-pin-title").textContent = shown.pin.label;
    frame.setAttribute("aria-label", shown.pin.label);
  }

  function initPinWindow() {
    // в #tabbrowser-tabbox: панели вкладок — его слои, иначе окошко не встало бы над затемнением
    backdrop = h("div", "", { id: "lumi-pin-backdrop", hidden: true });
    backdrop.addEventListener("click", () => hidePin(true));
    frame = h("div", "", { id: "lumi-pin-frame", hidden: true });
    frame.setAttribute("role", "dialog");
    const full = labeled(h("button", "lumi-pin-full"), "Открыть во вкладке");
    full.addEventListener("click", expandPin);
    const head = h("div", "lumi-pin-head");
    head.append(h("img", "", { alt: "" }), h("span", "lumi-pin-title"), full);
    frame.append(head);
    document.getElementById("tabbrowser-tabbox").append(backdrop, frame);

    // выбрали другую вкладку (полоса, Ctrl+Tab, смена пространства…) — окошка больше нет
    window.addEventListener("TabSelect", () => {
      if (shown && gBrowser.selectedTab !== shown.pin) release();
    });

    // Закреп никогда не бывает выбранной вкладкой «в основной области» сам по себе — только через showPin/expandPin.
    // Корень: Zen при выборе замены (закрыли последнюю вкладку, выгрузка, смена пространства) годной считает любую вкладку,
    // кроме выгруженного закрепа (_shouldChangeToTab), так что загруженный закреп подходит и становится на весь экран.
    // 1) закреп — не замена; на его месте будет соседняя вкладка или пустая вкладка пространства (findTabToBlur).
    const shouldChange = gZenWorkspaces._shouldChangeToTab;
    gZenWorkspaces._shouldChangeToTab = function (tab) {
      return shouldChange.call(this, tab) && !isPin(tab);
    };
    // 2) вкладку, ставшую закрепом, пока она выбрана (меню, перетаскивание), родное API не отпускает — уводим выбор сами.
    // _findTabToBlurTo тут не годится: у закрепа нет id пространства, и Zen исключает все вкладки пространства — берём последнюю использованную обычную.
    const leavePin = () => {
      const tab = gBrowser.selectedTab;
      if (!isPin(tab) || shown?.pin === tab) return;
      const to = gBrowser.visibleTabs.filter(t => !isPin(t) && !t.hasAttribute("zen-empty-tab") && gZenWorkspaces._shouldChangeToTab(t))
        .reduce((best, t) => (!best || t.lastAccessed > best.lastAccessed ? t : best), null) ?? gZenWorkspaces._emptyTab;
      if (to) gBrowser.selectedTab = to;
    };
    for (const type of ["TabSelect", "TabAddedToEssentials"]) window.addEventListener(type, () => setTimeout(leavePin));
    // Ctrl+W и «Закрыть вкладку» не закрывают закреп, а прячут (Zen иначе сбросил бы его адрес и выгрузил)
    document.getElementById("mainCommandSet").addEventListener("command", event => {
      if (event.target.id != "cmd_close" || !isPin(gBrowser.selectedTab)) return;
      event.stopPropagation();
      hidePin(true);
    }, true);
  }

  function initPins(rail, box) {
    initPinWindow();
    let queued = false;
    let gapPending = false, gapTimer; // gapPending: бросили, ждём пересборки ряда (render)
    // закрепы расступаются при перетаскивании (gap, js выше); сдвиги убираются плавно или, после броска, сразу
    const releaseGap = instant => {
      clearTimeout(gapTimer);
      gapPending = false;
      const list = [...box.children];
      clearGap(list, instant);
      list.forEach(el => el.removeAttribute("dragging"));
      gapTimer = setTimeout(() => box.removeAttribute("lumi-gap"), instant ? 0 : 260);
    };
    const render = () => {
      queued = false;
      const wanted = pinTabs().map(pinButton);
      const now = [...box.children];
      // переставляем, только если порядок изменился: иначе сбилось бы перетаскивание
      if (wanted.length != now.length || wanted.some((el, i) => el !== now[i])) box.replaceChildren(...wanted);
      if (gapPending) releaseGap(true); // бросили: ряд пересобран — расступившиеся встают на свои места без прыжка
      updateFrame();
    };
    const schedule = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(render);
      }
    };
    for (const type of ["TabOpen", "TabClose", "TabSelect", "TabMove", "TabAttrModified", "TabPinned", "TabUnpinned",
      "TabAddedToEssentials", "TabRemovedFromEssentials", "TabBrowserDiscarded"]) {
      window.addEventListener(type, schedule);
    }
    window.addEventListener("TabClose", () => setTimeout(schedule)); // закрытая ещё в списке во время своего TabClose
    Services.prefs.addObserver("luminoctis.tabs.hover-memory", schedule); // подсказка-title зависит от настройки карточки
    window.addEventListener("unload", () => Services.prefs.removeObserver("luminoctis.tabs.hover-memory", schedule), { once: true });
    render();

    // ПКМ — меню закрепа; шорткат (Shift+ПКМ) — сразу выгрузить
    const menu = window.MozXULElement.parseXULToFragment(`
      <menupopup id="lumi-pin-menu">
        <menuitem id="lumi-pin-menu-unload" label="Выгрузить"/>
        <menuitem id="lumi-pin-menu-unpin" label="Открепить"/>
      </menupopup>`).firstElementChild;
    document.getElementById("mainPopupSet").append(menu);
    let menuTab;
    menu.querySelector("#lumi-pin-menu-unload").addEventListener("command", () => unloadPin(menuTab));
    menu.querySelector("#lumi-pin-menu-unpin").addEventListener("command", () => unpin(menuTab));
    unloadShortcut(box, event => event.target.closest?.(".lumi-pin")?.tab);
    box.addEventListener("contextmenu", event => {
      const tab = event.target.closest(".lumi-pin")?.tab;
      if (!tab) return;
      event.preventDefault();
      menuTab = tab;
      menu.querySelector("#lumi-pin-menu-unload").disabled = tab.hasAttribute("pending");
      menu.openPopupAtScreen(event.screenX, event.screenY, true, event);
    });

    // Перетаскивание в любой момент: закреп — на новое место; вкладку из полосы — в закрепы, на место под курсором.
    // Синяя черта показывает место. Ловим над закрепами и пустым местом под ними.
    const line = h("div", "", { id: "lumi-pin-dropline", hidden: true });
    rail.append(line);
    let dragged = null;
    const zone = event => event.target.closest?.("#lumi-pins, .lumi-spacer");
    const droppable = dt => {
      const tab = dragged ?? dt.mozGetDataAt(TAB_DROP_TYPE, 0);
      return gBrowser.tabs.includes(tab) && (tab === dragged || !isPin(tab)) ? tab : null; // только вкладки этого окна
    };
    // место по серединам плиток там, где они стоят без сдвига (иначе расступившиеся плитки меняли бы результат)
    const slot = y => {
      const list = [...box.children];
      const i = list.findIndex(el => {
        const r = el.getBoundingClientRect();
        return y < r.top - shiftOf(el, "y") + r.height / 2;
      });
      return i < 0 ? list.length : i;
    };
    box.addEventListener("dragstart", event => {
      dragged = event.target.closest?.(".lumi-pin")?.tab ?? null;
      if (!dragged) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", pinURL(dragged));
      // перетаскиваемая плитка гаснет, когда снимок для курсора уже сделан
      setTimeout(() => dragged && pinButtons.get(dragged)?.setAttribute("dragging", ""));
    });
    rail.addEventListener("dragover", event => {
      if (!zone(event) || !droppable(event.dataTransfer)) {
        line.hidden = true;
        if (box.hasAttribute("lumi-gap") && !gapPending) releaseGap(false);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const list = [...box.children], i = slot(event.clientY);
      const r = (list[i] ?? list.at(-1))?.getBoundingClientRect();
      const y = !r ? box.getBoundingClientRect().top : list[i] ? r.top - 4 : r.bottom + 3; // середина зазора 7px
      line.style.top = `${y - rail.getBoundingClientRect().top}px`;
      line.hidden = false;
      line.toggleAttribute("quiet", !calm()); // с расступанием черта не нужна — она остаётся только при «уменьшить анимацию»
      if (calm()) return;
      clearTimeout(gapTimer);
      box.setAttribute("lumi-gap", "");
      gap(list, "y", (list[0]?.offsetHeight || 34) + 7, dragged ? list.indexOf(pinButtons.get(dragged)) : -1, i);
    });
    rail.addEventListener("dragleave", event => {
      if (rail.contains(event.relatedTarget)) return;
      line.hidden = true;
      if (!gapPending) releaseGap(false); // ушли с закрепов — щель плавно закрывается
    });
    rail.addEventListener("drop", event => {
      const tab = !line.hidden && droppable(event.dataTransfer);
      line.hidden = true;
      if (!tab) return releaseGap(false);
      event.preventDefault();
      const to = slot(event.clientY), from = pinTabs().indexOf(tab);
      gapPending = box.hasAttribute("lumi-gap"); // щель держится, пока рейка не пересоберётся (render)
      if (gapPending) setTimeout(() => gapPending && releaseGap(false), 500); // порядок не изменился — пересборки не будет
      if (from < 0 && !pinTab(tab)) return releaseGap(false);
      movePin(tab, from >= 0 && from < to ? to - 1 : to);
    });
    // Вкладку из полосы — на кнопку пространства: переезжает туда, пространство открывается (как «Переместить в пространство» в меню вкладки Zen)
    const wsOf = event => {
      const btn = event.target.closest?.("#zen-workspaces-button toolbarbutton[zen-workspace-id]");
      const tab = btn && droppable(event.dataTransfer);
      return tab && !isPin(tab) && tab.getAttribute("zen-workspace-id") != btn.getAttribute("zen-workspace-id") ? { btn, tab } : null;
    };
    const clearTargets = () => document.querySelectorAll("[lumi-drop-target]").forEach(b => b.removeAttribute("lumi-drop-target"));
    rail.addEventListener("dragover", event => {
      const hit = wsOf(event);
      clearTargets();
      if (!hit) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      hit.btn.setAttribute("lumi-drop-target", "");
    });
    rail.addEventListener("dragleave", event => rail.contains(event.relatedTarget) || clearTargets());
    rail.addEventListener("drop", async event => {
      const hit = wsOf(event);
      clearTargets();
      if (!hit) return;
      event.preventDefault();
      const id = hit.btn.getAttribute("zen-workspace-id");
      gZenWorkspaces.moveTabToWorkspace(hit.tab, id);
      gZenWorkspaces.lastSelectedWorkspaceTabs[id] = hit.tab; // в пространстве выбрана именно она
      await gZenWorkspaces.changeWorkspace(gZenWorkspaces.getWorkspaceFromId(id));
    });
    box.addEventListener("dragend", () => {
      clearTargets();
      dragged = null;
      line.hidden = true;
      if (!gapPending) releaseGap(false);
      else [...box.children].forEach(el => el.removeAttribute("dragging"));
    });
  }

  // Плитка закрепа: серая — выгружен, с рамкой — открыт (окошком или во вкладке). Клик — открыть окошком / спрятать.
  function pinButton(tab) {
    let btn = pinButtons.get(tab);
    if (!btn) {
      // div, а не button: кнопки Firefox не перетаскиваются
      btn = h("div", "lumi-pin", { tabIndex: 0, draggable: true, tab });
      btn.setAttribute("role", "button");
      btn.append(h("img", "", { alt: "" }));
      btn.addEventListener("click", () => (shown?.pin === tab ? hidePin(true) : showPin(tab)));
      btn.addEventListener("auxclick", event => event.button == 1 && openPinAsTab(tab));
      btn.addEventListener("keydown", event => {
        if (event.key != "Enter" && event.key != " ") return;
        event.preventDefault();
        btn.click();
      });
      pinButtons.set(tab, btn);
    }
    labeled(btn, tab.label);
    if (window.lumiHover?.enabled() ?? true) btn.removeAttribute("title"); // вместо подсказки — карточка (lumi-hovercard.uc.js)
    const img = btn.firstChild, icon = pinIcon(tab);
    if (img.getAttribute("src") != icon) img.src = icon;
    btn.toggleAttribute("pending", tab.hasAttribute("pending"));
    btn.toggleAttribute("selected", tab.selected);
    return btn;
  }

  // ---------- Таймер выгрузки: настройка Unload Countdown Time (luminoctis.tabs.unload-minutes, 0 — никогда) ----------
  // Своего таймера у Zen 1.23 нет. Раз в минуту родной выгрузкой Firefox выгружаем вкладки и закрепы, которые не выбраны,
  // не на виду (под мини-окном закрепа и в Split view у них zenModeActive), ничего не играют и неактивны дольше N минут.
  // Вкладку с открытым диалогом или вопросом «покинуть страницу?» discardBrowser сам не трогает.
  function unloadIdleTabs() {
    const minutes = Services.prefs.getIntPref("luminoctis.tabs.unload-minutes", 0);
    if (!minutes) return;
    for (const tab of gBrowser.tabs) {
      if (tab.selected || tab.hasAttribute("pending") || tab.soundPlaying || tab.pictureinpicture || tab._sharingState?.webRTC ||
        tab.linkedBrowser?.zenModeActive || tab.matches("[zen-empty-tab], [zen-glance-tab], [glance-id]")) continue;
      if (Date.now() - tab.lastAccessed > minutes * 60000) gBrowser.discardBrowser(tab);
    }
  }

  // ---------- Плееры: зеркало карточек родных медиа-контролов Zen ----------
  // Zen сам решает, когда карточка видна (играет, вкладка не спит и не выбрана);
  // мы показываем те же карточки плитками и жмём их же кнопки.
  function initPlayers(box) {
    const bar = document.getElementById("zen-media-controls-toolbar");
    let last = "";
    const sync = () => {
      const cards = [...bar.querySelectorAll(".zen-media-card:not([hidden])")];
      const data = cards.map(card => ({
        card,
        title: card.querySelector(".zen-media-title").textContent,
        artist: card.querySelector(".zen-media-artist").textContent,
        icon: card.querySelector(".zen-media-focus-button").style.listStyleImage,
        playing: card.classList.contains("playing"),
        noPrev: card.querySelector(".zen-media-previoustrack-button").disabled,
        noNext: card.querySelector(".zen-media-nexttrack-button").disabled,
      }));
      // Zen каждую секунду обновляет время и прогресс — перерисовываем только при смене данных.
      const key = JSON.stringify(data.map(({ card, ...rest }) => rest));
      if (key == last) return;
      last = key;
      box.replaceChildren(...data.map(playerTile));
      // порядок для лесенки анимации: открываются сверху вниз, закрываются снизу вверх
      [...box.children].forEach((tile, i, all) => {
        tile.style.setProperty("--i", i);
        tile.style.setProperty("--ri", all.length - 1 - i);
      });
    };
    new MutationObserver(sync).observe(bar, {
      subtree: true, childList: true, characterData: true, attributes: true,
    });
    sync();

    // Открыты, пока мышь над плитками или самими карточками; закрываем с запасом 250 мс,
    // чтобы случайный выход за край карточки не схлопывал всё.
    let closeTimer;
    box.addEventListener("mouseenter", () => {
      clearTimeout(closeTimer);
      box.setAttribute("open", "");
    });
    box.addEventListener("mouseleave", () => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => box.removeAttribute("open"), 250);
    });
  }

  function playerTile({ card, title, artist, icon, playing, noPrev, noNext }) {
    const press = sel => () => card.querySelector(sel).doCommand();
    const button = (cls, label, sel, disabled = false) => {
      const b = labeled(h("button", cls, { disabled }), label);
      b.addEventListener("click", press(sel));
      return b;
    };

    const tile = h("div", "lumi-player" + (playing ? " playing" : ""));
    const cover = button("lumi-player-cover", title || "Плеер", ".zen-media-focus-button");
    cover.style.backgroundImage = icon;
    const text = h("div", "lumi-player-text");
    text.append(
      h("span", "lumi-player-title", { textContent: title }),
      h("span", "lumi-player-artist", { textContent: artist })
    );
    tile.append(
      cover,
      text,
      button("lumi-player-prev", "Предыдущий трек", ".zen-media-previoustrack-button", noPrev),
      button("lumi-player-play", playing ? "Пауза" : "Играть", ".zen-media-playpause-button"),
      button("lumi-player-next", "Следующий трек", ".zen-media-nexttrack-button", noNext)
    );
    return tile;
  }
})();
