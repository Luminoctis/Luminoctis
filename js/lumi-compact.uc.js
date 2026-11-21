// ==UserScript==
// @name           Luminoctis: Compacting
// @description    Рейка и полоса вкладок прячутся за край окна (настройки luminoctis.compact.sidebar / .tabstrip) и выезжают, когда мышь у своего края — как compact mode Zen. Адресная строка прячется родным compact mode Zen.
// ==/UserScript==

// Прячет и показывает CSS (chrome.css, раздел 12): при настройке элемент за краем окна, при атрибуте корня lumi-show-sidebar / lumi-show-tabstrip — на месте.
// Здесь — только когда показать: мышь (или перетаскиваемая вкладка) у края — у самого края лежит прозрачная «горячая зона»
// (над сайтом: мышь над сайтом до интерфейса не доходит); убрать — через 350 мс после ухода мыши, но не пока открыто меню или панель,
// не пока над элементом идёт перетаскивание и не пока мышь над ним или над выехавшей адресной строкой.
UC_API.Windows.waitWindowLoading(window).then(async () => {
  const until = id => new Promise(done => {
    const look = () => document.getElementById(id) ? done(document.getElementById(id)) : setTimeout(look, 50);
    look();
  });
  const [rail, strip] = await Promise.all([until("lumi-rail"), until("lumi-tabstrip")]);
  const root = document.documentElement;
  const openPopups = new Set();
  const zones = [];
  // подсказки (tooltip) не держат панели: их popupshown иногда приходит уже после popuphidden, и панель «залипала»
  window.addEventListener("popupshown", event => { if (event.target.localName != "tooltip") openPopups.add(event.target); }, true);
  window.addEventListener("popuphidden", event => {
    openPopups.delete(event.target);
    zones.forEach(zone => zone.later());
  }, true);

  for (const zone of [
    { attr: "lumi-show-sidebar", el: rail, hot: "lumi-hot-left", pref: "luminoctis.compact.sidebar" },
    { attr: "lumi-show-tabstrip", el: strip, hot: "lumi-hot-top", pref: "luminoctis.compact.tabstrip" },
  ]) {
    const hot = Object.assign(document.createElement("div"), { id: zone.hot });
    document.getElementById("browser").append(hot);
    let timer, lastDrag = 0;
    // «своя» область: сам элемент, горячая зона, панель настроек (у рейки), выехавшая под полосой вкладок адресная строка
    const busy = () => openPopups.size || Date.now() - lastDrag < 400 || zone.el.matches(":hover") || hot.matches(":hover") ||
      (zone.el === strip && document.getElementById("zen-appcontent-navbar-wrapper").matches(":hover")) ||
      (zone.el === rail && document.getElementById("lumi-settings")?.matches(":not([hidden]):hover"));
    zone.later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => (busy() ? zone.later() : root.removeAttribute(zone.attr)), 350);
    };
    const show = () => {
      // атрибут lumi-show-tabstrip ещё и раскрывает адресную строку (chrome.css, раздел 2) — только если полоса вправду прячется
      if (zone.pref && !Services.prefs.getBoolPref(zone.pref, false)) return;
      root.setAttribute(zone.attr, "");
      zone.later(); // убирать сразу, как только мышь уйдёт и перетаскивание кончится (busy ниже), а не ждать события «ушла»
    };
    for (const target of [zone.el, hot]) {
      target.addEventListener("mouseenter", show);
      target.addEventListener("mouseleave", zone.later);
      target.addEventListener("dragover", () => { lastDrag = Date.now(); show(); }); // вкладку тянут над краем или над самим элементом
      target.addEventListener("dragleave", zone.later);
    }
    zones.push(zone);
  }

  // Адресную строку прячет родной compact mode Zen (атрибут корня zen-compact-mode, chrome.css разделы 2 и 12), а сам включатель «Адресная строка»
  // (zen.view.compact.hide-toolbar) его не включает: стоит выключить режим родной кнопкой / сочетанием / командой «Compact mode» — Zen запомнит это
  // и на следующие запуски (enable-at-startup), и строка навсегда на месте при включённом флажке. Поэтому флажок включён → держим режим включённым
  // (при запуске и при смене флажка); режим выключили руками — флажок гаснет вместе с ним (не спорим с пользователем и не включаем его заново при перезапуске).
  const HIDE = "zen.view.compact.hide-toolbar";
  let keepTimer;
  const keepCompact = (left = 40) => {
    clearTimeout(keepTimer);
    const zen = window.gZenCompactModeManager;
    if (!left || !zen || root.hasAttribute("popup-window") || root.getAttribute("zen-compact-mode") === "true" || !Services.prefs.getBoolPref(HIDE, false)) return;
    // пока Zen сам применяет запомненный режим при запуске (_wasInCompactMode) или идёт анимация, setter молча ничего не делает — ждём и проверяем снова
    if (zen._wasInCompactMode === undefined && !root.hasAttribute("zen-compact-animating")) zen.preference = true;
    keepTimer = setTimeout(() => keepCompact(left - 1), 500);
  };
  const onHidePref = () => keepCompact();
  Services.prefs.addObserver(HIDE, onHidePref);
  window.addEventListener("unload", () => Services.prefs.removeObserver(HIDE, onHidePref), { once: true });
  // Включили режим, пока в строке что-то было открыто / в фокусе (при запуске), — Zen ставит ей zen-compact-mode-active и снимает только при следующей
  // мутации (фокус атрибутов не меняет): строка оставалась раскрытой навсегда. Снимаем отметку сами, если держать её нечему (тот же селектор, что у Zen).
  const unstick = () => {
    const bar = document.getElementById("zen-appcontent-navbar-wrapper");
    if (bar.hasAttribute("zen-compact-mode-active") && !bar.querySelector(":where([panelopen], [open], #urlbar:focus-within, [breakout-extend]):not(.zen-compact-mode-ignore)"))
      window.gZenCompactModeManager._setElementExpandAttribute(bar, false, "zen-compact-mode-active");
  };
  window.addEventListener("ZenCompactMode:Toggled", event => {
    if (event.detail) setTimeout(unstick, 1000); else Services.prefs.setBoolPref(HIDE, false);
  });
  SessionStore.promiseAllWindowsRestored.then(() => keepCompact());

  // Прозрачный режим окна ([lumi-glass]): сквозь выехавшую панель видно то, что за окном, а не сайт. Для этого область сайтов
  // (#tabbrowser-tabpanels — она же Split view и закреп-окошко) режется clip-path ровно под панелями: рейка слева, полоса вкладок / адресная строка сверху.
  // Сайт не двигается и не перерисовывается. Размер реза считаем по живым прямоугольникам панелей на каждом кадре, пока идёт их
  // анимация (transitionrun / атрибуты) — клип едет синхронно с выездом, любое сочетание панелей и reduced-motion обходятся одинаково.
  // chrome.css, раздел 14: clip-path: var(--lumi-cut); вне стекла и в fullscreen переменная не действует.
  // Где работает размытие сайта (js/lumi-site-blur.uc.js, корню [lumi-site-blur]), клип не нужен: те же прямоугольники отдаются фильтру — под панелью виден размытый сайт.
  const nav = document.getElementById("zen-appcontent-navbar-wrapper"), panels = document.getElementById("tabbrowser-tabpanels");
  let cutUntil = 0, running = false, last = "";
  const cut = () => {
    let l = 0, t = 0, tp, right = root.hasAttribute("lumi-rail-right"); // рейка справа: её рез — у правого края
    if (root.hasAttribute("lumi-glass") && root.getAttribute("inDOMFullscreen") !== "true") {
      tp = panels.getBoundingClientRect();
      const n = nav.getBoundingClientRect();
      const rr = rail.getBoundingClientRect();
      l = right ? tp.right - rr.left : rr.right - tp.left;
      t = Math.max(strip.getBoundingClientRect().bottom, n.height > 20 ? n.bottom : 0) - tp.top; // свёрнутая строка (8px) — лишь невидимая зона показа
    }
    window.lumiSiteBlur?.set("compact-rail", l >= 1 ? (right ? { left: tp.right - l, top: tp.top, right: tp.right, bottom: tp.bottom } : { left: tp.left, top: tp.top, right: tp.left + l, bottom: tp.bottom }) : null);
    window.lumiSiteBlur?.set("compact-top", t >= 1 ? { left: tp.left, top: tp.top, right: tp.right, bottom: tp.top + t } : null);
    const value = l >= 1 || t >= 1 ? (right ? `inset(${Math.max(t, 0)}px ${Math.max(l, 0)}px 0 0)` : `inset(${Math.max(t, 0)}px 0 0 ${Math.max(l, 0)}px)`) : "";
    if (value != last) { last = value; value ? panels.style.setProperty("--lumi-cut", value) : panels.style.removeProperty("--lumi-cut"); }
  };
  const frame = () => { cut(); if (Date.now() < cutUntil) requestAnimationFrame(frame); else running = false; };
  const kick = () => { cutUntil = Date.now() + 450; if (!running) { running = true; requestAnimationFrame(frame); } };
  new MutationObserver(kick).observe(root, { attributes: true });
  new MutationObserver(kick).observe(nav, { attributes: true, attributeFilter: ["zen-has-hover", "zen-has-implicit-hover", "style"] });
  for (const el of [rail, strip, nav]) el.addEventListener("transitionrun", kick);
  const prefs = ["luminoctis.compact.sidebar", "luminoctis.compact.tabstrip", "zen.view.compact.hide-toolbar", "luminoctis.rail.side"];
  for (const name of prefs) Services.prefs.addObserver(name, kick);
  window.addEventListener("unload", () => { for (const name of prefs) Services.prefs.removeObserver(name, kick); }, { once: true });
  window.addEventListener("resize", kick);
  kick();
});
