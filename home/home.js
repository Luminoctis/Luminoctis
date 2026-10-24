// Luminoctis Home (chrome://userchrome/content/luminoctis/home/home.html) — каркас страницы.
// Страница привилегированная (chrome:// во вкладке, системный принципал): Services, ChromeUtils, IOUtils, PathUtils.
// Окно браузера — window.browsingContext.topChromeWindow (там window.lumiHome, window.luminoctis).
// Виджеты подключаются своими файлами (список — в home.html) и рисуют в своих областях: #lumi-wallpaper, #lumi-clock, #lumi-time, #lumi-notes.
ChromeUtils.importESModule("chrome://userscripts/content/lumi-palette.sys.mjs").watch(document);

// заглушка часов, пока нет home/clock.js: время чч:мм и дата; clock.js заменит содержимое #lumi-clock
const clock = document.getElementById("lumi-clock");
const time = clock.querySelector(".lumi-clock-time"), date = clock.querySelector(".lumi-clock-date");
if (time && date) {
  const tick = () => {
    const now = new Date();
    time.textContent = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    date.textContent = now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    setTimeout(tick, 1000 - now.getMilliseconds());
  };
  tick();
}
