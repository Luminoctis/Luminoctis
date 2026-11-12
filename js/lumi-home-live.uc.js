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
// acrylic — ACCENT_ENABLE_ACRYLICBLURBEHIND с тёмным оттенком, mica — ACCENT_DISABLED (родная подложка Zen, её вид пишет lumi-palette в widget.windows.mica.toplevel-backdrop).
// Рецепт как у Windhawk «Translucent Windows» (Blur, AccentBlurBehind 3A232323): при включённом accent родная подложка окна выключается (DWMSBT_AUTO),
// плюс DwmEnableBlurBehindWindow и рамка на всё окно. Без этого два слоя спорили: засвет и чёрные/серые прямоугольники при перерисовке (docs/areas/look.md).
// Ушли с Home / свернули окно / режим окна не прозрачный — ACCENT_DISABLED.
(() => {
  const { jsUrl } = ChromeUtils.importESModule(Components.stack.filename.replace(/[^/]*$/, "lumi-paths.sys.mjs"));
  const { windowMode } = ChromeUtils.importESModule(jsUrl("lumi-palette.sys.mjs"));
  const { setGlass } = ChromeUtils.importESModule(jsUrl("lumi-glass.sys.mjs"));
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
      const BB = new ctypes.StructType("DWM_BLURBEHIND", [{ flags: UI }, { enable: I }, { rgn: ctypes.voidptr_t }, { max: I }]);
      const MARGINS = new ctypes.StructType("MARGINS", [{ l: I }, { r: I }, { t: I }, { b: I }]);
      const dwm = ctypes.open("dwmapi.dll"), gdi = ctypes.open("gdi32.dll"), W = ctypes.winapi_abi, P = ctypes.voidptr_t;
      U = { ctypes, ACCENT, DATA, BB, MARGINS, comp: lib.declare("SetWindowCompositionAttribute", W, I, P, DATA.ptr),
        blurBehind: dwm.declare("DwmEnableBlurBehindWindow", W, I, P, BB.ptr), extend: dwm.declare("DwmExtendFrameIntoClientArea", W, I, P, MARGINS.ptr),
        attr: dwm.declare("DwmSetWindowAttribute", W, I, P, UI, P, UI), pos: lib.declare("SetWindowPos", W, I, P, P, I, I, I, I, UI),
        rgn: gdi.declare("CreateRectRgn", W, P, I, I, I, I), del: gdi.declare("DeleteObject", W, I, P) };
    } catch (e) { console.warn("Luminoctis прозрачная Home: нет Win32", e /* l10n-skip */); U = null; }
    return U;
  }
  const own = () => U.ctypes.voidptr_t(U.ctypes.UInt64(window.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle));
  // none → state 2 (TRANSPARENTGRADIENT), flags 2; blur → state 3 (BLURBEHIND), flags 0; иначе 0. Цвет всегда 0.
  // Проверено на экране (Win11 26300): 3 с flags 0 — чистое размытие (Windows чуть притемняет); 3 с flags 2 — чёрное при любом цвете,
  // 4 (acrylic) с цветом 0 — белёсое, с тёмным цветом (ABGR 0x3A232323, как у Windhawk) — тёмное стекло; 5 (hostbackdrop) — без размытия.
  const KIND = "luminoctis.look.blur-kind", WIN = "luminoctis.look.window", TRANSPARENT = "browser.tabs.allow_transparent_browser";
  const STATES = { none: { state: 2, flags: 2 }, blur: { state: 3, flags: 0 }, acrylic: { state: 4, flags: 0, color: 0x3A232323 } };
  // родная подложка окна (DWMWA_SYSTEMBACKDROP_TYPE = 38): под accent — AUTO (нет), иначе — то, что выбрал lumi-palette (toplevel-backdrop 1 — Mica, 2 — Acrylic)
  function backdrop(on) {
    const h = own(), v = new U.ctypes.uint32_t(on ? 0 : ({ 1: 2, 2: 3, 3: 4 })[Services.prefs.getIntPref("widget.windows.mica.toplevel-backdrop", 2)] ?? 3);
    U.attr(h, 38, v.address(), 4);
    const bb = new U.BB();
    Object.assign(bb, { flags: 1 | 2 | 4, enable: on ? 1 : 0, rgn: on ? U.rgn(0, 0, -1, -1) : null, max: 1 }); // ENABLE | BLURREGION | TRANSITIONONMAXIMIZED
    U.blurBehind(h, bb.address());
    glassOn = on;
    handle = window.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle;
    hooked = setGlass(handle, on);
    window[on && !hooked ? "addEventListener" : "removeEventListener"]("MozAfterPaint", fullGlass); // запасной путь — только пока перехват не встал
    if (on) { U.del(bb.rgn); fullGlass(); }
    // пересчёт рамки окна (как при смене размера, у Windhawk — TriggerWindowNCRendering): Zen заново ставит стекло уже через перехват.
    // Без этого после запуска окно оставалось чёрным, пока его не свернуть в окно и обратно
    U.pos(h, null, 0, 0, 0, 0, 0x1 | 0x2 | 0x4 | 0x10 | 0x20); // NOSIZE | NOMOVE | NOZORDER | NOACTIVATE | FRAMECHANGED
  }
  // Firefox после каждой отрисовки сужает стекло до «непрозрачной области» (элементы со сплошным фоном, nsWindow::UpdateOpaqueRegionInternal) —
  // под ней размытие пропадало: чёрные прямоугольники при наведении и загрузке. Windhawk перехватывал этот вызов; мы возвращаем стекло на всё окно сразу после отрисовки
  // (замер 2026-11-10: чёрных точек в полосе интерфейса до 20 тыс. на кадр без этого, 0 с ним)
  // Основной путь — перехват вызова, как у Windhawk (lumi-glass.sys.mjs); MozAfterPaint — запасной, если перехват не встал (стекло возвращается с опозданием в кадр)
  let glassOn = false, hooked = false, full = null, handle = null;
  function fullGlass() {
    if (!full) { full = new U.MARGINS(); Object.assign(full, { l: -1, r: -1, t: -1, b: -1 }); }
    U.extend(own(), full.address());
  }
  let accentSet = 0;
  function accent(kind) {
    const a = new U.ACCENT(), d = new U.DATA();
    Object.assign(a, { state: 0, flags: 0, color: 0, anim: 0 }, STATES[kind]);
    d.attr = 19; // WCA_ACCENT_POLICY
    d.data = a.address();
    d.size = U.ACCENT.size;
    accentSet = U.comp(own(), d.address()) != 0 ? a.state : -1; // GetWindowCompositionAttribute accent не отдаёт — запоминаем своё
    try { backdrop(a.state > 0); } catch (e) { console.warn("Luminoctis: подложка окна", e); } /* l10n-skip */
    return accentSet >= 0;
  }
  // Родная подложка Windows (Acrylic/Mica, DWMWA_SYSTEMBACKDROP_TYPE) у неактивного окна по замыслу ОС заменяется сплошным цветом — размытие пропадает.
  // Accent policy от активности окна не зависит: acrylic — сам accent, у неактивного окна в виде mica включаем «blur» вместо родной подложки.
  const inactive = () => Services.focus.activeWindow != window;
  const wantKind = on => {
    if (!on || !mica.matches || window.windowState == window.STATE_MINIMIZED) return "";
    const k = Services.prefs.getStringPref(KIND, "acrylic");
    return k == "mica" && inactive() ? "blur" : k;
  };
  function applyAccent() {
    if (!api()) return;
    const kind = wantKind(through || site || windowMode(window) == "transparent"), state = STATES[kind]?.state ?? 0;
    if (state != accentSet) accent(kind);
  }

  // ---------- окно браузера: насквозь / обычное ----------
  let through = null, site = false;
  const HT = "luminoctis.look.homeTransparency", WPMODE = "luminoctis.home.wallpaper.mode";
  const wantDesktop = () => Services.prefs.getStringPref(WPMODE, "wallpaper") == "transparent" || (windowMode(window) == "transparent" && Services.prefs.getIntPref(HT, 0) > 0);
  // Home «видна»: выбрана она сама или выбран закреп-окошко (lumi-rail.uc.js showPin) — Home остаётся под ним, режим насквозь не выключаем
  // from — вкладка, с которой только что ушли (TabSelect): в этот момент у закрепа ещё нет класса окошка, а у Home — deck-selected (их ставит рейка позже),
  // без подсказки режим «насквозь» на кадр гас и больше не включался
  // Glance (Alt+клик из Home или из закрепа-окошка): выбрана его вкладка, считаем по родителю
  const selTab = () => { const t = gBrowser.selectedTab; return window.gZenGlanceManager?.getTabOrGlanceParent?.(t) ?? t; };
  const homeTab = from => {
    const sel = selTab();
    if (sel?.hasAttribute("lumi-home") || sel?.hasAttribute("lumi-time-full")) return sel; // большой LumiTime — тот же вид «насквозь», что у Home (иначе под страницей сплошной bg0)
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
  const siteWant = () => Services.prefs.getBoolPref(TRANSPARENT, false) && windowMode(window) == "opaque" && mica.matches &&
    window.windowState != window.STATE_MINIMIZED && !!api() && !selTab()?.hasAttribute("zen-essential") &&
    !document.getElementById(selTab()?.linkedPanel)?.classList.contains("lumi-pin-window");
  function update(from) {
    const tab = homeTab(from);
    setThrough(tab && wantDesktop() && mica.matches && window.windowState != window.STATE_MINIMIZED && api() ? tab : null);
    site = !through && !tab && siteWant(); // Home (и непрозрачная) рисует себя сама
    if (!through) site ? document.documentElement.setAttribute("lumi-home-live", "site") : document.documentElement.removeAttribute("lumi-home-live"); // "site" — дыра под обычным сайтом (chrome.css раздел 15)
    if (site || through?.hasAttribute("lumi-time-full")) holeRect(); // у большого LumiTime стену под интерфейсом (маска вне вкладки) задаёт не страница Home, а мы
    applyAccent();
  }

  window.lumiHomeLive = {
    DESKTOP,
    want() { update(); return wantDesktop() ? DESKTOP : null; }, // аргумент (желание страницы) не читаем: см. шапку
    refresh: () => update(), // lumi-home.uc.js зовёт после выбора только что созданной Home (на TabSelect у неё ещё нет атрибута)
    // для проверок: accent policy окна браузера (2 — чёткий рабочий стол, 3 — размытие Windows, 0 — нет)
    win: () => api() && { accent: accentSet, browserHwnd: window.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle },
  };

  const onPref = () => { update(); setTimeout(() => { accentSet = -2; update(); }, 150); }; // Zen ставит свою подложку по toplevel-backdrop после нас — перекрываем
  const PREFS = [KIND, WIN, TRANSPARENT, HT, WPMODE];
  for (const n of PREFS) Services.prefs.addObserver(n, onPref); // применяются сразу
  window.addEventListener("unload", () => { for (const n of PREFS) Services.prefs.removeObserver(n, onPref); if (handle) setGlass(handle, false); }, { once: true }); // иначе хвост в glass остаётся после закрытия окна
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
  UC_API.Windows.waitWindowLoading(window).then(() => { const p = panels(); if (p) new ResizeObserver(() => { if (site || through?.hasAttribute("lumi-time-full")) holeRect(); }).observe(p); });
  // Стекло — сразу, до первого показа окна: Windows решает, как выводить развёрнутое на весь экран окно, при показе, и если стекла ещё нет,
  // окно остаётся чёрным до смены режима «в окно ↔ на весь экран» (у Windhawk стекло ставится при создании окна). Полная проверка — после загрузки
  try { if (windowMode(window) == "transparent" && api()) accent(wantKind(true)); } catch (e) { console.warn("Luminoctis: раннее стекло окна", e); } /* l10n-skip */
  UC_API.Windows.waitWindowLoading(window).then(() => update()); // окно уже «Прозрачное» при запуске
  window.addEventListener("TabSelect", e => { update(e.detail?.previousTab); requestAnimationFrame(() => update()); });
  window.addEventListener("sizemodechange", () => update());
  for (const ev of ["activate", "deactivate"]) window.addEventListener(ev, () => { accentSet = -2; update(); setTimeout(() => { accentSet = -2; update(); }, 150); }); // Windows может сбросить подложку при смене активности — ставим заново
  mica.addEventListener("change", () => update());
})();
