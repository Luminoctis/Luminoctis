// Заглушка блока сайтов (home/time-block.html): «Фокус — вернись после чч:мм»; «Всё равно открыть» — сайт открыт до конца этого фокуса.
import { JS } from "./paths.js";
ChromeUtils.importESModule(JS("lumi-palette.sys.mjs")).watch(document);
const engine = ChromeUtils.importESModule(JS("lumi-time.sys.mjs"));
const { t, localize } = ChromeUtils.importESModule(JS("lumi-i18n.sys.mjs"));
localize(document);
const q = new URLSearchParams(location.search);
const url = q.get("url") ?? "", site = q.get("site") ?? "", until = q.get("until");
let target = null;
try { target = new URL(url); } catch {}
const strict = q.get("kind") == "strict";
const brk = q.get("phase") && q.get("phase") != "focus";
document.getElementById("title").textContent = strict ? t("Строгий режим") : brk ? (until ? t("Перерыв — сайт закрыт до {0}", until) : t("Перерыв — сайт закрыт")) : until ? t("Фокус — вернись после {0}", until) : t("Фокус — вернись после него");
const list = q.get("list") || t("без названия");
document.getElementById("site").textContent = strict ? (until ? t("{0} закрыт списком «{1}» до {2}", site, list, until) : t("{0} закрыт списком «{1}», пока идёт фокус", site, list))
  : brk ? t("{0} заблокирован, пока идёт цикл", site) : t("{0} заблокирован, пока идёт фокус", site);
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
