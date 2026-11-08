// Окно отладки Luminoctis (chrome-окно, открывает window.lumiDebug.open() из js/lumi-debug.uc.js). Действия применяются к последнему активному окну браузера.
import { JS } from "../home/paths.js";
const { BrowserWindowTracker } = ChromeUtils.importESModule("resource:///modules/BrowserWindowTracker.sys.mjs");
ChromeUtils.importESModule(JS("lumi-palette.sys.mjs")).watch(document);
const $ = sel => document.querySelector(sel);
const top = () => BrowserWindowTracker.orderedWindows.find(w => !w.closed && w.lumiDebug); // getTopWindow() в Zen возвращает null
const el = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; e.append(...kids); return e; };

function renderPins() {
  const win = top(), sel = $("#pin"), old = sel.value;
  sel.replaceChildren(...(win?.luminoctis?.pins?.() ?? []).map((tab, i) => Object.assign(document.createElement("option"), { value: i, textContent: tab.label || "закреп " + (i + 1) })));
  if (old && sel.querySelector(`option[value="${old}"]`)) sel.value = old;
}
function chanceRow(win) {
  const sel = el("select", "", ...[1, 2, 5, 10, 50, 200].map(n => Object.assign(el("option"), { value: n, textContent: n })));
  sel.id = "glitch-chance";
  sel.value = win.lumiDebug.glitchChance;
  sel.addEventListener("change", () => top()?.lumiDebug?.setGlitchChance(+sel.value));
  return el("div", "arow", el("div", "text", el("b", "", "Шанс глитча: 1 из N"), el("span", "", "Временно, до перезапуска браузера. 1 = глитч на каждой смене вкладки")), sel);
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
    btn.addEventListener("click", () => top()?.lumiDebug?.run(a.id, { pin: +$("#pin").value || 0, n: +$("#num").value || 0 }));
    groups.get(a.group).append(el("div", "arow", el("div", "text", el("b", "", a.label), el("span", "", a.hint ?? "")), btn));
    if (a.id == "tab-glitch") groups.get(a.group).append(chanceRow(win));
  }
}
$("#reset").addEventListener("click", () => { top()?.lumiDebug?.cleanup(); render(); });
window.addEventListener("focus", renderPins);
window.addEventListener("unload", () => { for (const w of BrowserWindowTracker.orderedWindows) try { w.lumiDebug?.cleanup(); } catch {} });
renderPins();
render();
