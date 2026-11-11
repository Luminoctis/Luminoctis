// ==UserScript==
// @name           Luminoctis: размытие сайта под панелями
// @description    В прозрачном режиме окна под панелями мода, лежащими поверх сайта (рейка и полоса в Compacting, настройки, карточки, мини-окно LumiTime), виден размытый сайт, а не рабочий стол.
// ==/UserScript==

// backdrop-filter сайт (<browser> другого процесса) не размывает, зато обычный filter на #tabbrowser-tabpanels работает. Один скрытый <svg>-фильтр размывает
// только прямоугольники под открытыми панелями: на каждую — свой feGaussianBlur с подобластью, feMerge кладёт их поверх резкого сайта.
// Фильтр на #tabbrowser-tabpanels висит, только пока над сайтом открыта хотя бы одна панель (он отключает субпиксельное сглаживание текста и стоит GPU).
// Панели сообщают прямоугольник (client px окна): window.lumiSiteBlur.set(ключ, rect|null) или .track(ключ, элемент) — следит за рамкой, пока идёт анимация.
// Корню ставится [lumi-site-blur], пока размытие возможно (chrome.css §14: тогда дырки и сплошные подложки под панелями не нужны). Возможно, когда:
// включён pref luminoctis.look.site-blur (скрытый, по умолчанию true), окно в стекле, не DOM-fullscreen, нет prefers-reduced-transparency, включён
// gfx.webrender.svg-filter-effects (иначе сайт с фильтром пропадает целиком) и выбранная вкладка — настоящий сайт: у chrome-страниц (Home, свои вкладки)
// backdrop-filter и так размывает, там остаётся прежнее поведение с дыркой.
UC_API.Windows.waitWindowLoading(window).then(() => {
  const NS = "http://www.w3.org/2000/svg", PREF = "luminoctis.look.site-blur", SVG_PREF = "gfx.webrender.svg-filter-effects", RADIUS = 12;
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
    root.getAttribute("inDOMFullscreen") != "true" && !reduced.matches && !!gBrowser.selectedBrowser?.isRemoteBrowser;

  function apply() {
    const on = possible();
    root.toggleAttribute("lumi-site-blur", on);
    const p = on && rects.size ? panels.getBoundingClientRect() : null; // без панелей лишнего пересчёта раскладки нет
    boxes = [];
    if (p) for (const r of rects.values()) { // подобласть — часть панели над сайтом, в координатах #tabbrowser-tabpanels
      const x = Math.max(r.left - p.left, 0), y = Math.max(r.top - p.top, 0), w = Math.min(r.right - p.left, p.width) - x, h = Math.min(r.bottom - p.top, p.height) - y;
      if (w >= 1 && h >= 1) boxes.push([x, y, w, h].map(n => Math.round(n * 100) / 100));
    }
    const now = boxes.join("|");
    if (now == sig) return;
    sig = now;
    if (!boxes.length) {
      panels.style.removeProperty("filter");
      filter.replaceChildren();
      return;
    }
    filter.replaceChildren(
      ...boxes.map(([x, y, width, height], i) => make("feGaussianBlur", { in: "SourceGraphic", stdDeviation: RADIUS, x, y, width, height, result: `b${i}` })),
      make("feMerge", {}, make("feMergeNode", { in: "SourceGraphic" }), ...boxes.map((_, i) => make("feMergeNode", { in: `b${i}` }))));
    panels.style.filter = "url(#lumi-site-blur)";
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

  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ["lumi-glass", "inDOMFullscreen"] });
  new ResizeObserver(apply).observe(panels);
  const prefs = [PREF, SVG_PREF];
  for (const name of prefs) Services.prefs.addObserver(name, apply);
  reduced.addEventListener("change", apply);
  for (const type of ["TabSelect", "TabRemotenessChange"]) gBrowser.tabContainer.addEventListener(type, apply);
  window.addEventListener("unload", () => { for (const name of prefs) Services.prefs.removeObserver(name, apply); }, { once: true });

  window.lumiSiteBlur = { set, track, apply, possible, get boxes() { return boxes; } };
});
