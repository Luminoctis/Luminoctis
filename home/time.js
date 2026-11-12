// LumiTime: столбец таймера справа (#lumi-time) — сводка, кольцо с цифрами и ±1 мин, кнопки цикла, пресет/тема/длительности,
// «Сегодня», цели, кнопки панелей (home/time-panels.js). Логика и данные — в движке js/lumi-time.sys.mjs (идёт и без этой страницы);
// страница только рисует: перерисовка по событиям движка, тик раз в секунду — пока вкладка видна.
import { JS } from "./paths.js";
import * as store from "./store.js";
import { E, h, s, clockOf, goalsBlock, dailyBlock, dailyKey, openPanel, closePanel, panelName, refreshPanel, topicName, topicTag, topicColor, presetName } from "./time-panels.js";
const { t, localize } = ChromeUtils.importESModule(JS("lumi-i18n.sys.mjs"));
localize(document); // <html lang dir>

ChromeUtils.importESModule(JS("lumi-palette.sys.mjs")).watch(document);
const root = document.getElementById("lumi-time");

// Режимы: ?mini=1 — тот же главный вид в мини-окне рейки (js/lumi-rail.uc.js; в chrome-рамке «Открыть целиком», внизу кнопки панелей — они открывают большой LumiTime),
// без него — вся страница LumiTime в скрытой вкладке lumi-time-full (?panel=stats|journal|settings|day — какая панель открыта; по умолчанию Статистика).
const q = new URLSearchParams(location.search), mini = q.has("mini"), full = q.has("full");
document.body.toggleAttribute("lumi-mini", mini);
document.body.toggleAttribute("lumi-full", full); // большой режим: столбца нет, панель стыкуется к мини-окну рейки (place), всегда открыта
await E.init();

// Большой режим: за панелями тот же кадр, что на Home (текущие обои из wallpapers/state.json, без затемнения), а не сплошной bg0 страницы
// и не затемнение рейки (#lumi-time-backdrop[lumi-passive]). Обоев нет (видео, NSFW, инкогнито, режим «Прозрачный») — страница прозрачна, как окно под ней.
// Как у Home: слой = прямоугольник всего окна, сдвинутый на место вкладки (cover считается от окна). Только читает state.json — не листает обои и окно не трогает.
async function backdrop() {
  const win = window.browsingContext.topChromeWindow, P = "luminoctis.home.wallpaper.", prefs = Services.prefs;
  if (prefs.getStringPref(P + "mode", "wallpaper") == "transparent" || win.PrivateBrowsingUtils?.isWindowPrivate(win)) return;
  const item = (await store.readJSON("wallpapers/state.json", {})).current;
  if (!item || item.kind == "video" || item.nsfw) return;
  const src = item.file ? PathUtils.toFileURI(item.file) : URL.createObjectURL(await (await fetch(item.url, { credentials: "omit" })).blob());
  const { windowMode } = ChromeUtils.importESModule(JS("lumi-palette.sys.mjs"));
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const alpha = windowMode(win) == "transparent" ? 1 - clamp(prefs.getIntPref("luminoctis.look.homeTransparency", 0), 0, 90) / 100 : 1;
  const el = Object.assign(document.createElement("div"), { id: "lt-backdrop" });
  el.style.background = `url("${src}") center / cover`; // без затемнения (2026-11-12): в большом LumiTime обои ярче, чем на Home
  el.style.opacity = alpha;
  const place = () => {
    const b = window.browsingContext.embedderElement, r = b?.getBoundingClientRect(), k = win.devicePixelRatio / devicePixelRatio;
    if (r) Object.assign(el.style, { left: -r.x * k + "px", top: -r.y * k + "px", width: win.innerWidth * k + "px", height: win.innerHeight * k + "px" });
  };
  place();
  document.body.prepend(el);
  addEventListener("resize", place);
  win.addEventListener("resize", place);
  addEventListener("unload", () => win.removeEventListener("resize", place), { once: true });
}
if (full) backdrop().catch(e => console.warn("LumiTime: фон не показан", e) /* l10n-skip */);

let els = {}, buttonsKey = "";
const D = () => E.data;
const phaseName = () => ({ focus: t("Фокус"), break: t("Перерыв"), "long-break": t("Длинный перерыв") });

let addingTopic = false;
// тема — выпадающий список из настроек; «Новая тема…» заменяет его полем ввода (Enter — добавить, Esc/уход — отмена)
function topicSelect(S, value, on) { // on — свой обработчик (окошко «Добавить время»): { pick(v), isNew() }
  const el = h("select", { class: "lt-topic-pick", "aria-label": t("Тема фокуса"), title: t("Тема фокуса"), on: { change: () => {
    if (on) return el.value == NEW ? on.isNew() : on.pick(el.value);
    if (el.value == NEW) { addingTopic = true; build(); els.topic.focus(); return; }
    E.changeTopic(el.value); E.changeSelection({});
  } } }, h("option", { value: "", text: t("Без темы") }),
    [...new Set([...S.topics, ...(value && !S.topics.includes(value) ? [value] : [])])].map(tp => h("option", { value: tp, text: topicName(tp), style: topicColor(tp) ? `color:${topicColor(tp)}` : null })),
    h("option", { value: NEW, text: t("Новая тема…") }));
  el.value = value;
  if (topicColor(value)) el.style.borderLeft = `3px solid ${topicColor(value)}`; // цвет выбранной темы
  return el;
}
const NEW = "__new__";

function build() {
  const { settings: S, selection: sel, state: st, timerMode } = D(), idle = st.phase == "idle";
  const opt = (v, t) => h("option", { value: String(v), text: t });
  const sel_ = (label, options, value, onchange) => {
    const el = h("select", { "aria-label": label, title: label, on: { change: () => onchange(el.value) } }, options);
    el.value = String(value);
    return el;
  };
  els = {};
  root.replaceChildren(
    h("header", { class: "lt-head" },
      h("b", { class: "lt-title", text: "LumiTime" }),
      els.streak = h("span", { class: "lt-chip" }),
      els.month = h("span", { class: "lt-chip" })),
    h("div", { class: "lt-seg lt-mode", title: idle ? "" : t("Режим меняется, когда таймер стоит") },
      ["Countdown", "Stopwatch"].map(m => h("button", { text: m == "Countdown" ? t("Отсчёт") : t("Секундомер"), "aria-pressed": String(timerMode == m),
        disabled: !idle, on: { click: () => E.changeTimerMode(m) } }))),
    h("div", { class: "lt-pick" },
      sel_(t("Пресет"), [opt("", t("Свой")), ...S.presets.map(p => opt(p.id, presetName(p.name)))], sel.presetId, v => {
        const p = S.presets.find(x => x.id == v);
        E.changeSelection(p ? { presetId: p.id, pairIndex: p.pairIndex, longBreak: p.longBreak, every: p.every } : { presetId: "" });
      }),
      addingTopic ? els.topic = h("input", { type: "text", class: "lt-topic-pick", placeholder: t("Новая тема — Enter"), "aria-label": t("Новая тема"), maxLength: 200,
        on: { keydown: e => {
          if (e.key == "Enter" && e.target.value.trim()) { addingTopic = false; E.addTopic(e.target.value); }
          else if (e.key == "Escape") { e.stopPropagation(); addingTopic = false; build(); }
        }, blur: () => { if (addingTopic) { addingTopic = false; build(); } } } })
      : els.topic = topicSelect(S, st.phase == "focus" ? st.topic : sel.topic)),
    h("div", { class: "lt-ring" },
      s("svg", { viewBox: "0 0 120 120", "aria-hidden": "true" },
        s("circle", { class: "lt-track", cx: 60, cy: 60, r: 54 }),
        els.progress = s("circle", { class: "lt-progress", cx: 60, cy: 60, r: 54, pathLength: 100 })),
      h("div", { class: "lt-center" },
        els.main = h("div", { class: "lt-digits", role: "timer" }),
        els.extra = h("div", { class: "lt-extra" }),
        h("div", { class: "lt-adjust" },
          els.minus = h("button", { text: "−", on: { click: () => E.adjust(-1) } }),
          els.plus = h("button", { text: "+", on: { click: () => E.adjust(1) } })))),
    els.phase = h("div", { class: "lt-phase" }),
    els.last = h("div", { class: "lt-last" }),
    els.buttons = h("div", { class: "lt-buttons" }),
    h("div", { class: "lt-lengths", hidden: timerMode == "Stopwatch" },
      sel_(t("Фокус / перерыв"), S.pairs.map((p, i) => opt(i, `${p.focus} / ${p.rest}`)), sel.pairIndex, v => E.changeSelection({ pairIndex: Number(v), presetId: "" })),
      sel_(t("Длинный перерыв"), S.longBreaks.map(v => opt(v, t("{0} мин", v))), sel.longBreak, v => E.changeSelection({ longBreak: Number(v), presetId: "" })),
      sel_(t("Длинный перерыв после N фокусов"), S.counts.map(v => opt(v, `×${v}`)), sel.every, v => E.changeSelection({ every: Number(v), presetId: "" }))),
    els.count = h("div", { class: "lt-count" }),
    h("div", { class: "lt-today" }, h("div", { class: "lt-today-head" }, h("h4", { text: t("Сегодня") }),
      h("button", { class: "lt-add-btn", text: t("+ Добавить время"), title: t("Записать время в журнал вручную"), on: { click: e => toggleAdd(e.currentTarget) } })), els.today = h("div", { class: "lt-today-list" })),
    els.daily = h("div"),
    els.goals = h("div"),
    els.status = h("div", { class: "lt-status" }),
    h("nav", { class: "lt-nav" }, [["settings", t("Настройки")], ["stats", t("Статистика")], ["journal", t("Журнал")], ["day", t("День")]].map(([p, lb]) =>
      h("button", { "data-panel": p, text: lb, "aria-pressed": String(panelName() == p),
      on: { click: () => (mini ? window.browsingContext.topChromeWindow.luminoctis.openTime(p) : openPanel(p)) } }))), // в мини-окне панель открывает большой LumiTime (скрытая вкладка)
  );
  buttonsKey = ""; goalsKey = ""; dailyShown = "";
  update();
}

// окошко «Добавить время»: минуты, тема, Фокус/Перерыв → одна запись в журнал (E.addManual); Esc, клик мимо и «Отмена» закрывают
let addPop = null;
function closeAdd() {
  if (!addPop) return;
  addPop.remove(); addPop = null;
  document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escKey, true); window.removeEventListener("blur", closeAdd);
}
const outside = e => { if (addPop && !addPop.contains(e.target) && !e.target.closest(".lt-add-btn")) closeAdd(); };
const escKey = e => { if (e.key == "Escape" && addPop) { e.preventDefault(); e.stopPropagation(); closeAdd(); } };
function toggleAdd(anchor) {
  if (addPop) return closeAdd();
  const { settings: S, selection: sel } = D();
  let kind = "Focus", topic = sel.topic ?? "", newTopic = false;
  const minutes = h("input", { type: "number", min: 1, max: 600, step: 1, class: "lt-num", "aria-label": t("Минуты"), title: t("Минуты (1–600)"),
    value: String((S.pairs[sel.pairIndex] ?? S.pairs[0]).focus), on: { input: valid, keydown: e => { if (e.key == "Enter" && !ok.disabled) ok.click(); } } });
  const topicBox = h("div", { class: "lt-add-topic" });
  const drawTopic = () => {
    topicBox.hidden = kind != "Focus";
    topicBox.replaceChildren(newTopic ? h("input", { type: "text", class: "lt-topic-pick", placeholder: t("Новая тема — Enter"), "aria-label": t("Новая тема"), maxLength: 200,
      on: { keydown: e => {
        if (e.key == "Enter" && e.target.value.trim()) {
          e.stopPropagation(); const t = e.target.value.trim().slice(0, 200), known = D().settings.topics.find(x => x.toLocaleLowerCase() == t.toLocaleLowerCase());
          topic = known ?? t; newTopic = false; if (!known) E.saveSettings({ ...D().settings, topics: [...D().settings.topics, t] }); drawTopic();
        } else if (e.key == "Escape") { e.stopPropagation(); newTopic = false; drawTopic(); }
      } } })
      : topicSelect(D().settings, topic, { pick: v => { topic = v; }, isNew: () => { newTopic = true; drawTopic(); topicBox.firstChild.focus(); } }));
  };
  const seg = h("div", { class: "lt-seg" }, [["Focus", t("Фокус")], ["Break", t("Перерыв")]].map(([k, lb]) => h("button", { text: lb, "aria-pressed": String(kind == k),
    on: { click: () => { kind = k; for (const b of seg.children) b.setAttribute("aria-pressed", String(b == seg.children[k == "Focus" ? 0 : 1])); drawTopic(); } } })));
  const ok = h("button", { class: "lt-primary", text: t("Добавить"), on: { click: () => { if (E.addManual({ kind, topic, minutes: Number(minutes.value) })) closeAdd(); } } });
  function valid() { ok.disabled = !(/^[0-9]+$/.test(minutes.value) && minutes.value >= 1 && minutes.value <= 600); minutes.classList.toggle("lt-bad", ok.disabled); }
  addPop = h("div", { id: "lumi-time-add", role: "dialog", "aria-label": t("Добавить время") },
    h("div", { class: "lt-add-row" }, h("label", { text: t("Минут") }), minutes), seg, topicBox,
    h("div", { class: "lt-add-actions" }, h("button", { text: t("Отмена"), on: { click: closeAdd } }), ok));
  drawTopic(); valid(); document.body.append(addPop);
  const r = anchor.getBoundingClientRect(), w = addPop.offsetWidth, hh = addPop.offsetHeight;
  addPop.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
  addPop.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - hh - 8)) + "px";
  minutes.select();
  document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", escKey, true); window.addEventListener("blur", closeAdd);
}

function button(label, action, cls = "") {
  return h("button", { class: cls, text: label, on: { click: () => E.act(action) } });
}

let goalsKey = "", dailyShown = "";
function update() {
  if (!els.main) return;
  const { state: st, settings: S, selection: sel, timerMode } = D(), tm = E.now(), info = E.display(st, tm), idle = st.phase == "idle";
  const pair = S.pairs[sel.pairIndex] ?? S.pairs[0], paused = !idle && st.runningSince === null;
  root.dataset.phase = idle ? "idle" : st.phase == "focus" ? "focus" : "break";
  root.toggleAttribute("data-paused", paused);
  els.main.textContent = idle && timerMode == "Countdown" ? clockOf(pair.focus * 60000) : info.main;
  els.extra.textContent = info.extra;
  els.progress.style.strokeDashoffset = String(100 * (1 - info.progress));
  els.progress.style.opacity = info.progress === 0 ? "0" : "1";
  const last = E.lastRecord();
  els.minus.disabled = idle ? !last || !E.adjustRecordDuration(last, -1) : E.elapsedMs(st, tm) < 60000;
  els.plus.disabled = idle && !last;
  els.minus.title = idle ? t("Убрать минуту у последней записи журнала") : t("Убрать минуту прошедшего времени");
  els.plus.title = idle ? t("Добавить минуту к последней записи журнала") : t("Добавить минуту прошедшего времени");
  els.phase.textContent = idle ? t("Готов к фокусу") : (paused ? t("Пауза · ") : "") + phaseName()[st.phase] + (st.phase == "focus" && st.topic ? " · " + topicName(st.topic) : "");
  els.last.hidden = !idle;
  if (idle) els.last.textContent = last ? (last.kind == "Focus" ? t("Последняя запись: фокус · {0} · {1}", topicName(last.topic), clockOf(E.countedRecordMs(last))) : t("Последняя запись: перерыв · {0}", clockOf(E.countedRecordMs(last)))) : "";
  const every = idle ? sel.every : st.every;
  els.count.hidden = timerMode == "Stopwatch";
  els.count.textContent = t("{0} / {1} до длинного перерыва", st.completedFocuses, every);

  const overtime = st.timerMode != "Stopwatch" && !idle && E.elapsedMs(st, tm) >= st.plannedMs && st.acceptedOvertime;
  const key = `${st.phase}:${paused}:${overtime}:${timerMode}`;
  if (key != buttonsKey) {
    buttonsKey = key;
    const list = idle ? [button(t("Начать фокус"), "start-focus", "lt-primary")] : [
      timerMode == "Stopwatch" ? button(st.phase == "focus" ? t("На перерыв") : t("На фокус"), "toggle-mode", "lt-primary")
        : st.phase == "focus" ? button(t("Начать перерыв"), "start-break", "lt-primary") : button(t("Начать фокус"), "start-focus", "lt-primary"),
      paused ? button(t("Продолжить"), "resume") : button(t("Пауза"), "pause"),
      overtime && button(t("Не считать переработку"), "uncount-overtime", "lt-wide"),
      button(t("Стоп"), "stop", "lt-stop")];
    els.buttons.replaceChildren(...list.filter(Boolean));
  }

  // сводка: серия и месяц (с живым фокусом), сегодня по темам
  const sum = E.summary(), liveToday = E.countedTodayMs(st, tm), liveTopic = st.topic.trim() || "Фокус"; // l10n-skip
  const tip = topics => topics.map(([k, ms]) => `${topicName(k)} — ${clockOf(ms)}`).join("\n") || t("Записей нет");
  els.streak.textContent = t("Серия {0} дн · {1}", sum.streak.days, clockOf(sum.streak.totalMs + E.countedSinceMs(st, tm, sum.resetAt)));
  els.streak.title = t("Серия — дни подряд с фокусом") + "\n" + tip(sum.streak.topics);
  els.month.textContent = t("Месяц {0}", clockOf(sum.month.totalMs + E.countedMonthMs(st, tm)));
  els.month.title = t("За месяц") + "\n" + tip(sum.month.topics);
  const today = new Map(sum.today.topics);
  if (liveToday > 0) today.set(liveTopic, (today.get(liveTopic) ?? 0) + liveToday);
  const rows = [...today].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const todayKey = JSON.stringify(rows.map(([k, ms]) => [k, Math.floor(ms / 1000), topicColor(k)]));
  if (els.today.dataset.key != todayKey) {
    els.today.dataset.key = todayKey;
    els.today.replaceChildren(...(rows.length ? rows.map(([k, ms]) => h("div", { class: "lt-today-row" },
      topicTag(k), h("span", { text: clockOf(ms) + (k == liveTopic && liveToday > 0 ? " ●" : ""), title: k == liveTopic && liveToday > 0 ? t("в том числе идёт сейчас: {0}", clockOf(liveToday)) : "" })))
      : [h("div", { class: "lt-dim", text: t("Сегодня фокуса ещё не было") })]));
  }
  const dk = dailyKey(); // «Каждый день» между «Сегодня» и целями; перерисовывается только при изменении данных/дня
  if (dk != dailyShown) {
    dailyShown = dk;
    els.daily.replaceChildren(...[dailyBlock(() => (mini ? window.browsingContext.topChromeWindow.luminoctis.openTime("settings", "daily") : openPanel("settings", "daily")))].filter(Boolean));
  }
  const g = JSON.stringify(["streak", "week", "month"].map(p => E.goalRows(p)));
  if (g != goalsKey) {
    goalsKey = g;
    els.goals.replaceChildren(...[goalsBlock("streak", t("Цели на серию")), goalsBlock("week", t("Цели на неделю")), goalsBlock("month", t("Цели на месяц"))].filter(Boolean));
  }
  const status = D().journalError || (D().writeError ? t("Запись журнала не удалась — {0} ждут (Журнал → «Повторить»)", E.pendingCount()) : "");
  if (els.status.textContent != status) els.status.textContent = status;
}

// перерисовка по событиям движка; поле новой темы, в котором печатают, не пересобираем
const off = E.subscribe(kind => {
  if (addingTopic && document.activeElement == els.topic && kind != "load") update();
  else build();
  refreshPanel(kind);
});
document.addEventListener("lumi-time-panel", e => {
  for (const b of root.querySelectorAll(".lt-nav button")) b.setAttribute("aria-pressed", String(b.dataset.panel == e.detail));
});

// тик раз в секунду — только пока Home видна
let timer = null;
const run = () => {
  clearInterval(timer); timer = null;
  if (document.visibilityState != "visible") return;
  update();
  timer = setInterval(update, 1000);
};
document.addEventListener("visibilitychange", run);
window.addEventListener("unload", () => { off(); closeAdd(); clearInterval(timer); });
build();
run();
if (!mini) openPanel(["settings", "stats", "journal", "day"].includes(q.get("panel")) ? q.get("panel") : "stats", q.get("section"));
// большой режим: панель встаёт справа от мини-окна рейки (#lumi-time-frame в окне браузера) — позицию берём из него, offset* не зависит от анимации появления
function place() {
  const fr = window.browsingContext?.topChromeWindow?.document.getElementById("lumi-time-frame"), br = window.browsingContext?.embedderElement;
  if (!full || !fr?.offsetParent || !br) return;
  const p = fr.offsetParent.getBoundingClientRect(), b = br.getBoundingClientRect(), st = document.documentElement.style;
  st.setProperty("--lt-mini-r", `${p.left + fr.offsetLeft + fr.offsetWidth - b.left}px`);
  st.setProperty("--lt-mini-y", `${p.top + fr.offsetTop - b.top}px`);
  st.setProperty("--lt-mini-h", `${fr.offsetHeight}px`);
}
window.addEventListener("resize", place);
place();
window.lumiTime = { E, build, update, openPanel, closePanel, panelName, place }; // для проверок
