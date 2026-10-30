// ==UserScript==
// @name           Luminoctis: прозрачная Home
// @description    Прозрачный режим Home: область Home становится насквозь прозрачной, виден рабочий стол за окном браузера.
// ==/UserScript==

// Как устроено: страница Home (home/wallpaper.js) сообщает lumiHomeLive.want(DESKTOP | null).
// Пока выбрана Home, want задан и Windows рисует окно с прозрачностью (-moz-windows-mica): [lumi-home-live] на корне (chrome.css раздел 15),
// transparent у <browser> Home, [lumi-through] на странице.
// Accent policy окна браузера (SetWindowCompositionAttribute) задаёт luminoctis.look.blur-kind, когда окно «Прозрачное» (на любой вкладке)
// или Home «насквозь»: none — ACCENT_ENABLE_TRANSPARENTGRADIENT (чёткий рабочий стол), blur — ACCENT_ENABLE_BLURBEHIND (размытие Windows),
// acrylic / mica — ACCENT_DISABLED (родная подложка Zen, её вид пишет lumi-palette в widget.windows.mica.toplevel-backdrop).
// Ушли с Home / свернули окно / режим окна не прозрачный — ACCENT_DISABLED.
(() => {
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
  const KIND = "luminoctis.look.blur-kind", WIN = "luminoctis.look.window";
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
  const wantKind = on => on && mica.matches && window.windowState != window.STATE_MINIMIZED ? Services.prefs.getStringPref(KIND, "acrylic") : "";
  function applyAccent() {
    if (!api()) return;
    const kind = wantKind(through || Services.prefs.getStringPref(WIN, "") == "transparent"), state = STATES[kind]?.state ?? 0;
    if (state != accentSet) accent(kind);
  }

  // ---------- окно браузера: насквозь / обычное ----------
  let want = null, through = null;
  // Home «видна»: выбрана она сама или выбран закреп-окошко (lumi-rail.uc.js showPin) — Home остаётся под ним, режим насквозь не выключаем
  const homeTab = () => {
    const sel = gBrowser.selectedTab;
    if (sel?.hasAttribute("lumi-home")) return sel;
    if (!document.getElementById(sel?.linkedPanel)?.classList.contains("lumi-pin-window")) return null;
    return gBrowser.tabs.find(t => t.hasAttribute("lumi-home") && document.getElementById(t.linkedPanel)?.classList.contains("deck-selected")) ?? null;
  };
  function setThrough(tab) {
    const old = tab == through ? null : through;
    through = tab;
    document.documentElement.toggleAttribute("lumi-home-live", !!tab);
    for (const [t, on] of [[old, false], [tab, true]]) {
      if (!t?.linkedBrowser) continue;
      on ? t.linkedBrowser.setAttribute("transparent", "true") : t.linkedBrowser.removeAttribute("transparent");
      t.linkedBrowser.contentDocument?.documentElement?.toggleAttribute("lumi-through", on);
    }
  }
  function update() {
    const tab = homeTab();
    setThrough(tab && want && mica.matches && window.windowState != window.STATE_MINIMIZED && api() ? tab : null);
    applyAccent();
  }

  window.lumiHomeLive = {
    DESKTOP,
    want(v) { if (v != want) { want = v || null; update(); } return want; },
    update,
    get state() { return { want, through: !!through }; },
    // для проверок: accent policy окна браузера (2 — чёткий рабочий стол, 3 — размытие Windows, 0 — нет)
    win: () => api() && { accent: accentSet, browserHwnd: window.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle },
  };

  Services.prefs.addObserver(KIND, update); // применяются сразу
  Services.prefs.addObserver(WIN, update);
  window.addEventListener("unload", () => { Services.prefs.removeObserver(KIND, update); Services.prefs.removeObserver(WIN, update); }, { once: true });
  UC_API.Windows.waitWindowLoading(window).then(update); // окно уже «Прозрачное» при запуске
  window.addEventListener("TabSelect", update);
  window.addEventListener("sizemodechange", update);
  mica.addEventListener("change", update);
})();
