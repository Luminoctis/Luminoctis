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
  window.addEventListener("popupshown", event => openPopups.add(event.target), true);
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

  // Прозрачный режим окна ([lumi-glass]): сквозь выехавшую панель видно то, что за окном, а не сайт. Для этого область сайтов
  // (#tabbrowser-tabpanels — она же Split view и закреп-окошко) режется clip-path ровно под панелями: рейка слева, полоса вкладок / адресная строка сверху.
  // Сайт не двигается и не перерисовывается. Размер реза считаем по живым прямоугольникам панелей на каждом кадре, пока идёт их
  // анимация (transitionrun / атрибуты) — клип едет синхронно с выездом, любое сочетание панелей и reduced-motion обходятся одинаково.
  // chrome.css, раздел 14: clip-path: var(--lumi-cut); вне стекла и в fullscreen переменная не действует.
  const nav = document.getElementById("zen-appcontent-navbar-wrapper"), panels = document.getElementById("tabbrowser-tabpanels");
  let cutUntil = 0, running = false, last = "";
  const cut = () => {
    let l = 0, t = 0;
    if (root.hasAttribute("lumi-glass") && root.getAttribute("inDOMFullscreen") !== "true") {
      const tp = panels.getBoundingClientRect(), n = nav.getBoundingClientRect();
      l = rail.getBoundingClientRect().right - tp.left;
      t = Math.max(strip.getBoundingClientRect().bottom, n.height > 20 ? n.bottom : 0) - tp.top; // свёрнутая строка (8px) — лишь невидимая зона показа
    }
    const value = l >= 1 || t >= 1 ? `inset(${Math.max(t, 0)}px 0 0 ${Math.max(l, 0)}px)` : "";
    if (value != last) { last = value; value ? panels.style.setProperty("--lumi-cut", value) : panels.style.removeProperty("--lumi-cut"); }
  };
  const frame = () => { cut(); if (Date.now() < cutUntil) requestAnimationFrame(frame); else running = false; };
  const kick = () => { cutUntil = Date.now() + 450; if (!running) { running = true; requestAnimationFrame(frame); } };
  new MutationObserver(kick).observe(root, { attributes: true });
  new MutationObserver(kick).observe(nav, { attributes: true, attributeFilter: ["zen-has-hover", "zen-has-implicit-hover", "style"] });
  for (const el of [rail, strip, nav]) el.addEventListener("transitionrun", kick);
  const prefs = ["luminoctis.compact.sidebar", "luminoctis.compact.tabstrip", "zen.view.compact.hide-toolbar"];
  for (const name of prefs) Services.prefs.addObserver(name, kick);
  window.addEventListener("unload", () => { for (const name of prefs) Services.prefs.removeObserver(name, kick); }, { once: true });
  window.addEventListener("resize", kick);
  kick();
});
