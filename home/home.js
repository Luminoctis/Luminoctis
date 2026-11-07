// Luminoctis Home (chrome://userchrome/content/luminoctis/home/home.html) — каркас страницы.
// Страница привилегированная (chrome:// во вкладке, системный принципал): Services, ChromeUtils, IOUtils, PathUtils.
// Окно браузера — window.browsingContext.topChromeWindow (там window.lumiHome, window.luminoctis).
// Виджеты подключаются своими файлами (список — в home.html) и рисуют в своих областях: #lumi-wallpaper, #lumi-clock, #lumi-search, #lumi-shortcuts, #lumi-notes.
import { JS } from "./paths.js";
ChromeUtils.importESModule(JS("lumi-palette.sys.mjs")).watch(document);

// блоки first screen и заметки включаются/выключаются: luminoctis.home.show.<clock|search|shortcuts|notes> (по умолчанию все включены)
const SHOW = "luminoctis.home.show.";
const priv = window.browsingContext.usePrivateBrowsing; // в инкогнито LumiNotes нет
const applyShow = () => {
  for (const b of ["clock", "search", "shortcuts", "notes"]) document.body.toggleAttribute("lumi-hide-" + b, !Services.prefs.getBoolPref(SHOW + b, true) || (b == "notes" && priv));
};
Services.prefs.addObserver(SHOW, applyShow);
window.addEventListener("unload", () => Services.prefs.removeObserver(SHOW, applyShow));
applyShow();

// плавная прокрутка к заметкам и обратно
const go = top => document.documentElement.scrollTo({ top, behavior: "smooth" });
document.getElementById("lumi-scroll-down").onclick = () => go(innerHeight);
document.getElementById("lumi-scroll-up").onclick = () => go(0);
addEventListener("scroll", () => document.body.toggleAttribute("lumi-scrolled", document.documentElement.scrollTop > innerHeight / 3), { passive: true });

// кивок стрелки вниз — таймером, не infinite-анимацией, и только 3 раза за показ Home: в прозрачных режимах окна каждый кадр анимации тянет ~50% ядра
// (замер 2026-11-06: постоянный кивок = 5–10% ядра и ~5% GPU в простое). Не в скрытой Home и не после прокрутки.
const arrow = document.getElementById("lumi-scroll-down");
let nudges = 0;
arrow.addEventListener("animationend", () => arrow.removeAttribute("nudge"));
document.addEventListener("visibilitychange", () => { if (!document.hidden) nudges = 0; });
setInterval(() => { if (!document.hidden && nudges < 3 && !document.body.hasAttribute("lumi-scrolled")) { nudges++; arrow.setAttribute("nudge", ""); } }, 2800);
