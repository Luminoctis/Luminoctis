// ==UserScript==
// @name           Luminoctis: Home
// @description    Вкладка Luminoctis Home (home/home.html): одна на окно, не видна в полосе вкладок и рейке; «L» на рейке — открыть / вернуться на прежнюю вкладку.
// ==/UserScript==

// Home — обычная вкладка (не Essentials: те в рейке, у них свой лимит и своя логика мини-окна), помеченная атрибутом lumi-home
// и значением SessionStore (lumi-home) — после перезапуска узнаётся, вторая не появляется. Пространства: при открытии
// вкладка переезжает в активное пространство (gZenWorkspaces.moveTabToWorkspace).
// Выгрузка: chrome://-страница живёт в процессе браузера, а родной gBrowser.discardBrowser выгружает только вкладки сайтов
// (для неё всегда false). Поэтому discardBrowser для Home закрывает её без следа в истории закрытых, а «L» создаёт заново —
// так её выгружают и таймер выгрузки мода, и «Выгрузить» Zen. Данные виджеты хранят в папке (home/store.js), не во вкладке.
// Не выгружать вообще: флажок luminoctis.home.never-unload (и режим окна «Обои»).
// Старт: каждое обычное окно (первое с восстановленной сессией, Ctrl+N) выбирает Home, а все остальные вкладки выгружены (startup() ниже).
(() => {
  const { jsUrl, pageUrl } = ChromeUtils.importESModule(Components.stack.filename.replace(/[^/]*$/, "lumi-paths.sys.mjs"));
  const { windowMode } = ChromeUtils.importESModule(jsUrl("lumi-palette.sys.mjs"));
  const URL = pageUrl("home/home.html");
  const KEY = "lumi-home";
  let prev = null; // вкладка, с которой пришли на Home

  const isEmpty = tab => !!tab?.hasAttribute("zen-empty-tab"); // серая пустая вкладка Zen: выбрана в пространстве без вкладок
  const isHome = tab => !!tab?.hasAttribute(KEY);
  // скрытая вкладка LumiTime целиком (lumi-rail.uc.js, openTime) — как Home, не в полосе; «откуда» пришли — её lumiPrev
  const isFull = tab => !!tab?.hasAttribute("lumi-time-full");
  const base = tab => (isFull(tab) ? tab.lumiPrev : tab);
  const urlOf = tab => tab.linkedBrowser?.currentURI?.spec;
  const fresh = new WeakSet(); // только что созданные create(): адрес ещё не дошёл до вкладки и сессии
  const entryUrl = tab => { try { const s = JSON.parse(SessionStore.getTabState(tab)); return s.entries?.[s.index - 1]?.url; } catch { return null; } };
  // Home из сессии без своей страницы (about:blank в процессе сайтов — так было после обновления 0.5.0): она пустая навсегда, заменяем новой
  const broken = tab => !fresh.has(tab) && urlOf(tab) != URL && entryUrl(tab) != URL;
  // Home этого окна: помеченная, иначе восстановленная сессией (значение или адрес); лишние и пустые закрываем
  function find() {
    // gBrowser.tabs у Zen — только активное пространство; allStoredTabs — все пространства
    const found = (gZenWorkspaces.allStoredTabs ?? gBrowser.tabs).filter(t => !t.closing &&
      (isHome(t) || SessionStore.getCustomTabValue(t, KEY) == "1" || urlOf(t) == URL));
    const ok = found.filter(t => !broken(t));
    for (const t of found) if (!ok.includes(t)) gBrowser.removeTab(t, { animate: false, skipSessionStore: true });
    const [home, ...extra] = ok.sort((a, b) => isHome(b) - isHome(a));
    for (const t of extra) gBrowser.removeTab(t, { animate: false, skipSessionStore: true });
    if (home && !isHome(home)) mark(home);
    return home ?? null;
  }
  function mark(tab) {
    tab.setAttribute(KEY, "");
    SessionStore.setCustomTabValue(tab, KEY, "1");
    gBrowser._tabAttrModified(tab, [KEY]); // полоса вкладок пересобирается и убирает её
  }
  function create(background = false) {
    // не inBackground: иначе Zen показывает тост «New background tab opened!» (open() всё равно сразу её выбирает)
    const tab = gBrowser.addTrustedTab(URL, { inBackground: background, skipAnimation: true });
    fresh.add(tab);
    mark(tab);
    return tab;
  }
  // режим окна «Обои» (luminoctis.look.window): обои Home — под интерфейсом на всех вкладках; кадр рисует страница Home, поэтому она должна жить
  // (в фоне): не выгружаем её и поднимаем при старте / включении режима
  const wallMode = () => windowMode(window) == "wallpaper";
  const ensure = () => { if (wallMode() && !find()) create(true); };

  function open() {
    const from = base(gBrowser.selectedTab);
    if (from && !isHome(from) && !isEmpty(from)) prev = from; // новая Home выбирается ещё до метки — TabSelect её не узнает
    const home = find() ?? create();
    const ws = gZenWorkspaces.activeWorkspace;
    if (ws && home.getAttribute("zen-workspace-id") != ws) gZenWorkspaces.moveTabToWorkspace(home, ws);
    gBrowser.selectedTab = home;
    lit(true);
    window.lumiHomeLive?.refresh(); // новая Home на TabSelect ещё без метки — окно «насквозь» включаем сразу, не через кадр
    return home;
  }
  // назад: прежняя вкладка, если она ещё есть в этом пространстве; иначе — последняя использованная обычная
  function back() {
    const ok = t => t && !t.closing && gBrowser.visibleTabs.includes(t) && !isHome(t) && !isEmpty(t);
    const to = ok(prev) ? prev
      : gBrowser.visibleTabs.filter(t => ok(t) && !t.hasAttribute("zen-essential"))
        .reduce((best, t) => (!best || t.lastAccessed > best.lastAccessed ? t : best), null);
    if (to) gBrowser.selectedTab = to; // вернуться некуда (пространство пусто) — остаёмся на Home, а не на серой заглушке
  }
  // подсветка «L» и обои под всем окном ([lumi-home-wall] на корне — chrome.css раздел 15); кадр в #lumi-home-wall рисует сама Home (home/wallpaper.js)
  function lit(on, from) {
    document.getElementById("lumi-logo")?.toggleAttribute("lumi-home-open", on);
    document.documentElement.toggleAttribute("lumi-home-wall", on || underPin(from) || wallMode());
  }
  // выбран закреп-окошко (lumi-rail.uc.js), а под ним видна Home — обои под интерфейсом остаются (как «насквозь» в lumi-home-live.uc.js)
  const panelOf = t => t && document.getElementById(t.linkedPanel);
  // в момент TabSelect класса окошка ещё нет — закреп (zen-essential) узнаём сразу, иначе на кадр мигает рабочий стол; rAF-повтор в TabSelect уточнит
  // from — вкладка, с которой только что ушли (TabSelect): панель Home в этот момент ещё без deck-selected (рейка вернёт его в микрозадаче) — без подсказки обои мигнули бы
  const underPin = from => !!(gBrowser.selectedTab?.hasAttribute("zen-essential") || panelOf(gBrowser.selectedTab)?.classList.contains("lumi-pin-window")) &&
    (isHome(from) || !!panelOf(gBrowser.tabs.find(isHome))?.classList.contains("deck-selected"));
  const neverUnload = () => wallMode() || Services.prefs.getBoolPref("luminoctis.home.never-unload", false);
  const toggle = () => (isHome(gBrowser.selectedTab) ? back() : open());
  window.lumiHome = { toggle, open, back, isHome, find, URL, settle: () => settle() }; // settle — старт (для проверок)

  // «Обычная страница новой вкладки» (zen.urlbar.replace-newtab выключен): Ctrl+T и «+» без адреса ведут на Home, а не создают вкладку.
  // Включён — родной плавающий поиск Zen. Вызовы с адресом (ссылки, закладки) и Ctrl+T из самой Home не трогаем.
  const openTab = BrowserCommands.openTab;
  BrowserCommands.openTab = function (opts = {}) {
    if (opts.url || Services.prefs.getBoolPref("zen.urlbar.replace-newtab", true)) return openTab.call(this, opts);
    if (!isHome(gBrowser.selectedTab)) open();
  };

  // Home — «витрина», а не страница сайта: в адресной строке пусто и подсказка, как на новой вкладке (адрес из списка начальных страниц Firefox),
  // а загрузка «в текущую вкладку» из интерфейса (Enter в адресной строке, закладка) идёт в новую — иначе сайт открылся бы поверх Home и вкладка осталась бы скрытой.
  if (typeof gInitialPages != "undefined" && !gInitialPages.includes(URL)) gInitialPages.push(URL);
  for (const name of ["openTrustedLinkIn", "openWebLinkIn", "openLinkIn"]) {
    const orig = window[name];
    if (typeof orig == "function") window[name] = function (url, where, ...rest) {
      const fromHome = where == "current" && isHome(gBrowser.selectedTab);
      if (fromHome) gURLBar.userTypedValue = null; // набранное не должно остаться в адресной строке Home
      return orig.call(this, url, fromHome ? "tab" : where, ...rest);
    };
  }

  // ---------- Старт: всегда Home ----------
  // Стартовое окно: обычное (не приватное, не всплывающее), без вкладки/ссылки в аргументах (перетащенная вкладка, ссылка из другой программы — не трогаем).
  // Zen сам выбирает при старте пустую вкладку или (continue-where-left-off) прошлую — она бы загрузилась — и открывает над ней поиск (open-on-startup).
  // Пока он выбирает, обе настройки временно выключены (старые значения лежат в pref luminoctis.home.startup-saved, возвращает окно, которое их выключило); когда Zen закончил — выбираем Home
  // и выгружаем всё, что успело загрузиться (вкладки сессии уже pending: browser.sessionstore.restore_on_demand).
  let armed = false; // пустое пространство → Home включается после старта (settle сам выбирает Home)
  const arg = window.arguments?.[0];
  const startsOnHome = !PrivateBrowsingUtils.isWindowPrivate(window) && window.toolbar.visible &&
    (!arg || (typeof arg == "string" && (typeof isInitialPage != "function" || isInitialPage(arg.split("|")[0]))));
  function settle() {
    open();
    for (const t of gZenWorkspaces.allStoredTabs) {
      if (!t.selected && !t.closing && !t.hasAttribute("pending") && !t.soundPlaying && !t.matches("[zen-empty-tab], [zen-glance-tab], [glance-id]")) {
        gBrowser.discardBrowser(t, true);
      }
    }
  }
  if (startsOnHome) {
    const ZEN = ["zen.workspaces.continue-where-left-off", "zen.urlbar.open-on-startup"], SAVED = "luminoctis.home.startup-saved", pr = Services.prefs;
    const restore = () => {
      for (const [n, had, v] of JSON.parse(pr.getStringPref(SAVED, "[]"))) had ? pr.setBoolPref(n, v) : pr.clearUserPref(n);
      pr.clearUserPref(SAVED);
    };
    // остаток прошлого запуска (сбой до restore) — вернуть; настройки уже временно выключены другим стартующим окном — не трогаем
    if (pr.prefHasUserValue(SAVED) && [...Services.wm.getEnumerator("navigator:browser")].length < 2) restore();
    const owner = !pr.prefHasUserValue(SAVED);
    if (owner) {
      pr.setStringPref(SAVED, JSON.stringify(ZEN.map(n => [n, pr.prefHasUserValue(n), pr.getBoolPref(n, false)])));
      for (const n of ZEN) pr.setBoolPref(n, false);
    }
    Promise.race([gZenWorkspaces.promiseInitialized, new Promise(r => setTimeout(r, 20000))]).then(() => UC_API.Windows.waitWindowLoading(window)).then(settle).then(() => { armed = true; })
      .catch(console.error).finally(() => { if (owner) restore(); });
  }

  const discard = gBrowser.discardBrowser;
  gBrowser.discardBrowser = function (tab, force) {
    if (!isHome(tab)) return discard.call(this, tab, force);
    if (tab.selected || tab.closing || neverUnload()) return false;
    this.removeTab(tab, { animate: false, skipSessionStore: true });
    return true;
  };

  UC_API.Windows.waitWindowLoading(window).then(() => {
    // Home никогда не «замена» закрытой/выгруженной вкладки (Zen выбирает её сам) — туда попадают только по «L»
    const shouldChange = gZenWorkspaces._shouldChangeToTab;
    gZenWorkspaces._shouldChangeToTab = function (tab) {
      return shouldChange.call(this, tab) && !isHome(tab) && !isFull(tab);
    };
    // Ctrl+Tab не листает Home (она вызывается только «L»)
    const tl = Object.getOwnPropertyDescriptor(ctrlTab, "tabList");
    if (tl?.get && tl.configurable) Object.defineProperty(ctrlTab, "tabList", { configurable: true, get() { return tl.get.call(this).filter(t => !isHome(t) && !isFull(t)); } });
    const HTML = "http://www.w3.org/1999/xhtml", wall = document.createElementNS(HTML, "div");
    wall.id = "lumi-home-wall";
    wall.append(document.createElementNS(HTML, "canvas"));
    const bg = document.getElementById("zen-browser-background"); // под рейкой и интерфейсом, над фоном окна
    if (bg) bg.after(wall); else document.getElementById("browser")?.prepend(wall);
    const sync = from => lit(isHome(gBrowser.selectedTab), from);
    window.addEventListener("TabSelect", event => {
      const was = base(event.detail?.previousTab);
      if (isHome(event.target) && !isHome(was) && !isEmpty(was)) prev = was ?? null;
      sync(event.detail?.previousTab);
      requestAnimationFrame(() => sync()); // класс окошка закрепа ставится после TabSelect
    });
    // Пустое пространство (переключились в него или закрыли последнюю вкладку): Zen выбирает серую пустую вкладку — вместо неё Home.
    // Отложено: пока Zen заканчивает переключение / закрытие, выбранная вкладка и активное пространство ещё не устоялись.
    if (!PrivateBrowsingUtils.isWindowPrivate(window) && window.toolbar.visible) {
      let timer;
      window.addEventListener("TabSelect", () => {
        clearTimeout(timer);
        timer = setTimeout(() => { if (armed && isEmpty(gBrowser.selectedTab)) open(); }, 80);
      });
    }
    // Home прошлой сессии восстанавливается позже старта (уже создана новая) — find() оставит одну, иначе старая висит в полосе как «Luminoctis Home»
    window.addEventListener("SSTabRestoring", event => { if (SessionStore.getCustomTabValue(event.target, KEY) == "1") find(); });
    // после восстановления сессии (в любой ветке старта): лишние Home убрать, в режиме «Обои» поднять; выбрана сломанная Home (about:blank из сессии) — открыть новую
    const repair = () => {
      const sel = gBrowser.selectedTab, wasBroken = (isHome(sel) || SessionStore.getCustomTabValue(sel, KEY) == "1") && broken(sel);
      find(); ensure();
      if (wasBroken) open();
      sync();
    };
    SessionStore.promiseAllWindowsRestored.then(() => { if (!startsOnHome) armed = true; repair(); }).catch(console.error);
    // вкладка Home досталась из сессии уже после этого (окна, восстановленные позже первого) — проверить и её
    window.addEventListener("SSTabRestored", event => { if (SessionStore.getCustomTabValue(event.target, KEY) == "1") setTimeout(repair, 300); });
    const onWin = () => { ensure(); sync(); };
    Services.prefs.addObserver("luminoctis.look.window", onWin);
    window.addEventListener("unload", () => Services.prefs.removeObserver("luminoctis.look.window", onWin), { once: true });
  });
})();
