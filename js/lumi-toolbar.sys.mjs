// ==UserScript==
// @name           Luminoctis: панель адреса
// @description    Порядок кнопок как в концепте (назад · обновить · вперёд → адрес → расширения → загрузки → шестерёнка; «+» — в полосе вкладок) и настройка мода «новая вкладка вместо переключения».
// ==/UserScript==

import { CustomizableUI } from "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs";

// Шестерёнка — родная кнопка Firefox «Настройки» (preferences-button): открывает настройки Zen, значок-шестерёнку даёт Zen.
// Настройки мода — правой кнопкой по рейке (js/lumi-rail.uc.js).
// Раскладку ставим один раз (номер версии в настройке), дальше пользователь вправе её менять.
// Ждём первое окно: до него CustomizableUI ещё не загрузил сохранённую раскладку и перезапишет нашу.
const LAYOUT_VERSION = 3; // 2: «+» переехал в полосу вкладок; 3: своя шестерёнка заменена родной
function applyLayout() {
  Services.obs.removeObserver(applyLayout, "browser-delayed-startup-finished");
  const version = Services.prefs.getIntPref("luminoctis.toolbar.layout", 0);
  if (version >= LAYOUT_VERSION) return;
  if (version == 2) {
    // раскладка уже стоит (возможно, с правками пользователя) — меняем только кнопку, на том же месте
    const gear = CustomizableUI.getPlacementOfWidget("lumi-gear-button", false);
    if (gear) CustomizableUI.addWidgetToArea("preferences-button", gear.area, gear.position);
    CustomizableUI.removeWidgetFromArea("lumi-gear-button");
  } else {
    const order = [
      "back-button", "stop-reload-button", "forward-button",
      "urlbar-container", "unified-extensions-button", "downloads-button", "preferences-button",
    ];
    order.forEach((id, i) => CustomizableUI.addWidgetToArea(id, CustomizableUI.AREA_NAVBAR, i));
    for (const id of CustomizableUI.getWidgetIdsInArea(CustomizableUI.AREA_NAVBAR)) {
      if (CustomizableUI.isSpecialWidget(id)) CustomizableUI.removeWidgetFromArea(id); // пружины
    }
    CustomizableUI.removeWidgetFromArea("sidebar-button"); // родная боковая панель не нужна
    CustomizableUI.removeWidgetFromArea("new-tab-button"); // «+» теперь в полосе вкладок
    CustomizableUI.removeWidgetFromArea("lumi-gear-button"); // своя шестерёнка до версии 3
  }
  Services.prefs.setIntPref("luminoctis.toolbar.layout", LAYOUT_VERSION);
}
Services.obs.addObserver(applyLayout, "browser-delayed-startup-finished");

// Настройка мода (preferences.json, страница «Моды» в настройках Zen): «открывать новую вкладку, а не
// переключаться на уже открытую». Переключение предлагают результаты «Перейти на вкладку» в адресной строке —
// и Firefox, и Zen (его поиск по вкладкам боковой панели) включают их одной настройкой browser.urlbar.suggest.openpage.
const NEW_TAB_PREF = "luminoctis.urlbar.always-new-tab";
const syncSwitchToTab = () => {
  if (Services.prefs.getBoolPref(NEW_TAB_PREF, false)) {
    Services.prefs.setBoolPref("browser.urlbar.suggest.openpage", false);
  } else {
    Services.prefs.clearUserPref("browser.urlbar.suggest.openpage"); // родное поведение — переключаться
  }
};
Services.prefs.addObserver(NEW_TAB_PREF, syncSwitchToTab);
if (Services.prefs.getBoolPref(NEW_TAB_PREF, false)) syncSwitchToTab(); // при старте трогаем только если включено
