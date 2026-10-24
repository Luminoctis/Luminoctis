// ==UserScript==
// @name           Luminoctis: меню «⋯» и меню вкладки
// @description    Родное меню Zen/Firefox открывает своя кнопка-виджет «⋯» (по умолчанию в панели адреса слева от шестерёнки); пункты меню прячутся по настройке luminoctis.appmenu.hidden, пункты меню вкладки — по luminoctis.tabmenu.hidden.
// ==/UserScript==

UC_API.Windows.waitWindowLoading(window).then(() => {
  // «⋯» — свой виджет lumi-appmenu-button (js/lumi-toolbar.sys.mjs), настраивается как любая кнопка. Меню открывает родной PanelUI:
  // подменяем PanelUI.menuButton на нашу кнопку (якорь панели, подсветка [open], значки уведомлений — всё родное) и повторяем
  // родные обработчики mousedown/keypress. Если виджет убран в палитру, остаётся родная (спрятанная) кнопка.
  const nativeDots = PanelUI.menuButton;
  const widget = () => CustomizableUI.getPlacementOfWidget("lumi-appmenu-button", false) &&
    document.getElementById("lumi-appmenu-button");
  Object.defineProperty(PanelUI, "menuButton", { configurable: true, get: () => widget() || nativeDots });
  // Firefox при каждом открытии/закрытии ставит на кнопку свои подписи (l10n) — возвращаем «Меню»
  const nativeUpdate = PanelUI._updatePanelButton;
  PanelUI._updatePanelButton = function (...args) {
    nativeUpdate.apply(this, args);
    const btn = widget();
    if (btn) {
      btn.removeAttribute("data-l10n-id");
      btn.setAttribute("label", "Меню");
      btn.setAttribute("tooltiptext", "Меню");
    }
  };
  const isDots = event => event.target.closest?.("#lumi-appmenu-button");
  window.addEventListener("mousedown", event => {
    if (event.button == 0 && isDots(event)) PanelUI.toggle(event);
  });
  window.addEventListener("keypress", event => {
    if ((event.key == " " || event.key == "Enter") && isDots(event)) {
      PanelUI.toggle(event);
      event.stopPropagation();
    }
  });

  // ---------- какие пункты меню видны: luminoctis.appmenu.hidden — id скрытых через запятую (выбор — в панели настроек) ----------
  // Пункты — строки главного вида меню (#appMenu-mainView). Применяем при смене настройки и при каждом открытии (Zen сам прячет и показывает часть строк).
  // Черта между группами прячется, если вокруг неё не осталось видимых пунктов.
  const HIDDEN = "luminoctis.appmenu.hidden";
  const rows = () => [...PanelMultiView.getViewNode(document, "appMenu-mainView").querySelector(".panel-subview-body").children];
  const nativeHidden = el => el.hidden || (!el.hasAttribute("lumi-hidden") && getComputedStyle(el).display == "none");
  const apply = () => {
    const hidden = new Set(Services.prefs.getStringPref(HIDDEN, "").split(","));
    let lastSep = null, seen = false;
    for (const el of rows()) {
      if (el.localName == "toolbarseparator") {
        el.toggleAttribute("lumi-hidden", !seen); // перед ней видимых пунктов нет
        if (seen) lastSep = el;
        seen = false;
        continue;
      }
      el.toggleAttribute("lumi-hidden", hidden.has(el.id));
      seen ||= !nativeHidden(el) && !el.hasAttribute("lumi-hidden");
    }
    if (!seen) lastSep?.setAttribute("lumi-hidden", ""); // последняя черта — без пунктов под ней
  };
  window.addEventListener("ViewShowing", event => {
    if (event.target.id == "appMenu-mainView") apply();
  });
  Services.prefs.addObserver(HIDDEN, apply);
  window.addEventListener("unload", () => Services.prefs.removeObserver(HIDDEN, apply));

  // Список пунктов для панели настроек: строки меню, которые Zen сейчас показывает (уведомления и пустые — не считаем)
  const textOf = el => el.getAttribute("label") ||
    [...el.querySelectorAll("label")].map(l => !l.hidden && (l.value || l.textContent.trim())).find(Boolean) || "";
  luminoctis.appMenuItems = async () => {
    await document.l10n.translateFragment(PanelMultiView.getViewNode(document, "appMenu-mainView")); // меню ещё ни разу не открывали — подписей нет
    return rows()
      .filter(el => el.id && el.localName != "toolbarseparator" && !nativeHidden(el) && !el.matches(".panel-banner-item, #appMenu-addon-banners"))
      .map(el => ({
        id: el.id,
        // ряд масштаба — одна строка: «Масштаб» и кнопки в нём (полноэкранный режим)
        label: [textOf(el), ...[...el.querySelectorAll(":scope > toolbarbutton[label]")].map(b => b.id.includes("zoom") ? "" : b.label)]
          .filter(Boolean).join(" · "),
      }))
      .filter(item => item.label);
  };

  // ---------- меню вкладки (#tabContextMenu): luminoctis.tabmenu.hidden — id скрытых пунктов через запятую ----------
  // Родное меню строит Firefox/Zen и при каждом открытии сам прячет и показывает часть пунктов (по вкладке) — наш слушатель
  // стоит после их обработчика (onpopupshowing в разметке), поэтому применяем в нём. Скрытое прячется атрибутом lumi-hidden (chrome.css, раздел 8);
  // черта, вокруг которой не осталось видимых пунктов, прячется тоже.
  const TAB_HIDDEN = "luminoctis.tabmenu.hidden";
  const tabMenu = document.getElementById("tabContextMenu");
  // варианты пунктов для нескольких выбранных вкладок прячутся вместе с основным (в списке настроек их нет)
  const TWINS = {
    context_reloadTab: "context_reloadSelectedTabs", context_playTab: "context_playSelectedTabs",
    context_toggleMuteTab: "context_toggleMuteSelectedTabs", context_pinTab: "context_pinSelectedTabs",
    context_unpinTab: "context_unpinSelectedTabs", context_duplicateTab: "context_duplicateTabs",
    context_bookmarkTab: "context_bookmarkSelectedTabs", context_moveTabToNewGroup: "context_moveSplitViewToNewGroup",
    context_ungroupTab: "context_ungroupSplitView",
  };
  const applyTabMenu = () => {
    const hidden = new Set(Services.prefs.getStringPref(TAB_HIDDEN, "").split(","));
    for (const id of [...hidden]) if (TWINS[id]) hidden.add(TWINS[id]);
    let lastSep = null, seen = false;
    for (const el of tabMenu.children) {
      el.removeAttribute("lumi-hidden");
      if (el.hidden) continue; // родное решение: для этой вкладки пункта нет
      if (el.localName == "menuseparator") {
        if (!seen) el.setAttribute("lumi-hidden", ""); // перед чертой видимых пунктов нет
        else lastSep = el;
        seen = false;
      } else if (hidden.has(el.id)) {
        el.setAttribute("lumi-hidden", "");
      } else {
        seen = true;
      }
    }
    if (!seen) lastSep?.setAttribute("lumi-hidden", ""); // последняя черта — без пунктов под ней
  };
  tabMenu.addEventListener("popupshowing", event => event.target == tabMenu && applyTabMenu());
  Services.prefs.addObserver(TAB_HIDDEN, applyTabMenu);
  window.addEventListener("unload", () => Services.prefs.removeObserver(TAB_HIDDEN, applyTabMenu));

  // Список пунктов для панели настроек. Подписи Firefox подгружает по первому открытию меню — переводим заранее.
  // Показываем все пункты с подписью (не только видимые сейчас: это зависит от вкладки, на которой меню открывали в последний раз),
  // кроме двойников для нескольких вкладок и пунктов полноэкранного режима.
  const twinIds = new Set(Object.values(TWINS));
  luminoctis.tabMenuItems = async () => {
    gBrowser.translateTabContextMenu();
    await document.l10n.translateFragment(tabMenu);
    return [...tabMenu.children]
      .filter(el => el.id && el.localName != "menuseparator" && el.getAttribute("label") && !twinIds.has(el.id) && !/fullscreen/i.test(el.id))
      .map(el => ({ id: el.id, label: el.getAttribute("label") }));
  };
});
