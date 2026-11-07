// ==UserScript==
// @name           Luminoctis: эффект загрузок
// @description    Пока идёт загрузка — от кнопки загрузок бегут «силовые линии» вдоль панели адреса и рейки; загрузка кончилась — по окну проходит волна. Выключатель luminoctis.look.download-fx.
// ==/UserScript==

// Оверлей #lumi-downloads-fx (chrome.css, «Эффект загрузок») виден только пока есть активные загрузки: без них нет ни одной бесконечной анимации.
// Волна — только после успешного завершения; ошибка или отмена просто гасят линии.
(() => {
  const PREF = "luminoctis.look.download-fx";
  const enabled = () => Services.prefs.getBoolPref(PREF, true);
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");

  UC_API.Windows.waitWindowLoading(window).then(async () => {
    const div = cls => Object.assign(document.createElement("div"), { className: cls });
    const fx = Object.assign(div(""), { id: "lumi-downloads-fx", hidden: true });
    const hl = [["h l", 0], ["h l", -0.9], ["h r", 0], ["h r", -0.9], ["v", 0], ["v", -1.2], ["src", 0], ["src", -0.8]]
      .map(([c, delay]) => Object.assign(div(`lumi-dlfx-hl ${c}`), { style: `animation-delay: ${delay}s` }));
    fx.append(div("lumi-dlfx-track h"), div("lumi-dlfx-track v"), ...hl);
    document.documentElement.append(fx);

    const active = new Set(); // идущие загрузки этого окна
    const rect = id => document.getElementById(id)?.getBoundingClientRect();
    // точка эффекта: кнопка загрузок; если её нет (убрана из панели) — правый верх панели адреса
    const layout = () => {
      const W = window.innerWidth, H = window.innerHeight;
      const nav = rect("nav-bar"), btn = rect("downloads-button"), rail = rect("lumi-rail");
      const navOk = nav && nav.width > 0 && nav.bottom > 0;
      const ny = navOk ? nav.bottom : 40;
      const ox = btn?.width ? btn.left + btn.width / 2 : navOk ? nav.right - 24 : W - 24;
      const oy = btn?.width ? btn.top + btn.height / 2 : navOk ? nav.top + nav.height / 2 : 20;
      const rx = rail && rail.width > 0 && rail.right < ox ? rail.right : 0;
      const far = Math.hypot(Math.max(ox, W - ox), Math.max(oy, H - oy));
      for (const [k, v] of Object.entries({ ox, oy, rx, ny, W, H, wd: far * 2 })) fx.style.setProperty(`--lumi-dlfx-${k}`, `${Math.round(v)}px`);
    };
    const progress = () => {
      let sum = 0, n = 0;
      for (const d of active) if (d.hasProgress) { sum += d.progress; n++; }
      fx.style.setProperty("--lumi-dlfx-p", n ? (sum / n / 100).toFixed(2) : "0.3");
    };
    const sync = () => {
      const run = enabled() && active.size > 0;
      if (run) { layout(); progress(); }
      fx.toggleAttribute("run", run);
      fx.hidden = !run && !fx.querySelector(".lumi-dlfx-wave");
      document.documentElement.toggleAttribute("lumi-downloading", run);
    };
    const wave = () => {
      if (!enabled()) return;
      layout();
      const btn = document.getElementById("downloads-button");
      if (btn) { btn.setAttribute("lumi-dlfx-done", ""); setTimeout(() => btn.removeAttribute("lumi-dlfx-done"), 900); } // подсветка кнопки (reduced-motion)
      fx.hidden = false;
      for (const delay of [0, 0.14]) {
        const w = Object.assign(div("lumi-dlfx-wave"), { style: `animation-delay: ${delay}s` });
        w.addEventListener("animationend", () => { w.remove(); if (!active.size) sync(); });
        fx.append(w);
      }
      setTimeout(() => { for (const w of fx.querySelectorAll(".lumi-dlfx-wave")) w.remove(); if (!active.size) sync(); }, 1800); // без анимаций (reduced-motion) animationend не придёт
    };

    const list = await Downloads.getList(Downloads.ALL);
    const view = {
      onDownloadAdded(d) { if (!d.stopped) { active.add(d); sync(); } },
      onDownloadChanged(d) {
        if (!d.stopped) { active.add(d); progress(); sync(); return; }
        if (!active.delete(d)) return;
        const ok = d.succeeded;
        sync();
        if (ok) wave();
      },
      onDownloadRemoved(d) { if (active.delete(d)) sync(); },
    };
    await list.addView(view);
    Services.prefs.addObserver(PREF, sync);
    window.addEventListener("unload", () => { list.removeView(view); Services.prefs.removeObserver(PREF, sync); }, { once: true });
    window.lumiDownloadsFx = { fx, active, sync, wave, enabled };
  });
})();
