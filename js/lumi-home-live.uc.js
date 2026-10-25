// ==UserScript==
// @name           Luminoctis: живые сцены Home
// @description    Сцены Wallpaper Engine на Home — живые: программа WE играет сцену в своём окне (-playInWindow), окно лежит ровно под окном браузера, а область Home становится насквозь прозрачной.
// ==/UserScript==

// Как устроено: страница Home (home/wallpaper.js) сообщает, какая сцена WE сейчас на ней (lumiHomeLive.want(папка | null)).
// Пока выбрана Home, включена настройка luminoctis.home.wallpaper.we.live и Windows рисует окно с прозрачностью (-moz-windows-mica):
//  1) wallpaper64.exe -control openWallpaper -file <папка>\project.json -playInWindow "<имя>" -borderless — окно WE;
//  2) окну WE (FindWindowW по имени) — WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE (нет в панели задач и Alt+Tab, не активируется) и место
//     сразу под окном браузера, прямоугольник = прямоугольник окна браузера (физические пиксели — DPI учитывает сама Windows);
//  3) окно браузера: SetWindowCompositionAttribute(ACCENT_ENABLE_TRANSPARENTGRADIENT, цвет 0) — прозрачный CSS становится дырой
//     в окне; [lumi-home-live] на корне (chrome.css раздел 15), transparent у <browser> Home, [lumi-live] на странице.
// Ушли с Home / свернули окно — сначала обычный вид (ACCENT_DISABLED — снова Mica/Acrylic), потом окно WE прячется; через 30 с
// закрывается (closeWallpaper). Закрыли окно браузера — закрывается сразу. Не вышло (нет WE, окно не появилось) — остаётся статичный кадр.
// Запускается только wallpaper64/32.exe из папки Steam (we.exePath), аргументы — из папки обоев, у которой есть project.json сцены.
// Прозрачная Home (want(DESKTOP), «Фон: Прозрачный» в настройках): то же «насквозь», но без окна WE — видно то, что за браузером.
// Свойства сцены (редактор на Home) — -control applyProperties … -location <имя нашего окна>: только наше окно, обои рабочего стола не трогаются.
(() => {
  const PREF = "luminoctis.home.wallpaper.we.live";
  const we = ChromeUtils.importESModule("chrome://userchrome/content/luminoctis/home/we.js");
  const enabled = () => Services.prefs.getBoolPref(PREF, true);
  const mica = matchMedia("(-moz-windows-mica)"); // без него Windows не рисует прозрачные пиксели окна
  // имя окна WE — своё у каждого окна браузера и у каждого профиля («Luminoctis Home k3x9q», «Luminoctis Home k3x9q 2», …):
  // окно WE ищется по имени во всей системе — два браузера (два профиля) с одним именем делили бы одно окно WE и закрывали его друг другу.
  // Имя от пути профиля постоянно между запусками — остаток прошлого запуска этого профиля находится и закрывается.
  let hash = 0;
  for (const c of PathUtils.profileDir.toLowerCase()) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const BASE = "Luminoctis Home " + hash.toString(36);
  const taken = new Set([...Services.wm.getEnumerator("navigator:browser")].map(w => w.lumiHomeLive?.name));
  let n = 1;
  while (taken.has(n == 1 ? BASE : BASE + " " + n)) n++;
  const NAME = n == 1 ? BASE : BASE + " " + n;
  const DESKTOP = "desktop"; // want(DESKTOP) — прозрачная Home без окна WE (папка обоев — всегда полный путь, не совпадёт)

  // ---------- Win32 через js-ctypes ----------
  let U;
  function api() {
    if (U !== undefined) return U;
    try {
      const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
      const lib = ctypes.open("user32.dll"), H = ctypes.voidptr_t, I = ctypes.int32_t, UI = ctypes.uint32_t;
      const RECT = new ctypes.StructType("RECT", [{ l: I }, { t: I }, { r: I }, { b: I }]);
      const ACCENT = new ctypes.StructType("ACCENT_POLICY", [{ state: I }, { flags: I }, { color: UI }, { anim: I }]);
      const DATA = new ctypes.StructType("WINCOMPATTRDATA", [{ attr: I }, { data: ctypes.voidptr_t }, { size: ctypes.size_t }]);
      const f = (name, ret, ...args) => lib.declare(name, ctypes.winapi_abi, ret, ...args);
      U = { ctypes, RECT, ACCENT, DATA,
        find: f("FindWindowW", H, ctypes.char16_t.ptr, ctypes.char16_t.ptr),
        cls: f("GetClassNameW", I, H, ctypes.char16_t.ptr, I),
        isWindow: f("IsWindow", I, H),
        prev: f("GetWindow", H, H, UI),
        rect: f("GetWindowRect", I, H, RECT.ptr),
        pos: f("SetWindowPos", I, H, H, I, I, I, I, UI),
        show: f("ShowWindow", I, H, I),
        getEx: f("GetWindowLongW", I, H, I),
        setEx: f("SetWindowLongW", I, H, I, I),
        comp: f("SetWindowCompositionAttribute", I, H, DATA.ptr),
        visible: f("IsWindowVisible", I, H),
      };
    } catch (e) { console.warn("Luminoctis живые сцены: нет Win32", e); U = null; }
    return U;
  }
  const own = () => U.ctypes.voidptr_t(U.ctypes.UInt64(window.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle));
  const same = (a, b) => a && b && a.toString() == b.toString();
  const SWP = { NOACTIVATE: 0x10, SHOW: 0x40, FRAME: 0x20, NOOWNERZORDER: 0x200 };
  function rectOf(h) {
    const r = new U.RECT();
    U.rect(h, r.address());
    return { x: r.l, y: r.t, w: r.r - r.l, h: r.b - r.t };
  }
  // окно WE с нашим именем; класс проверяем — чужое окно с таким заголовком не трогаем
  function findWE() {
    const h = U.find(null, NAME);
    if (h.isNull()) return null;
    const buf = U.ctypes.char16_t.array(64)();
    U.cls(h, buf, 64);
    return buf.readString() == "WPEOverlappedWallpaper" ? h : null;
  }
  // окно браузера насквозь прозрачное (state 2 — ACCENT_ENABLE_TRANSPARENTGRADIENT, цвет 0) / обычное (0 — ACCENT_DISABLED)
  function accent(on) {
    const a = new U.ACCENT(), d = new U.DATA();
    Object.assign(a, { state: on ? 2 : 0, flags: on ? 2 : 0, color: 0, anim: 0 });
    d.attr = 19; // WCA_ACCENT_POLICY
    d.data = a.address();
    d.size = U.ACCENT.size;
    accentSet = U.comp(own(), d.address()) != 0 ? a.state : -1; // GetWindowCompositionAttribute accent не отдаёт — запоминаем своё
    return accentSet >= 0;
  }


  // ---------- окно Wallpaper Engine ----------
  let accentSet = 0, want = null, shown = null, hwnd = null, through = null, closeTimer = 0, poll = 0, failed = null;
  const alive = () => hwnd && U.isWindow(hwnd) != 0;
  let exe = null; // путь к wallpaper64.exe — запоминается при открытии: закрывать надо синхронно, и при выходе из браузера
  function run(args) {
    if (!exe) return false;
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(exe);
    const p = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    p.init(f);
    p.runwAsync(args, args.length); // wallpaper64.exe передаёт команду запущенной программе WE и выходит
    return true;
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const args = (dir, r) => ["-control", "openWallpaper", "-file", PathUtils.join(dir, "project.json"), "-playInWindow", NAME,
    "-width", String(r.w), "-height", String(r.h), "-borderless"];
  // открыть сцену папки dir в окне NAME; true — окно нашлось
  async function open(dir) {
    const it = await we.item(dir).catch(() => null);
    if (it?.type != "scene") return false; // только сцены: видео и веб-обои и так живые на странице
    // то же имя — WE грузит новую сцену в то же окно; новое окно WE ставит в угол экрана, под браузер его сразу уносит place()
    exe ??= await we.exePath();
    if (!run(args(it.page, rectOf(own())))) return false;
    for (let t = 0; t < 15000 && !(hwnd = findWE()); t += 50) await sleep(50);
    if (!hwnd) return false;
    U.show(hwnd, 0); // SW_HIDE: новый стиль окна применяется к панели задач только после скрытия
    U.setEx(hwnd, -20, (U.getEx(hwnd, -20) | 0x80 | 0x08000000) & ~0x40000); // TOOLWINDOW | NOACTIVATE, без APPWINDOW
    shown = dir;
    place(true);
    if (Object.keys(await we.savedProps(it)).length) await applyProps(dir); // свои значения свойств этой сцены
    await sleep(500); // первый кадр сцены
    return true;
  }
  // ровно под окном браузера, его прямоугольник; force — даже если место и порядок не изменились
  let last = "";
  function place(force) {
    if (!alive()) return false;
    const me = own(), r = rectOf(me), key = `${r.x},${r.y},${r.w},${r.h}`;
    if (!force && key == last && same(U.prev(hwnd, 3 /* GW_HWNDPREV */), me)) return true;
    last = key;
    U.pos(hwnd, me, r.x, r.y, r.w, r.h, SWP.NOACTIVATE | SWP.NOOWNERZORDER | SWP.SHOW | SWP.FRAME);
    return true;
  }
  // свойства сцены (свои значения поверх project.json) — только нашему окну; аргумент собирает we.propsArg из проверенных значений
  async function applyProps(dir) {
    if (dir != shown || !alive()) return false;
    const it = await we.item(dir), arg = it && we.propsArg(it.props, { ...we.defaults(it.props), ...(await we.savedProps(it)) });
    return !!arg && run(["-control", "applyProperties", "-properties", arg, "-location", NAME]);
  }
  function hide() {
    if (alive()) U.show(hwnd, 0);
    last = "";
    clearTimeout(closeTimer);
    if (shown) closeTimer = setTimeout(close, 30000); // вернулись быстро — сцена не перезапускается
  }
  function close() {
    clearTimeout(closeTimer);
    if (alive()) U.show(hwnd, 0);
    if (shown || hwnd) { run(["-control", "closeWallpaper", "-location", NAME]); }
    shown = hwnd = null;
  }

  // ---------- окно браузера: насквозь / обычное ----------
  const homeTab = () => (gBrowser.selectedTab?.hasAttribute("lumi-home") ? gBrowser.selectedTab : null);
  function setThrough(tab) {
    if (tab == through) return;
    const old = through;
    through = tab;
    document.documentElement.toggleAttribute("lumi-home-live", !!tab);
    for (const [t, on] of [[old, false], [tab, true]]) {
      if (!t?.linkedBrowser) continue;
      on ? t.linkedBrowser.setAttribute("transparent", "true") : t.linkedBrowser.removeAttribute("transparent");
      t.linkedBrowser.contentDocument?.documentElement?.toggleAttribute("lumi-live", on);
    }
    if (api()) accent(!!tab);
  }

  let chain = Promise.resolve();
  const update = () => (chain = chain.then(step).catch(e => console.warn("Luminoctis живые сцены:", e)));
  async function step() {
    const tab = homeTab();
    const desk = want == DESKTOP;
    const dir = tab && want && (desk || enabled()) && mica.matches && window.windowState != window.STATE_MINIMIZED && api() ? want : null;
    if (!dir || dir == failed) { setThrough(null); hide(); stopPoll(); return; }
    if (desk) { hide(); stopPoll(); setThrough(tab); return; } // прозрачная Home: окно WE не нужно
    if (dir != shown || !alive()) {
      setThrough(null); // пока сцена открывается — статичный кадр
      if (!(await open(dir))) { failed = dir; hide(); stopPoll(); return; } // не открылась — статичный кадр, до смены обоев не повторяем
      if (homeTab() != tab || want != dir) return update(); // пока ждали окно, всё поменялось
    }
    clearTimeout(closeTimer);
    place(true);
    setThrough(tab);
    startPoll();
  }
  // перемещение окна событий не даёт — сверяем место 4 раза в секунду, пока сцена видна
  function startPoll() { poll ||= setInterval(() => place(false) || update(), 250); }
  function stopPoll() { clearInterval(poll); poll = 0; }

  window.lumiHomeLive = {
    name: NAME,
    DESKTOP,
    applyProps,
    want(dir) { if (dir != want) { want = dir || null; failed = null; update(); } return want; },
    args,
    update,
    get state() { return { want, shown, hwnd: hwnd?.toString() ?? null, through: !!through, name: NAME }; },
    // для проверок: прямоугольники, окно WE сразу под браузером и видно ли, accent policy окна браузера (2 — насквозь)
    win: () => api() && { browser: rectOf(own()), we: alive() ? rectOf(hwnd) : null, under: !!alive() && same(U.prev(hwnd, 3), own()),
      visible: !!alive() && U.visible(hwnd) != 0, accent: accentSet, hwnd: hwnd && U.ctypes.cast(hwnd, U.ctypes.uintptr_t).value.toString(),
      browserHwnd: window.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle },
    whenIdle: () => chain,
  };

  window.addEventListener("TabSelect", () => { failed = null; update(); }); // сцена не открылась — пробуем снова при возврате на Home
  window.addEventListener("sizemodechange", update);
  window.addEventListener("activate", () => poll && place(true)); // браузер поднялся над другими окнами — WE снова сразу под ним
  mica.addEventListener("change", update);
  const onPref = () => update();
  Services.prefs.addObserver(PREF, onPref);
  window.addEventListener("unload", () => {
    Services.prefs.removeObserver(PREF, onPref);
    stopPoll();
    close();
  });
  // остаток прошлого запуска (браузер упал, окно WE осталось) — закрыть
  if (api() && (hwnd = findWE())) we.exePath().then(e => { exe = e; close(); });
})();
