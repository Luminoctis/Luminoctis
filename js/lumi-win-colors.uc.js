// ==UserScript==
// @name           Luminoctis: настройки Windows и прозрачность
// @description    В прозрачных режимах окна («Прозрачный», «Обои») плашка вверху окна, если настройки цвета Windows мешают прозрачности: «Исправить», «Открыть настройки Windows», «Не напоминать». Логика — lumi-win-colors.sys.mjs, подсказка в настройках — settings.js.
// ==/UserScript==

UC_API.Windows.waitWindowLoading(window).then(() => {
  const base = Components.stack.filename.replace(/[^/]*$/, "");
  const { t } = ChromeUtils.importESModule(base + "lumi-i18n.sys.mjs");
  const mod = ChromeUtils.importESModule(base + "lumi-win-colors.sys.mjs");
  const W = mod.lumiWinColors, ID = "lumi-win-colors";
  // три кнопки не помещаются в узкую плашку Zen — переносятся
  const css = document.createElementNS("http://www.w3.org/1999/xhtml", "style");
  css.textContent = "notification-message[lumi-win-colors] .notification-button-container, notification-message[lumi-win-colors] .notification-button-container > * { flex-wrap: wrap; }";
  document.documentElement.append(css);
  const box = () => gNotificationBox;
  const bar = () => box().getNotificationWithValue(ID);

  let adding = false; // appendNotification асинхронный: параллельные update() не должны добавить вторую плашку
  async function update() {
    const c = W.check(), shown = bar();
    if (!c.active || !c.issues.length || c.dismissed) return void shown?.close();
    if (shown || adding) return;
    adding = true;
    try {
    const n = await box().appendNotification(ID, {
      label: t("Настройки Windows мешают прозрачности"),
      priority: box().PRIORITY_WARNING_MEDIUM,
    }, [
      { label: t("Исправить"), callback: () => { W.fix(); update(); return true; } },
      { label: t("Открыть настройки Windows"), callback: () => {
        W.openSettings();
        const l = bar(); if (l) l.messageText.textContent = t("В Windows (Персонализация → Цвета) включите «Эффекты прозрачности» и выключите цвет акцента на заголовках окон и на панели задач и в меню «Пуск».");
        return true;
      } },
      { label: t("Не напоминать"), callback: () => { Services.prefs.setBoolPref(mod.DISMISS, true); return false; } },
    ]);
    n.setAttribute("lumi-win-colors", "");
    } finally { adding = false; }
  }

  const watch = () => update();
  for (const p of [mod.MODE, mod.DISMISS]) Services.prefs.addObserver(p, watch);
  Services.obs.addObserver(watch, mod.TOPIC);
  window.addEventListener("focus", watch); // вернулся из настроек Windows
  window.addEventListener("unload", () => {
    for (const p of [mod.MODE, mod.DISMISS]) Services.prefs.removeObserver(p, watch);
    Services.obs.removeObserver(watch, mod.TOPIC);
  }, { once: true });

  window.lumiWinColors = W;
  window.lumiWinColorsBar = { update, get notification() { return bar(); } };
  update();
});
