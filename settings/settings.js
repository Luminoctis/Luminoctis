// Панель настроек Luminoctis (chrome://userchrome/content/luminoctis/settings.html, встроена в окно справа от рейки —
// js/lumi-rail.uc.js). Страница привилегированная: читает и пишет настройки Firefox напрямую,
// закрепы (родные Essentials Zen) — через win.luminoctis, пространства — через gZenWorkspaces окна.
const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
const win = window.browsingContext.topChromeWindow; // окно браузера с этой панелью
const { ContextualIdentityService } = win;
const $ = sel => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
// цвета контейнеров — токены палитры, как точки на рейке
const DOT = { blue: "blue", turquoise: "teal", green: "green", yellow: "yellow", orange: "orange",
  red: "red", pink: "pink", purple: "purple", toolbar: "fg" };
// палитра: цвета ставятся и на эту страницу (она отдельный документ и не наследует переменные окна)
const palette = ChromeUtils.importESModule("chrome://userscripts/content/lumi-palette.sys.mjs");
palette.watch(document, { glass: true });
const keys = ChromeUtils.importESModule("chrome://userscripts/content/lumi-keys.sys.mjs");

// ---------- разделы: ряд вкладок сверху, открытый раздел — в адресе (settings.html#sidebar) ----------
const tabButtons = [...document.querySelectorAll(".tabs [data-tab]")];
const showTab = () => {
  const [wanted, anchor] = location.hash.slice(1).split("/"); // #раздел или #раздел/место
  const name = tabButtons.some(b => b.dataset.tab == wanted) ? wanted : "sidebar";
  for (const b of tabButtons) b.setAttribute("aria-selected", b.dataset.tab == name);
  for (const s of document.querySelectorAll("main > section")) s.classList.toggle("shown", s.id == name);
  document.querySelector("main").scrollTop = 0;
  if (name == wanted && anchor) document.getElementById(anchor + "-section")?.scrollIntoView({ block: "start" });
  Services.prefs.setStringPref("luminoctis.settings.tab", name); // панель откроется на нём и после перезапуска
};
window.lumiShowTab = showTab; // для js/lumi-rail.uc.js: тот же адрес hashchange не шлёт
for (const b of tabButtons) b.addEventListener("click", () => location.replace("#" + b.dataset.tab)); // без записи в историю
window.addEventListener("hashchange", showTab);
showTab();

// «Готово» и Esc закрывают панель; клик мимо — нет, рейкой можно пользоваться и при открытых настройках
const close = () => win.luminoctis.closeSettings();
$("#done").addEventListener("click", close);
window.addEventListener("keydown", event => {
  if (event.key == "Escape" && !event.defaultPrevented) close();
});

// ---------- флажки, привязанные к настройкам (data-pref, data-inverted — флажок означает «не») ----------
for (const box of document.querySelectorAll("input[type=checkbox][data-pref]")) {
  const pref = box.dataset.pref, inverted = "inverted" in box.dataset;
  const read = () => (box.checked = Services.prefs.getBoolPref(pref, box.dataset.default == "true") != inverted);
  box.addEventListener("change", () => Services.prefs.setBoolPref(pref, box.checked != inverted));
  Services.prefs.addObserver(pref, read);
  window.addEventListener("unload", () => Services.prefs.removeObserver(pref, read));
  read();
}

// ---------- выбор из нескольких значений (data-pref, data-default; кнопки data-value; data-int — числовая настройка) ----------
for (const seg of document.querySelectorAll("div[data-pref]")) {
  const pref = seg.dataset.pref, int = "int" in seg.dataset;
  const read = () => {
    const v = int ? String(Services.prefs.getIntPref(pref, Number(seg.dataset.default))) : Services.prefs.getStringPref(pref, seg.dataset.default);
    for (const b of seg.querySelectorAll("[data-value]")) b.classList.toggle("on", b.dataset.value == v);
  };
  seg.addEventListener("click", event => {
    const b = event.target.closest("[data-value]");
    if (b) int ? Services.prefs.setIntPref(pref, Number(b.dataset.value)) : Services.prefs.setStringPref(pref, b.dataset.value);
  });
  Services.prefs.addObserver(pref, read);
  window.addEventListener("unload", () => Services.prefs.removeObserver(pref, read));
  read();
}

// прозрачность окна даёт Windows (Zen: widget.windows.mica); если её нет — предупреждаем
$("#glass-off").hidden = win.matchMedia("(-moz-windows-mica)").matches;

// ---------- выгрузка по таймеру: минуты, 0 — никогда (таймер — js/lumi-rail.uc.js) ----------
const unload = $("#unload"), UNLOAD = "luminoctis.tabs.unload-minutes";
unload.value = String(Services.prefs.getIntPref(UNLOAD, 0));
unload.addEventListener("change", () => Services.prefs.setIntPref(UNLOAD, Number(unload.value)));

// ---------- перетаскивание строк списка (пространства, закрепы) ----------
// Тянуть за ручку ⠿; черта показывает место. onMove(откуда, куда) — индексы итогового места в списке.
function sortable(list, onMove) {
  let from = -1;
  const rows = () => [...list.querySelectorAll(":scope > .item")];
  const slot = y => {
    const i = rows().findIndex(r => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
    return i < 0 ? rows().length : i;
  };
  const mark = i => rows().forEach((r, k) => {
    r.classList.toggle("drop-before", k == i);
    r.classList.toggle("drop-after", i == rows().length && k == rows().length - 1);
  });
  list.addEventListener("dragstart", event => {
    const row = event.target.closest?.(".item");
    if (!row || !event.target.classList.contains("grip")) return;
    from = rows().indexOf(row);
    row.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(from));
    event.dataTransfer.setDragImage(row, 20, row.offsetHeight / 2);
  });
  list.addEventListener("dragover", event => {
    if (from < 0) return;
    event.preventDefault();
    mark(slot(event.clientY));
  });
  list.addEventListener("drop", event => {
    if (from < 0) return;
    event.preventDefault();
    const to = slot(event.clientY);
    const final = to > from ? to - 1 : to;
    if (final != from) onMove(from, final);
  });
  list.addEventListener("dragend", () => {
    from = -1;
    mark(-1);
    list.querySelector(".dragging")?.classList.remove("dragging");
  });
}
const grip = () => el("span", { className: "grip", draggable: true, textContent: "⠿", title: "Перетащите, чтобы поменять порядок" });

// ---------- рабочие пространства ----------
function renderSpaces() {
  const spaces = win.gZenWorkspaces.getWorkspaces();
  const identities = ContextualIdentityService.getPublicIdentities();
  $("#spaces").replaceChildren(...spaces.map(ws => {
    const icon = el("button", { className: "icon", title: "Сменить иконку" });
    if (ws.icon?.endsWith(".svg")) icon.append(el("img", { src: ws.icon }));
    else icon.textContent = ws.icon || "•";
    // родной выбор иконки Zen, рядом с кнопкой пространства в рейке
    icon.addEventListener("click", () => {
      const anchor = win.document.querySelector(`#zen-workspaces-button toolbarbutton[zen-workspace-id="${ws.uuid}"]`);
      win.gZenEmojiPicker.open(anchor, {
        onSelect: async value => {
          ws.icon = value;
          await win.gZenWorkspaces.saveWorkspace(ws);
        },
      });
      win.focus();
    });
    const name = el("input", { className: "name", type: "text", value: ws.name, title: "Название" });
    name.addEventListener("change", () => {
      ws.name = name.value.trim() || ws.name;
      win.gZenWorkspaces.saveWorkspace(ws);
    });
    const color = identities.find(i => i.userContextId == ws.containerTabId)?.color;
    const dot = el("span", { className: "dot" });
    dot.style.background = DOT[color] ? `var(--lumi-${DOT[color]})` : "transparent";
    const container = el("select", { title: "Контейнер: новые вкладки пространства открываются в нём" },
      el("option", { value: 0, textContent: "Без контейнера" }),
      ...identities.map(i => el("option", { value: i.userContextId, textContent: ContextualIdentityService.getUserContextLabel(i.userContextId) })));
    container.value = ws.containerTabId || 0;
    container.addEventListener("change", () => {
      ws.containerTabId = Number(container.value);
      win.gZenWorkspaces.saveWorkspace(ws);
    });
    // удалить — родным removeWorkspace Zen (вкладки пространства закрываются), после подтверждения под строкой; последнее — нельзя
    const remove = el("button", { className: "small remove", textContent: "×", disabled: spaces.length < 2,
      title: spaces.length < 2 ? "Последнее пространство удалить нельзя" : "Удалить пространство" });
    const row = el("div", { className: "item" }, grip(), icon, name, dot, container, remove);
    remove.addEventListener("click", () => {
      if (row.nextElementSibling?.classList.contains("confirm")) return row.nextElementSibling.remove();
      const yes = el("button", { className: "danger", textContent: "Удалить" });
      const no = el("button", { textContent: "Отмена" });
      const ask = el("div", { className: "confirm" },
        el("span", { textContent: `Удалить «${ws.name}»? Его вкладки закроются.` }), yes, no);
      yes.addEventListener("click", () => {
        if (win.gZenWorkspaces.getWorkspaces().length > 1) win.gZenWorkspaces.removeWorkspace(ws.uuid);
        ask.remove();
      });
      no.addEventListener("click", () => ask.remove());
      row.after(ask);
      no.focus();
    });
    return row;
  }));
}
// новое — родным createAndSaveWorkspace Zen, в конце списка, без переключения на него; сразу можно ввести название
$("#space-add").addEventListener("click", async () => {
  await win.gZenWorkspaces.createAndSaveWorkspace("Новое пространство", undefined, true);
  renderSpaces();
  const name = $("#spaces .item:last-child .name");
  name?.focus();
  name?.select();
});
// родная перестановка пространств Zen (ей же пользуется перетаскивание кнопок пространств)
sortable($("#spaces"), (from, to) => win.gZenWorkspaces.reorderWorkspace(win.gZenWorkspaces.getWorkspaces()[from].uuid, to));
for (const type of ["ZenWorkspacesUIUpdate", "ZenWorkspaceDataChanged"]) {
  win.addEventListener(type, renderSpaces);
  window.addEventListener("unload", () => win.removeEventListener(type, renderSpaces));
}
renderSpaces();

// ---------- закрепы = родные Essentials Zen (js/lumi-rail.uc.js) ----------
const lumi = win.luminoctis;
const urlOf = tab => tab.linkedBrowser.currentURI.spec;
const readable = url => { try { return decodeURI(url); } catch { return url; } }; // %D0%9A… → кириллица
// название над адресом — в узкой панели так помещается больше
const site = (title, url) => el("span", { className: "site", title: url },
  el("span", { className: "title", textContent: title || url }), el("span", { className: "url", textContent: readable(url) }));
function renderPins() {
  const pins = lumi.pins();
  $("#pins").replaceChildren(...(pins.length ? pins.map(tab => {
    const remove = el("button", { className: "small remove", textContent: "×", title: "Открепить" });
    remove.addEventListener("click", () => lumi.unpin(tab)); // как «Открепить» в меню закрепа: вкладка закрывается
    return el("div", { className: "item" }, grip(),
      el("span", { className: "icon" }, el("img", { src: win.gBrowser.getIcon(tab) || `page-icon:${urlOf(tab)}` })),
      site(tab.label, urlOf(tab)), remove);
  }) : [el("div", { className: "empty", textContent: "Закрепов нет — добавьте сайт кнопкой ниже" })]));
}
sortable($("#pins"), (from, to) => lumi.movePin(lumi.pins()[from], to));
// перерисовка — только когда меняются сами закрепы (TabAttrModified у загружающихся вкладок идёт постоянно)
let pinTimer;
const onPinEvent = event => {
  if (event.type != "TabRemovedFromEssentials" && !event.target.hasAttribute?.("zen-essential")) return;
  clearTimeout(pinTimer);
  pinTimer = setTimeout(renderPins, 100);
};
const pinEvents = ["TabAddedToEssentials", "TabRemovedFromEssentials", "TabClose", "TabMove", "TabAttrModified"];
for (const type of pinEvents) win.addEventListener(type, onPinEvent);
window.addEventListener("unload", () => pinEvents.forEach(type => win.removeEventListener(type, onPinEvent)));
renderPins();

// «Текущий сайт» — выбранная вкладка (или последняя открытая) с обычной страницей; она сама становится закрепом
const lastSite = () => win.gBrowser.visibleTabs
  .filter(t => !t.hasAttribute("zen-essential") && /^https?:/.test(urlOf(t)))
  .sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
const current = $("#pin-current");
const showCurrent = () => {
  const tab = lastSite();
  current.disabled = !tab;
  current.textContent = tab ? `+ Текущий сайт: ${tab.label}` : "+ Текущий сайт";
};
current.addEventListener("click", () => {
  const tab = lastSite();
  if (tab) lumi.pinTab(tab);
  showCurrent();
});
for (const type of ["TabSelect", "TabAddedToEssentials"]) {
  win.addEventListener(type, showCurrent);
  window.addEventListener("unload", () => win.removeEventListener(type, showCurrent));
}
showCurrent();

// «Из закладок» — поиск по закладкам; закреп — новая ленивая вкладка с адресом закладки (сама закладка остаётся на месте)
const search = $("#pin-search");
const findBookmarks = async () => {
  const query = search.value.trim();
  const pinned = new Set(lumi.pins().map(urlOf));
  const found = query.length < 2 ? [] : (await PlacesUtils.bookmarks.search(query)).filter(b => b.url && !pinned.has(b.url.href)).slice(0, 8);
  $("#pin-results").replaceChildren(...found.map(b => {
    const add = el("button", { textContent: "Добавить" });
    add.addEventListener("click", () => {
      lumi.addPin(b.url.href, b.title);
      findBookmarks(); // добавленная пропадает из результатов
    });
    return el("div", { className: "item" },
      el("span", { className: "icon" }, el("img", { src: `page-icon:${b.url.href}` })), site(b.title, b.url.href), add);
  }));
};
search.addEventListener("input", findBookmarks);

// ---------- меню «⋯» и меню вкладки: какие пункты видны (в настройке — id скрытых через запятую; прячет js/lumi-appmenu.uc.js) ----------
// luminoctis.appmenu.hidden — меню «⋯», luminoctis.tabmenu.hidden — меню вкладки (#tabContextMenu)
async function renderMenuList(list, pref, getItems) {
  const hiddenItems = () => Services.prefs.getStringPref(pref, "").split(",").filter(Boolean);
  const hidden = hiddenItems();
  list.replaceChildren(...(await getItems()).map(({ id, label }) => {
    const box = el("input", { type: "checkbox", checked: !hidden.includes(id) });
    box.dataset.item = id;
    box.addEventListener("change", () => {
      const rest = hiddenItems().filter(x => x != id);
      Services.prefs.setStringPref(pref, (box.checked ? rest : [...rest, id]).join(","));
    });
    return el("label", { className: "row slim" }, el("span", { textContent: label }), box);
  }));
}
renderMenuList($("#appmenu"), "luminoctis.appmenu.hidden", () => lumi.appMenuItems());
renderMenuList($("#tabmenu"), "luminoctis.tabmenu.hidden", () => lumi.tabMenuItems());

// ---------- шорткаты: клик по сочетанию — запись нового (js/lumi-keys.sys.mjs), Esc — отмена, ↺ — по умолчанию ----------
// Мышь: нужен Ctrl, Alt или Shift — иначе обычный клик по вкладке перестал бы работать; нажатие без них отменяет запись.
let recording = null; // { name, bind }
function renderKeys() {
  for (const row of document.querySelectorAll("[data-key]")) {
    const name = row.dataset.key;
    row.querySelector(".bind").textContent = keys.label(keys.get(name));
    row.querySelector(".reset").hidden = !Services.prefs.prefHasUserValue(keys.pref(name));
  }
  for (const view of document.querySelectorAll("[data-key-view]")) view.textContent = keys.label(keys.get(view.dataset.keyView));
}
const stopRecording = () => {
  recording?.bind.classList.remove("recording");
  recording = null;
  renderKeys();
};
function record(name) {
  stopRecording();
  const bind = document.querySelector(`[data-key="${name}"] .bind`);
  recording = { name, bind };
  bind.classList.add("recording");
  bind.textContent = "Нажмите…"; // подсказка — в описании строки
}
for (const row of document.querySelectorAll("[data-key]")) {
  const name = row.dataset.key;
  row.querySelector(".bind").addEventListener("click", event => {
    if (!recording) record(name);
  });
  row.querySelector(".reset").addEventListener("click", () => Services.prefs.clearUserPref(keys.pref(name)));
  Services.prefs.addObserver(keys.pref(name), renderKeys);
  window.addEventListener("unload", () => Services.prefs.removeObserver(keys.pref(name), renderKeys));
}
// нажатие, которым записали сочетание, дальше не идёт: ни клик по кнопке под мышью, ни меню правой кнопки
let swallow = false;
window.addEventListener("mousedown", event => {
  swallow = !!recording;
  if (!recording) return;
  event.preventDefault();
  event.stopPropagation();
  const combo = keys.KEYS[recording.name].mouse && keys.mouseCombo(event);
  if (combo && /^(ctrl|alt|shift|meta)\+/.test(combo)) Services.prefs.setStringPref(keys.pref(recording.name), combo);
  stopRecording();
}, true);
for (const type of ["click", "auxclick", "contextmenu"]) {
  window.addEventListener(type, event => {
    if (!swallow) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
}
window.addEventListener("keydown", event => {
  swallow = false;
  if (!recording) return;
  event.preventDefault();
  event.stopPropagation(); // Esc не закрывает панель, Tab не уводит фокус
  const { name } = recording;
  if (event.key == "Escape") return stopRecording();
  if (keys.KEYS[name].mouse) return;
  const combo = keys.keyCombo(event);
  if (!combo) return; // пока зажат только модификатор
  Services.prefs.setStringPref(keys.pref(name), combo);
  stopRecording();
}, true);
window.addEventListener("blur", stopRecording); // ушли из панели (или её закрыли) — запись не висит до следующего открытия
renderKeys();

// ---------- палитра: готовые палитры и правка каждого цвета (js/lumi-palette.sys.mjs) ----------
const SAMPLE = ["bg0", "bg1", "surface", "raised", "fg", "accent", "red", "green"];
const chips = c => el("span", { className: "swatches" }, ...SAMPLE.map(t => {
  const i = el("i");
  i.style.background = c[t];
  return i;
}));
function renderPresets() {
  const id = palette.presetId();
  $("#presets").replaceChildren(...Object.entries(palette.PRESETS).map(([key, { name }]) => {
    const row = el("button", { className: "preset" + (key == id ? " on" : "") }, el("span", { className: "name", textContent: name }));
    if (palette.edited(key).length) row.append(el("span", { className: "badge", textContent: "изменена" }));
    row.append(chips(palette.colors(key)));
    row.dataset.preset = key;
    row.setAttribute("aria-pressed", key == id);
    row.addEventListener("click", () => palette.choose(key));
    return row;
  }));
}

// пересчёт цветов: HSV (квадрат и полоса оттенка) ↔ RGB ↔ hex
const hsv2rgb = (h, s, v) => [5, 3, 1].map(n => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); });
const rgb2hsv = (r, g, b) => {
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d && (max == r ? (g - b) / d % 6 : max == g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return [(h + 360) % 360, max && d / max, max / 255];
};
const toHex = rgb => "#" + rgb.map(x => x.toString(16).padStart(2, "0")).join("");
const fromHex = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const parseHex = text => {
  let t = text.trim().toLowerCase().replace(/^#?/, "#");
  if (/^#[0-9a-f]{3}$/.test(t)) t = "#" + [...t.slice(1)].map(c => c + c).join("");
  return /^#[0-9a-f]{6}$/.test(t) ? t : null;
};
// у серого и чёрного нет оттенка — оставляем прежний, иначе полоса оттенка прыгала бы в красный
const hsvOf = (hex, keepHue) => { const hsv = rgb2hsv(...fromHex(hex)); return hsv[1] && hsv[2] ? hsv : [keepHue, hsv[1], hsv[2]]; };
window.lumiColorMath = { hsv2rgb, rgb2hsv, toHex, fromHex, parseHex }; // для dev\check-look.js

let editor = null; // открытый редактор цвета (один на всю палитру)
function openEditor(token) {
  const same = editor?.token == token;
  editor?.node.remove();
  editor = same ? null : makeEditor(token); // повторный клик по строке — закрыть
  for (const row of document.querySelectorAll(".color")) {
    const open = row.dataset.token == editor?.token;
    row.classList.toggle("open", open);
    row.setAttribute("aria-expanded", open);
    if (open) row.after(editor.node);
  }
}
function makeEditor(token) {
  const sv = el("div", { className: "sv", tabIndex: 0 }, el("div", { className: "mark" }));
  sv.setAttribute("aria-label", "Насыщенность и яркость");
  const hue = el("input", { className: "hue", type: "range", min: 0, max: 360, step: 1, title: "Оттенок" });
  hue.setAttribute("aria-label", "Оттенок");
  const hexIn = el("input", { className: "hexin", type: "text", spellcheck: false, title: "Цвет: #rrggbb или #rgb" });
  const rgbIn = [0, 1, 2].map(() => el("input", { type: "number", min: 0, max: 255 }));
  const reset = el("button", { textContent: "Сбросить", title: "Вернуть цвет палитры" });
  const node = el("div", { className: "editor" }, sv, hue,
    el("div", { className: "fields" }, hexIn, ...rgbIn.map((input, i) => el("label", {}, "RGB"[i], input)), reset));
  const ed = { token, node, hex: "", hsv: [0, 0, 0], frame: 0 };
  // показать состояние; поле, которое сейчас правят, не трогаем
  const show = except => {
    const [h, s, v] = ed.hsv;
    sv.style.setProperty("--hue", h);
    sv.firstChild.style.left = s * 100 + "%";
    sv.firstChild.style.top = (1 - v) * 100 + "%";
    if (except != hue) hue.value = h;
    if (except != hexIn) { hexIn.value = ed.hex; hexIn.classList.remove("bad"); }
    fromHex(ed.hex).forEach((x, i) => { if (except != rgbIn[i]) rgbIn[i].value = x; });
  };
  // значение из настройки: открытие, смена палитры, сброс, правка из другого окна
  ed.sync = () => {
    ed.hex = palette.colors()[token];
    ed.hsv = hsvOf(ed.hex, ed.hsv[0]);
    show();
  };
  // своя правка: сразу в редакторе, в настройку — не чаще раза за кадр (её наблюдатель перекрашивает все окна)
  const set = (hex, hsv, except) => {
    ed.hex = hex;
    ed.hsv = hsv;
    show(except);
    ed.frame ||= requestAnimationFrame(() => { ed.frame = 0; palette.setColor(token, ed.hex); });
  };
  const fromHsv = (hsv, except) => set(toHex(hsv2rgb(...hsv)), hsv, except);
  const clamp = x => Math.min(1, Math.max(0, x));
  const pick = event => {
    const b = sv.getBoundingClientRect();
    fromHsv([ed.hsv[0], clamp((event.clientX - b.left) / b.width), 1 - clamp((event.clientY - b.top) / b.height)]);
  };
  sv.addEventListener("pointerdown", event => { sv.setPointerCapture(event.pointerId); pick(event); });
  sv.addEventListener("pointermove", event => { if (sv.hasPointerCapture(event.pointerId)) pick(event); });
  sv.addEventListener("keydown", event => {
    const step = event.shiftKey ? 0.1 : 0.01, [h, s, v] = ed.hsv;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key];
    if (!move) return;
    event.preventDefault();
    fromHsv([h, clamp(s + move[0]), clamp(v + move[1])]);
  });
  hue.addEventListener("input", () => fromHsv([Number(hue.value), ed.hsv[1], ed.hsv[2]], hue));
  hexIn.addEventListener("input", () => {
    const hex = parseHex(hexIn.value);
    hexIn.classList.toggle("bad", !hex); // неверное значение не сохраняется
    if (hex) set(hex, hsvOf(hex, ed.hsv[0]), hexIn);
  });
  hexIn.addEventListener("change", () => show()); // после ввода — привести к #rrggbb
  rgbIn.forEach(input => input.addEventListener("input", () => {
    const hex = toHex(rgbIn.map(i => Math.min(255, Math.max(0, Math.round(Number(i.value) || 0)))));
    set(hex, hsvOf(hex, ed.hsv[0]), input);
  }));
  reset.addEventListener("click", () => palette.resetColor(token));
  ed.sync();
  return ed;
}

// строки цветов строятся один раз; при смене цветов только обновляются — редактор под строкой не пересоздаётся
// (иначе посреди перетаскивания по квадрату терялся бы захват мыши)
const colorRows = [];
for (const [group, labels] of palette.GROUPS) {
  colorRows.push(el("div", { className: "group", textContent: group }));
  for (const [token, label] of Object.entries(labels)) {
    const undo = el("button", { className: "small", textContent: "↺", title: "Вернуть цвет палитры" });
    undo.addEventListener("click", event => { event.stopPropagation(); palette.resetColor(token); });
    const row = el("div", { className: "color", tabIndex: 0, title: "Изменить цвет" },
      el("span", { className: "chip" }), el("span", { className: "label", textContent: label }), el("span", { className: "hex" }), undo);
    row.dataset.token = token;
    row.setAttribute("role", "button");
    row.setAttribute("aria-expanded", false);
    row.addEventListener("click", () => openEditor(token));
    row.addEventListener("keydown", event => {
      if (event.target == row && (event.key == "Enter" || event.key == " ")) { event.preventDefault(); openEditor(token); }
    });
    colorRows.push(row);
  }
}
$("#colors").append(...colorRows);
function renderColors() {
  const c = palette.colors(), changed = palette.edited();
  for (const row of document.querySelectorAll(".color")) {
    const t = row.dataset.token;
    row.querySelector(".chip").style.background = c[t];
    row.querySelector(".hex").textContent = c[t];
    row.querySelector(".small").hidden = !changed.includes(t);
  }
  $("#palette-reset").disabled = !changed.length;
}
$("#palette-reset").addEventListener("click", () => palette.resetPalette());
const renderPalette = () => {
  // настройку поменяли не из редактора — показать новый цвет; во время своей правки (ждёт кадра) — не мешать
  if (editor && !editor.frame && palette.colors()[editor.token] != editor.hex) editor.sync();
  renderPresets();
  renderColors();
};
let paletteQueued = false; // «Сбросить палитру» меняет много настроек — перерисовка одна
const onPalette = () => {
  if (paletteQueued) return;
  paletteQueued = true;
  Promise.resolve().then(() => { paletteQueued = false; renderPalette(); });
};
Services.prefs.addObserver("luminoctis.palette", onPalette);
window.addEventListener("unload", () => Services.prefs.removeObserver("luminoctis.palette", onPalette));
renderPalette();

// ---------- Luminoctis Home: папка данных (home/store.js; пусто — Documents\Luminoctis Home) ----------
{
  const store = await import("./home/store.js");
  const box = $("#home-dir");
  box.placeholder = store.defaultDir();
  const read = () => (box.value = Services.prefs.getStringPref(store.PREF, ""));
  box.addEventListener("change", () => {
    const v = box.value.trim();
    v ? Services.prefs.setStringPref(store.PREF, v) : Services.prefs.clearUserPref(store.PREF);
  });
  Services.prefs.addObserver(store.PREF, read);
  window.addEventListener("unload", () => Services.prefs.removeObserver(store.PREF, read));
  read();
}

// ---------- Luminoctis Home: часы и обои (home/clock.js, home/wallpaper.js; docs/areas/home.md) ----------
{
  const { Clock } = await import("./home/clock.js");
  for (const b of document.querySelectorAll(".clock-styles [data-value]")) new Clock(b.querySelector(".clock-prev"), b.dataset.value); // живые превью
  const watchPref = (pref, read) => {
    Services.prefs.addObserver(pref, read);
    window.addEventListener("unload", () => Services.prefs.removeObserver(pref, read));
    read();
  };
  // числа: ползунки (рядом <output>) и списки
  for (const input of document.querySelectorAll("[data-int-pref]")) {
    const pref = input.dataset.intPref, out = input.nextElementSibling?.matches("output") ? input.nextElementSibling : null;
    input.addEventListener("input", () => Services.prefs.setIntPref(pref, Number(input.value)));
    watchPref(pref, () => { input.value = String(Services.prefs.getIntPref(pref, Number(input.dataset.default))); if (out) out.value = input.value; });
  }
  // строки: поиск, папка (пусто — сброс)
  for (const input of document.querySelectorAll("[data-str-pref]")) {
    const pref = input.dataset.strPref;
    input.addEventListener("change", () => {
      const v = input.value.trim();
      v ? Services.prefs.setStringPref(pref, v) : Services.prefs.clearUserPref(pref);
    });
    watchPref(pref, () => (input.value = Services.prefs.getStringPref(pref, "")));
  }
  $("#wp-pick").addEventListener("click", () => {
    const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window.browsingContext, "Папка с обоями", Ci.nsIFilePicker.modeGetFolder);
    fp.open(r => {
      if (r != Ci.nsIFilePicker.returnOK) return;
      Services.prefs.setStringPref("luminoctis.home.wallpaper.folder", fp.file.path);
      Services.prefs.setBoolPref("luminoctis.home.wallpaper.src.local", true); // выбрали папку — значит, её и показывать
    });
  });
}

// ---------- Wallpaper Engine: папка мастерской и выбор обоев (home/we.js) ----------
{
  const we = await import("./home/we.js");
  const box = $("#we-items"), folderBox = $("#we-folder"), OFF = "luminoctis.home.wallpaper.we.off";
  const off = () => new Set(Services.prefs.getStringPref(OFF, "").split(",").filter(Boolean));
  const TYPE = { video: "Видео", web: "Веб", scene: "Сцена", application: "Программа" };
  let gen = 0;
  async function render() {
    const my = ++gen, dir = await we.folder();
    folderBox.placeholder = Services.prefs.getStringPref(we.PREF, "") ? "" : dir ?? "Steam не найден — укажите папку steamapps/workshop/content/431960";
    const items = dir ? await we.list(dir) : [];
    if (my != gen) return;
    const skip = off();
    box.replaceChildren(...items.map(it => {
      const card = Object.assign(document.createElement("div"), { className: "we-item" });
      const show = Object.assign(document.createElement("button"), { className: "we-show", title: "Поставить на Home сейчас" });
      if (it.preview) show.append(Object.assign(new Image(), { src: PathUtils.toFileURI(it.preview), loading: "lazy", alt: "" }));
      show.append(Object.assign(document.createElement("span"), { className: "we-type", textContent: TYPE[it.type] ?? it.type }));
      show.addEventListener("click", async () => {
        const tab = win.lumiHome.open();
        for (let i = 0; i < 50; i++) { // Home могла только что создаться — ждём обои
          const wp = tab.linkedBrowser.contentWindow?.lumiWallpaper;
          if (wp) { await wp.ready; return wp.showItem(it); }
          await new Promise(r => setTimeout(r, 100));
        }
      });
      const label = document.createElement("label");
      const check = Object.assign(document.createElement("input"), { type: "checkbox", checked: !skip.has(it.id), title: "Брать в смену обоев" });
      check.addEventListener("change", () => {
        const s = off();
        check.checked ? s.delete(it.id) : s.add(it.id);
        s.size ? Services.prefs.setStringPref(OFF, [...s].join(",")) : Services.prefs.clearUserPref(OFF);
      });
      label.append(check, Object.assign(document.createElement("span"), { textContent: it.title, title: it.title }));
      card.append(show, label);
      return card;
    }));
    if (dir && !items.length) box.replaceChildren(Object.assign(document.createElement("p"), { textContent: "В папке нет обоев Wallpaper Engine" }));
  }
  Services.prefs.addObserver(we.PREF, render);
  window.addEventListener("unload", () => Services.prefs.removeObserver(we.PREF, render));
  render();
  $("#we-pick").addEventListener("click", () => {
    const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window.browsingContext, "Папка Wallpaper Engine (steamapps/workshop/content/431960)", Ci.nsIFilePicker.modeGetFolder);
    fp.open(r => {
      if (r != Ci.nsIFilePicker.returnOK) return;
      Services.prefs.setStringPref(we.PREF, fp.file.path);
      Services.prefs.setBoolPref("luminoctis.home.wallpaper.src.we", true);
    });
  });
  // «Как в Wallpaper Engine»: что выбрано в программе сейчас, или подсказка, что её нет
  const hint = $("#we-sync-hint"), HINT = hint.textContent;
  async function syncHint() {
    const cfg = await we.configPath(), it = cfg ? await we.selected(cfg).catch(() => null) : null;
    hint.textContent = !cfg ? "Wallpaper Engine не найден — нужна программа Wallpaper Engine из Steam (её файл steamapps\\common\\wallpaper_engine\\config.json)"
      : it ? `${HINT}. Сейчас там: «${it.title}»` : `${HINT}. Сейчас в нём не выбраны обои из мастерской`;
  }
  const SYNC = "luminoctis.home.wallpaper.we.sync";
  for (const p of [we.CONFIG_PREF, SYNC]) Services.prefs.addObserver(p, syncHint);
  window.addEventListener("unload", () => { for (const p of [we.CONFIG_PREF, SYNC]) Services.prefs.removeObserver(p, syncHint); });
  document.addEventListener("visibilitychange", () => !document.hidden && syncHint()); // в программе могли сменить обои
  syncHint();
  window.lumiWE = { render, syncHint }; // для проверок
}

// ---------- LumiTime: «Открыть» — Home и панель настроек таймера (home/time.js) ----------
$("#lumitime-settings")?.addEventListener("click", async () => {
  const tab = win.lumiHome.open();
  win.luminoctis.closeSettings();
  for (let i = 0; i < 50; i++) { // Home могла только что создаться — ждём страницу
    const lt = tab.linkedBrowser.contentWindow?.lumiTime;
    if (lt) { if (lt.panelName() != "settings") lt.openPanel("settings"); return; }
    await new Promise(r => setTimeout(r, 100));
  }
});
