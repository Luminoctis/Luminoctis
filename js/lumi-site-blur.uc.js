// ==UserScript==
// @name           Luminoctis: размытие сайта под панелями
// @description    В прозрачном режиме окна под панелями мода, лежащими поверх сайта (рейка и полоса в Compacting, настройки, карточки, мини-окно LumiTime), виден размытый сайт, а не рабочий стол.
// ==/UserScript==

// backdrop-filter не размывает ни сайт (<browser> другого процесса), ни Home (страницу chrome в <browser>), зато обычный filter на #tabbrowser-tabpanels работает.
// Один скрытый <svg>-фильтр размывает только прямоугольники под открытыми панелями: на каждую — свой feGaussianBlur с подобластью. Под панелью виден только
// размытый слой: у сплошной страницы он непрозрачен и закрывает резкую, у прозрачной (Home насквозь) резкая страница вырезается (feComposite out по маске).
// Не использовать feFlood и table-функции feComponentTransfer: они уводят фильтр на медленный путь (GPU 6% → 40% на анимированной странице, замер 0.7.3).
// Всё, что внутри #tabbrowser-tabpanels и перерисовывается каждый кадр (страница с анимацией, бесконечная полоска загрузки Zen #zen-loading-progress-bar), заставляет
// пересчитывать весь фильтр на область: на Home с застрявшей загрузкой это 50% GPU (замер 0.7.3), на паузе — 0%. Полоску ставит на паузу CSS по [lumi-site-blurred].
// Фильтр на #tabbrowser-tabpanels висит, только пока над сайтом открыта хотя бы одна панель (он отключает субпиксельное сглаживание текста и стоит GPU).
// Панели сообщают прямоугольник (client px окна): window.lumiSiteBlur.set(ключ, rect|null) или .track(ключ, элемент) — следит за рамкой, пока идёт анимация.
// Корню ставится [lumi-site-blur], пока размытие возможно (chrome.css §14: тогда дырки и сплошные подложки под панелями не нужны). Возможно, когда:
// включён pref luminoctis.look.site-blur (скрытый, по умолчанию true), окно в стекле, не DOM-fullscreen, нет prefers-reduced-transparency, включён
// gfx.webrender.svg-filter-effects (иначе страница с фильтром пропадает целиком). Home и большой LumiTime (chrome-страницы) размываются так же, как сайты.
UC_API.Windows.waitWindowLoading(window).then(() => {
  const NS = "http://www.w3.org/2000/svg", PREF = "luminoctis.look.site-blur", SVG_PREF = "gfx.webrender.svg-filter-effects", TRANSPARENT = "browser.tabs.allow_transparent_browser", RADIUS = 24;
  const root = document.documentElement, panels = document.getElementById("tabbrowser-tabpanels");
  const make = (tag, attrs = {}, ...kids) => {
    const el = document.createElementNS(NS, tag);
    for (const name in attrs) el.setAttribute(name, attrs[name]);
    el.append(...kids);
    return el;
  };
  const filter = make("filter", { id: "lumi-site-blur", x: 0, y: 0, width: "100%", height: "100%", primitiveUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" });
  root.append(make("svg", { "aria-hidden": "true", style: "position:fixed;width:0;height:0;pointer-events:none" }, filter));
  const reduced = matchMedia("(prefers-reduced-transparency: reduce)");
  const rects = new Map(), loops = new Map(); // ключ панели → { left, top, right, bottom }; ключ → id кадра слежения
  let boxes = [], sig = "";

  const possible = () => Services.prefs.getBoolPref(PREF, true) && Services.prefs.getBoolPref(SVG_PREF, true) && root.hasAttribute("lumi-glass") &&
    root.getAttribute("inDOMFullscreen") != "true" && !reduced.matches;
  // Настоящий сайт на сплошной подложке --lumi-solid (без прозрачных сайтов): страница непрозрачна, и фильтру хватает одного размытия на панель.
  // Иначе (Home и большой LumiTime — тоже удалённые <browser>, но страница прозрачная насквозь; сайты при allow_transparent_browser) — «честный» вариант, он на несколько примитивов длиннее
  const solidPage = () => !!gBrowser.selectedBrowser?.isRemoteBrowser && !Services.prefs.getBoolPref(TRANSPARENT, false) && !root.hasAttribute("lumi-home-live") &&
    !gBrowser.selectedTab.hasAttribute("lumi-home") && !gBrowser.selectedTab.hasAttribute("lumi-time-full");

  function apply() {
    const on = possible();
    root.toggleAttribute("lumi-site-blur", on);
    const p = on && rects.size ? panels.getBoundingClientRect() : null; // без панелей лишнего пересчёта раскладки нет
    boxes = [];
    if (p) for (const r of rects.values()) { // подобласть — часть панели над сайтом, в координатах #tabbrowser-tabpanels
      const x = Math.max(r.left - p.left, 0), y = Math.max(r.top - p.top, 0), w = Math.min(r.right - p.left, p.width) - x, h = Math.min(r.bottom - p.top, p.height) - y;
      if (w >= 1 && h >= 1) boxes.push([x, y, w, h].map(n => Math.round(n * 100) / 100));
    }
    const solid = solidPage(), now = boxes.length ? boxes.join("|") + "|" + p.width + "x" + p.height + (solid ? "s" : "t") : ""; // размер области — в подписи: от него зависят полосы у краёв
    if (now == sig) return;
    sig = now;
    if (!boxes.length) {
      panels.style.removeProperty("filter");
      panels.removeAttribute("lumi-site-blurred");
      filter.replaceChildren();
      return;
    }
    // На каждую панель: g — размытие подобласти; m — маска «здесь была страница» (альфа g, поднятая до 1); у края области сайтов (верх под полосой, лево под
    // рейкой) g тает к прозрачному (часть окна размытия лежит за краем), поэтому альфу поднимают: feComponentTransfer снимает премультипликацию, цвет остаётся
    // честным средним. Фильтр на анимированной странице стоит GPU за каждый примитив на всю область (замер 0.7.3), поэтому два пути:
    // · сплошная страница: слой = m (g с альфой ×8) непрозрачен во всей подобласти, резкая страница под ним не видна — вырезать её не нужно (как в 0.7.1);
    // · иначе страница может быть прозрачной (Home насквозь, прозрачные сайты): слой — «честный» g (белый текст на прозрачном фоне не превращается в сплошное
    //   белое пятно, как при ×8), резкая страница вырезается по маскам m (×255). Подъёма у края здесь нет: полоса с ×3 у полупрозрачного сайта
    //   была плотнее соседнего слоя — светлая полоса с резкой границей слева под рейкой и снизу (0.7.3); без неё слой у края просто плавно тает.
    const rect = ([x, y, width, height]) => ({ x, y, width, height }), merge = (nodes, result) => make("feMerge", result ? { result } : {}, ...nodes.map(n => make("feMergeNode", { in: n })));
    const ct = (src, box, slope, result) => make("feComponentTransfer", { in: src, ...rect(box), result }, make("feFuncA", { type: "linear", slope }));
    const prims = [], top = []; // примитивы и слои, которые кладутся поверх страницы
    boxes.forEach((box, i) => {
      prims.push(make("feGaussianBlur", { in: "SourceGraphic", stdDeviation: RADIUS, ...rect(box), result: `g${i}` }), ct(`g${i}`, box, solid ? 8 : 255, `m${i}`));
      if (solid) return top.push(`m${i}`);
      top.push(`g${i}`);
    });
    const masks = boxes.map((_, i) => `m${i}`);
    filter.replaceChildren(...prims, ...(solid ? [merge(["SourceGraphic", ...top])] : [...(masks.length > 1 ? [merge(masks, "m")] : []),
      make("feComposite", { in: "SourceGraphic", in2: masks.length > 1 ? "m" : masks[0], operator: "out", result: "cut" }), merge(["cut", ...top])]));
    panels.style.filter = "url(#lumi-site-blur)";
    panels.setAttribute("lumi-site-blurred", ""); // chrome.css §14б: бесконечные анимации внутри области под фильтром ставятся на паузу
  }

  const set = (key, r) => {
    if (r) rects.set(key, { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    else if (!rects.delete(key)) return; // карточка прячется на каждый mouseover — без изменений ничего не пересчитываем
    apply();
  };
  // рамка элемента (null / спрятан / убран — панели нет); пока идёт анимация (выезд, появление), обновляется каждый кадр
  const track = (key, el) => {
    cancelAnimationFrame(loops.get(key));
    loops.delete(key);
    const shown = el?.isConnected && !el.hidden && el.getClientRects().length;
    set(key, shown ? el.getBoundingClientRect() : null);
    if (shown && el.getAnimations().some(a => a.playState == "running")) loops.set(key, requestAnimationFrame(() => track(key, el)));
  };

  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ["lumi-glass", "inDOMFullscreen", "lumi-home-live"] });
  new ResizeObserver(apply).observe(panels);
  const prefs = [PREF, SVG_PREF, TRANSPARENT];
  for (const name of prefs) Services.prefs.addObserver(name, apply);
  reduced.addEventListener("change", apply);
  for (const type of ["TabSelect", "TabRemotenessChange"]) gBrowser.tabContainer.addEventListener(type, apply);
  window.addEventListener("unload", () => { for (const name of prefs) Services.prefs.removeObserver(name, apply); }, { once: true });

  window.lumiSiteBlur = { set, track, apply, possible, get boxes() { return boxes; } };
});
