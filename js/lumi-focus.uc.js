// ==UserScript==
// @name           Luminoctis: блок сайтов (строгий режим и фокус LumiTime)
// @description    Переход на заблокированный сайт открывает заглушку. Строгий режим (списки по расписанию, без обхода) и фокус LumiTime (списки пресетов, с кнопкой «Всё равно открыть»).
// ==/UserScript==

// Ловим запрос документа верхнего уровня (http-on-modify-request идёт в родительском процессе для всех вкладок), отменяем его
// и грузим во вкладку home/time-block.html. Каждое окно обслуживает только свои вкладки (embedderElement в этом окне).
// Сначала строгий режим (lumi-strict.sys.mjs block), потом блок фокуса в движке (lumi-time.sys.mjs focusBlock): включено, список не пуст, фокус идёт (не пауза); в перерыв — только со «строгим режимом» (blockBreaks).
(() => {
  const { jsUrl, pageUrl } = ChromeUtils.importESModule(Components.stack.filename.replace(/[^/]*$/, "lumi-paths.sys.mjs"));
  const engine = ChromeUtils.importESModule(jsUrl("lumi-time.sys.mjs"));
  const strict = ChromeUtils.importESModule(jsUrl("lumi-strict.sys.mjs"));
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
      const block = strict.block(host) ?? engine.focusBlock(host);
      if (!block) return;
      channel.cancel(Cr.NS_BINDING_ABORTED);
      const url = `${BLOCK}?url=${encodeURIComponent(channel.URI.spec)}&site=${encodeURIComponent(block.site)}&until=${block.kind == "strict" ? (block.until ? new Date(block.until).toTimeString().slice(0, 5) : "") : block.until ?? ""}&phase=${block.phase ?? ""}&kind=${block.kind ?? "focus"}&list=${encodeURIComponent(block.list ?? "")}`;
      Services.tm.dispatchToMainThread(() => {
        browser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      });
    },
  };
  Services.obs.addObserver(observer, "http-on-modify-request");
  window.addEventListener("unload", () => Services.obs.removeObserver(observer, "http-on-modify-request"));
})();
