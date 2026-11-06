// ==UserScript==
// @name           Luminoctis: блок сайтов во время фокуса
// @description    LumiTime: пока идёт фокус, переход на сайты из списка (настройки LumiTime) открывает заглушку «Фокус — вернись после чч:мм» с кнопкой «Всё равно открыть».
// ==/UserScript==

// Ловим запрос документа верхнего уровня (http-on-modify-request идёт в родительском процессе для всех вкладок), отменяем его
// и грузим во вкладку home/time-block.html. Каждое окно обслуживает только свои вкладки (embedderElement в этом окне).
// Решение «блокировать?» — в движке (lumi-time.sys.mjs focusBlock): включено, список не пуст, фокус идёт (не пауза); в перерыв — только со «строгим режимом» (blockBreaks).
(() => {
  const { jsUrl, pageUrl } = ChromeUtils.importESModule(Components.stack.filename.replace(/[^/]*$/, "lumi-paths.sys.mjs"));
  const engine = ChromeUtils.importESModule(jsUrl("lumi-time.sys.mjs"));
  const BLOCK = pageUrl("home/time-block.html");
  // движок запускает рейка (lumi-rail.uc.js, E.init()); до загрузки данных focusBlock — null

  const observer = {
    observe(subject) {
      const channel = subject.QueryInterface(Ci.nsIHttpChannel);
      const info = channel.loadInfo;
      if (info?.externalContentPolicyType != Ci.nsIContentPolicy.TYPE_DOCUMENT) return;
      const browser = info.browsingContext?.top?.embedderElement;
      if (browser?.ownerDocument != document || !gBrowser.getTabForBrowser(browser)) return;
      let host = "";
      try { host = channel.URI.host; } catch { return; }
      const block = engine.focusBlock(host);
      if (!block) return;
      channel.cancel(Cr.NS_BINDING_ABORTED);
      const url = `${BLOCK}?url=${encodeURIComponent(channel.URI.spec)}&site=${encodeURIComponent(block.site)}&until=${block.until ?? ""}&phase=${block.phase}`;
      Services.tm.dispatchToMainThread(() => {
        browser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      });
    },
  };
  Services.obs.addObserver(observer, "http-on-modify-request");
  window.addEventListener("unload", () => Services.obs.removeObserver(observer, "http-on-modify-request"));
})();
