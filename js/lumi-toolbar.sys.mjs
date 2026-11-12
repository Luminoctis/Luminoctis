// ==UserScript==
// @name           Luminoctis: панель адреса
// @description    Порядок кнопок как в концепте (назад · обновить · вперёд → адрес → расширения → загрузки → шестерёнка; «+» — в полосе вкладок) и настройка мода «новая вкладка вместо переключения».
// ==/UserScript==

import { CustomizableUI } from "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs";

const { t } = ChromeUtils.importESModule(new URL("lumi-i18n.sys.mjs", import.meta.url).href);
// Настройки Zen, без которых мод выглядит неправильно. Установщик пишет их сам (installer/install.ps1 $prefDefs); под Sine установщика нет —
// ставим один раз из JS (флаг luminoctis.prefs.seeded), если нет <профиль>\luminoctis-install.json. Список держать в паре с $prefDefs.
// Часть настроек Zen читает при создании окна, поэтому при самом первом запуске нужен перезапуск.
{
  const state = Services.dirsvc.get("ProfD", Ci.nsIFile);
  state.append("luminoctis-install.json");
  if (!state.exists() && !Services.prefs.getBoolPref("luminoctis.prefs.seeded", false)) {
    const set = {
      "zen.workspaces.separate-essentials": false, "zen.view.use-single-toolbar": false,
      "zen.view.compact.enable-at-startup": true, "zen.view.compact.hide-toolbar": true, "zen.view.compact.hide-tabbar": false,
      "zen.view.sidebar-expanded": true, "zen.view.show-newtab-button-top": false,
      "browser.download.autohideButton": false, "browser.urlbar.scotchBonnet.enableOverride": true,
      "browser.urlbar.unifiedSearchButton.always": true,
    };
    for (const [k, v] of Object.entries(set)) Services.prefs.setBoolPref(k, v);
    Services.prefs.setBoolPref("luminoctis.prefs.seeded", true);
  }
}

// Шестерёнка — родная кнопка Firefox «Настройки» (preferences-button): открывает настройки Zen, значок-шестерёнку даёт Zen.
// Настройки мода — правой кнопкой по рейке (js/lumi-rail.uc.js).
// Раскладку ставим один раз (номер версии в настройке), дальше пользователь вправе её менять.
// Ждём первое окно: до него CustomizableUI ещё не загрузил сохранённую раскладку и перезапишет нашу.
const LAYOUT_VERSION = 4; // 2: «+» переехал в полосу вкладок; 3: своя шестерёнка заменена родной; 4: «⋯» — свой виджет lumi-appmenu-button

// «⋯»: родная #PanelUI-button не настраивается (removable=false), поэтому своя кнопка-виджет; меню открывает lumi-appmenu.uc.js
// (PanelUI.menuButton подменён на неё), родная кнопка спрятана в chrome.css. Значок и «Меню» — в chrome.css / label.
if (CustomizableUI.getWidget("lumi-appmenu-button")?.provider != "api") {
  CustomizableUI.createWidget({
    id: "lumi-appmenu-button", type: "button", label: t("Меню"), tooltiptext: t("Меню"),
    removable: true, overflows: false,
    onCreated(node) { node.setAttribute("badged", "true"); node.setAttribute("delegatesanchor", "true"); },
  });
}

function applyLayout() {
  Services.obs.removeObserver(applyLayout, "browser-delayed-startup-finished");
  const version = Services.prefs.getIntPref("luminoctis.toolbar.layout", 0);
  if (version >= LAYOUT_VERSION) return;
  if (version >= 2) {
    if (version == 2) {
      // раскладка уже стоит (возможно, с правками пользователя) — меняем только кнопку, на том же месте
      const gear = CustomizableUI.getPlacementOfWidget("lumi-gear-button", false);
      if (gear) CustomizableUI.addWidgetToArea("preferences-button", gear.area, gear.position);
      CustomizableUI.removeWidgetFromArea("lumi-gear-button");
    }
    // 3→4: добавляем «⋯» перед шестерёнкой, только если виджета ещё нигде нет
    if (!CustomizableUI.getPlacementOfWidget("lumi-appmenu-button", false)) {
      const gear = CustomizableUI.getPlacementOfWidget("preferences-button", false);
      CustomizableUI.addWidgetToArea("lumi-appmenu-button", gear?.area ?? CustomizableUI.AREA_NAVBAR, gear?.position);
    }
  } else {
    const order = [
      "back-button", "stop-reload-button", "forward-button",
      "urlbar-container", "unified-extensions-button", "downloads-button", "lumi-appmenu-button", "preferences-button",
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
