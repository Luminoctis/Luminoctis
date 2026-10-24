// ==UserScript==
// @name           Luminoctis: Home
// @description    Вкладка Luminoctis Home (home/home.html): одна на окно, не видна в полосе вкладок и рейке; «L» на рейке или клавиша (luminoctis.keys.inter) — открыть / вернуться на прежнюю вкладку.
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
  const keys = ChromeUtils.importESModule("chrome://userscripts/content/lumi-keys.sys.mjs");
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
    document.getElementById("lumi-logo")?.toggleAttribute("lumi-home-open", true);
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
    // Home никогда не «замена» закрытой/выгруженной вкладки (Zen выбирает её сам) — туда попадают только по «L» или клавише
    const shouldChange = gZenWorkspaces._shouldChangeToTab;
    gZenWorkspaces._shouldChangeToTab = function (tab) {
      return shouldChange.call(this, tab) && !isHome(tab);
    };
    const logo = () => document.getElementById("lumi-logo");
    const sync = () => logo()?.toggleAttribute("lumi-home-open", isHome(gBrowser.selectedTab));
    window.addEventListener("TabSelect", event => {
      if (isHome(event.target) && !isHome(event.detail?.previousTab)) prev = event.detail?.previousTab ?? null;
      sync();
    });
    // клавиша (по умолчанию Tab; читаем при каждом нажатии — смена в настройках действует сразу).
    // В полях ввода самого браузера (адресная строка, поля Home) — не перехватываем.
    window.addEventListener("keydown", event => {
      if (event.repeat || !keys.matches("inter", event)) return;
      const t = event.composedTarget ?? event.target;
      if (t.isContentEditable || t.closest?.("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      event.stopPropagation(); // и сайт нажатие не получит
      toggle();
    }, true);
    SessionStore.promiseAllWindowsRestored.then(() => { find(); sync(); }).catch(console.error);
  });
})();
