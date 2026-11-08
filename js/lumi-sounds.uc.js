// ==UserScript==
// @name           Luminoctis: звуки
// @description    Звуки браузера: печать, открытие/закрытие/переключение вкладок, наведение, клики по рейке, конец загрузки. Выключено по умолчанию (luminoctis.sounds.enabled).
// ==/UserScript==

// Пак звуков (luminoctis.sounds.pack: default = sounds/ (CC0 Kenney), gx = sounds/gx/ (синтез)).
// Один файл на действие, при каждом проигрывании высота и громкость чуть гуляют (как в Opera GX).
// Играем через Web Audio: один AudioContext на окно, файлы декодированы заранее (HTMLAudioElement стартовал ~100 мс и глотал звуки по 10–20 мс).
// Chrome-документ не подпадает под запрет автозапуска — достаточно resume(). Контекст создаётся, только когда включены звуки или звук глитча (тогда разбирается только glitch.ogg, а между проигрываниями контекст на suspend()).
// Тестовый крючок: window.lumiSounds.log — последние события {action, src, rate, volume, played, ended}:
// played — звук реально запущен (контекст running, start() вызван), ended — графом отыгран до конца.
(() => {
  const { pageUrl } = ChromeUtils.importESModule(Components.stack.filename.replace(/[^/]*$/, "lumi-paths.sys.mjs"));
  const { BrowserWindowTracker } = ChromeUtils.importESModule("resource:///modules/BrowserWindowTracker.sys.mjs");
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const P = "luminoctis.sounds.", GLITCH = "luminoctis.look.tab-glitch", START = "luminoctis.look.startup-glitch";
  const prefs = Services.prefs;
  // действие -> [множитель громкости, минимальный интервал мс, разброс высоты (доля), разброс громкости (доля)]
  const ACTIONS = {
    type: [0.6, 40, 0.03, 0.1], "tab-open": [1, 80, 0.01, 0.03], "tab-close": [1, 80, 0.01, 0.03], "tab-switch": [0.7, 80, 0.01, 0.03],
    hover: [0.35, 0, 0.03, 0.1], click: [0.8, 60, 0.01, 0.03], download: [1, 300, 0, 0],
    glitch: [0.8, 0, 0, 0],
  };
  const t0 = Date.now();
  const lastAt = {};
  const log = [];
  let count = 0; // всего событий (журнал обрезается до 50)
  let ctx = null;
  const bufs = new Map(); // src -> AudioBuffer | null (null: файл не читается/не декодируется)
  const loading = new Map(); // src -> Promise

  const setSources = action => [pageUrl(`sounds/${prefs.getStringPref(P + "pack", "default") === "gx" ? "gx/" : ""}${action}.ogg`)];

  const sources = setSources;

  function load(src) {
    if (!loading.has(src) && !bufs.has(src)) {
      loading.set(src, fetch(src).then(r => r.arrayBuffer()).then(d => ctx.decodeAudioData(d))
        .then(b => bufs.set(src, b), () => bufs.set(src, null)).finally(() => loading.delete(src)));
    }
    return loading.get(src);
  }
  const preload = action => Promise.all(sources(action).map(load));
  const master = () => prefs.getBoolPref(P + "enabled", false);
  // звук глитча живёт отдельно от общего выключателя; нужен, только пока включён редкий или стартовый глитч
  const glitchOn = () => prefs.getBoolPref(P + "glitch.enabled", true) && (prefs.getBoolPref(GLITCH, true) || prefs.getBoolPref(START, true));
  const wanted = () => master() ? Object.keys(ACTIONS) : glitchOn() ? ["glitch"] : [];

  function ensure(list = wanted()) {
    if (!ctx) ctx = new AudioContext();
    list.forEach(preload);
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    return ctx;
  }

  function play(action, { force = false, ignoreFocus = false } = {}) {
    const cfg = ACTIONS[action];
    if (!cfg) return;
    if (!force && !(action === "glitch" ? prefs.getBoolPref(P + "glitch.enabled", true) : master() && prefs.getBoolPref(P + action + ".enabled", true))) return;
    const now = performance.now();
    if (now - (lastAt[action] ?? -1e9) < cfg[1]) return;
    lastAt[action] = now;
    const list = sources(action);
    const jitter = j => 1 + (Math.random() * 2 - 1) * j;
    // ×0.1: при той же отметке ползунка в 10 раз тише (просьба пользователя после 0.5.5)
    const volume = Math.min(1, Math.max(0, prefs.getIntPref(P + "volume", 50) / 100 * 0.1 * cfg[0] * jitter(cfg[3])));
    const rate = jitter(cfg[2]);
    // download — в одном окне (последнем активном), даже если браузер не в фокусе; остальное — только в активном окне
    const mine = ignoreFocus ? (BrowserWindowTracker.getTopWindow() ?? BrowserWindowTracker.orderedWindows[0]) === window : document.hasFocus();
    const entry = { action, src: list[0], rate, volume, played: false, ended: false };
    log.push(entry);
    count++;
    if (log.length > 50) log.shift();
    if (!mine || !volume) return;
    try {
      ensure(master() ? undefined : [action]);
      const go = () => {
        const buf = bufs.get(entry.src);
        if (!buf) return;
        const s = ctx.createBufferSource(), g = ctx.createGain();
        s.buffer = buf;
        s.playbackRate.value = rate;
        g.gain.value = volume;
        s.connect(g).connect(ctx.destination);
        s.onended = () => { entry.ended = true; };
        s.start();
        entry.played = true;
      };
      const run = () => ctx.state === "running" ? go() : ctx.resume().then(go, () => {});
      // файл ещё не декодирован: событие пропускаем (иначе звук запоздает), кроме «▶» в настройках — его ждём
      if (bufs.has(entry.src)) run(); else if (force) load(entry.src).then(run);
      // «▶» и глитч при выключенных общих звуках: потом снова отпустить устройство
      if ((force || action === "glitch") && !master()) setTimeout(() => { if (!master()) ctx?.suspend(); }, 3000);
    } catch {}
  }

  // применить настройки: общие звуки — всё и устройство занято; только звук глитча — глитч разобран, контекст на suspend(); иначе отпустить устройство
  function sync() {
    if (master()) return void ensure();
    const list = wanted();
    if (list.length) ctx ??= new AudioContext();
    list.forEach(preload);
    ctx?.suspend();
  }
  const prefObserver = {
    observe(_s, _t, name) {
      if (name === P + "pack") {
        if (!ctx) return;
        bufs.clear(); // смена пака — применить сразу
        wanted().forEach(preload);
      } else sync();
    },
  };
  prefs.addObserver(P, prefObserver);
  prefs.addObserver(GLITCH, prefObserver);
  prefs.addObserver(START, prefObserver);
  window.addEventListener("unload", () => { prefs.removeObserver(P, prefObserver); prefs.removeObserver(GLITCH, prefObserver); prefs.removeObserver(START, prefObserver); ctx?.close(); }, { once: true });
  sync();

  const PRINT = /^(?: |Backspace|Enter)$/;
  window.addEventListener("keydown", e => {
    if (e.ctrlKey || e.altKey || e.metaKey || !(e.key.length === 1 || PRINT.test(e.key))) return;
    play("type");
  }, true);

  const settled = () => Date.now() - t0 > 5000; // восстановление сессии открывает десятки вкладок разом
  let openedAt = 0;
  gBrowser.tabContainer.addEventListener("TabOpen", () => { if (settled()) (openedAt = performance.now(), play("tab-open")); });
  gBrowser.tabContainer.addEventListener("TabClose", () => { if (settled()) play("tab-close"); });
  // глитч (lumi-glitch) решает в своём TabSelect, порядок обработчиков не гарантирован — проверяем после них; при глитче играет только glitch
  gBrowser.tabContainer.addEventListener("TabSelect", () => { if (settled() && performance.now() - openedAt > 200) setTimeout(() => { if (!window.lumiGlitch?.active) play("tab-switch"); }, 0); });

  const HOVER = ".lumi-tab, .lumi-pin";
  document.addEventListener("mouseover", e => {
    const el = e.target.closest?.(HOVER);
    if (el && !el.contains(e.relatedTarget)) play("hover");
  });
  document.addEventListener("click", e => {
    if (e.target.closest?.("#lumi-rail button, #lumi-rail toolbarbutton, #lumi-rail .lumi-pin, #lumi-pins .lumi-pin")) play("click");
  }, true);

  UC_API.Windows.waitWindowLoading(window).then(async () => {
    const list = await Downloads.getList(Downloads.ALL);
    const view = { onDownloadChanged(d) { if (d.succeeded && !d._lumiSound) (d._lumiSound = true, play("download", { ignoreFocus: true })); } };
    await list.addView(view);
    window.addEventListener("unload", () => list.removeView(view), { once: true });
  });

  window.lumiSounds = { play, ready: action => ctx ? preload(action) : Promise.resolve(), log, get count() { return count; }, ACTIONS, sources, get ctx() { return ctx; }, get decoded() { return bufs; } };
})();
