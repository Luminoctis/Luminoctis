// ==UserScript==
// @name           Luminoctis: звуки
// @description    Звуки браузера: печать, открытие/закрытие/переключение вкладок, наведение, клики по рейке, конец загрузки. Выключено по умолчанию (luminoctis.sounds.enabled).
// ==/UserScript==

// Набор звуков (папка sounds/, CC0 Kenney) или свой файл на действие (luminoctis.sounds.<действие>.file). Варианты чередуются, высота слегка гуляет.
// Тестовый крючок: window.lumiSounds.log — последние события {action, src, rate, volume, played}.
(() => {
  const { pageUrl } = ChromeUtils.importESModule(Components.stack.filename.replace(/[^/]*$/, "lumi-paths.sys.mjs"));
  const { BrowserWindowTracker } = ChromeUtils.importESModule("resource:///modules/BrowserWindowTracker.sys.mjs");
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const P = "luminoctis.sounds.";
  const prefs = Services.prefs;
  // действие -> [число вариантов, множитель громкости, минимальный интервал мс]
  const ACTIONS = {
    type: [8, 0.6, 40], "tab-open": [3, 1, 80], "tab-close": [3, 1, 80], "tab-switch": [3, 0.7, 80],
    hover: [4, 0.35, 0], click: [3, 0.8, 60], download: [3, 1, 300],
  };
  const t0 = Date.now();
  const voices = new Map(); // src -> [Audio, Audio, Audio] (по кругу: быстрые повторы не обрывают друг друга)
  const lastAt = {}, lastIdx = {};
  const log = [];

  function sources(action) {
    const file = prefs.getStringPref(P + action + ".file", "");
    if (file) {
      try {
        const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        f.initWithPath(file);
        if (f.exists()) return [Services.io.newFileURI(f).spec];
      } catch {}
    }
    return Array.from({ length: ACTIONS[action][0] }, (_, i) => pageUrl(`sounds/${action}-${i + 1}.ogg`));
  }

  function voice(src) {
    let v = voices.get(src);
    if (!v) {
      v = Array.from({ length: 3 }, () => Object.assign(new Audio(src), { preload: "auto", preservesPitch: false }));
      v.i = 0;
      voices.set(src, v);
    }
    return v[v.i++ % v.length];
  }

  function play(action, { force = false, ignoreFocus = false } = {}) {
    const cfg = ACTIONS[action];
    if (!cfg || !prefs.getBoolPref(P + "enabled", false) && !force) return;
    if (!prefs.getBoolPref(P + action + ".enabled", true) && !force) return;
    const now = performance.now();
    if (now - (lastAt[action] ?? -1e9) < cfg[2]) return;
    lastAt[action] = now;
    const list = sources(action);
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === lastIdx[action]) i = (i + 1) % list.length; // подряд одинаковый не играем
    lastIdx[action] = i;
    const volume = Math.min(1, Math.max(0, prefs.getIntPref(P + "volume", 50) / 100 * cfg[1]));
    const rate = 0.9 + Math.random() * 0.2;
    // download — в одном окне (последнем активном), даже если браузер не в фокусе; остальное — только в активном окне
    const mine = ignoreFocus ? BrowserWindowTracker.getTopWindow() === window : document.hasFocus();
    const entry = { action, src: list[i], rate, volume, played: false };
    log.push(entry);
    if (log.length > 50) log.shift();
    if (!mine || !volume) return;
    try {
      const a = voice(list[i]);
      a.volume = volume;
      a.playbackRate = rate;
      a.currentTime = 0;
      a.play().catch(() => {});
      entry.played = true;
    } catch {}
  }

  // выбранный/сброшенный файл — забыть старые Audio
  prefs.addObserver(P, { observe: () => voices.clear() });

  const PRINT = /^(?: |Backspace|Enter)$/;
  window.addEventListener("keydown", e => {
    if (e.ctrlKey || e.altKey || e.metaKey || !(e.key.length === 1 || PRINT.test(e.key))) return;
    play("type");
  }, true);

  const settled = () => Date.now() - t0 > 5000; // восстановление сессии открывает десятки вкладок разом
  let openedAt = 0;
  gBrowser.tabContainer.addEventListener("TabOpen", () => { if (settled()) (openedAt = performance.now(), play("tab-open")); });
  gBrowser.tabContainer.addEventListener("TabClose", () => { if (settled()) play("tab-close"); });
  gBrowser.tabContainer.addEventListener("TabSelect", () => { if (settled() && performance.now() - openedAt > 200) play("tab-switch"); });

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

  window.lumiSounds = { play, log, ACTIONS, sources };
})();
