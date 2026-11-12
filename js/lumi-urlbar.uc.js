// ==UserScript==
// @name           Luminoctis: адресная строка
// @description    Поисковик, выбранный в адресной строке, становится поисковиком по умолчанию, а адрес в поле не стирается; раскрытая строка встаёт на место закрытой.
// ==/UserScript==

(() => {

// Родной выбор поисковика Firefox включает разовый «режим поиска» и стирает адрес из поля.
// Здесь обычный клик по поисковику (или Enter на нём) делает его поисковиком по умолчанию — родной настройкой
// SearchService, как в about:preferences#search. Shift/средняя кнопка и «Настройки поиска» работают по-родному.
// Плавающая адресная строка Zen (Ctrl+T, «+») складывается, как только фокус уходит из поля, а родное меню поисковиков
// ещё и закрывает список результатов (без него строка теряет позицию по центру): меню оказывалось у свёрнутой верхней строки.
// Пока меню открыто из плавающей строки, фокус остаётся в поле (mousedown не отдаёт его кнопке), а список результатов не закрывается.
const { t } = ChromeUtils.importESModule(Components.stack.filename.replace(/[^/]*$/, "lumi-i18n.sys.mjs"));
UC_API.Windows.waitWindowLoading(window).then(() => {
  // Результаты — продолжение строки (chrome.css, раздел 2б): раскрытая строка должна встать ровно туда, где стояла закрытая.
  // Размеры закрытой снимаем перед раскрытием (нажатие мыши или фокус) и отдаём CSS переменными.
  const container = document.getElementById("urlbar-container");
  const snapBar = () => {
    if (gURLBar.hasAttribute("breakout-extend")) return;
    const bar = gURLBar.getBoundingClientRect(), box = container.getBoundingClientRect();
    if (!bar.height || !box.height) return; // панель спрятана
    gURLBar.style.setProperty("--lumi-ub-dy", `${bar.top - box.top}px`);
    gURLBar.style.setProperty("--lumi-ub-w", `${bar.width}px`);
    gURLBar.style.setProperty("--lumi-ub-h", `${bar.height}px`);
  };
  for (const type of ["mousedown", "focusin"]) gURLBar.addEventListener(type, snapBar, true);
  // Загрузка сайта заполняет поле адреса слева направо (chrome.css, раздел 2в): --lumi-load (0..1) и [lumi-loading] на #urlbar
  // по реальному прогрессу выбранной вкладки. Состояние хранится у каждой вкладки, при переключении рисуется без анимации (lumi-load-jump).
  const { nsIWebProgressListener: WPL } = Ci;
  const loads = new WeakMap(); // browser → { load, loading, shown, timer }
  let fadeTimer;
  const paint = (st, jump) => {
    clearTimeout(fadeTimer);
    if (jump) {
      gURLBar.setAttribute("lumi-load-jump", "");
      requestAnimationFrame(() => requestAnimationFrame(() => gURLBar.removeAttribute("lumi-load-jump")));
    }
    if (st?.shown) {
      gURLBar.style.setProperty("--lumi-load", st.load);
      gURLBar.setAttribute("lumi-loading", "");
    } else {
      gURLBar.removeAttribute("lumi-loading");
      fadeTimer = setTimeout(() => gURLBar.style.setProperty("--lumi-load", 0), 500); // после затухания
    }
  };
  const loadOf = browser => { let st = loads.get(browser); if (!st) loads.set(browser, st = {}); return st; };
  gBrowser.addTabsProgressListener({
    onStateChange(browser, webProgress, request, flags, status) {
      if (!webProgress.isTopLevel || !(flags & WPL.STATE_IS_NETWORK)) return;
      const st = loadOf(browser), selected = browser == gBrowser.selectedBrowser;
      clearTimeout(st.timer);
      if (flags & WPL.STATE_START) {
        Object.assign(st, { load: 0.1, loading: true, shown: false });
        if (selected) paint(st, true); // новая загрузка начинается с нуля, без «отката» от прошлой
        // быстрые загрузки не мигают: показываем, только если идёт дольше 150 мс
        st.timer = setTimeout(() => { st.shown = true; if (browser == gBrowser.selectedBrowser) paint(st); }, 150);
      } else if (flags & WPL.STATE_STOP && st.loading) {
        st.loading = false;
        if (!st.shown) return;
        const ok = Components.isSuccessCode(status); // остановка/ошибка — просто гаснет, без добегания до 100%
        if (ok) st.load = 1;
        if (selected) paint(st);
        st.timer = setTimeout(() => { st.shown = false; if (browser == gBrowser.selectedBrowser) paint(st); }, ok ? 250 : 0);
      }
    }
  });
  // прогресс шлют только слушатели выбранной вкладки (у слушателей всех вкладок onProgressChange не приходит), у фоновых вкладок он не обновляется
  gBrowser.addProgressListener({
    onProgressChange(webProgress, request, curSelf, maxSelf, curTotal, maxTotal) { // webProgress здесь null: прогресс уже суммарный по странице
      const st = loads.get(gBrowser.selectedBrowser);
      if (!st?.loading || !(maxTotal > 0)) return;
      const next = 0.1 + 0.8 * Math.min(curTotal / maxTotal, 1); // почти всё до 90%, остальное — по завершении
      if (next <= st.load) return; // только вперёд: maxTotal растёт по ходу загрузки
      st.load = next;
      if (st.shown) paint(st);
    },
  });
  gBrowser.tabContainer.addEventListener("TabSelect", () => {
    const st = loads.get(gBrowser.selectedBrowser);
    paint(st?.loading || st?.shown ? st : null, true);
  });
  // Ctrl+V с картинкой в буфере — сразу поиск по ней в Google Lens (общий модуль lumi-lens.sys.mjs, как в поиске Home).
  // На Home — в новой вкладке, на обычной странице — в текущей. Текст вставляется как обычно.
  const { jsUrl } = ChromeUtils.importESModule(Components.stack.filename.replace(/[^/]*$/, "lumi-paths.sys.mjs"));
  const { lensRequest, MAX_IMG } = ChromeUtils.importESModule(jsUrl("lumi-lens.sys.mjs"));
  let hintTimer = 0, hintOrig = null;
  const hint = (msg, ms) => { // подсказка в поле: msg на ms мс (без ms — до следующего вызова), без msg — прежняя
    const f = gURLBar.inputField;
    clearTimeout(hintTimer);
    hintOrig ??= f.placeholder;
    f.placeholder = msg ?? hintOrig;
    if (msg == null) hintOrig = null;
    else if (ms) hintTimer = setTimeout(() => hint(), ms);
  };
  const searchImage = async file => {
    if (file.size > MAX_IMG) return hint(t("Картинка больше 20 МБ"), 3000);
    hint(t("Ищу по картинке…"));
    try {
      const { url, postData } = await lensRequest(file, window);
      const where = gBrowser.selectedTab.hasAttribute("lumi-home") ? "tab" : "current";
      openTrustedLinkIn(url, where, { postData });
      gURLBar.view.close();
      gURLBar.handleRevert();
      gURLBar.blur();
      hint();
    } catch (e) {
      console.error("Luminoctis адресная строка, поиск по картинке:", e); // l10n-skip
      hint(t("Не удалось отправить картинку"), 3000);
    }
  };
  const onPaste = e => {
    const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    return searchImage(file);
  };
  gURLBar.inputField.addEventListener("paste", onPaste, true);
  window.lumiUrlbarPaste = { onPaste, searchImage }; // для dev/check-urlbar.js
  const { SearchService } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
  const list = gURLBar.querySelector(".searchmode-switcher-panel-list");
  // в родной строке заголовок «This time search with:» (разовый поиск); у нас пункт меняет поисковик по умолчанию
  const header = gURLBar.querySelector(".searchmode-switcher-panel-description");
  header.removeAttribute("data-l10n-id");
  header.textContent = t("Поиск по умолчанию:");
  let holdFloating = false;
  // Стекло: раскрытая строка (результаты, плавающая строка Zen) над сайтом размывает его под собой (js/lumi-site-blur.uc.js, chrome.css §14)
  const ubBg = gURLBar.querySelector(".urlbar-background");
  const ubBlur = () => window.lumiSiteBlur?.track("urlbar", gURLBar.hasAttribute("breakout-extend") ? ubBg : null);
  new MutationObserver(ubBlur).observe(gURLBar, { attributes: true, attributeFilter: ["breakout-extend"] });
  new ResizeObserver(ubBlur).observe(gURLBar);
  const { view } = gURLBar;
  const { close } = view;
  view.close = function (...args) { return holdFloating ? undefined : close.apply(this, args); };
  gURLBar.addEventListener("mousedown", event => {
    if (event.button != 0 || !gURLBar.hasAttribute("zen-floating-urlbar") ||
        !event.target.closest?.(".searchmode-switcher")) return;
    holdFloating = true;
    event.preventDefault(); // фокус остаётся в поле, меню открывает сам moz-button по этому же mousedown
  }, true);
  list.addEventListener("hidden", () => {
    if (!holdFloating) return;
    holdFloating = false;
    gURLBar.focus();
  });
  const pick = async event => {
    const item = event.target.closest?.("[data-action='searchmode']");
    if (!item || event.shiftKey || (event.type == "click" && event.button != 0)) return;
    if (event.type == "keydown" && event.key != "Enter" && event.key != " ") return;
    // перехватываем до обработчика Firefox на самом пункте (он стоит на фазе всплытия)
    event.stopImmediatePropagation();
    event.preventDefault();
    gURLBar.searchModeSwitcher.closePanel();
    const engine = await SearchService.getEngineById(item.dataset.engineId);
    const privateDefault = PrivateBrowsingUtils.isWindowPrivate(window) &&
      Services.prefs.getBoolPref("browser.search.separatePrivateDefault", false);
    await SearchService[privateDefault ? "setDefaultPrivate" : "setDefault"](engine, SearchService.CHANGE_REASON.USER);
  };
  list.addEventListener("click", pick, true);
  list.addEventListener("keydown", pick, true);
});
})();
