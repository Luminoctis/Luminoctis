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
(() => {
  const URL = "chrome://userchrome/content/luminoctis/home/home.html";
  const KEY = "lumi-home";
  let prev = null; // вкладка, с которой пришли на Home

  const isHome = tab => !!tab?.hasAttribute(KEY);
  const urlOf = tab => tab.linkedBrowser?.currentURI?.spec;
  // Home этого окна: помеченная, иначе восстановленная сессией (значение или адрес); лишние закрываем
  function find() {
    // gBrowser.tabs у Zen — только активное пространство; allStoredTabs — все пространства
    const found = (gZenWorkspaces.allStoredTabs ?? gBrowser.tabs).filter(t => !t.closing &&
      (isHome(t) || SessionStore.getCustomTabValue(t, KEY) == "1" || urlOf(t) == URL));
    const [home, ...extra] = found.sort((a, b) => isHome(b) - isHome(a));
    for (const t of extra) gBrowser.removeTab(t, { animate: false, skipSessionStore: true });
    if (home && !isHome(home)) mark(home);
    return home ?? null;
  }
  function mark(tab) {
    tab.setAttribute(KEY, "");
    SessionStore.setCustomTabValue(tab, KEY, "1");
    gBrowser._tabAttrModified(tab, [KEY]); // полоса вкладок пересобирается и убирает её
  }
  function create() {
    // не inBackground: иначе Zen показывает тост «New background tab opened!» (open() всё равно сразу её выбирает)
    const tab = gBrowser.addTrustedTab(URL, { inBackground: false, skipAnimation: true });
    mark(tab);
    return tab;
  }

  function open() {
    if (!isHome(gBrowser.selectedTab)) prev = gBrowser.selectedTab; // новая Home выбирается ещё до метки — TabSelect её не узнает
    const home = find() ?? create();
    const ws = gZenWorkspaces.activeWorkspace;
    if (ws && home.getAttribute("zen-workspace-id") != ws) gZenWorkspaces.moveTabToWorkspace(home, ws);
    gBrowser.selectedTab = home;
    lit(true);
    return home;
  }
  // назад: прежняя вкладка, если она ещё есть в этом пространстве; иначе — последняя использованная обычная
  function back() {
    const ok = t => t && !t.closing && gBrowser.visibleTabs.includes(t) && !isHome(t);
    const to = ok(prev) ? prev
      : gBrowser.visibleTabs.filter(t => ok(t) && !t.hasAttribute("zen-essential"))
        .reduce((best, t) => (!best || t.lastAccessed > best.lastAccessed ? t : best), null) ?? gZenWorkspaces._emptyTab;
    if (to) gBrowser.selectedTab = to;
  }
  // подсветка «L» и обои под всем окном ([lumi-home-wall] на корне — chrome.css раздел 15); кадр в #lumi-home-wall рисует сама Home (home/wallpaper.js)
  function lit(on) {
    document.getElementById("lumi-logo")?.toggleAttribute("lumi-home-open", on);
    document.documentElement.toggleAttribute("lumi-home-wall", on || underPin());
  }
  // выбран закреп-окошко (lumi-rail.uc.js), а под ним видна Home — обои под интерфейсом остаются (как «насквозь» в lumi-home-live.uc.js)
  const panelOf = t => t && document.getElementById(t.linkedPanel);
  // в момент TabSelect класса окошка ещё нет — закреп (zen-essential) узнаём сразу, иначе на кадр мигает рабочий стол; rAF-повтор в TabSelect уточнит
  const underPin = () => !!(gBrowser.selectedTab?.hasAttribute("zen-essential") || panelOf(gBrowser.selectedTab)?.classList.contains("lumi-pin-window")) &&
    !!panelOf(gBrowser.tabs.find(isHome))?.classList.contains("deck-selected");
  const toggle = () => (isHome(gBrowser.selectedTab) ? back() : open());
  window.lumiHome = { toggle, open, back, isHome, find, URL };

  const discard = gBrowser.discardBrowser;
  gBrowser.discardBrowser = function (tab, force) {
    if (!isHome(tab)) return discard.call(this, tab, force);
    if (tab.selected || tab.closing) return false;
    this.removeTab(tab, { animate: false, skipSessionStore: true });
    return true;
  };

  UC_API.Windows.waitWindowLoading(window).then(() => {
    // Home никогда не «замена» закрытой/выгруженной вкладки (Zen выбирает её сам) — туда попадают только по «L»
    const shouldChange = gZenWorkspaces._shouldChangeToTab;
    gZenWorkspaces._shouldChangeToTab = function (tab) {
      return shouldChange.call(this, tab) && !isHome(tab);
    };
    const HTML = "http://www.w3.org/1999/xhtml", wall = document.createElementNS(HTML, "div");
    wall.id = "lumi-home-wall";
    wall.append(document.createElementNS(HTML, "canvas"));
    const bg = document.getElementById("zen-browser-background"); // под рейкой и интерфейсом, над фоном окна
    if (bg) bg.after(wall); else document.getElementById("browser")?.prepend(wall);
    const sync = () => lit(isHome(gBrowser.selectedTab));
    window.addEventListener("TabSelect", event => {
      if (isHome(event.target) && !isHome(event.detail?.previousTab)) prev = event.detail?.previousTab ?? null;
      sync();
      requestAnimationFrame(sync); // класс окошка закрепа ставится после TabSelect
    });
    SessionStore.promiseAllWindowsRestored.then(() => { find(); sync(); }).catch(console.error);
  });
})();
