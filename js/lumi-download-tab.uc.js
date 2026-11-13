// ==UserScript==
// @name           Luminoctis: вкладка под загрузку
// @description    Вкладка, открытая только ради загрузки (ссылка на .exe из Discord и т.п.), закрывается сама, как в Chrome; повторной загрузки при выгрузке и перезапуске нет.
// ==/UserScript==

// Причина: вкладку, открытую снаружи (openLinkIn/addTab(url)), Firefox держит на about:blank с userTypedValue = адрес файла и пустой историей — страница так и не
// появилась, загрузку принял менеджер загрузок. Выгрузка вкладки (gBrowser.discardBrowser: таймер, «Выгрузить», старт мода) превращает userTypedValue в «загрузить
// при выборе» — выбрали вкладку, и файл скачивается заново. Вкладки, открытые из страницы (target=_blank), Firefox закрывает сам.
// Здесь: загрузка документа записывается (адрес → browsingContext), а когда появляется загрузка с таким адресом (в т.ч. после редиректа), вкладку этого контекста,
// если она пустая (about:blank без истории), закрываем без следа в «закрытых». Вкладка со своей страницей (ссылка-загрузка внутри сайта) под условие не подпадает.
// Закреп так не закрываем, только забываем адрес (иначе выгрузка + выбор скачали бы файл заново). Связь «загрузка → вкладка» нужна потому, что у загрузки вкладки нет, а адрес после редиректа другой.
(() => {
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const norm = u => { try { return Services.io.newURI(u).specIgnoringRef; } catch { return null; } };
  const prevOf = new WeakMap(); // вкладка → с какой на неё перешли
  const navs = new Map(); // адрес загрузки документа (и каждого редиректа) → id контекста просмотра; последние 30
  const watch = { observe(ch) {
    try {
      const li = ch.QueryInterface(Ci.nsIChannel).loadInfo;
      if (li?.externalContentPolicyType != Ci.nsIContentPolicy.TYPE_DOCUMENT) return;
      const k = ch.URI.specIgnoringRef;
      navs.delete(k); navs.set(k, li.browsingContextID);
      if (navs.size > 30) navs.delete(navs.keys().next().value);
    } catch {}
  } };

  // Вкладка под эту загрузку: загрузку начал документ её контекста; она пустая (about:blank без истории) и не выгружена
  function tabFor(d) {
    const b = BrowsingContext.get(navs.get(norm(d.source.url)))?.embedderElement, t = b && gBrowser.getTabForBrowser(b);
    return t && !t.closing && !t.hasAttribute("pending") && b.currentURI?.spec == "about:blank" && !b.canGoBack ? t : null;
  }
  function finish(tab) {
    if (tab.pinned) { tab.linkedBrowser.userTypedValue = null; return; } // закреп жив, но заново качать при выгрузке не должен
    if (tab.selected) {
      const p = prevOf.get(tab), home = window.lumiHome;
      if (p && !p.closing && !home?.isHome(p) && gBrowser.visibleTabs.includes(p) && !p.hasAttribute("zen-empty-tab")) gBrowser.selectedTab = p;
      else if (home) home.open();
    }
    gBrowser.removeTab(tab, { skipSessionStore: true });
  }

  UC_API.Windows.waitWindowLoading(window).then(async () => {
    Services.obs.addObserver(watch, "http-on-modify-request");
    window.addEventListener("unload", () => Services.obs.removeObserver(watch, "http-on-modify-request"), { once: true });
    gBrowser.tabContainer.addEventListener("TabSelect", e => prevOf.set(e.target, e.detail?.previousTab));
    const list = await Downloads.getList(Downloads.ALL);
    let live = false; // addView пересказывает прежние загрузки — на них вкладки не закрываем
    const view = { onDownloadAdded(d) { const t = live && tabFor(d); if (t) finish(t); } };
    await list.addView(view);
    live = true;
    window.addEventListener("unload", () => list.removeView(view), { once: true });
  });
})();
