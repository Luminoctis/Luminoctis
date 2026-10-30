// ==UserScript==
// @name           Luminoctis: прозрачная Home
// @description    Прозрачный режим Home: область Home становится насквозь прозрачной, виден рабочий стол за окном браузера.
// ==/UserScript==

// Как устроено: страница Home (home/wallpaper.js) сообщает lumiHomeLive.want(DESKTOP | null).
// Пока выбрана Home, want задан и Windows рисует окно с прозрачностью (-moz-windows-mica):
//  окно браузера: SetWindowCompositionAttribute(ACCENT_ENABLE_TRANSPARENTGRADIENT, цвет 0) — прозрачный CSS становится дырой
//  в окне; [lumi-home-live] на корне (chrome.css раздел 15), transparent у <browser> Home, [lumi-through] на странице.
// «Размыть то, что за окном»: luminoctis.home.through.blur (+ скрытый blur-accent 3/4/5, по умолчанию 4).
// Ушли с Home / свернули окно — обычный вид (ACCENT_DISABLED — снова Mica/Acrylic).
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
  // окно браузера насквозь прозрачное (state 2 — ACCENT_ENABLE_TRANSPARENTGRADIENT, цвет 0) / обычное (0 — ACCENT_DISABLED);
  // luminoctis.home.through.blur — размытие Windows за окном. Только размытие, без тона: затемнял именно accent Windows (CSS от корня до <browser> прозрачный).
  // Скрытый luminoctis.home.through.blur-accent: 4 (по умолчанию) — ACCENT_ENABLE_ACRYLICBLURBEHIND, цвет AABBGGRR с alpha 1 (при alpha 0 acrylic бывает
  // непрозрачным), почти нулевой тон; 3 — ACCENT_ENABLE_BLURBEHIND, flags 0; 5 — ACCENT_ENABLE_HOSTBACKDROP. Если за окном тёмно — переключить.
  const BLUR = "luminoctis.home.through.blur", BLUR_ACCENT = BLUR + "-accent";
  const BLURS = { 3: { flags: 0, color: 0 }, 4: { flags: 2, color: 0x01ffffff }, 5: { flags: 2, color: 0x01ffffff } };
  let accentSet = 0;
  function accent(on) {
    const a = new U.ACCENT(), d = new U.DATA(), blur = on && Services.prefs.getBoolPref(BLUR, false);
    const bs = Services.prefs.getIntPref(BLUR_ACCENT, 4), b = BLURS[bs] ?? BLURS[4];
    Object.assign(a, blur ? { state: bs in BLURS ? bs : 4, ...b, anim: 0 } : { state: on ? 2 : 0, flags: on ? 2 : 0, color: 0, anim: 0 });
    d.attr = 19; // WCA_ACCENT_POLICY
    d.data = a.address();
    d.size = U.ACCENT.size;
    accentSet = U.comp(own(), d.address()) != 0 ? a.state : -1; // GetWindowCompositionAttribute accent не отдаёт — запоминаем своё
    return accentSet >= 0;
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
    const old = tab == through ? null : through, fresh = tab != through;
    through = tab;
    document.documentElement.toggleAttribute("lumi-home-live", !!tab);
    for (const [t, on] of [[old, false], [tab, true]]) {
      if (!t?.linkedBrowser) continue;
      on ? t.linkedBrowser.setAttribute("transparent", "true") : t.linkedBrowser.removeAttribute("transparent");
      t.linkedBrowser.contentDocument?.documentElement?.toggleAttribute("lumi-through", on);
    }
    if (fresh && api()) accent(!!tab);
  }
  function update() {
    const tab = homeTab();
    setThrough(tab && want && mica.matches && window.windowState != window.STATE_MINIMIZED && api() ? tab : null);
  }

  window.lumiHomeLive = {
    DESKTOP,
    want(v) { if (v != want) { want = v || null; update(); } return want; },
    update,
    get state() { return { want, through: !!through }; },
    // для проверок: accent policy окна браузера (2 — насквозь)
    win: () => api() && { accent: accentSet, browserHwnd: window.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle },
  };

  for (const p of [BLUR, BLUR_ACCENT]) Services.prefs.addObserver(p, () => { if (through && api()) accent(true); }); // применяется сразу
  window.addEventListener("TabSelect", update);
  window.addEventListener("sizemodechange", update);
  mica.addEventListener("change", update);
})();
