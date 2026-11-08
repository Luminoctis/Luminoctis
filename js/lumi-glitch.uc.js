// ==UserScript==
// @name           Luminoctis: редкий глитч
// @description    Раз в ~100 смен вкладки интерфейс на ~150 мс «ломается»: RGB-сдвиг, дрожание, шум. Выключатели luminoctis.look.tab-glitch и luminoctis.look.startup-glitch (глитч идёт всю загрузку Zen первого окна, со звуком). window.lumiGlitch.run() — запустить сразу.
// ==/UserScript==

// Оверлей #lumi-glitch и атрибут lumi-glitch на корне живут только на время глитча (chrome.css, «Редкий глитч»); в покое их нет совсем.
(() => {
  const PREF = "luminoctis.look.tab-glitch", MS = 150;
  const root = document.documentElement, t0 = Date.now();
  let busy = false, openedAt = -1e9, timer = 0;
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
  const stop = () => { clearTimeout(timer); busy = false; root.removeAttribute("lumi-glitch"); document.getElementById("lumi-glitch")?.remove(); };
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
    timer = setTimeout(stop, ms + 40); // таймер, а не animationend: при reduced-motion и в свёрнутом окне анимаций нет
  };
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  UC_API.Windows.waitWindowLoading(window).then(() => {
    gBrowser.tabContainer.addEventListener("TabOpen", () => { openedAt = performance.now(); });
    gBrowser.tabContainer.addEventListener("TabSelect", () => {
      if (!Services.prefs.getBoolPref(PREF, true) || Date.now() - t0 < 5000 || performance.now() - openedAt < 200) return;
      if (window.lumiGlitch.rand() < window.lumiGlitch.chance && !reduced()) run();
    });
  });
  // Стартовый глитч: часть загрузки. Раз за запуск Zen, в первом окне (флаг — в default-ветке prefs, в профиль не пишется, живёт на процесс).
  // Zen держит интерфейс на opacity 0 (:root[zen-before-loaded]) до конца восстановления сессии; пока идёт глитч, корень несёт lumi-startup-glitch
  // и chrome.css отменяет это скрытие. Глитч стартует сразу при загрузке окна, идёт быстрыми всплесками по 150 мс и гаснет в конце всплеска после снятия
  // zen-before-loaded (не короче 300 мс и не дольше 6 с). Звук — в начале (после разбора glitch.ogg, не дольше 400 мс) и ещё раз в конце, если загрузка шла дольше 1,2 с.
  const DONE = "luminoctis.internal.startup-glitch-done", START = "luminoctis.look.startup-glitch", SND = "luminoctis.sounds.glitch.enabled";
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const startup = async ({ force = false } = {}) => {
    const G = window.lumiGlitch, def = Services.prefs.getDefaultBranch("");
    if (!force) {
      if (Services.prefs.getBoolPref(DONE, false)) return;
      def.setBoolPref(DONE, true);
    }
    if (!Services.prefs.getBoolPref(START, true) || reduced()) return;
    const sound = (wait = false) => Services.prefs.getBoolPref(SND, true) && sleep(0).then(async () => {
      const S = window.lumiSounds; // lumi-sounds грузится после этого скрипта
      if (wait) await Promise.race([S?.ready("glitch"), sleep(400)]);
      S?.play("glitch", { ignoreFocus: true }); // окно в момент старта ещё без фокуса
    });
    const zenDone = new Promise(res => {
      if (!root.hasAttribute("zen-before-loaded")) return res();
      const mo = new MutationObserver(() => { if (!root.hasAttribute("zen-before-loaded")) (mo.disconnect(), res()); });
      mo.observe(root, { attributes: true, attributeFilter: ["zen-before-loaded"] });
    });
    G.startupAt = Date.now(); G.zenAt = G.endAt = 0;
    root.setAttribute("lumi-startup-glitch", "");
    run(6000, { silent: true });
    sound(true);
    await Promise.race([zenDone.then(() => { G.zenAt = Date.now(); }), sleep(6000)]); // потолок 6 с
    root.removeAttribute("lumi-startup-glitch");
    const el = Date.now() - G.startupAt, end = Math.max(300, Math.ceil(el / MS) * MS); // не короче 300 мс, гаснем в конце всплеска
    if (el > 1200) sound();
    clearTimeout(timer);
    timer = setTimeout(() => { G.endAt = Date.now(); stop(); }, end - el);
  };
  window.lumiGlitch = { startup, startupAt: 0, zenAt: 0, endAt: 0, chance: 1 / 100, run, stop, get active() { return busy; }, rand: () => Math.random() }; // rand — подмена в проверке
  startup();
})();
