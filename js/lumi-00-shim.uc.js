// ==UserScript==
// @name           Luminoctis: UC_API для Sine
// @description    fx-autoconfig даёт глобальный UC_API сам; под Sine его нет — берём тот же модуль из chrome://userchromejs.
// ==/UserScript==

window.UC_API ??= ChromeUtils.importESModule("chrome://userchromejs/content/uc_api.sys.mjs");
