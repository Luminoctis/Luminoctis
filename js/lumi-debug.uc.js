// ==UserScript==
// @name           Luminoctis: окно отладки
// @description    Ctrl+Alt+Shift+D или кнопка в настройках («О моде») открывает окно, где визуальные эффекты мода запускаются вручную, без настоящей причины. window.lumiDebug = { actions, run(id, args), open(), cleanup() }.
// ==/UserScript==

// Список действий — массив actions ниже: {id, group, label, hint, run({tab, n})}. Чтобы добавить действие, допиши одну строку. Окно (settings/debug.js) рисует его само.
// tab — выбранный в окне закреп (вкладка), n — число. Всё, что подменяется, снимает cleanup() (кнопка «Сбросить всё», закрытие окна, закрытие этого окна браузера).
(() => {
  const { jsUrl, pageUrl } = ChromeUtils.importESModule(Components.stack.filename.replace(/[^/]*$/, "lumi-paths.sys.mjs"));
  const dbg = ChromeUtils.importESModule(jsUrl("lumi-debug.sys.mjs"));
  const URL = pageUrl("settings/debug.html");
  const SYSTEM = Services.scriptSecurityManager.getSystemPrincipal();
  const root = document.documentElement;
  const fx = () => window.lumiDownloadsFx;
  const logo = () => document.getElementById("lumi-logo");
  const pinBtn = tab => [...document.querySelectorAll("#lumi-pins .lumi-pin")].find(b => b.tab === tab);
  const badged = new Set(); // вкладки с подменённым значком
  const fakeDl = { hasProgress: true, progress: 40, stopped: false, succeeded: false };
  const COMPACT = ["luminoctis.compact.sidebar", "luminoctis.compact.tabstrip", "zen.view.compact.hide-toolbar"];
  let logoAttr = null, loadTimer = 0;
  const openTab = (url, opts) => gBrowser.selectedTab = gBrowser.addTab(url, { triggeringPrincipal: SYSTEM, ...opts });
  const block = q => openTab(pageUrl("home/time-block.html") + "?url=" + encodeURIComponent("https://example.org/") + "&site=example.org&" + q);
  const updateDot = on => root.toggleAttribute("lumi-update", on ?? !!Services.prefs.getStringPref("luminoctis.update.available", ""));

  function stopLoad() {
    clearInterval(loadTimer);
    clearTimeout(loadTimer);
    gURLBar.removeAttribute("lumi-loading");
    gURLBar.style.setProperty("--lumi-load", 0);
  }
  function fakeLoad() { // как ход настоящей загрузки (lumi-urlbar.uc.js): 10% → 90% за 3 с, в конце 100% и угасание
    stopLoad();
    const t0 = Date.now();
    gURLBar.setAttribute("lumi-loading", "");
    loadTimer = setInterval(() => {
      const p = Math.min((Date.now() - t0) / 3000, 1);
      gURLBar.style.setProperty("--lumi-load", (0.1 + 0.8 * p).toFixed(3));
      if (p < 1) return;
      clearInterval(loadTimer);
      gURLBar.style.setProperty("--lumi-load", 1);
      loadTimer = setTimeout(() => { gURLBar.removeAttribute("lumi-loading"); loadTimer = setTimeout(() => gURLBar.style.setProperty("--lumi-load", 0), 500); }, 250);
    }, 50);
  }
  const setBadge = (tab, spec) => { luminoctis.debugBadge(tab, spec); spec ? badged.add(tab) : badged.delete(tab); };
  const setTasks = kind => {
    const l = logo();
    if (!l) return;
    logoAttr ??= l.getAttribute("lumi-tasks") ?? "";
    kind ? l.setAttribute("lumi-tasks", kind) : l.removeAttribute("lumi-tasks");
  };
  const download = (on, done) => {
    if (on) { fx().active.add(fakeDl); return fx().sync(); }
    fx().active.delete(fakeDl);
    fx().sync();
    if (done) fx().wave();
  };

  const actions = [
    { group: "Загрузки", id: "dl-run", label: "Загрузка идёт", hint: "Силовые линии от кнопки загрузок (нужен флажок «Эффект загрузок»)", run: () => download(true) },
    { group: "Загрузки", id: "dl-done", label: "Загрузка завершена", hint: "Линии гаснут, по окну проходит волна", run: () => download(false, true) },
    { group: "Загрузки", id: "dl-fail", label: "Ошибка или отмена", hint: "Линии гаснут без волны", run: () => download(false) },
    { group: "Адресная строка", id: "urlbar-load", label: "Загрузка сайта 0→100%", hint: "Полоса в поле адреса, ~3 с, сайт не грузится", run: fakeLoad },
    { group: "Адресная строка", id: "urlbar-load-off", label: "Остановить полосу", hint: "Сразу погасить", run: stopLoad },
    { group: "Значки закрепов", id: "badge-n", label: "Число", hint: "Значок с числом на выбранном закрепе (число — выше)", run: ({ tab, n }) => tab && setBadge(tab, { n }) },
    { group: "Значки закрепов", id: "badge-dot", label: "Точка", hint: "Новый заголовок без числа", run: ({ tab }) => tab && setBadge(tab, { n: 0, dot: true }) },
    {
      group: "Значки закрепов", id: "badge-ping", label: "Пульсация", hint: "Повторить пульсацию значка",
      run: ({ tab, n }) => {
        if (!tab) return;
        if (!badged.has(tab)) setBadge(tab, { n });
        const b = pinBtn(tab);
        b?.removeAttribute("lumi-ping");
        void b?.offsetWidth;
        b?.setAttribute("lumi-ping", "");
      },
    },
    { group: "Значки закрепов", id: "badge-reset", label: "Сбросить значки", hint: "Вернуть настоящие значки всех закрепов", run: () => { for (const t of [...badged]) setBadge(t, null); } },
    ...["type", "tab-open", "tab-close", "tab-switch", "click", "download"].map(a => (
      { group: "Звуки", id: "sound-" + a, label: a, hint: "Играет, даже если звуки выключены", run: () => window.lumiSounds.play(a, { force: true, ignoreFocus: true }) })),
    { group: "Точки", id: "update-on", label: "Точка обновления: показать", hint: "На шестерёнке; настоящее состояние обновления не меняется", run: () => updateDot(true) },
    { group: "Точки", id: "update-off", label: "Точка обновления: убрать", hint: "Вернуть по настоящему состоянию", run: () => updateDot() },
    { group: "Точки", id: "tasks-today", label: "Задачи на «L»: сегодня", hint: "Жёлтая точка", run: () => setTasks("today") },
    { group: "Точки", id: "tasks-late", label: "Задачи на «L»: просрочено", hint: "Красная точка", run: () => setTasks("late") },
    { group: "Точки", id: "tasks-off", label: "Задачи на «L»: убрать", hint: "Вернуть как было", run: () => { setTasks(logoAttr || ""); logoAttr = null; } },
    { group: "Блокировка", id: "block-focus", label: "Блок фокуса", hint: "Заглушка во вкладке: «Фокус — вернись после…»", run: () => block("until=18:00&phase=focus&kind=focus") },
    { group: "Блокировка", id: "block-break", label: "Блок перерыва", hint: "Заглушка: «Перерыв — сайт закрыт»", run: () => block("until=15:30&phase=break&kind=focus") },
    { group: "Блокировка", id: "block-strict", label: "Строгий режим", hint: "Заглушка без «Всё равно открыть»", run: () => block("until=22:00&kind=strict&list=" + encodeURIComponent("Работа")) },
    { group: "Окна", id: "win-private", label: "Приватное окно", hint: "Открыть новое приватное окно", run: () => OpenBrowserWindow({ private: true }) },
    { group: "Окна", id: "compact-on", label: "Compact mode: вкл", hint: "Рейка, полоса и адрес прячутся; «Сбросить всё» вернёт настройки", run: () => COMPACT.forEach(p => dbg.setBoolPref(p, true)) },
    { group: "Окна", id: "compact-off", label: "Compact mode: выкл", hint: "Всё на месте", run: () => COMPACT.forEach(p => dbg.setBoolPref(p, false)) },
    { group: "Вкладки", id: "tab-glitch", label: "Глитч вкладки", hint: "Показывает редкий глитч смены вкладки сразу", run: () => window.lumiGlitch.run(undefined, { debug: true }) },
    { group: "Вкладки", id: "tab-gray", label: "Выгруженная вкладка", hint: "Новая вкладка в фоне, серая, пока не выбрана", run: () => gBrowser.addTab("https://example.org/", { triggeringPrincipal: SYSTEM, createLazyBrowser: true }) },
  ];

  const { BrowserWindowTracker } = ChromeUtils.importESModule("resource:///modules/BrowserWindowTracker.sys.mjs");
  // шанс глитча — во всех окнах сразу; не pref, после перезапуска снова 1/100
  const setGlitchChance = n => { for (const w of BrowserWindowTracker.orderedWindows) if (w.lumiGlitch) w.lumiGlitch.chance = 1 / n; };
  // shared=false: только своё окно (общие подмены — шанс глитча, prefs — принадлежат открытому окну отладки)
  function cleanup(shared = true) {
    if (shared) setGlitchChance(100);
    if (fx()) download(false);
    stopLoad();
    for (const t of [...badged]) setBadge(t, null);
    setTasks(logoAttr || "");
    logoAttr = null;
    updateDot();
    if (shared) dbg.restorePrefs();
  }
  const debugWin = () => { for (const w of Services.wm.getEnumerator("")) { try { if (w.location.href.startsWith(URL)) return w; } catch {} } };
  function open() {
    const w = debugWin();
    if (w) return void w.focus();
    window.openDialog(URL, "lumi-debug", `chrome,dialog=no,resizable,alwaysRaised,width=420,height=760,left=${Math.max(0, window.screenX + window.outerWidth - 440)},top=${window.screenY + 40}`);
  }
  // args.pin — номер закрепа (по умолчанию первый), args.n — число
  async function run(id, args = {}) {
    const action = actions.find(a => a.id === id);
    if (!action) throw new Error("нет действия " + id);
    return action.run({ tab: luminoctis.pins()[args.pin ?? 0], n: args.n ?? 3 });
  }
  window.lumiDebug = { actions, run, open, cleanup, setGlitchChance, get glitchChance() { return Math.round(1 / window.lumiGlitch.chance); } };
  window.addEventListener("unload", () => cleanup(!debugWin()), { once: true });
})();
