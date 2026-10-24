// Luminoctis Home (chrome://userchrome/content/luminoctis/home/home.html) — каркас страницы.
// Страница привилегированная (chrome:// во вкладке, системный принципал): Services, ChromeUtils, IOUtils, PathUtils.
// Окно браузера — window.browsingContext.topChromeWindow (там window.lumiHome, window.luminoctis).
// Виджеты подключаются своими файлами (список — в home.html) и рисуют в своих областях: #lumi-wallpaper, #lumi-clock, #lumi-time, #lumi-notes.
ChromeUtils.importESModule("chrome://userscripts/content/lumi-palette.sys.mjs").watch(document);
