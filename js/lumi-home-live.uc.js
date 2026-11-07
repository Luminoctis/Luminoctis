// ==UserScript==
// @name           Luminoctis: прозрачная Home
// @description    Прозрачный режим Home: область Home становится насквозь прозрачной, виден рабочий стол за окном браузера.
// ==/UserScript==

// Как устроено: «насквозь» ли Home, решают prefs (wantDesktop: режим обоев «Рабочий стол» или «Прозрачность обоев» > 0 в прозрачном окне), а не страница —
// выгруженная Home при выборе грузится ~0,3 с, и если ждать её сообщения lumiHomeLive.want(), окно успевает показать обычный вид (тёмная рамка, сплошной фон страницы).
// Страница (home/wallpaper.js) по-прежнему зовёт want(...) — это лишь повод пересчитать состояние.
// Пока выбрана Home, wantDesktop и Windows рисует окно с прозрачностью (-moz-windows-mica): [lumi-home-live] на корне (chrome.css раздел 15),
// transparent у <browser> Home, [lumi-through] на странице.
// Accent policy окна браузера (SetWindowCompositionAttribute) задаёт luminoctis.look.blur-kind, когда окно «Прозрачное» (на любой вкладке)
// или Home «насквозь»: none — ACCENT_ENABLE_TRANSPARENTGRADIENT (чёткий рабочий стол), blur — ACCENT_ENABLE_BLURBEHIND (размытие Windows),
// acrylic / mica — ACCENT_DISABLED (родная подложка Zen, её вид пишет lumi-palette в widget.windows.mica.toplevel-backdrop).
// Ушли с Home / свернули окно / режим окна не прозрачный — ACCENT_DISABLED.
(() => {
  const { jsUrl } = ChromeUtils.importESModule(Components.stack.filename.replace(/[^/]*$/, "lumi-paths.sys.mjs"));
  const { windowMode } = ChromeUtils.importESModule(jsUrl("lumi-palette.sys.mjs"));
  const mica = matchMedia("(-moz-windows-mica)"); // без него Windows не рисует прозрачные пиксели окна
  const DESKTOP = "desktop";

  // ---------- Win32 через js-ctypes ----------
  let U;
  function api() {
    if (U !== undefined) return U;
    try {
      const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
      const lib = ctypes.open("user32.dll"), I = ctypes.int32_t, UI = ctypes.uint32_t;
      const ACCENT = new ctypes.StructType("ACCENT_POLICY", [{ state: I }, { flags: I }, { color: UI }, { anim: I }]);
      const DATA = new ctypes.StructType("WINCOMPATTRDATA", [{ attr: I }, { data: ctypes.voidptr_t }, { size: ctypes.size_t }]);
      U = { ctypes, ACCENT, DATA, comp: lib.declare("SetWindowCompositionAttribute", ctypes.winapi_abi, I, ctypes.voidptr_t, DATA.ptr) };
    } catch (e) { console.warn("Luminoctis прозрачная Home: нет Win32", e); U = null; }
    return U;
  }
  const own = () => U.ctypes.voidptr_t(U.ctypes.UInt64(window.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle));
  // none → state 2 (TRANSPARENTGRADIENT), flags 2; blur → state 3 (BLURBEHIND), flags 0; иначе 0. Цвет всегда 0.
  // Проверено на экране (Win11 26300): 3 с flags 0 — чистое размытие (Windows чуть притемняет); 3 с flags 2 — чёрное при любом цвете,
  // 4 (acrylic) — белёсое, 5 (hostbackdrop) — без размытия. Не менять.
  const KIND = "luminoctis.look.blur-kind", WIN = "luminoctis.look.window", TRANSPARENT = "browser.tabs.allow_transparent_browser";
  const STATES = { none: { state: 2, flags: 2 }, blur: { state: 3, flags: 0 } };
  let accentSet = 0;
  function accent(kind) {
    const a = new U.ACCENT(), d = new U.DATA();
    Object.assign(a, { state: 0, flags: 0, color: 0, anim: 0 }, STATES[kind]);
    d.attr = 19; // WCA_ACCENT_POLICY
    d.data = a.address();
    d.size = U.ACCENT.size;
    accentSet = U.comp(own(), d.address()) != 0 ? a.state : -1; // GetWindowCompositionAttribute accent не отдаёт — запоминаем своё
    return accentSet >= 0;
  }
  // Родная подложка Windows (Acrylic/Mica, DWMWA_SYSTEMBACKDROP_TYPE) у неактивного окна по замыслу ОС заменяется сплошным цветом — размытие пропадает.
  // Accent policy «blur» от активности окна не зависит, поэтому у неактивного окна в видах acrylic/mica включаем его вместо родной подложки.
  const inactive = () => Services.focus.activeWindow != window;
  const wantKind = on => {
    if (!on || !mica.matches || window.windowState == window.STATE_MINIMIZED) return "";
    const k = Services.prefs.getStringPref(KIND, "acrylic");
    return (k == "acrylic" || k == "mica") && inactive() ? "blur" : k;
  };
  function applyAccent() {
    if (!api()) return;
    const kind = wantKind(through || site || windowMode() == "transparent"), state = STATES[kind]?.state ?? 0;
    if (state != accentSet) accent(kind);
  }

  // ---------- окно браузера: насквозь / обычное ----------
  let through = null, site = false;
  const HT = "luminoctis.look.homeTransparency", WPMODE = "luminoctis.home.wallpaper.mode";
  const wantDesktop = () => Services.prefs.getStringPref(WPMODE, "wallpaper") == "transparent" || (windowMode() == "transparent" && Services.prefs.getIntPref(HT, 0) > 0);
  // Home «видна»: выбрана она сама или выбран закреп-окошко (lumi-rail.uc.js showPin) — Home остаётся под ним, режим насквозь не выключаем
  // from — вкладка, с которой только что ушли (TabSelect): в этот момент у закрепа ещё нет класса окошка, а у Home — deck-selected (их ставит рейка позже),
  // без подсказки режим «насквозь» на кадр гас и больше не включался
  // Glance (Alt+клик из Home или из закрепа-окошка): выбрана его вкладка, считаем по родителю
  const selTab = () => { const t = gBrowser.selectedTab; return window.gZenGlanceManager?.getTabOrGlanceParent?.(t) ?? t; };
  const homeTab = from => {
    const sel = selTab();
    if (sel?.hasAttribute("lumi-home")) return sel;
    if (from?.hasAttribute("lumi-home") && !from.closing && sel?.hasAttribute("zen-essential")) return from;
    if (!document.getElementById(sel?.linkedPanel)?.classList.contains("lumi-pin-window")) return null;
    return gBrowser.tabs.find(t => t.hasAttribute("lumi-home") && document.getElementById(t.linkedPanel)?.classList.contains("deck-selected")) ?? null;
  };
  function setThrough(tab) {
    const old = tab == through ? null : through;
    through = tab;
    tab ? document.documentElement.setAttribute("lumi-home-live", "") : document.documentElement.removeAttribute("lumi-home-live");
    for (const [t, on] of [[old, false], [tab, true]]) {
      if (!t?.linkedBrowser) continue;
      on ? t.linkedBrowser.setAttribute("transparent", "true") : (t.linkedBrowser.removeAttribute("transparent"), t.linkedBrowser.style.removeProperty("opacity"));
      t.linkedBrowser.contentDocument?.documentElement?.toggleAttribute("lumi-through", on);
    }
  }
  // Прозрачные сайты (расширение Zen Internet, мод Transparent Zen; им нужен browser.tabs.allow_transparent_browser): в непрозрачном окне подложка сплошная,
  // и прозрачные страницы стоят на ней. Область сайта становится «дырой» к подложке Windows — теми же слоями, что у Home насквозь
  // (chrome.css раздел 15: [lumi-home-live], маска #lumi-home-wall); прямоугольник дыры — по #tabbrowser-tabpanels.
  // В прозрачном режиме окна стекло видно и так (chrome.css раздел 14).
  const panels = () => document.getElementById("tabbrowser-tabpanels");
  function holeRect() {
    const r = panels()?.getBoundingClientRect(), wall = document.getElementById("lumi-home-wall");
    if (!r || !wall) return;
    wall.style.setProperty("--lumi-home-x", r.left + "px");
    wall.style.setProperty("--lumi-home-y", r.top + "px");
  }
  const siteWant = () => Services.prefs.getBoolPref(TRANSPARENT, false) && windowMode() == "opaque" && mica.matches &&
    window.windowState != window.STATE_MINIMIZED && !!api() && !selTab()?.hasAttribute("zen-essential") &&
    !document.getElementById(selTab()?.linkedPanel)?.classList.contains("lumi-pin-window");
  function update(from) {
    const tab = homeTab(from);
    setThrough(tab && wantDesktop() && mica.matches && window.windowState != window.STATE_MINIMIZED && api() ? tab : null);
    site = !through && !tab && siteWant(); // Home (и непрозрачная) рисует себя сама
    if (!through) site ? document.documentElement.setAttribute("lumi-home-live", "site") : document.documentElement.removeAttribute("lumi-home-live"); // "site" — дыра под обычным сайтом (chrome.css раздел 15)
    if (site) holeRect();
    applyAccent();
  }

  window.lumiHomeLive = {
    DESKTOP,
    want() { update(); return wantDesktop() ? DESKTOP : null; }, // аргумент (желание страницы) не читаем: см. шапку
    refresh: () => update(), // lumi-home.uc.js зовёт после выбора только что созданной Home (на TabSelect у неё ещё нет атрибута)
    // для проверок: accent policy окна браузера (2 — чёткий рабочий стол, 3 — размытие Windows, 0 — нет)
    win: () => api() && { accent: accentSet, browserHwnd: window.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle },
  };

  const onPref = () => update();
  const PREFS = [KIND, WIN, TRANSPARENT, HT, WPMODE];
  for (const n of PREFS) Services.prefs.addObserver(n, onPref); // применяются сразу
  window.addEventListener("unload", () => { for (const n of PREFS) Services.prefs.removeObserver(n, onPref); }, { once: true });
  // «Выгруженная» Home — закрытая вкладка: «L» создаёт новую, страница грузится ~0,3 с. У нового документа нет [lumi-through], а до появления корня Firefox
  // красит его тёмным холстом (вспышка на всю вкладку). Поэтому <browser> прячем (opacity 0 — видно дыру к рабочему столу, как у готовой Home) с начала загрузки
  // до появления корня; в этот момент ставим [lumi-through] и показываем (до первой отрисовки страницы)
  const showBrowser = b => b.style.removeProperty("opacity");
  window.addEventListener("DOMDocElementInserted", e => {
    if (through && e.target == through.linkedBrowser.contentDocument) { e.target.documentElement.setAttribute("lumi-through", ""); showBrowser(through.linkedBrowser); }
  }, true);
  UC_API.Windows.waitWindowLoading(window).then(() => gBrowser.addTabsProgressListener({
    onLocationChange(browser) {
      if (!through || browser != through.linkedBrowser || browser.contentDocument?.documentElement) return;
      browser.style.opacity = "0";
      setTimeout(() => showBrowser(browser), 1000); // страница не загрузилась — не оставляем невидимой
    },
  }));
  // область сайта меняется от Compacting, рейки и размера окна — дыра следует за ней
  UC_API.Windows.waitWindowLoading(window).then(() => { const p = panels(); if (p) new ResizeObserver(() => { if (site) holeRect(); }).observe(p); });
  UC_API.Windows.waitWindowLoading(window).then(() => update()); // окно уже «Прозрачное» при запуске
  window.addEventListener("TabSelect", e => { update(e.detail?.previousTab); requestAnimationFrame(() => update()); });
  window.addEventListener("sizemodechange", () => update());
  for (const ev of ["activate", "deactivate"]) window.addEventListener(ev, () => { accentSet = -2; update(); setTimeout(() => { accentSet = -2; update(); }, 150); }); // Windows может сбросить подложку при смене активности — ставим заново
  mica.addEventListener("change", () => update());
})();
