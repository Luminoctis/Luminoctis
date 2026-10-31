// ==UserScript==
// @name           Luminoctis: точка обновления
// @description    Ставит на окно атрибут lumi-update, пока найдена новая версия мода (luminoctis.update.available); по нему chrome.css рисует точку на шестерёнке.
// ==/UserScript==

(() => {
  const PREF = "luminoctis.update.available";
  const root = document.documentElement;
  // атрибутом, потому что @media -moz-pref() не умеет «строка не пуста»
  const read = () => root.toggleAttribute("lumi-update", !!Services.prefs.getStringPref(PREF, ""));
  Services.prefs.addObserver(PREF, read);
  window.addEventListener("unload", () => Services.prefs.removeObserver(PREF, read), { once: true });
  read();
})();
