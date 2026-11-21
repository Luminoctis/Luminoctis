// LumiTime: выпадающий список в стиле мода вместо системного <select> (тот в окне мода рисуется чужим и в мини-окне рейки не открывается).
// dropdown(options, value, onchange, attrs): options — [[значение, подпись, цвет?], …]; возвращает <button class="lt-dd"> со свойством value
// (как у select: чтение/запись) и событием change. Список — .lt-dd-pop в body страницы (position: fixed, не вылезает за края окна), стрелки/Home/End/Enter/Esc,
// буква — к подписи на неё, клик мимо, прокрутка и потеря фокуса окном закрывают. Стили — home/time.css (.lt-dd*).
let active = null; // открыт всегда один

export function dropdown(options, value, onchange, attrs = {}) {
  const opts = options.map(([v, label, color]) => ({ v: String(v), label, color }));
  let cur = String(value), hl = -1, pop = null, items = [], kbPick = 0, watch = 0;
  const caption = Object.assign(document.createElement("span"), { className: "lt-dd-cap" });
  const el = Object.assign(document.createElement("button"), { type: "button", className: "lt-dd" });
  el.setAttribute("aria-haspopup", "listbox"); el.setAttribute("aria-expanded", "false");
  for (const [k, v] of Object.entries(attrs)) if (v != null) k == "class" ? el.classList.add(...v.split(" ")) : el.setAttribute(k, v);
  el.append(caption);
  const paint = () => {
    const o = opts.find(x => x.v == cur);
    caption.textContent = o?.label ?? "";
    el.style.borderLeft = o?.color ? `3px solid ${o.color}` : ""; // цвет выбранной темы
  };
  Object.defineProperty(el, "value", { get: () => cur, set: v => { cur = String(v); paint(); } });
  paint();

  const mark = i => {
    hl = i;
    items.forEach((it, j) => it.classList.toggle("hl", j == i));
    items[i]?.scrollIntoView({ block: "nearest" });
  };
  const key = e => {
    const k = e.key, stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (k == "Escape") { stop(); close(true); }
    else if (k == "ArrowDown") { stop(); mark(Math.min(items.length - 1, hl + 1)); }
    else if (k == "ArrowUp") { stop(); mark(Math.max(0, hl - 1)); }
    else if (k == "Home") { stop(); mark(0); }
    else if (k == "End") { stop(); mark(items.length - 1); }
    else if (k == "Enter" || k == " ") { stop(); kbPick = performance.now(); if (hl >= 0) pick(hl); }
    else if (k == "Tab") close();
    else if (k.length == 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const q = k.toLocaleLowerCase(), n = opts.length;
      for (let d = 1; d <= n; d++) { const i = (hl + d) % n; if (opts[i].label.toLocaleLowerCase().startsWith(q)) { stop(); mark(i); break; } }
    }
  };
  const outside = e => { if (pop && !pop.contains(e.target) && !el.contains(e.target)) close(); };
  const away = e => { if (!pop?.contains(e.target)) close(); };
  function close(refocus) {
    if (!pop) return;
    clearInterval(watch); pop.remove(); pop = null; items = []; active = null;
    el.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("scroll", away, true); window.removeEventListener("resize", away); window.removeEventListener("blur", away);
    if (refocus) el.focus();
  }
  function pick(i) {
    const changed = opts[i].v != cur;
    cur = opts[i].v; paint(); close(true);
    if (changed) el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function show() {
    active?.(); // закрыть другой
    pop = document.createElement("div");
    pop.className = "lt-dd-pop"; pop.setAttribute("role", "listbox");
    items = opts.map((o, i) => {
      const it = document.createElement("div");
      it.className = "lt-dd-item" + (o.color ? " lt-tc" : "") + (o.v == cur ? " on" : "");
      it.setAttribute("role", "option"); it.setAttribute("aria-selected", String(o.v == cur));
      if (o.color) it.style.setProperty("--tc", o.color);
      it.textContent = o.label; it.title = o.label;
      it.addEventListener("click", () => pick(i));
      it.addEventListener("pointermove", () => hl != i && mark(i));
      return it;
    });
    pop.append(...items);
    document.body.append(pop);
    const r = el.getBoundingClientRect(), M = 8;
    pop.style.minWidth = r.width + "px";
    const w = pop.offsetWidth, full = pop.scrollHeight, below = innerHeight - r.bottom - M - 4, above = r.top - M - 4, up = full > below && above > below;
    pop.style.maxHeight = Math.max(80, up ? above : below) + "px";
    const h = Math.min(full, parseFloat(pop.style.maxHeight));
    pop.style.left = Math.max(M, Math.min(r.left, innerWidth - w - M)) + "px";
    pop.style.top = (up ? r.top - h - 4 : r.bottom + 4) + "px";
    el.setAttribute("aria-expanded", "true");
    active = close;
    watch = setInterval(() => !el.isConnected && close(), 300); // страницу перестроили (build) — списка у отсоединённой кнопки быть не должно
    mark(Math.max(0, opts.findIndex(o => o.v == cur)));
    document.addEventListener("keydown", key, true); document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", away, true); window.addEventListener("resize", away); window.addEventListener("blur", away);
  }
  el.addEventListener("click", e => {
    if (pop) return close();
    if (e.detail === 0 && performance.now() - kbPick < 250) return; // Space/Enter, которым только что выбрали, не открывает заново
    show();
  });
  el.addEventListener("keydown", e => { if ((e.key == "ArrowDown" || e.key == "ArrowUp") && !pop) { e.preventDefault(); show(); } });
  el.addEventListener("change", () => onchange(cur));
  return el;
}
