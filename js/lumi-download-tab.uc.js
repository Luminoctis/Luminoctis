// ==UserScript==
// @name           Luminoctis: вкладка под загрузку
// @description    Вкладка, открытая только ради загрузки (ссылка на .exe из Discord и т.п.), закрывается сама, как в Chrome; повторной загрузки при выгрузке и перезапуске нет.
// ==/UserScript==

// Причина: вкладку, открытую снаружи (openLinkIn/addTab(url)), Firefox держит на about:blank с userTypedValue = адрес файла и пустой историей — страница так и не
// появилась, загрузку принял менеджер загрузок. Выгрузка вкладки (gBrowser.discardBrowser: таймер, «Выгрузить», старт мода) превращает userTypedValue в «загрузить
// при выборе» — выбрали вкладку, и файл скачивается заново. Вкладки, открытые из страницы (target=_blank), Firefox закрывает сам — сразу, как пришёл ответ-файл.
// Здесь: загрузка документа записывается (адрес → browsingContext), и пустую вкладку (about:blank без истории) этого контекста закрываем без следа в «закрытых»:
//  1) сразу, когда ответ — вложение (Content-Disposition: attachment): окно «Куда сохранить» ещё открыто или его отменили, а вкладка уже не нужна (внешняя ссылка при
//     «всегда спрашивать, куда сохранять» иначе висела бы до ответа в окне, а после «Отмена» — навсегда, и выгрузка + выбор скачали бы файл заново);
//  2) иначе — когда появляется загрузка с таким адресом (в т.ч. после редиректа): файл без заголовка вложения (тип, который Firefox не показывает).
// Вкладка со своей страницей (ссылка-загрузка внутри сайта) под условие не подпадает.
// Закреп так не закрываем, только забываем адрес (иначе выгрузка + выбор скачали бы файл заново). Связь «загрузка → вкладка» нужна потому, что у загрузки вкладки нет, а адрес после редиректа другой.
(() => {
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const norm = u => { try { return Services.io.newURI(u).specIgnoringRef; } catch { return null; } };
  const prevOf = new WeakMap(); // вкладка → с какой на неё перешли
  const navs = new Map(); // адрес загрузки документа (и каждого редиректа) → id контекста просмотра; последние 30

  // Пустая вкладка этого контекста: about:blank без истории, не выгружена и не закрывается
  function blankTab(id) {
    const b = BrowsingContext.get(id)?.embedderElement, t = b && gBrowser.getTabForBrowser(b);
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
  const watch = { observe(ch, topic) {
    try {
      const c = ch.QueryInterface(Ci.nsIChannel), li = c.loadInfo;
      if (li?.externalContentPolicyType != Ci.nsIContentPolicy.TYPE_DOCUMENT) return;
      if (topic == "http-on-examine-response") {
        // Вложение: закрываем чуть позже — пусть загрузку сперва примет обработчик файла (Firefox для target=_blank делает так же)
        // PDF не трогаем: Firefox может показать вложение-PDF прямо в этой вкладке (browser.download.open_pdf_attachments_inline) — такой закроется по onDownloadAdded
        if (c.contentDisposition == Ci.nsIChannel.DISPOSITION_ATTACHMENT && !/pdf/i.test(c.contentType)) { const id = li.browsingContextID; setTimeout(() => { try { const t = blankTab(id); if (t) finish(t); } catch {} }, 150); }
        return;
      }
      const k = c.URI.specIgnoringRef;
      navs.delete(k); navs.set(k, li.browsingContextID);
      if (navs.size > 30) navs.delete(navs.keys().next().value);
    } catch {}
  } };
  // Сразу, не дожидаясь загрузки окна: ссылка, с которой запустили Zen, начинает грузиться почти одновременно со скриптом
  const TOPICS = ["http-on-modify-request", "http-on-examine-response"];
  for (const t of TOPICS) Services.obs.addObserver(watch, t);
  window.addEventListener("unload", () => { for (const t of TOPICS) Services.obs.removeObserver(watch, t); }, { once: true });

  UC_API.Windows.waitWindowLoading(window).then(async () => {
    gBrowser.tabContainer.addEventListener("TabSelect", e => prevOf.set(e.target, e.detail?.previousTab));
    const list = await Downloads.getList(Downloads.ALL);
    let live = false; // addView пересказывает прежние загрузки — на них вкладки не закрываем
    const view = { onDownloadAdded(d) { const t = live && blankTab(navs.get(norm(d.source.url))); if (t) finish(t); } };
    await list.addView(view);
    live = true;
    window.addEventListener("unload", () => list.removeView(view), { once: true });
  });
})();
