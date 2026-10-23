// ==UserScript==
// @name           Luminoctis: боковая рейка
// @description    Рейка 56px слева: иконка Luminoctis, рабочие пространства Zen, закрепы (папка закладок «Luminoctis»), плееры.
// ==/UserScript==

(() => {
  const PIN_FOLDER = "Luminoctis";

  const h = (tag, className, props = {}) =>
    Object.assign(document.createElement(tag), { className }, props);
  const labeled = (el, text) => {
    el.setAttribute("aria-label", text);
    el.title = text;
    return el;
  };

  // Страница настроек Luminoctis (Luminoctis\settings → профиль chrome\resources\luminoctis, адрес даёт fx-autoconfig).
  // Её открывают меню рейки и шестерёнка; уже открытая вкладка настроек переиспользуется.
  const SETTINGS_URL = "chrome://userchrome/content/luminoctis/settings.html";
  window.luminoctis = {
    pinFolderGuid: () => pinFolderGuid(),
    openSettings(section = "") {
      switchToTabHavingURI(SETTINGS_URL + (section && "#" + section), true, {
        ignoreFragment: "whenComparingAndReplace",
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
    },
  };

  UC_API.Windows.waitWindowLoading(window).then(() => {
    const rail = h("nav", "", { id: "lumi-rail" });
    rail.setAttribute("aria-label", "Боковая панель Luminoctis");

    // Клик (Inter Menu) и смена картинки по ПКМ — на следующих этапах.
    const logo = labeled(h("button", "", { id: "lumi-logo", textContent: "L" }), "Luminoctis");

    const pins = h("div", "", { id: "lumi-pins" });
    const players = h("div", "", { id: "lumi-players" });
    rail.append(
      logo,
      h("div", "lumi-sep"),
      h("div", "lumi-sep"),
      h("span", "lumi-caption", { textContent: "PIN" }),
      pins,
      h("div", "lumi-spacer"),
      players
    );
    document.getElementById("navigator-toolbox").before(rail);

    initWorkspaces(rail);
    initPins(pins);
    initPlayers(players);
    initRailMenu(rail);
  });

  // ---------- Меню по правой кнопке на рейке ----------
  // Рейка — область перетаскивания окна; без своего меню Windows показывает системное меню окна.
  // У кнопок пространств своё родное меню Zen, у закрепов меню нет — их не трогаем.
  function initRailMenu(rail) {
    const menu = window.MozXULElement.parseXULToFragment(`
      <menupopup id="lumi-rail-menu">
        <menuitem id="lumi-rail-menu-sidebar" label="Настройки боковой панели"/>
        <menuitem id="lumi-rail-menu-settings" label="Настройки мода Luminoctis"/>
        <menuseparator/>
        <menuitem label="Управление пространствами" command="cmd_zenManageWorkspaces"/>
        <menuitem label="Новое пространство" command="cmd_zenOpenWorkspaceCreation"/>
        <menuitem label="Новая вкладка" command="cmd_newNavigatorTab"/>
        <menuseparator/>
        <menuitem label="Настроить панель инструментов" command="cmd_CustomizeToolbars"/>
      </menupopup>`).firstElementChild;
    document.getElementById("mainPopupSet").append(menu);
    menu.querySelector("#lumi-rail-menu-settings").addEventListener("command", () => luminoctis.openSettings());
    menu.querySelector("#lumi-rail-menu-sidebar").addEventListener("command", () => luminoctis.openSettings("sidebar"));
    rail.addEventListener("contextmenu", event => {
      if (event.target.closest("#zen-workspaces-button toolbarbutton, .lumi-pin")) return;
      event.preventDefault();
      menu.openPopupAtScreen(event.screenX, event.screenY, true, event);
    });
  }

  // ---------- Рабочие пространства: родной переключатель Zen, перенесённый в рейку ----------
  function initWorkspaces(rail) {
    const icons = document.getElementById("zen-workspaces-button");
    // Элемент Zen подключается один раз (#hasConnected), перенос его не ломает.
    rail.querySelector(".lumi-sep").after(icons);

    // Цветная точка контейнера Firefox: цвет берём из контейнера пространства.
    const paintDots = () => {
      for (const btn of icons.querySelectorAll("toolbarbutton[zen-workspace-id]")) {
        const ws = gZenWorkspaces.getWorkspaceFromId(btn.getAttribute("zen-workspace-id"));
        const color = ws?.containerTabId
          ? ContextualIdentityService.getPublicIdentityFromId(ws.containerTabId)?.color
          : null;
        if (color) btn.setAttribute("lumi-container", color);
        else btn.removeAttribute("lumi-container");
      }
    };
    window.addEventListener("ZenWorkspacesUIUpdate", () => setTimeout(paintDots));
    paintDots();
  }

  // ---------- Закрепы: закладки из папки «Luminoctis», общие для всех пространств ----------
  async function pinFolderGuid() {
    const { bookmarks } = PlacesUtils;
    const roots = [bookmarks.toolbarGuid, bookmarks.menuGuid];
    const found = (await bookmarks.search({ title: PIN_FOLDER })).find(
      b => b.type == bookmarks.TYPE_FOLDER && roots.includes(b.parentGuid)
    );
    if (found) return found.guid;
    // папка закрепов до переименования мода (2026-10-23) — просто переименовываем
    const old = (await bookmarks.search({ title: "Laith" })).find(
      b => b.type == bookmarks.TYPE_FOLDER && roots.includes(b.parentGuid)
    );
    if (old) return (await bookmarks.update({ guid: old.guid, title: PIN_FOLDER })).guid;
    const folder = await bookmarks.insert({
      parentGuid: bookmarks.menuGuid,
      type: bookmarks.TYPE_FOLDER,
      title: PIN_FOLDER,
    });
    return folder.guid;
  }

  function initPins(box) {
    let timer;
    const render = async () => {
      const tree = await PlacesUtils.promiseBookmarksTree(await pinFolderGuid());
      const items = (tree.children ?? []).filter(c => c.uri); // без подпапок и разделителей
      box.replaceChildren(...items.map(pinButton));
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => render().catch(console.error), 100);
    };

    const events = ["bookmark-added", "bookmark-removed", "bookmark-moved",
      "bookmark-title-changed", "bookmark-url-changed"];
    PlacesUtils.observers.addListener(events, schedule);
    window.addEventListener("unload", () => PlacesUtils.observers.removeListener(events, schedule));
    schedule();
  }

  function pinButton({ uri, title }) {
    const btn = labeled(h("button", "lumi-pin"), title || uri);
    btn.append(h("img", "", { src: `page-icon:${uri}`, alt: "" }));
    btn.addEventListener("click", () => {
      const r = btn.getBoundingClientRect();
      // Родной Glance Zen в отдельном окошке: не создаёт вкладку, закрывается кликом мимо.
      gZenGlanceManager.openDetachedGlance({
        url: uri,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
    });
    return btn;
  }

  // ---------- Плееры: зеркало карточек родных медиа-контролов Zen ----------
  // Zen сам решает, когда карточка видна (играет, вкладка не спит и не выбрана);
  // мы показываем те же карточки плитками и жмём их же кнопки.
  function initPlayers(box) {
    const bar = document.getElementById("zen-media-controls-toolbar");
    let last = "";
    const sync = () => {
      const cards = [...bar.querySelectorAll(".zen-media-card:not([hidden])")];
      const data = cards.map(card => ({
        card,
        title: card.querySelector(".zen-media-title").textContent,
        artist: card.querySelector(".zen-media-artist").textContent,
        icon: card.querySelector(".zen-media-focus-button").style.listStyleImage,
        playing: card.classList.contains("playing"),
        noPrev: card.querySelector(".zen-media-previoustrack-button").disabled,
        noNext: card.querySelector(".zen-media-nexttrack-button").disabled,
      }));
      // Zen каждую секунду обновляет время и прогресс — перерисовываем только при смене данных.
      const key = JSON.stringify(data.map(({ card, ...rest }) => rest));
      if (key == last) return;
      last = key;
      box.replaceChildren(...data.map(playerTile));
      // порядок для лесенки анимации: открываются сверху вниз, закрываются снизу вверх
      [...box.children].forEach((tile, i, all) => {
        tile.style.setProperty("--i", i);
        tile.style.setProperty("--ri", all.length - 1 - i);
      });
    };
    new MutationObserver(sync).observe(bar, {
      subtree: true, childList: true, characterData: true, attributes: true,
    });
    sync();

    // Открыты, пока мышь над плитками или самими карточками; закрываем с запасом 250 мс,
    // чтобы случайный выход за край карточки не схлопывал всё.
    let closeTimer;
    box.addEventListener("mouseenter", () => {
      clearTimeout(closeTimer);
      box.setAttribute("open", "");
    });
    box.addEventListener("mouseleave", () => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => box.removeAttribute("open"), 250);
    });
  }

  function playerTile({ card, title, artist, icon, playing, noPrev, noNext }) {
    const press = sel => () => card.querySelector(sel).doCommand();
    const button = (cls, label, sel, disabled = false) => {
      const b = labeled(h("button", cls, { disabled }), label);
      b.addEventListener("click", press(sel));
      return b;
    };

    const tile = h("div", "lumi-player" + (playing ? " playing" : ""));
    const cover = button("lumi-player-cover", title || "Плеер", ".zen-media-focus-button");
    cover.style.backgroundImage = icon;
    const text = h("div", "lumi-player-text");
    text.append(
      h("span", "lumi-player-title", { textContent: title }),
      h("span", "lumi-player-artist", { textContent: artist })
    );
    tile.append(
      cover,
      text,
      button("lumi-player-prev", "Предыдущий трек", ".zen-media-previoustrack-button", noPrev),
      button("lumi-player-play", playing ? "Пауза" : "Играть", ".zen-media-playpause-button"),
      button("lumi-player-next", "Следующий трек", ".zen-media-nexttrack-button", noNext)
    );
    return tile;
  }
})();
