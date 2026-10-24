// ==UserScript==
// @name           Luminoctis: адресная строка
// @description    Поисковик, выбранный в адресной строке, становится поисковиком по умолчанию, а адрес в поле не стирается; раскрытая строка встаёт на место закрытой.
// ==/UserScript==

// Родной выбор поисковика Firefox включает разовый «режим поиска» и стирает адрес из поля.
// Здесь обычный клик по поисковику (или Enter на нём) делает его поисковиком по умолчанию — родной настройкой
// SearchService, как в about:preferences#search. Shift/средняя кнопка и «Настройки поиска» работают по-родному.
// Плавающая адресная строка Zen (Ctrl+T, «+») складывается, как только фокус уходит из поля, а родное меню поисковиков
// ещё и закрывает список результатов (без него строка теряет позицию по центру): меню оказывалось у свёрнутой верхней строки.
// Пока меню открыто из плавающей строки, фокус остаётся в поле (mousedown не отдаёт его кнопке), а список результатов не закрывается.
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
  const { SearchService } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
  const list = gURLBar.querySelector(".searchmode-switcher-panel-list");
  // в родной строке заголовок «This time search with:» (разовый поиск); у нас пункт меняет поисковик по умолчанию
  const header = gURLBar.querySelector(".searchmode-switcher-panel-description");
  header.removeAttribute("data-l10n-id");
  header.textContent = "Поиск по умолчанию:";
  let holdFloating = false;
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
