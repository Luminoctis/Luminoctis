// ==UserScript==
// @name           Luminoctis: карточка при наведении
// @description    Наведение на вкладку полосы или закреп рейки (без клика, ~400 мс) — карточка с названием и памятью вкладки. Одна реализация на оба места.
// ==/UserScript==

(() => {
  const PREF = "luminoctis.tabs.hover-memory", DELAY = 400, FRESH = 5000;
  const enabled = () => Services.prefs.getBoolPref(PREF, true);
  const mb = bytes => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} ГБ` : `${Math.round(bytes / 1024 ** 2)} МБ`);

  // ---------- память вкладки: тот же способ, что в about:processes (toolkit/content/global/aboutProcesses.js) ----------
  // ChromeUtils.requestProcInfo() даёт память ПРОЦЕССОВ и окна в них (outerWindowId); окно вкладки = browser.outerWindowID.
  // Памяти по окну Firefox не отдаёт, поэтому честное число — память процесса вкладки; если процесс общий — говорим сколько вкладок в нём.
  let snapshot = null, pending = null;
  const procs = (force = false) => {
    if (!force && snapshot && Date.now() - snapshot.t < FRESH) return Promise.resolve(snapshot.list); // кеш: запрос не бесплатный
    return (pending ||= ChromeUtils.requestProcInfo().then(main => {
      snapshot = { t: Date.now(), list: [main, ...main.children] };
      return snapshot.list;
    }).finally(() => (pending = null)));
  };
  // { unloaded } | { internal } (страница в процессе браузера, напр. about:robots — своей памяти нет) | { bytes, tabs } (tabs — вкладок в этом процессе, считая эту) | { unknown }
  async function memory(tab) {
    const id = tab.linkedBrowser?.outerWindowID;
    if (tab.hasAttribute("pending") || id == null) return { unloaded: true };
    if (!tab.linkedBrowser.isRemoteBrowser) return { internal: true };
    const owner = list => list.find(p => p.windows?.some(w => w.outerWindowId == id));
    const proc = owner(await procs()) ?? owner(await procs(true)); // вкладку открыли после снимка — берём свежий
    if (!proc) return { unknown: true };
    const tabIds = new Set();
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      for (const b of win.gBrowser?.browsers ?? []) b.outerWindowID != null && tabIds.add(b.outerWindowID);
    }
    return { bytes: proc.memory, tabs: proc.windows.filter(w => tabIds.has(w.outerWindowId)).length || 1 };
  }
  const lines = m =>
    m.unloaded ? ["Выгружена — 0 МБ"]
    : m.internal ? ["Внутренняя страница Zen"]
    : m.unknown ? ["Память: нет данных"]
    : m.tabs > 1 ? [`Память: ${mb(m.bytes)}`, `общий процесс с ещё ${m.tabs - 1} вкл.`]
    : [`Память: ${mb(m.bytes)}`];

  UC_API.Windows.waitWindowLoading(window).then(() => {
    const card = Object.assign(document.createElement("div"), { id: "lumi-hovercard", hidden: true });
    const title = document.createElement("div"), info = document.createElement("div");
    title.className = "lumi-hovercard-title";
    info.className = "lumi-hovercard-info";
    card.append(title, info);
    document.documentElement.append(card);

    let timer, token = 0, current = null, quiet = null; // quiet — элемент, над которым карточку не показываем до ухода мыши (клик, drag, прокрутка)
    const targetOf = event => event.target.closest?.(".lumi-tab, .lumi-pin");
    const hide = () => {
      clearTimeout(timer);
      token++;
      card.hidden = true;
      current = null;
    };
    const place = el => {
      const r = el.getBoundingClientRect(), c = card.getBoundingClientRect();
      const pin = el.classList.contains("lumi-pin");
      const x = pin ? r.right + 10 : Math.min(Math.max(8, r.left), innerWidth - c.width - 8);
      const y = pin ? Math.min(Math.max(8, r.top + r.height / 2 - c.height / 2), innerHeight - c.height - 8) : r.bottom + 4;
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
    };
    async function show(el) {
      const mine = ++token;
      const tab = el.tab;
      const [m] = await Promise.all([
        memory(tab).catch(() => ({ unknown: true })),
        new Promise(r => (timer = setTimeout(r, card.hidden ? DELAY : 0))), // уже видна соседняя — переходим сразу
      ]);
      if (mine != token || !el.isConnected) return;
      title.textContent = tab.label;
      info.replaceChildren(...lines(m).map(text => Object.assign(document.createElement("div"), { textContent: text })));
      card.toggleAttribute("pending", !!m.unloaded);
      card.hidden = false;
      current = el;
      place(el);
    }

    document.addEventListener("mouseover", event => {
      const el = targetOf(event);
      if (el == current || (el && el == targetOf({ target: event.relatedTarget ?? document }))) return;
      if (!el) {
        quiet = null;
        return hide();
      }
      if (!enabled() || !el.tab || el == quiet) return;
      show(el);
    });
    // клик, перетаскивание, прокрутка, меню, клавиша — карточка прячется и не возвращается, пока мышь не уйдёт с элемента
    const dismiss = event => {
      quiet = targetOf(event) ?? current;
      hide();
    };
    for (const type of ["mousedown", "dragstart", "contextmenu", "keydown"]) document.addEventListener(type, dismiss, true);
    document.addEventListener("mouseout", event => event.relatedTarget || hide()); // мышь ушла из окна
    for (const type of ["wheel", "scroll"]) document.addEventListener(type, hide, { capture: true, passive: true });
    window.addEventListener("blur", hide);

    window.lumiHover = { memory, lines, hide, enabled, card, PREF };
  });
})();
