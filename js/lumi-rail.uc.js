// ==UserScript==
// @name           Luminoctis: боковая рейка
// @description    Рейка 56px слева: иконка Luminoctis, рабочие пространства Zen, закрепы (родные Essentials Zen) с мини-окном, плееры; меню по правой кнопке, панель настроек мода и таймер выгрузки вкладок.
// ==/UserScript==

(() => {
  // палитра — сразу, до отрисовки окна (скрипт идёт на DOMContentLoaded): без вспышки цветов Tokyo Night
  ChromeUtils.importESModule("chrome://userscripts/content/lumi-palette.sys.mjs").watch(document);
  const keys = ChromeUtils.importESModule("chrome://userscripts/content/lumi-keys.sys.mjs");
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
  const SETTINGS_URL = "chrome://userchrome/content/luminoctis/settings.html";
  let settings;
  window.luminoctis = {
    openSettings(tab) {
      if (!settings) {
        settings = h("div", "", { id: "lumi-settings" });
        settings.setAttribute("role", "dialog");
        settings.setAttribute("aria-label", "Настройки Luminoctis");
        tab ||= Services.prefs.getStringPref("luminoctis.settings.tab", "sidebar"); // последний открытый раздел (пишет страница)
        settings.append(h("iframe", "", { src: SETTINGS_URL + "#" + tab }));
        document.getElementById("lumi-rail").before(settings); // до рейки: раскрытые плееры рисуются поверх панели
      } else {
        // полный адрес: короткий «#раздел» браузер достроил бы от адреса окна (browser.xhtml), а не страницы
        if (tab) settings.firstChild.contentWindow.location.replace(SETTINGS_URL + "#" + tab);
        settings.hidden = false;
      }
      settings.firstChild.focus(); // чтобы Esc сразу закрывал
    },
    closeSettings() {
      if (settings) settings.hidden = true;
    },
    // закрепы — для панели настроек и самопроверок (dev\check-pins.js)
    pins: pinTabs, addPin, pinTab, movePin, unpin, unloadPin, showPin, hidePin, migratePins, unloadIdleTabs,
    unload, unloadShortcut,
  };

  UC_API.Windows.waitWindowLoading(window).then(() => {
    const rail = h("nav", "", { id: "lumi-rail" });
    rail.setAttribute("aria-label", "Боковая панель Luminoctis");

    // Клик (Inter Menu) и смена картинки по ПКМ — на следующих этапах.
    const logo = labeled(h("button", "", { id: "lumi-logo", textContent: "L" }), "Luminoctis");

    const pins = h("div", "", { id: "lumi-pins" });
    const players = h("div", "", { id: "lumi-players" });
    rail.append(
      logo,
      h("div", "lumi-sep"),
      h("div", "lumi-sep"),
      h("span", "lumi-caption", { textContent: "PIN" }),
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
    if (btn?.isConnected && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
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

  function showPin(pin) {
    if (shown?.mini && shown.pin === pin) return;
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
  function hidePin() {
    const pin = shown?.pin ?? gBrowser.selectedTab, prev = shown?.prev;
    const to = prev?.isConnected && !prev.closing && prev !== pin ? prev : gBrowser._findTabToBlurTo(pin);
    if (to) gBrowser.selectedTab = to;
    release();
    gBrowser.selectedBrowser.focus();
  }
  function expandPin() {
    const { pin, prev } = shown;
    release();
    shown = { pin, prev, mini: false };
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
    backdrop.addEventListener("click", hidePin);
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
    // Ctrl+W и «Закрыть вкладку» не закрывают закреп, а прячут (Zen иначе сбросил бы его адрес и выгрузил)
    document.getElementById("mainCommandSet").addEventListener("command", event => {
      if (event.target.id != "cmd_close" || !isPin(gBrowser.selectedTab)) return;
      event.stopPropagation();
      hidePin();
    }, true);
  }

  function initPins(rail, box) {
    initPinWindow();
    let queued = false;
    const render = () => {
      queued = false;
      const wanted = pinTabs().map(pinButton);
      const now = [...box.children];
      // переставляем, только если порядок изменился: иначе сбилось бы перетаскивание
      if (wanted.length != now.length || wanted.some((el, i) => el !== now[i])) box.replaceChildren(...wanted);
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
    // Синяя черта показывает место. Ловим над закрепами, подписью «PIN» и пустым местом под ними.
    const line = h("div", "", { id: "lumi-pin-dropline", hidden: true });
    rail.append(line);
    let dragged = null;
    const zone = event => event.target.closest?.("#lumi-pins, .lumi-caption, .lumi-spacer");
    const droppable = dt => {
      const tab = dragged ?? dt.mozGetDataAt(TAB_DROP_TYPE, 0);
      return gBrowser.tabs.includes(tab) && (tab === dragged || !isPin(tab)) ? tab : null; // только вкладки этого окна
    };
    const slot = y => {
      const list = [...box.children];
      const i = list.findIndex(el => {
        const r = el.getBoundingClientRect();
        return y < r.top + r.height / 2;
      });
      return i < 0 ? list.length : i;
    };
    box.addEventListener("dragstart", event => {
      dragged = event.target.closest?.(".lumi-pin")?.tab ?? null;
      if (!dragged) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", pinURL(dragged));
    });
    rail.addEventListener("dragover", event => {
      if (!zone(event) || !droppable(event.dataTransfer)) return (line.hidden = true);
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const list = [...box.children], i = slot(event.clientY);
      const r = (list[i] ?? list.at(-1))?.getBoundingClientRect();
      const y = !r ? box.getBoundingClientRect().top : list[i] ? r.top - 4 : r.bottom + 3; // середина зазора 7px
      line.style.top = `${y - rail.getBoundingClientRect().top}px`;
      line.hidden = false;
    });
    rail.addEventListener("dragleave", event => {
      if (!rail.contains(event.relatedTarget)) line.hidden = true;
    });
    rail.addEventListener("drop", event => {
      const tab = !line.hidden && droppable(event.dataTransfer);
      line.hidden = true;
      if (!tab) return;
      event.preventDefault();
      const to = slot(event.clientY), from = pinTabs().indexOf(tab);
      if (from < 0 && !pinTab(tab)) return;
      movePin(tab, from >= 0 && from < to ? to - 1 : to);
    });
    box.addEventListener("dragend", () => {
      dragged = null;
      line.hidden = true;
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
      btn.addEventListener("click", () => (shown?.pin === tab ? hidePin() : showPin(tab)));
      btn.addEventListener("keydown", event => {
        if (event.key != "Enter" && event.key != " ") return;
        event.preventDefault();
        btn.click();
      });
      pinButtons.set(tab, btn);
    }
    labeled(btn, tab.label);
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
