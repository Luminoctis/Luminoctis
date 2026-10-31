// Luminoctis Home (chrome://userchrome/content/luminoctis/home/home.html) — каркас страницы.
// Страница привилегированная (chrome:// во вкладке, системный принципал): Services, ChromeUtils, IOUtils, PathUtils.
// Окно браузера — window.browsingContext.topChromeWindow (там window.lumiHome, window.luminoctis).
// Виджеты подключаются своими файлами (список — в home.html) и рисуют в своих областях: #lumi-wallpaper, #lumi-clock, #lumi-search, #lumi-shortcuts, #lumi-notes.
import { JS } from "./paths.js";
ChromeUtils.importESModule(JS("lumi-palette.sys.mjs")).watch(document);

// блоки first screen и заметки включаются/выключаются: luminoctis.home.show.<clock|search|shortcuts|notes> (по умолчанию все включены)
const SHOW = "luminoctis.home.show.";
const applyShow = () => {
  for (const b of ["clock", "search", "shortcuts", "notes"]) document.body.toggleAttribute("lumi-hide-" + b, !Services.prefs.getBoolPref(SHOW + b, true));
};
Services.prefs.addObserver(SHOW, applyShow);
window.addEventListener("unload", () => Services.prefs.removeObserver(SHOW, applyShow));
applyShow();

// плавная прокрутка к заметкам и обратно
const go = top => document.documentElement.scrollTo({ top, behavior: "smooth" });
document.getElementById("lumi-scroll-down").onclick = () => go(innerHeight);
document.getElementById("lumi-scroll-up").onclick = () => go(0);
addEventListener("scroll", () => document.body.toggleAttribute("lumi-scrolled", document.documentElement.scrollTop > innerHeight / 3), { passive: true });
