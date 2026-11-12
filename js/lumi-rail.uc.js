// ==UserScript==
// @name           Luminoctis: боковая рейка
// @description    Рейка 48px слева: иконка Luminoctis, рабочие пространства Zen, закрепы (родные Essentials Zen) с мини-окном, плееры; меню по правой кнопке, панель настроек мода и таймер выгрузки вкладок.
// ==/UserScript==

(() => {
  const { t } = ChromeUtils.importESModule(Components.stack.filename.replace(/[^/]*$/, "lumi-i18n.sys.mjs"));
  const { jsUrl, pageUrl } = ChromeUtils.importESModule(Components.stack.filename.replace(/[^/]*$/, "lumi-paths.sys.mjs"));
  // палитра — сразу, до отрисовки окна (скрипт идёт на DOMContentLoaded): без вспышки цветов Tokyo Night
  ChromeUtils.importESModule(jsUrl("lumi-palette.sys.mjs")).watch(document, { glass: true });
  const keys = ChromeUtils.importESModule(jsUrl("lumi-keys.sys.mjs"));
  const h = (tag, className, props = {}) =>
    Object.assign(document.createElement(tag), { className }, props);
  const labeled = (el, text, title = text) => {
    if (el.getAttribute("aria-label") != text) el.setAttribute("aria-label", text);
    if (title == null) el.hasAttribute("title") && el.removeAttribute("title");
    else if (el.getAttribute("title") != title) el.setAttribute("title", title);
    return el;
  };

  // Настройки Luminoctis — панель справа от рейки (концепт, вид «edit»). Внутри — страница настроек
  // (Luminoctis\settings → профиль chrome\resources\luminoctis, адрес даёт fx-autoconfig), раздел — в её адресе (#sidebar).
  // Панель грузится при первом открытии, потом только прячется: раздел и прокрутка остаются как были.
  const SETTINGS_URL = pageUrl("settings/settings.html");
  let settings;
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches; // «уменьшить анимацию» — общая для рейки и полосы
  // Заглушка вместо пустой/дефолтной/битой иконки сайта (вкладка ещё грузится, у сайта нет значка): аккуратная точка цвета текста.
  // В img ставится прозрачный пиксель, а саму точку рисует CSS (img[lumi-dot], chrome.css раздел 6) — context-fill у data:-картинок не работает.
  const DOT = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  function setIcon(img, icon) {
    const src = icon && !icon.includes("defaultFavicon") && img.lumiBad !== icon ? icon : DOT;
    if (img.getAttribute("src") != src) img.setAttribute("src", src);
    img.toggleAttribute("lumi-dot", src == DOT);
    if (!img.lumiErr) img.addEventListener("error", img.lumiErr = () => { // битая картинка — тоже точка (и больше её не пробуем)
      if (img.getAttribute("src") == DOT) return;
      img.lumiBad = img.getAttribute("src");
      setIcon(img, null);
    });
  }
  window.luminoctis = {
    // tab — раздел (sidebar, look, tabs…)
    openSettings(tab) {
      const hash = tab && "#" + tab;
      if (!settings) {
        settings = h("div", "", { id: "lumi-settings" });
        settings.setAttribute("role", "dialog");
        settings.setAttribute("aria-label", t("Настройки Luminoctis"));
        tab ||= Services.prefs.getStringPref("luminoctis.settings.tab", "look"); // последний открытый раздел (пишет страница)
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
    openTime, // LumiTime целиком — вкладкой (панель: settings|stats|journal|day)
    pins: pinTabs, addPin, pinTab, movePin, unpin, showPin, hidePin, migratePins, unloadIdleTabs, isKept, setKept,
    unload, unloadShortcut, gap, clearGap, shiftOf, calm, setIcon, DOT, pinStartURL, debugBadge,
    get dragPin() { return dragPin; }, // закреп, который сейчас тащат с рейки (полоса вкладок принимает его бросок)
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
    rail.setAttribute("aria-label", t("Боковая панель Luminoctis"));

    // Клик — Luminoctis Home: открыть / вернуться (js/lumi-home.uc.js; подсветку lumi-home-open ставит он же)
    const incognito = PrivateBrowsingUtils.isWindowPrivate(window); // в приватном окне вместо «L» — маска (chrome.css, «Инкогнито»)
    const logo = labeled(h("button", "", { id: "lumi-logo", textContent: incognito ? "" : "L" }), incognito ? t("Главная Luminoctis — инкогнито") : t("Главная Luminoctis"));
    if (incognito) logo.append(h("span", "lumi-incognito"));
    logo.addEventListener("click", () => window.lumiHome?.toggle());

    const pins = h("div", "", { id: "lumi-pins" });
    const players = h("div", "", { id: "lumi-players" });
    rail.append(
      logo,
      initTimer(), // плитка таймера LumiTime — сразу под «L»; кнопку Библиотеки initWorkspaces вставит между ними (logo.after)
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
    initTaskDot(logo);
    initRailMenu(rail);
    watchUnloadTimer();
    gZenWorkspaces.promiseInitialized
      .then(() => SessionStore.promiseAllWindowsRestored)
      .then(migratePins)
      .then(loadKept)
      .catch(console.error);
  });

  // ---------- Меню по правой кнопке на рейке ----------
  // Рейка — область перетаскивания окна; без своего меню Windows показывает системное меню окна.
  // У кнопок пространств своё родное меню Zen, у закрепов — своё (initPins).
  function initRailMenu(rail) {
    const lSettings = t("Настройки мода Luminoctis"), lNoTimer = t("Убрать таймер"), lSpaces = t("Управление пространствами"), lCustomize = t("Настроить панель инструментов");
    const menu = window.MozXULElement.parseXULToFragment(`
      <menupopup id="lumi-rail-menu">
        <menuitem id="lumi-rail-menu-settings" label="${lSettings}"/>
        <menuseparator id="lumi-rail-menu-timer-sep" hidden="true"/>
        <menuitem id="lumi-rail-menu-timer" label="${lNoTimer}" hidden="true"/>
        <menuseparator/>
        <menuitem label="${lSpaces}" command="cmd_zenManageWorkspaces"/>
        <menuseparator/>
        <menuitem label="${lCustomize}" command="cmd_CustomizeToolbars"/>
      </menupopup>`).firstElementChild;
    document.getElementById("mainPopupSet").append(menu);
    menu.querySelector("#lumi-rail-menu-settings").addEventListener("command", () => luminoctis.openSettings());
    menu.querySelector("#lumi-rail-menu-timer").addEventListener("command", () => Services.prefs.setBoolPref(TIME_RAIL, false));
    rail.addEventListener("contextmenu", event => {
      if (event.target.closest("#zen-workspaces-button toolbarbutton, .lumi-pin")) return;
      event.preventDefault();
      // «Убрать таймер» — только у самой плитки
      menu.querySelector("#lumi-rail-menu-timer").hidden = menu.querySelector("#lumi-rail-menu-timer-sep").hidden = !event.target.closest("#lumi-time-tile");
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
    const manage = labeled(h("button", "", { id: "lumi-spaces-button" }), t("Библиотека Zen: пространства"));
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
  function pinStartURL(tab) { return tab._zenPinnedInitialState?.entry?.url || pinURL(tab); } // адрес, с которым закреп создан / на который сбрасывается (не текущий)
  // значок закрепа: родной; у ещё не загруженного — из кэша значков Places (асинхронно, потом закрепы перерисовываются); иначе null — setIcon нарисует точку
  const placesIcons = new Map(); // адрес -> data:-адрес значка или null
  const pinIcon = tab => {
    const icon = gBrowser.getIcon(tab);
    if (icon) return icon;
    const url = pinURL(tab);
    if (!placesIcons.has(url)) {
      placesIcons.set(url, null);
      try {
        PlacesUtils.favicons.getFaviconForPage(Services.io.newURI(url)).then(
          f => f && (placesIcons.set(url, f.dataURI.spec), window.dispatchEvent(new Event("lumi-pin-icons"))), () => {});
      } catch {}
    }
    return placesIcons.get(url);
  };
  let dragPin = null; // закреп в системном drag (initPins) — для get dragPin выше
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
  // Выгрузить вкладку полосы или закреп. С выбранной вкладки уходим на Home (иначе родная выгрузка выбрала бы соседнюю).
  function unload(tab) {
    if (isPin(tab)) unloadPin(tab);
    else if (!tab.hasAttribute("pending")) {
      if (tab.selected) window.lumiHome?.open();
      gBrowser.explicitUnloadTabs([tab]);
    }
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
  let frame, backdrop, grip, keepBehind;
  const pinButtons = new WeakMap(); // вкладка закрепа -> плитка в рейке
  const panelOf = tab => tab?.linkedBrowser?.closest(".browserSidebarContainer");

  // Стекло (chrome.css §14): панель ПРЕЖНЕЙ вкладки под окошком вырезается по рамке (маска [lumi-hole], как дырка под панелью настроек) — сквозь прозрачную
  // рамку и прозрачный сайт закрепа виден фон окна, а не резкий сайт под ним. Вырез — в координатах самой панели; translate анимации появления вычитаем.
  let holed;
  const clearHole = () => {
    if (!holed) return;
    holed.removeAttribute("lumi-hole");
    for (const v of ["x", "y", "w", "h"]) holed.style.removeProperty(`--lumi-hole-${v}`);
    holed = null;
  };
  function updateHole() {
    const behind = shown?.mini && !leaving && !frame.hidden && document.documentElement.hasAttribute("lumi-glass") ? panelOf(shown.prev) : null;
    if (holed && holed !== behind) clearHole();
    if (!behind) return;
    const r = frame.getBoundingClientRect(), p = behind.getBoundingClientRect(), [tx = 0, ty = 0] = getComputedStyle(frame).translate.split(" ").map(n => parseFloat(n) || 0);
    holed = behind;
    behind.setAttribute("lumi-hole", "");
    for (const [v, n] of [["x", r.left - tx - p.left], ["y", r.top - ty - p.top], ["w", r.width], ["h", r.height]]) behind.style.setProperty(`--lumi-hole-${v}`, n + "px");
  }

  // Закрытие окошка — обратное появлению (chrome.css, lumi-pin-in/lumi-fade-in): then() вызывается после анимации и всё снимает.
  // При «уменьшить анимацию» — сразу. smooth только у действий пользователя; программные hidePin() (выгрузка, открепление) — мгновенные.
  let leaving = false;
  async function leave(then, withPanel = true) {
    if (!shown?.mini || leaving || calm()) return then();
    leaving = true;
    clearHole(); // прежняя вкладка снова видна под гаснущей рамкой — без скачка в конце
    const cur = shown;
    const fade = (el, ms, easing, shift) => el.animate(
      [{ opacity: 1, translate: "0 0" }, { opacity: 0, translate: shift ? "-12px 0" : "0 0" }], { duration: ms, easing, fill: "forwards" });
    const anims = [fade(backdrop, 200, "cubic-bezier(0.4, 0, 1, 1)"), fade(frame, 200, "cubic-bezier(0.4, 0, 1, 1)", true), fade(grip, 200, "cubic-bezier(0.4, 0, 1, 1)", true)];
    if (withPanel && panelOf(cur.pin)) anims.push(fade(panelOf(cur.pin), 200, "cubic-bezier(0.4, 0, 1, 1)", true));
    await Promise.allSettled(anims.map(a => a.finished));
    leaving = false;
    if (shown === cur) then(); // иначе за это время выбрали другую вкладку — release уже был
    anims.forEach(a => a.cancel());
  }

  function showPin(pin) {
    closeMini(false);
    if (leaving || (shown?.mini && shown.pin === pin)) return;
    const old = shown?.mini ? shown.pin : null; // окошко другого закрепа: прежняя вкладка под ним остаётся та же
    const prev = old ? shown.prev : gBrowser.selectedTab === pin ? gBrowser._findTabToBlurTo(pin) : gBrowser.selectedTab;
    const origin = !old && shown && !shown.mini ? shown.prev : shown?.origin; // закреп на весь экран, поверх него — окошко другого: вкладка до первого
    if (!old) release();
    shown = { pin, prev, mini: true, origin };
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
    frame.hidden = backdrop.hidden = grip.hidden = false;
    applyWidth(pin);
    updateFrame();
    updateHole();
    gBrowser.selectedBrowser.focus(); // клавиатура — сразу сайту закрепа, а не плитке рейки
  }
  // Спрятать закреп (окошком или во весь экран): снова выбрана вкладка, что была до него
  function hidePin(smooth) {
    if (smooth === true && shown?.mini) return leave(() => hidePin());
    const pin = shown?.pin ?? gBrowser.selectedTab, prev = shown?.prev;
    // куда вернуться: на вкладку, что была до закрепа, если она ещё есть, загружена и сама не закреп (иначе Zen бросил бы на
    // последний открытый, пусть и выгруженный сайт) — иначе на Home этого пространства
    const ok = t => t?.isConnected && !t.closing && t !== pin && !isPin(t) && !t.hasAttribute("pending");
    const to = [prev, shown?.origin].find(ok);
    if (to) gBrowser.selectedTab = to;
    else if (window.lumiHome) window.lumiHome.open();
    else gBrowser._findTabToBlurTo(pin) && (gBrowser.selectedTab = gBrowser._findTabToBlurTo(pin));
    release();
    gBrowser.selectedBrowser.focus();
  }
  function expandNow() {
    const { pin, prev, origin } = shown;
    release();
    shown = { pin, prev, mini: false, origin };
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
    clearHole();
    frame.hidden = backdrop.hidden = grip.hidden = true;
    tabbox().style.removeProperty("--lumi-pin-w");
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
    setIcon(frame.querySelector("img"), pinIcon(shown.pin));
    frame.querySelector(".lumi-pin-title").textContent = shown.pin.label;
    frame.setAttribute("aria-label", shown.pin.label);
  }

  // Ширина окошка каждого закрепа запоминается отдельно: pref luminoctis.pins.widths = {ключ: px}. Ключ — id вкладки Essentials (Zen хранит его между
  // запусками), запасной — первоначальный адрес закрепа. Нет записи — ширина по умолчанию (--lumi-pin-w в chrome.css).
  const WIDTHS = "luminoctis.pins.widths", MIN_W = 360;
  const tabbox = () => document.getElementById("tabbrowser-tabbox");
  const pinKey = tab => tab.id || tab._zenPinnedInitialState?.entry?.url || pinURL(tab);
  const widths = () => { try { return JSON.parse(Services.prefs.getStringPref(WIDTHS, "{}")) || {}; } catch { return {}; } };
  const maxWidth = () => Math.max(MIN_W, tabbox().getBoundingClientRect().width - 24);
  function applyWidth(pin) {
    const w = widths()[pinKey(pin)];
    if (w > 0) tabbox().style.setProperty("--lumi-pin-w", Math.min(Math.max(w, MIN_W), maxWidth()) + "px");
    else tabbox().style.removeProperty("--lumi-pin-w");
  }
  // тяжение за правый край: на время тяжения поверх всего окна прозрачный щит, иначе сайт (другой процесс) съест мышь
  function startResize(event) {
    const cur = shown?.pin;
    if (!cur || event.button) return;
    event.preventDefault();
    const box = tabbox(), shield = h("div", "", { id: "lumi-pin-shield" });
    grip.setAttribute("dragging", "");
    document.documentElement.append(shield);
    let w = frame.getBoundingClientRect().width;
    const move = e => {
      w = Math.round(Math.min(Math.max(e.clientX - box.getBoundingClientRect().left - 12, MIN_W), maxWidth()));
      box.style.setProperty("--lumi-pin-w", w + "px");
      updateHole();
    };
    const up = () => {
      shield.remove();
      grip.removeAttribute("dragging");
      shield.removeEventListener("mousemove", move);
      shield.removeEventListener("mouseup", up);
      Services.prefs.setStringPref(WIDTHS, JSON.stringify({ ...widths(), [pinKey(cur)]: w }));
    };
    shield.addEventListener("mousemove", move);
    shield.addEventListener("mouseup", up);
  }

  function initPinWindow() {
    // в #tabbrowser-tabbox: панели вкладок — его слои, иначе окошко не встало бы над затемнением
    backdrop = h("div", "", { id: "lumi-pin-backdrop", hidden: true });
    backdrop.addEventListener("click", () => hidePin(true));
    frame = h("div", "", { id: "lumi-pin-frame", hidden: true });
    frame.setAttribute("role", "dialog");
    const full = labeled(h("button", "lumi-pin-full"), t("Открыть во вкладке"));
    full.addEventListener("click", expandPin);
    const head = h("div", "lumi-pin-head");
    head.append(h("img", "", { alt: "" }), h("span", "lumi-pin-title"), full);
    frame.append(head);
    grip = h("div", "", { id: "lumi-pin-grip", hidden: true });
    grip.addEventListener("mousedown", startResize);
    tabbox().append(backdrop, frame, grip);
    // вырез за рамкой (updateHole): размер рамки/области, смена режима окна
    const ro = new ResizeObserver(updateHole);
    ro.observe(frame);
    ro.observe(tabbox());
    new MutationObserver(updateHole).observe(document.documentElement, { attributeFilter: ["lumi-glass"] });

    // выбрали другую вкладку (полоса, Ctrl+Tab, смена пространства…) — окошка больше нет
    window.addEventListener("TabSelect", () => {
      if (!gBrowser.selectedTab.hasAttribute("lumi-time-full")) closeMini(false); // скрытая вкладка LumiTime целиком — мини-окно остаётся поверх неё
      // Glance (Alt+клик) поверх закрепа выбирает свою вкладку, но окошко остаётся: закреп — её родитель
      if (shown && gBrowser.selectedTab !== shown.pin && gZenGlanceManager.getTabOrGlanceParent(gBrowser.selectedTab) !== shown.pin) release();
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
      // закреп ушёл из-под окошка (или вкладка стала закрепом): последняя использованная ЗАГРУЖЕННАЯ вкладка, иначе Home (не выгруженный сайт)
      const to = gBrowser.visibleTabs.filter(t => !isPin(t) && !t.hasAttribute("zen-empty-tab") && !t.hasAttribute("lumi-home") && !t.hasAttribute("lumi-time-full") && !t.hasAttribute("pending") && gZenWorkspaces._shouldChangeToTab(t))
        .reduce((best, t) => (!best || t.lastAccessed > best.lastAccessed ? t : best), null);
      if (to) gBrowser.selectedTab = to;
      else if (window.lumiHome) window.lumiHome.open();
      else if (gZenWorkspaces._emptyTab) gBrowser.selectedTab = gZenWorkspaces._emptyTab;
    };
    for (const type of ["TabSelect", "TabAddedToEssentials"]) window.addEventListener(type, () => setTimeout(leavePin));
    // Вопрос «покинуть страницу?» (beforeunload) при закрытии окна/вкладки открывается внутри вкладки закрепа. Firefox сам выбирает такую вкладку,
    // но leavePin сразу уводил выбор с закрепа, и вопрос оставался в невидимой панели (окно «зависало»). Показываем закреп окошком раньше Firefox (capture).
    window.addEventListener("DOMWillOpenModalDialog", event => {
      const tab = event.isTrusted && event.detail?.inPermitUnload && gBrowser.getTabForBrowser(event.originalTarget);
      if (tab && isPin(tab) && !tab.selected && !tab.closing) showPin(tab);
    }, true);
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
      "TabAddedToEssentials", "TabRemovedFromEssentials", "TabBrowserDiscarded", "lumi-pin-icons"]) {
      window.addEventListener(type, schedule);
    }
    window.addEventListener("TabClose", () => setTimeout(schedule)); // закрытая ещё в списке во время своего TabClose
    Services.prefs.addObserver("luminoctis.tabs.hover-memory", schedule); // подсказка-title зависит от настройки карточки
    window.addEventListener("unload", () => Services.prefs.removeObserver("luminoctis.tabs.hover-memory", schedule), { once: true });
    render();

    // ПКМ — меню закрепа; шорткат (Shift+ПКМ) — сразу выгрузить
    const lUnload = t("Выгрузить"), lKeep = t("Всегда загружен"), lQuiet = t("Уведомления"), lUnpin = t("Открепить");
    const menu = window.MozXULElement.parseXULToFragment(`
      <menupopup id="lumi-pin-menu">
        <menuitem id="lumi-pin-menu-unload" label="${lUnload}"/>
        <menuitem id="lumi-pin-menu-keep" type="checkbox" label="${lKeep}"/>
        <menuitem id="lumi-pin-menu-quiet" type="checkbox" label="${lQuiet}"/>
        <menuitem id="lumi-pin-menu-unpin" label="${lUnpin}"/>
      </menupopup>`).firstElementChild;
    document.getElementById("mainPopupSet").append(menu);
    let menuTab;
    menu.querySelector("#lumi-pin-menu-unload").addEventListener("command", () => unloadPin(menuTab));
    menu.querySelector("#lumi-pin-menu-unpin").addEventListener("command", () => unpin(menuTab));
    menu.querySelector("#lumi-pin-menu-keep").addEventListener("command", () => setKept(menuTab, !isKept(menuTab)));
    menu.querySelector("#lumi-pin-menu-quiet").addEventListener("command", () => setQuiet(menuTab, !isQuiet(menuTab)));
    unloadShortcut(box, event => event.target.closest?.(".lumi-pin")?.tab);
    box.addEventListener("contextmenu", event => {
      const tab = event.target.closest(".lumi-pin")?.tab;
      if (!tab) return;
      event.preventDefault();
      menuTab = tab;
      menu.querySelector("#lumi-pin-menu-unload").disabled = tab.hasAttribute("pending");
      const keep = menu.querySelector("#lumi-pin-menu-keep"); // checked="false" XUL тоже рисует галочкой — снимать атрибут
      isKept(tab) ? keep.setAttribute("checked", "true") : keep.removeAttribute("checked");
      const notify = menu.querySelector("#lumi-pin-menu-quiet");
      isQuiet(tab) ? notify.removeAttribute("checked") : notify.setAttribute("checked", "true");
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
      // только свой тип: адрес (text/plain, text/uri-list) браузер принял бы за ссылку и загрузил закреп в сайт или Home под курсором.
      // Полоса вкладок читает dragPin и открывает новую вкладку с начальным адресом закрепа
      dragPin = dragged;
      event.dataTransfer.setData("application/x-lumi-pin", "1");
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
      dragged = dragPin = null;
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
      // второй значок — маленький значок сайта из Glance (Alt+клик по ссылке), пока он открыт; клик по нему снова показывает Glance
      const glance = h("img", "lumi-pin-glance", { alt: "" });
      btn.append(h("img", "", { alt: "" }), glance, h("span", "lumi-pin-badge"));
      btn.addEventListener("click", event => {
        if (event.target === glance && tab.glanceTab) return void (event.stopPropagation(), gBrowser.selectedTab = tab.glanceTab);
        shown?.pin === tab ? hidePin(true) : showPin(tab);
      });
      btn.addEventListener("auxclick", event => event.button == 1 && openPinAsTab(tab));
      btn.addEventListener("animationend", event => event.animationName == "lumi-pin-ping" && btn.removeAttribute("lumi-ping"));
      btn.addEventListener("keydown", event => {
        if (event.key != "Enter" && event.key != " ") return;
        event.preventDefault();
        btn.click();
      });
      pinButtons.set(tab, btn);
    }
    labeled(btn, tab.label, window.lumiHover?.enabled() ?? true ? null : tab.label); // вместо подсказки — карточка (lumi-hovercard.uc.js)
    setIcon(btn.firstChild, pinIcon(tab));
    btn.toggleAttribute("pending", tab.hasAttribute("pending"));
    const g = tab.glanceTab;
    btn.toggleAttribute("glance", !!g);
    if (g) setIcon(btn.children[1], gBrowser.getIcon(g));
    btn.toggleAttribute("selected", tab.selected || !!g?.selected);
    applyKeep(tab);
    updateBadge(btn, tab);
    return btn;
  }

  // ---------- Значок непрочитанного: число из заголовка вкладки, как в Opera GX ----------
  // Первое число в круглых скобках — «(3) Discord», «Inbox (12) — почта». Нет числа, но заголовок сменился, пока закреп не был выбран
  // (родной атрибут titlechanged, Firefox снимает его при выборе) — точка. Закреп открыт — значка нет. Рост числа / появление точки — пульсация.
  const badgeSeen = new WeakMap(); // вкладка -> { n, dot } на прошлой отрисовке
  const badgeDebug = new WeakMap(); // окно отладки (lumi-debug.uc.js): вкладка -> { n, dot } вместо настоящих; null в debugBadge снимает
  function debugBadge(tab, spec) {
    spec ? badgeDebug.set(tab, spec) : badgeDebug.delete(tab);
    const btn = pinButtons.get(tab);
    if (btn) updateBadge(btn, tab);
  }
  // Плеер (YouTube Music и т.п.) меняет заголовок на каждый трек — точку не ставим, пока вкладка играет и ещё 2 минуты после звука.
  const SOUND_GRACE = 2 * 60000, soundAt = new WeakMap(), soundTitle = new WeakSet();
  window.addEventListener("TabAttrModified", event => event.detail?.changed?.includes("soundplaying") && soundAt.set(event.target, Date.now()));
  const recentSound = tab => {
    if (tab.hasAttribute("soundplaying")) soundAt.set(tab, Date.now());
    return Date.now() - (soundAt.get(tab) ?? 0) < SOUND_GRACE;
  };
  function updateBadge(btn, tab) {
    const fake = badgeDebug.get(tab), quiet = !fake && isQuiet(tab);
    let n = fake ? fake.n | 0 : quiet ? 0 : +(/\((\d+)\)/.exec(tab.label || "")?.[1] ?? 0), dot = false;
    if (fake) dot = !n && !!fake.dot;
    else if (!quiet && !n && tab.hasAttribute("titlechanged")) {
      if (recentSound(tab)) soundTitle.add(tab); // заголовок сменился под звук — это не сообщение, даже когда грейс кончится
      dot = !soundTitle.has(tab);
    } else if (!tab.hasAttribute("titlechanged")) soundTitle.delete(tab);
    const open = btn.hasAttribute("selected"), prev = badgeSeen.get(tab);
    badgeSeen.set(tab, { n, dot });
    btn.lastChild.textContent = !open && n ? (n > 99 ? "99+" : n) : "";
    btn.toggleAttribute("lumi-unread", !open && (n > 0 || dot));
    btn.toggleAttribute("lumi-dot", !open && dot);
    if (prev && !open && !calm() && (n > prev.n || (dot && !prev.dot))) {
      btn.removeAttribute("lumi-ping");
      void btn.offsetWidth; // перезапуск анимации
      btn.setAttribute("lumi-ping", "");
    }
  }

  // ---------- «Всегда загружен» (пункт меню закрепа): грузится при запуске и не выгружается сам ----------
  // Список ключей закрепов (pinKey) в pref luminoctis.pins.keep. Защита: атрибут undiscardable (его уважает выгрузчик Firefox при нехватке памяти,
  // TabUnloader) + обёртка discardBrowser (наш таймер и любой код, зовущий discardBrowser без force). Вручную («Выгрузить», Shift+ПКМ) — выгружается.
  const KEEP = "luminoctis.pins.keep";
  const kept = () => { try { return JSON.parse(Services.prefs.getStringPref(KEEP, "[]")) || []; } catch { return []; } };
  // id Essentials Zen присваивает не сразу — у только что созданного закрепа ключ пока адрес, поэтому подходит любой из двух
  const keysOf = tab => [tab.id, tab._zenPinnedInitialState?.entry?.url || pinURL(tab)].filter(Boolean);
  function isKept(tab) { return isPin(tab) && keysOf(tab).some(k => kept().includes(k)); } // function: window.luminoctis выше берёт её до этой строки
  const applyKeep = tab => tab.toggleAttribute("undiscardable", isKept(tab));
  function setKept(tab, on) {
    const own = keysOf(tab), list = kept().filter(k => !own.includes(k));
    if (on) list.push(own[0]);
    Services.prefs.setStringPref(KEEP, JSON.stringify(list));
    applyKeep(tab);
    if (on && tab.hasAttribute("pending")) gBrowser.reloadTab(tab); // загрузить сразу, в фоне
  }
  // «Уведомления» (пункт меню закрепа): выключенные — в pref luminoctis.pins.quiet (те же ключи), у них нет ни числа, ни точки
  const QUIET = "luminoctis.pins.quiet";
  const quietList = () => { try { return JSON.parse(Services.prefs.getStringPref(QUIET, "[]")) || []; } catch { return []; } };
  function isQuiet(tab) { return isPin(tab) && keysOf(tab).some(k => quietList().includes(k)); }
  function setQuiet(tab, quiet) {
    const own = keysOf(tab), list = quietList().filter(k => !own.includes(k));
    if (quiet) list.push(own[0]);
    Services.prefs.setStringPref(QUIET, JSON.stringify(list));
    const btn = pinButtons.get(tab);
    if (btn) updateBadge(btn, tab);
  }
  const discardOrig = gBrowser.discardBrowser;
  gBrowser.discardBrowser = function (tab, force) {
    return !force && isKept(tab) ? false : discardOrig.call(this, tab, force);
  };
  // При запуске браузера (не в окне, открытом позже) выгруженные «всегда загруженные» грузим по очереди в фоне
  async function loadKept() {
    if (Date.now() - Services.startup.getStartupInfo().process > 5 * 60000) return;
    // Home на старте выгружает всё загруженное (settle, lumi-home.uc.js) и потом снимает pref startup-saved — ждём этого, иначе она выгрузила бы и наши
    for (let i = 0; i < 60 && (i == 0 || Services.prefs.prefHasUserValue("luminoctis.home.startup-saved")); i++) await new Promise(r => setTimeout(r, 500));
    for (const tab of pinTabs().filter(t => isKept(t) && t.hasAttribute("pending"))) {
      gBrowser.reloadTab(tab);
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // ---------- Таймер выгрузки: настройка Unload Countdown Time (luminoctis.tabs.unload-minutes, 0 — никогда) ----------
  // Своего таймера у Zen 1.23 нет. Раз в минуту родной выгрузкой Firefox выгружаем вкладки и закрепы, которые не выбраны,
  // не на виду (под мини-окном закрепа и в Split view у них zenModeActive), ничего не играют и неактивны дольше N минут.
  // Вкладку с открытым диалогом или вопросом «покинуть страницу?» discardBrowser сам не трогает.
  // Интервал крутится, только пока настройка > 0 (при 0 — «никогда» — зря не будим окно раз в минуту)
  function watchUnloadTimer() {
    const PREF = "luminoctis.tabs.unload-minutes";
    let timer;
    const sync = () => {
      const on = Services.prefs.getIntPref(PREF, 0) > 0;
      if (on && !timer) timer = setInterval(unloadIdleTabs, 60000);
      else if (!on && timer) timer = clearInterval(timer);
    };
    Services.prefs.addObserver(PREF, sync);
    window.addEventListener("unload", () => { Services.prefs.removeObserver(PREF, sync); clearInterval(timer); }, { once: true });
    sync();
  }
  function unloadIdleTabs() {
    const minutes = Services.prefs.getIntPref("luminoctis.tabs.unload-minutes", 0);
    if (!minutes) return;
    // gBrowser.tabs у Zen — только вкладки текущего пространства; нужны все (в DOM остальные есть)
    for (const tab of document.querySelectorAll("tab.tabbrowser-tab")) { // только вкладки браузера, не <tab> других tabbox
      if (tab.selected || tab.hasAttribute("pending") || tab.soundPlaying || tab.pictureinpicture || tab._sharingState?.webRTC ||
        tab.linkedBrowser?.zenModeActive || tab.matches("[zen-empty-tab], [zen-glance-tab], [glance-id]")) continue;
      if (Date.now() - tab.lastAccessed > minutes * 60000) gBrowser.discardBrowser(tab);
    }
  }

  // ---------- Точка задач на «L»: жёлтая — есть невыполненная задача со сроком сегодня, красная — срок прошёл (красная главнее) ----------
  // Листы LumiNotes читаем только на чтение (home/notes-md.mjs + home/store.js; readLayout не зовём — он создаёт файлы). Пересчёт: старт, смена папки данных,
  // уведомления об изменении листов, полночь. Частые события склеиваются (не чаще раза в 1,5 с).
  function initTaskDot(logo) {
    const notes = ChromeUtils.importESModule(pageUrl("home/notes-md.mjs"));
    const store = ChromeUtils.importESModule(pageUrl("home/store.js"));
    const pad = n => String(n).padStart(2, "0");
    const dayNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    let state = "", queued = null, running = false, again = false;
    const scan = (items, today) => items.reduce((acc, it) => {
      const own = it.check === false && it.due ? (it.due < today ? "late" : it.due == today ? "today" : "") : "";
      const kids = scan(it.children ?? [], today);
      return acc == "late" || own == "late" || kids == "late" ? "late" : acc || own || kids;
    }, "");
    async function recalc() {
      if (running) return void (again = true);
      running = true;
      try {
        const today = dayNow();
        let next = "";
        for (const file of (await store.list(notes.DIR)).filter(f => /\.md$/i.test(f))) {
          const kind = scan(await notes.readSheet(file.slice(0, -3)), today);
          if (kind == "late") { next = kind; break; }
          next ||= kind;
        }
        if (next != state) {
          state = next;
          if (next) logo.setAttribute("lumi-tasks", next);
          else logo.removeAttribute("lumi-tasks");
        }
      } catch (err) { console.error("LumiNotes: точка задач:", err); } // l10n-skip
      running = false;
      if (again) { again = false; schedule(); }
    }
    function schedule() {
      queued ??= setTimeout(() => { queued = null; recalc(); }, 1500);
    }
    const observer = { observe: schedule };
    for (const topic of ["lumi-notes-saved", notes.CHANGED]) Services.obs.addObserver(observer, topic);
    Services.prefs.addObserver(store.PREF, schedule);
    window.addEventListener("unload", () => {
      for (const topic of ["lumi-notes-saved", notes.CHANGED]) Services.obs.removeObserver(observer, topic);
      Services.prefs.removeObserver(store.PREF, schedule);
    }, { once: true });
    const midnight = () => {
      const d = new Date();
      setTimeout(() => { recalc(); midnight(); }, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 2) - d);
    };
    midnight();
    recalc();
  }

  // ---------- Таймер LumiTime на рейке: плитка с кольцом + мини-окно ----------
  // Движок (js/lumi-time.sys.mjs) один на всё приложение, время считает из отметок, так что плитка только рисует: перерисовка по событиям
  // движка и тик раз в секунду, пока цикл идёт и плитка видна. Клик — мини-окно (та же страница home/time.html?mini=1 в iframe,
  // рамка и затемнение — как у мини-окна закрепа, chrome.css §6). Весь LumiTime («Открыть целиком» и кнопки панелей внизу мини-окна) — как Home:
  // скрытая вкладка home/time.html с атрибутом lumi-time-full (не в полосе вкладок, рейке и сессии; Home и полоса её пропускают).
  // Мини-окно остаётся поверх неё (затемнение не ловит клики); уход на любую другую вкладку закрывает и вкладку, и мини-окно.
  const TIME_RAIL = "luminoctis.time.rail"; // плитка на рейке (по умолчанию вкл; «Убрать таймер» выключает)
  const TIME_URL = pageUrl("home/time.html");
  let mini = null; // { backdrop, frame, iframe, closing }
  let miniTile = null; // плитка таймера: openTime по ней открывает мини-окно
  const TIME_FULL = "lumi-time-full";
  const isFull = tab => !!tab?.hasAttribute(TIME_FULL);
  let full = null, opening = false; // скрытая вкладка LumiTime целиком; opening — идёт её создание (метка ставится на TabOpen, до полосы вкладок)
  window.addEventListener("TabOpen", event => {
    if (!opening) return;
    full = event.target;
    full.setAttribute(TIME_FULL, "");
    full.lumiPrev = gBrowser.selectedTab; // вкладка, с которой пришли (на TabOpen она ещё выбрана): по ней Home понимает, «откуда» (lumi-home.uc.js, base)
  }, true);
  function closeFull() {
    const tab = full;
    full = null;
    if (tab && !tab.closing && isFull(tab)) {
      if (gBrowser.selectedTab === tab) { // иначе Zen сам выберет соседнюю: возвращаем, откуда пришли, а если её нет — на Home этого пространства
        const prev = tab.lumiPrev;
        if (prev && !prev.closing && gBrowser.tabs.includes(prev)) gBrowser.selectedTab = prev; else window.lumiHome?.open();
      }
      gBrowser.removeTab(tab, { animate: false, skipSessionStore: true }); // без следа (ушла на сайт — lumi-home.uc.js снял метку — не трогаем) в «недавно закрытых»
    }
  }
  // выбрали не LumiTime-целиком — вкладка и мини-окно уходят вместе; выбрали её — мини-окно перенастраивается
  window.addEventListener("TabSelect", event => {
    if (isFull(event.target)) return syncMini();
    closeMini(false);
    // не сразу: если уходим потому, что саму вкладку закрывают (Ctrl+W), TabSelect приходит раньше TabClose — повторное закрытие ломает removeTab
    setTimeout(() => { if (!isFull(gBrowser.selectedTab)) closeFull(); });
  });
  window.addEventListener("TabClose", event => { if (event.target === full) { full = null; closeMini(false); } }); // Ctrl+W на ней
  window.addEventListener("unload", () => { try { closeFull(); } catch {} }, { once: true }); // в сессию на выходе не попадает (best effort)
  // сессия успела записать её до unload — после перезапуска не возвращаем обычной вкладкой
  window.addEventListener("SSTabRestoring", event => {
    const tab = event.target;
    if (SessionStore.getCustomTabValue(tab, TIME_FULL) == "1") setTimeout(() => !tab.closing && gBrowser.removeTab(tab, { animate: false, skipSessionStore: true }));
  });
  // панель: settings|stats|journal|day (по умолчанию — Статистика). Вкладка есть — выбираем её и переключаем панель страницей (без пересоздания)
  function openTime(panel, section) { // section — якорь внутри панели (напр. "daily" в настройках)
    if (full && !full.closing && isFull(full)) {
      gBrowser.selectedTab = full;
      if (!mini && miniTile) openMini(miniTile); // большой режим = мини-окно + панель справа от него
      const page = full.linkedBrowser.contentWindow?.lumiTime;
      if (panel && page) page.openPanel(panel, section);
      else if (panel) full.linkedBrowser.loadURI(Services.io.newURI(`${TIME_URL}?full=1&panel=${panel}${section ? `&section=${section}` : ""}`), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); // страница ещё грузится
      return;
    }
    opening = true;
    try { gBrowser.selectedTab = gBrowser.addTrustedTab(TIME_URL + "?full=1" + (panel ? `&panel=${panel}` : "") + (section ? `&section=${section}` : ""), { skipAnimation: true }); } finally { opening = false; }
    SessionStore.setCustomTabValue(full, TIME_FULL, "1");
    if (!mini && miniTile) openMini(miniTile);
  }
  // над своей вкладкой (chrome-страница) затемнение пропускает клики и не темнит; над сайтом подложка нужна (Firefox не размывает чужой процесс)
  function syncMini() {
    if (!mini) return;
    const sel = gBrowser.selectedTab;
    mini.backdrop.toggleAttribute("lumi-passive", isFull(sel));
    mini.frame.toggleAttribute("lumi-passive", isFull(sel));
    const fb = mini.frame.querySelector(".lumi-time-full");
    if (fb) fb.textContent = isFull(sel) ? t("Закрыть целиком") : t("Открыть целиком");
    mini.frame.querySelector("iframe")?.contentDocument?.documentElement?.toggleAttribute("lumi-passive", isFull(sel)); // столбец внутри тоже стеклом
    mini.frame.toggleAttribute("lumi-over-site", !isFull(sel) && !sel?.hasAttribute("lumi-home"));
    window.lumiSiteBlur?.track("time-mini", mini.frame); // стекло: под рамкой размытый сайт (js/lumi-site-blur.uc.js)
    if (isFull(sel)) sel.linkedBrowser.contentWindow?.lumiTime?.place?.(); // панель большого режима стыкуется к рамке
  }
  function openMini(tile) {
    if (mini) return;
    if (shown) hidePin();
    const backdrop = h("div", "", { id: "lumi-time-backdrop" }), frame = h("div", "", { id: "lumi-time-frame" });
    frame.setAttribute("role", "dialog");
    frame.setAttribute("aria-label", t("Таймер LumiTime"));
    const fullBtn = h("button", "lumi-time-full", { textContent: t("Открыть целиком") });
    fullBtn.addEventListener("click", () => (isFull(gBrowser.selectedTab) ? closeFull() : openTime())); // пока большой LumiTime открыт, кнопка его закрывает (подпись — syncMini)
    const head = h("div", "lumi-pin-head");
    head.append(h("span", "lumi-pin-title", { textContent: "LumiTime" }), fullBtn);
    // страница создаётся на каждое открытие и убирается при закрытии: пока окна нет, она не тикает
    const iframe = h("iframe", "", { src: TIME_URL + "?mini=1" });
    frame.append(head, iframe);
    backdrop.addEventListener("click", () => closeMini(true));
    const esc = event => event.key == "Escape" && closeMini(true);
    document.addEventListener("keydown", esc);
    iframe.addEventListener("load", () => iframe.contentWindow.addEventListener("keydown", esc));
    tabbox().append(backdrop, frame);
    mini = { backdrop, frame, iframe, esc, tile };
    syncMini(); // и ведёт за рамкой размытие сайта, пока она появляется
    tile.setAttribute("open", "");
    iframe.focus();
  }
  // Закрытие — обратное появлению (chrome.css lumi-pin-in/lumi-fade-in); smooth — только у действий пользователя
  async function closeMini(smooth) {
    const m = mini;
    if (!m || m.closing) return;
    const done = () => {
      if (mini !== m) return;
      document.removeEventListener("keydown", m.esc);
      m.backdrop.remove();
      m.frame.remove();
      window.lumiSiteBlur?.track("time-mini", null);
      m.tile.removeAttribute("open");
      mini = null;
      if (full) setTimeout(closeFull); // большой режим без мини-окна не существует (не сразу: см. TabSelect)
    };
    if (!smooth || calm()) return done();
    m.closing = true;
    const fade = (el, shift) => el.animate(
      [{ opacity: 1, translate: "0 0" }, { opacity: 0, translate: shift ? "-12px 0" : "0 0" }],
      { duration: 200, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
    await Promise.allSettled([fade(m.backdrop).finished, fade(m.frame, true).finished]);
    done();
  }
  function initTimer() {
    const E = ChromeUtils.importESModule(jsUrl("lumi-time.sys.mjs"));
    const svg = (tag, attrs) => Object.entries(attrs).reduce((el, [k, v]) => (el.setAttribute(k, v), el), document.createElementNS("http://www.w3.org/2000/svg", tag));
    const arc = svg("circle", { class: "lumi-time-arc", cx: 17, cy: 17, r: 14, pathLength: 100 });
    const num = h("span", "lumi-time-num"), tile = labeled(h("button", "", { id: "lumi-time-tile" }), t("Таймер LumiTime"));
    const ring = svg("svg", { viewBox: "0 0 34 34", "aria-hidden": "true" });
    ring.append(svg("circle", { class: "lumi-time-track", cx: 17, cy: 17, r: 14 }), arc);
    tile.append(ring, h("span", "lumi-time-icon"), num);
    tile.setAttribute("phase", "idle");
    miniTile = tile;
    tile.addEventListener("click", () => (mini ? closeMini(true) : openMini(tile)));

    const names = { focus: t("Фокус"), break: t("Перерыв"), "long-break": t("Длинный перерыв") };
    const update = () => {
      const st = E.data.state, idle = !E.data.loaded || st.phase == "idle";
      const paused = !idle && st.runningSince === null;
      tile.setAttribute("phase", idle ? "idle" : st.phase == "focus" ? "focus" : "break");
      tile.toggleAttribute("paused", paused);
      if (idle) return void labeled(tile, t("Таймер LumiTime"));
      const info = E.display(st, E.now()), p = info.main.replace("+", "").split(":").map(Number);
      const minutes = p.length == 3 ? p[0] * 60 + p[1] : p[0];
      num.textContent = (info.main[0] == "+" ? "+" : "") + (minutes || info.main[0] == "+" || st.timerMode == "Stopwatch" ? minutes : p.at(-1) + t("с"));
      arc.style.strokeDashoffset = String(100 * (1 - info.progress));
      labeled(tile, paused ? t("Пауза · {0} · {1}", names[st.phase], info.main) : `${names[st.phase]} · ${info.main}`);
    };
    let timer = null;
    const sync = () => {
      const on = !tile.hidden && E.data.loaded && E.data.state.phase != "idle";
      update();
      if (on && !timer) timer = setInterval(update, 1000); // без цикла и пока плитка спрятана — не тикаем
      else if (!on && timer) timer = clearInterval(timer);
    };
    const applyPref = () => {
      tile.hidden = !Services.prefs.getBoolPref(TIME_RAIL, true);
      if (tile.hidden) closeMini(false);
      sync();
    };
    const off = E.subscribe(sync);
    Services.prefs.addObserver(TIME_RAIL, applyPref);
    window.addEventListener("unload", () => { off(); clearInterval(timer); Services.prefs.removeObserver(TIME_RAIL, applyPref); }, { once: true });
    // движок поднимаем здесь (повторный init безопасен — он один на приложение): звук и уведомление «время вышло» работают без открытой страницы
    E.init().then(sync, console.error);
    applyPref();
    return tile;
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
      for (const tile of box.children) syncVolume(tile); // сайт мог сам поменять громкость — ползунок показывает актуальную
    });
    box.addEventListener("mouseleave", () => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => box.removeAttribute("open"), 250);
    });

    // Стекло (chrome.css §14): backdrop-filter не размывает сайт (чужой процесс), поэтому под РАСКРЫТОЙ карточкой сайт вырезается маской по её рамке
    // и сквозь карточку видно стекло окна. Вторая независимая дырка: [lumi-hole2] на .browserContainer панелей (дырки настроек/закрепа — на самих панелях,
    // маски вложены и пересекаются), переменные --lumi-hole-x/y/w/h/r — инлайн на нём. Одна карточка: вырез следует за рамкой каждый кадр, пока идут переходы;
    // несколько (рамка одна на всех, между карточками в полёте были бы щели): вырез только когда все раскрыты и не двигаются. У свёрнутой плитки выреза нет.
    // Режем видимые панели: выбранную (.deck-selected) и панели Split view ([zen-split]); Home не режем — у него backdrop-filter и так размывает страницу.
    let carved = [], raf = 0;
    const uncarve = keep => {
      for (const el of carved) if (!keep.includes(el)) { el.removeAttribute("lumi-hole2"); for (const v of "xywhr") el.style.removeProperty(`--lumi-hole-${v}`); }
      carved = keep;
    };
    function carve() {
      raf = 0;
      const cards = [...box.children], open = box.hasAttribute("open"), moving = cards.some(c => c.getAnimations().length);
      if (moving) raf = requestAnimationFrame(carve);
      const on = document.documentElement.hasAttribute("lumi-glass") && cards.length && (cards.length == 1 ? open || moving : open && !moving);
      const rects = on ? cards.map(c => c.getBoundingClientRect()) : [];
      const L = Math.min(...rects.map(r => r.left)), T = Math.min(...rects.map(r => r.top)), R = Math.max(...rects.map(r => r.right)), B = Math.max(...rects.map(r => r.bottom));
      const radius = on ? parseFloat(getComputedStyle(cards[0]).borderTopLeftRadius) || 0 : 0;
      const hit = on ? [...document.querySelectorAll("#tabbrowser-tabpanels > .browserSidebarContainer")]
        .filter(p => p.matches(".deck-selected, [zen-split='true']") && !window.lumiHome?.isHome(gBrowser.getTabForBrowser(p.querySelector("browser"))))
        .map(p => p.querySelector(":scope > .browserContainer")).filter(el => {
          const r = el?.getBoundingClientRect();
          return r && r.left < R && r.right > L && r.top < B && r.bottom > T;
        }) : [];
      uncarve(hit);
      window.lumiSiteBlur?.set("players", hit.length ? { left: L, top: T, right: R, bottom: B } : null); // над сайтом — размытый сайт вместо дырки (chrome.css §14)
      for (const el of hit) {
        const r = el.getBoundingClientRect();
        el.setAttribute("lumi-hole2", "");
        for (const [v, n] of [["x", L - r.left], ["y", T - r.top], ["w", R - L], ["h", B - T], ["r", radius]]) el.style.setProperty(`--lumi-hole-${v}`, n + "px");
      }
    }
    const schedule = () => { raf ||= requestAnimationFrame(carve); };
    new MutationObserver(schedule).observe(box, { attributeFilter: ["open"], childList: true });
    new MutationObserver(schedule).observe(document.documentElement, { attributeFilter: ["lumi-glass"] });
    new ResizeObserver(schedule).observe(document.getElementById("tabbrowser-tabpanels"));
    window.addEventListener("TabSelect", schedule);
  }

  // Громкость самих медиа на сайте (свойство volume у <video>/<audio>) — через JSWindowActor LumiMedia (js/lumi-media-child.sys.mjs), во всех фреймах вкладки.
  try {
    ChromeUtils.registerWindowActor("LumiMedia", { child: { esModuleURI: jsUrl("lumi-media-child.sys.mjs") }, allFrames: true, safeForUntrustedWebProcess: true });
  } catch {} // уже зарегистрирован другим окном
  const askMedia = (tab, name, data) => Promise.all((tab.linkedBrowser?.browsingContext?.getAllBrowsingContextsInSubtree() ?? [])
    .map(async bc => { try { return await bc.currentWindowGlobal?.getActor("LumiMedia").sendQuery(name, data); } catch { return null; } })); // служебные страницы актора не имеют
  // Вкладка карточки: карточка Zen её не выдаёт (список карточек закрытый) — ищем вкладку с активным медиа и теми же названием и исполнителем
  function cardTab(title, artist) {
    for (const tab of gBrowser.tabs) {
      const mc = tab.linkedBrowser?.browsingContext?.mediaController;
      if (!mc?.isActive) continue;
      const md = mc.getMetadata();
      if (md.title == title && (md.artist || "") == artist) return tab;
    }
    return gBrowser.tabs.find(tab => tab.label == title && !tab.hasAttribute("pending")) ?? null;
  }
  async function syncVolume(tile) {
    const slider = tile.querySelector(".lumi-player-vol");
    if (!tile.tab || !slider || slider.matches(":active")) return;
    const found = (await askMedia(tile.tab, "get")).filter(Boolean);
    const volume = (found.find(m => m.playing) ?? found[0])?.volume;
    slider.disabled = volume == null;
    if (volume != null && !slider.matches(":active")) slider.value = volume;
  }

  function playerTile({ card, title, artist, icon, playing, noPrev, noNext }) {
    const press = sel => () => card.querySelector(sel).doCommand();
    const button = (cls, label, sel, disabled = false) => {
      const b = labeled(h("button", cls, { disabled }), label);
      b.addEventListener("click", press(sel));
      return b;
    };

    const tile = h("div", "lumi-player" + (playing ? " playing" : ""));
    // клик по самой плитке (обложка, название) открывает вкладку с этим медиа; пространство переключается, как у карточки Zen (switchTabIfNeeded)
    // закреп (Essentials) — сразу на всё окно, как «Открыть во вкладке» (openPinAsTab: showPin+expandNow без кадра окошка)
    const open = () => isPin(tile.tab) ? openPinAsTab(tile.tab) : tile.tab ? gZenWorkspaces.switchTabIfNeeded(tile.tab) : press(".zen-media-focus-button")();
    const cover = labeled(h("button", "lumi-player-cover"), title || t("Плеер"));
    cover.addEventListener("click", open);
    if (icon && icon != "none") cover.style.backgroundImage = icon;
    else cover.setAttribute("lumi-dot", ""); // нет обложки — точка
    const text = h("div", "lumi-player-text");
    text.append(
      h("span", "lumi-player-title", { textContent: title }),
      h("span", "lumi-player-artist", { textContent: artist })
    );
    // ползунок громкости сайта: ряд под кнопками, виден в раскрытой карточке
    tile.tab = cardTab(title, artist);
    const vol = h("input", "lumi-player-vol", { type: "range", min: 0, max: 1, step: 0.01, value: 1, disabled: true });
    labeled(vol, t("Громкость сайта"));
    vol.addEventListener("input", () => tile.tab && askMedia(tile.tab, "set", +vol.value));
    tile.addEventListener("click", event => event.target.closest("button, input") || open());
    tile.append(
      cover,
      text,
      button("lumi-player-prev", t("Предыдущий трек"), ".zen-media-previoustrack-button", noPrev),
      button("lumi-player-play", playing ? t("Пауза") : t("Играть"), ".zen-media-playpause-button"),
      button("lumi-player-next", t("Следующий трек"), ".zen-media-nexttrack-button", noNext),
      vol
    );
    syncVolume(tile);
    return tile;
  }
})();
