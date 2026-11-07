// Заглушка блока сайтов (home/time-block.html): «Фокус — вернись после чч:мм»; «Всё равно открыть» — сайт открыт до конца этого фокуса.
import { JS } from "./paths.js";
ChromeUtils.importESModule(JS("lumi-palette.sys.mjs")).watch(document);
const engine = ChromeUtils.importESModule(JS("lumi-time.sys.mjs"));
const q = new URLSearchParams(location.search);
const url = q.get("url") ?? "", site = q.get("site") ?? "", until = q.get("until");
let target = null;
try { target = new URL(url); } catch {}
const strict = q.get("kind") == "strict";
const brk = q.get("phase") && q.get("phase") != "focus";
document.getElementById("title").textContent = strict ? "Строгий режим" : brk ? `Перерыв — сайт закрыт${until ? ` до ${until}` : ""}` : until ? `Фокус — вернись после ${until}` : "Фокус — вернись после него";
document.getElementById("site").textContent = strict ? `${site} закрыт списком «${q.get("list") || "без названия"}»${until ? ` до ${until}` : ", пока идёт фокус"}` : `${site} заблокирован, пока идёт ${brk ? "цикл" : "фокус"}`;
if (strict) document.getElementById("open").remove(); // строгость: обхода нет
else document.getElementById("open").addEventListener("click", () => {
  if (!target || !/^https?:$/.test(target.protocol)) return;
  engine.allowSite(target.hostname);
  location.replace(target.href);
});
// назад; если идти некуда (сайт открывали в новой вкладке) — закрыть вкладку
document.getElementById("back").addEventListener("click", () => {
  if (history.length > 1) return history.back();
  const win = window.browsingContext.topChromeWindow, tab = win.gBrowser.getTabForBrowser(window.browsingContext.embedderElement);
  if (tab) win.gBrowser.removeTab(tab);
});
