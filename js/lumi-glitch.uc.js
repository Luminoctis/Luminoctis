// ==UserScript==
// @name           Luminoctis: редкий глитч
// @description    Раз в ~100 смен вкладки интерфейс на ~150 мс «ломается»: RGB-сдвиг, дрожание, шум. Выключатели luminoctis.look.tab-glitch и luminoctis.look.startup-glitch (один глитч при запуске браузера, со звуком, ~300 мс (два всплеска), когда интерфейс Zen уже показан). window.lumiGlitch.run() — запустить сразу.
// ==/UserScript==

// Оверлей #lumi-glitch и атрибут lumi-glitch на корне живут только на время глитча (chrome.css, «Редкий глитч»); в покое их нет совсем.
(() => {
  const PREF = "luminoctis.look.tab-glitch", MS = 150;
  UC_API.Windows.waitWindowLoading(window).then(() => {
    const root = document.documentElement, t0 = Date.now();
    let busy = false, openedAt = -1e9;
    // RGB-сдвиг: красный канал уезжает на d px вправо, зелёный+синий влево, склейка screen; три силы — chrome.css крутит их по steps()
    const filters = () => {
      const NS = "http://www.w3.org/2000/svg", el = (t, a, ...k) => { const e = document.createElementNS(NS, t); for (const x in a) e.setAttribute(x, a[x]); e.append(...k); return e; };
      return el("svg", {}, ...[3, -4, 2].map((d, i) => el("filter", { id: `lumi-glitch-f${i + 1}`, x: 0, y: 0, width: "100%", height: "100%", "color-interpolation-filters": "sRGB" },
        el("feColorMatrix", { in: "SourceGraphic", values: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", result: "r" }),
        el("feOffset", { in: "r", dx: d, result: "ro" }),
        el("feColorMatrix", { in: "SourceGraphic", values: "0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0", result: "c" }),
        el("feOffset", { in: "c", dx: -d, result: "co" }),
        el("feBlend", { in: "ro", in2: "co", mode: "screen" }))));
    };
    const stop = () => { busy = false; root.removeAttribute("lumi-glitch"); document.getElementById("lumi-glitch")?.remove(); };
    const run = (ms = MS, { debug = false, silent = false } = {}) => {
      if (busy) return;
      busy = true;
      if (!silent) window.lumiSounds?.play("glitch", debug ? { force: true, ignoreFocus: true } : {}); // из окна отладки фокус у него, не у браузера
      const fx = Object.assign(document.createElement("div"), { id: "lumi-glitch" });
      fx.append(filters(), ...["lumi-glitch-noise", "lumi-glitch-band", "lumi-glitch-band b2"].map(c => Object.assign(document.createElement("i"), { className: c })));
      const n = Math.max(1, Math.round(ms / MS)); // длиннее 150 мс — не медленное движение, а n быстрых всплесков (chrome.css крутит те же кадры n раз)
      root.style.setProperty("--lumi-glitch-ms", `${ms / n}ms`);
      root.style.setProperty("--lumi-glitch-n", n);
      root.append(fx);
      root.setAttribute("lumi-glitch", "");
      setTimeout(stop, ms + 40); // таймер, а не animationend: при reduced-motion и в свёрнутом окне анимаций нет
    };
    const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gBrowser.tabContainer.addEventListener("TabOpen", () => { openedAt = performance.now(); });
    gBrowser.tabContainer.addEventListener("TabSelect", () => {
      if (!Services.prefs.getBoolPref(PREF, true) || Date.now() - t0 < 5000 || performance.now() - openedAt < 200) return;
      if (window.lumiGlitch.rand() < window.lumiGlitch.chance && !reduced()) run();
    });
    // Стартовый глитч: раз за запуск Zen, в первом окне, со звуком (если он включён). Флаг — в default-ветке prefs (в профиль не пишется, живёт на процесс).
    // Раньше шёл, пока интерфейс ещё невидим: Zen держит всё на opacity 0 (:root[zen-before-loaded]) до конца восстановления сессии (gZenStartup.promiseInitialized).
    const DONE = "luminoctis.internal.startup-glitch-done", START = "luminoctis.look.startup-glitch";
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const startup = async ({ force = false } = {}) => {
      const def = Services.prefs.getDefaultBranch("");
      if (!force) {
        if (Services.prefs.getBoolPref(DONE, false)) return;
        def.setBoolPref(DONE, true);
      }
      if (!Services.prefs.getBoolPref(START, true) || reduced()) return;
      await Promise.race([window.gZenStartup?.promiseInitialized, sleep(6000)]); // потолок 6 с: не ждать вечно
      while (document.hidden && Date.now() - t0 < 30000) await sleep(250); // свёрнуто или запуск в фоне: ждём показа не дольше 30 с от запуска
      if (document.hidden) return;
      await sleep(400); // запас: плавное появление Zen и полоса обновления (0,35 с) заканчиваются
      if (document.hidden || reduced()) return;
      window.lumiGlitch.startupAt = Date.now();
      run(300);
    };
    window.lumiGlitch = { startup, startupAt: 0, chance: 1 / 100, run, stop, get active() { return busy; }, rand: () => Math.random() }; // rand — подмена в проверке
    startup();
  });
})();
