// ==UserScript==
// @name           Luminoctis: клавиши вкладок и закрепов
// @description    Alt+Q / Alt+E — соседняя вкладка полосы (по кругу — настройка), Alt+1…9, 0 — закрепы рейки сверху вниз.
// ==/UserScript==

// Слушаем keydown в capture на окне: родной процесс видит нажатие раньше сайта, preventDefault не пускает его ни в страницу, ни в меню (доступ по Alt).
(() => {
  const { jsUrl } = ChromeUtils.importESModule(Components.stack.filename.replace(/[^/]*$/, "lumi-paths.sys.mjs"));
  const keys = ChromeUtils.importESModule(jsUrl("lumi-keys.sys.mjs"));
  const WRAP = "luminoctis.keys.wrap";

  function step(dir) {
    const tabs = [...document.querySelectorAll("#lumi-tabs > .lumi-tab")].map(el => el.tab).filter(Boolean);
    if (!tabs.length) return;
    const i = tabs.indexOf(gBrowser.selectedTab);
    let to;
    if (i < 0) to = dir > 0 ? tabs[0] : tabs.at(-1); // выбрана не вкладка полосы (Home, закреп)
    else if (tabs[i + dir]) to = tabs[i + dir];
    else if (Services.prefs.getBoolPref(WRAP, false)) to = dir > 0 ? tabs[0] : tabs.at(-1);
    if (to && to !== gBrowser.selectedTab) gBrowser.selectedTab = to;
  }

  window.addEventListener("keydown", event => {
    if (event.isComposing || event.repeat && !event.altKey) return;
    let handled = false;
    if (event.ctrlKey && event.altKey && event.shiftKey && !event.metaKey && event.code == "KeyD") (window.lumiDebug?.open(), handled = true); // окно отладки
    else if (keys.matches("tabLeft", event)) (step(-1), handled = true);
    else if (keys.matches("tabRight", event)) (step(1), handled = true);
    else if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey && /^(Digit|Numpad)\d$/.test(event.code)) {
      const n = +event.code.slice(-1);
      handled = true;
      document.querySelectorAll("#lumi-pins .lumi-pin")[(n || 10) - 1]?.click();
    }
    if (handled) (event.preventDefault(), event.stopPropagation());
  }, true);
})();
