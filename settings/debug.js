// Окно отладки Luminoctis (chrome-окно, открывает window.lumiDebug.open() из js/lumi-debug.uc.js). Действия применяются к последнему активному окну браузера.
import { JS } from "../home/paths.js";
const { BrowserWindowTracker } = ChromeUtils.importESModule("resource:///modules/BrowserWindowTracker.sys.mjs");
ChromeUtils.importESModule(JS("lumi-palette.sys.mjs")).watch(document);
const $ = sel => document.querySelector(sel);
const top = () => BrowserWindowTracker.orderedWindows.find(w => !w.closed && w.lumiDebug); // getTopWindow() в Zen возвращает null
const el = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; e.append(...kids); return e; };

// <select> в отдельном chrome-окне не открывает список, поэтому выбор — ряд кнопок-сегментов
let pinIdx = 0;
const seg = (id, values, cur, pick) => {
  const box = el("div", "seg"), mark = v => { for (const b of box.children) b.classList.toggle("on", b.dataset.v == v); };
  box.id = id;
  for (const v of values) { const b = el("button", "", v.label ?? v); b.dataset.v = v.value ?? v; b.addEventListener("click", () => { mark(b.dataset.v); pick(+b.dataset.v); }); box.append(b); }
  mark(cur);
  return box;
};
function renderPins() {
  const n = top()?.luminoctis?.pins?.().length ?? 0;
  if (pinIdx >= n) pinIdx = 0;
  $("#pin").replaceChildren(...Array.from({ length: n }, (_, i) => i).map(i => Object.assign(el("button", "", i + 1), { onclick: () => { pinIdx = i; renderPins(); } })));
  $("#pin").children[pinIdx]?.classList.add("on");
}
function chanceRow(win) {
  const s = seg("glitch-chance", [1, 2, 5, 10, 50, 100], win.lumiDebug.glitchChance, n => top()?.lumiDebug?.setGlitchChance(n));
  return el("div", "arow", el("div", "text", el("b", "", "Шанс глитча: 1 из N"), el("span", "", "Временно, до перезапуска браузера. 1 = глитч на каждой смене вкладки")), s);
}
function render() {
  const win = top(), actions = win?.lumiDebug?.actions;
  $("#list").replaceChildren();
  if (!actions) return void $("#list").append(el("p", "hint", "Нет окна браузера с модом."));
  const groups = new Map();
  for (const a of actions) {
    if (!groups.has(a.group)) {
      const box = el("div", "group");
      groups.set(a.group, box);
      $("#list").append(el("h2", "", a.group), box);
    }
    const btn = el("button", "", "▶");
    btn.dataset.id = a.id;
    btn.addEventListener("click", () => top()?.lumiDebug?.run(a.id, { pin: pinIdx, n: +$("#num").value || 0 }));
    groups.get(a.group).append(el("div", "arow", el("div", "text", el("b", "", a.label), el("span", "", a.hint ?? "")), btn));
    if (a.id == "tab-glitch") groups.get(a.group).append(chanceRow(win));
  }
}
$("#reset").addEventListener("click", () => { top()?.lumiDebug?.cleanup(); render(); });
window.addEventListener("focus", renderPins);
window.addEventListener("unload", () => { for (const w of BrowserWindowTracker.orderedWindows) try { w.lumiDebug?.cleanup(); } catch {} });
renderPins();
render();
