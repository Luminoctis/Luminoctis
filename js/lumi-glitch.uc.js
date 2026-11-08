// ==UserScript==
// @name           Luminoctis: редкий глитч
// @description    Раз в ~200 смен вкладки интерфейс на ~150 мс «ломается»: RGB-сдвиг, дрожание, шум. Выключатель luminoctis.look.tab-glitch. window.lumiGlitch.run() — запустить сразу.
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
    const run = (ms = MS, { debug = false } = {}) => {
      if (busy) return;
      busy = true;
      window.lumiSounds?.play("glitch", debug ? { force: true, ignoreFocus: true } : {}); // из окна отладки фокус у него, не у браузера
      const fx = Object.assign(document.createElement("div"), { id: "lumi-glitch" });
      fx.append(filters(), ...["lumi-glitch-noise", "lumi-glitch-band", "lumi-glitch-band b2"].map(c => Object.assign(document.createElement("i"), { className: c })));
      root.style.setProperty("--lumi-glitch-ms", `${ms}ms`);
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
    window.lumiGlitch = { chance: 1 / 200, run, stop, get active() { return busy; }, rand: () => Math.random() }; // rand — подмена в проверке
  });
})();
