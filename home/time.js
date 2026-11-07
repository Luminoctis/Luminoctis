// LumiTime: столбец таймера справа (#lumi-time) — сводка, кольцо с цифрами и ±1 мин, кнопки цикла, пресет/тема/длительности,
// «Сегодня», цели, кнопки панелей (home/time-panels.js). Логика и данные — в движке js/lumi-time.sys.mjs (идёт и без этой страницы);
// страница только рисует: перерисовка по событиям движка, тик раз в секунду — пока вкладка видна.
import { JS } from "./paths.js";
import { E, h, s, clockOf, goalsBlock, openPanel, closePanel, panelName, refreshPanel } from "./time-panels.js";

ChromeUtils.importESModule(JS("lumi-palette.sys.mjs")).watch(document);
const root = document.getElementById("lumi-time");

// Режимы: ?mini=1 — тот же главный вид в мини-окне рейки (js/lumi-rail.uc.js; в chrome-рамке «Открыть целиком», внизу кнопки панелей — они открывают большой LumiTime),
// без него — вся страница LumiTime в скрытой вкладке lumi-time-full (?panel=stats|journal|settings|day — какая панель открыта; по умолчанию Статистика).
const q = new URLSearchParams(location.search), mini = q.has("mini"), full = q.has("full");
document.body.toggleAttribute("lumi-mini", mini);
document.body.toggleAttribute("lumi-full", full); // большой режим: столбца нет, панель стыкуется к мини-окну рейки (place), всегда открыта
await E.init();

let els = {}, buttonsKey = "";
const D = () => E.data;
const phaseName = { focus: "Фокус", break: "Перерыв", "long-break": "Длинный перерыв" };

let addingTopic = false;
// тема — выпадающий список из настроек; «Новая тема…» заменяет его полем ввода (Enter — добавить, Esc/уход — отмена)
function topicSelect(S, value, on) { // on — свой обработчик (окошко «Добавить время»): { pick(v), isNew() }
  const el = h("select", { class: "lt-topic-pick", "aria-label": "Тема фокуса", title: "Тема фокуса", on: { change: () => {
    if (on) return el.value == NEW ? on.isNew() : on.pick(el.value);
    if (el.value == NEW) { addingTopic = true; build(); els.topic.focus(); return; }
    E.changeTopic(el.value); E.changeSelection({});
  } } }, h("option", { value: "", text: "Без темы" }),
    [...new Set([...S.topics, ...(value && !S.topics.includes(value) ? [value] : [])])].map(t => h("option", { value: t, text: t })),
    h("option", { value: NEW, text: "Новая тема…" }));
  el.value = value;
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
    h("div", { class: "lt-seg lt-mode", title: idle ? "" : "Режим меняется, когда таймер стоит" },
      ["Countdown", "Stopwatch"].map(m => h("button", { text: m == "Countdown" ? "Отсчёт" : "Секундомер", "aria-pressed": String(timerMode == m),
        disabled: !idle, on: { click: () => E.changeTimerMode(m) } }))),
    h("div", { class: "lt-pick" },
      sel_("Пресет", [opt("", "Свой"), ...S.presets.map(p => opt(p.id, p.name))], sel.presetId, v => {
        const p = S.presets.find(x => x.id == v);
        E.changeSelection(p ? { presetId: p.id, pairIndex: p.pairIndex, longBreak: p.longBreak, every: p.every } : { presetId: "" });
      }),
      addingTopic ? els.topic = h("input", { type: "text", class: "lt-topic-pick", placeholder: "Новая тема — Enter", "aria-label": "Новая тема", maxLength: 200,
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
      sel_("Фокус / перерыв", S.pairs.map((p, i) => opt(i, `${p.focus} / ${p.rest}`)), sel.pairIndex, v => E.changeSelection({ pairIndex: Number(v), presetId: "" })),
      sel_("Длинный перерыв", S.longBreaks.map(v => opt(v, `${v} мин`)), sel.longBreak, v => E.changeSelection({ longBreak: Number(v), presetId: "" })),
      sel_("Длинный перерыв после N фокусов", S.counts.map(v => opt(v, `×${v}`)), sel.every, v => E.changeSelection({ every: Number(v), presetId: "" }))),
    els.count = h("div", { class: "lt-count" }),
    h("div", { class: "lt-today" }, h("div", { class: "lt-today-head" }, h("h4", { text: "Сегодня" }),
      h("button", { class: "lt-add-btn", text: "+ Добавить время", title: "Записать время в журнал вручную", on: { click: e => toggleAdd(e.currentTarget) } })), els.today = h("div", { class: "lt-today-list" })),
    els.goals = h("div"),
    els.status = h("div", { class: "lt-status" }),
    h("nav", { class: "lt-nav" }, [["settings", "Настройки"], ["stats", "Статистика"], ["journal", "Журнал"], ["day", "День"]].map(([p, t]) =>
      h("button", { "data-panel": p, text: t, "aria-pressed": String(panelName() == p),
      on: { click: () => (mini ? window.browsingContext.topChromeWindow.luminoctis.openTime(p) : openPanel(p)) } }))), // в мини-окне панель открывает большой LumiTime (скрытая вкладка)
  );
  buttonsKey = "";
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
  const minutes = h("input", { type: "number", min: 1, max: 600, step: 1, class: "lt-num", "aria-label": "Минуты", title: "Минуты (1–600)",
    value: String((S.pairs[sel.pairIndex] ?? S.pairs[0]).focus), on: { input: valid, keydown: e => { if (e.key == "Enter" && !ok.disabled) ok.click(); } } });
  const topicBox = h("div", { class: "lt-add-topic" });
  const drawTopic = () => {
    topicBox.hidden = kind != "Focus";
    topicBox.replaceChildren(newTopic ? h("input", { type: "text", class: "lt-topic-pick", placeholder: "Новая тема — Enter", "aria-label": "Новая тема", maxLength: 200,
      on: { keydown: e => {
        if (e.key == "Enter" && e.target.value.trim()) {
          e.stopPropagation(); const t = e.target.value.trim().slice(0, 200), known = D().settings.topics.find(x => x.toLocaleLowerCase() == t.toLocaleLowerCase());
          topic = known ?? t; newTopic = false; if (!known) E.saveSettings({ ...D().settings, topics: [...D().settings.topics, t] }); drawTopic();
        } else if (e.key == "Escape") { e.stopPropagation(); newTopic = false; drawTopic(); }
      } } })
      : topicSelect(D().settings, topic, { pick: v => { topic = v; }, isNew: () => { newTopic = true; drawTopic(); topicBox.firstChild.focus(); } }));
  };
  const seg = h("div", { class: "lt-seg" }, [["Focus", "Фокус"], ["Break", "Перерыв"]].map(([k, t]) => h("button", { text: t, "aria-pressed": String(kind == k),
    on: { click: () => { kind = k; for (const b of seg.children) b.setAttribute("aria-pressed", String(b == seg.children[k == "Focus" ? 0 : 1])); drawTopic(); } } })));
  const ok = h("button", { class: "lt-primary", text: "Добавить", on: { click: () => { if (E.addManual({ kind, topic, minutes: Number(minutes.value) })) closeAdd(); } } });
  function valid() { ok.disabled = !(/^[0-9]+$/.test(minutes.value) && minutes.value >= 1 && minutes.value <= 600); minutes.classList.toggle("lt-bad", ok.disabled); }
  addPop = h("div", { id: "lumi-time-add", role: "dialog", "aria-label": "Добавить время" },
    h("div", { class: "lt-add-row" }, h("label", { text: "Минут" }), minutes), seg, topicBox,
    h("div", { class: "lt-add-actions" }, h("button", { text: "Отмена", on: { click: closeAdd } }), ok));
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

let goalsKey = "";
function update() {
  if (!els.main) return;
  const { state: st, settings: S, selection: sel, timerMode } = D(), t = E.now(), info = E.display(st, t), idle = st.phase == "idle";
  const pair = S.pairs[sel.pairIndex] ?? S.pairs[0], paused = !idle && st.runningSince === null;
  root.dataset.phase = idle ? "idle" : st.phase == "focus" ? "focus" : "break";
  root.toggleAttribute("data-paused", paused);
  els.main.textContent = idle && timerMode == "Countdown" ? clockOf(pair.focus * 60000) : info.main;
  els.extra.textContent = info.extra;
  els.progress.style.strokeDashoffset = String(100 * (1 - info.progress));
  els.progress.style.opacity = info.progress === 0 ? "0" : "1";
  const last = E.lastRecord();
  els.minus.disabled = idle ? !last || !E.adjustRecordDuration(last, -1) : E.elapsedMs(st, t) < 60000;
  els.plus.disabled = idle && !last;
  els.minus.title = idle ? "Убрать минуту у последней записи журнала" : "Убрать минуту прошедшего времени";
  els.plus.title = idle ? "Добавить минуту к последней записи журнала" : "Добавить минуту прошедшего времени";
  els.phase.textContent = idle ? "Готов к фокусу" : `${paused ? "Пауза · " : ""}${phaseName[st.phase]}${st.phase == "focus" && st.topic ? ` · ${st.topic}` : ""}`;
  els.last.hidden = !idle;
  if (idle) els.last.textContent = last ? `Последняя запись: ${last.kind == "Focus" ? `фокус · ${last.topic}` : "перерыв"} · ${clockOf(E.countedRecordMs(last))}` : "";
  const every = idle ? sel.every : st.every;
  els.count.hidden = timerMode == "Stopwatch";
  els.count.textContent = `${st.completedFocuses} / ${every} до длинного перерыва`;

  const overtime = st.timerMode != "Stopwatch" && !idle && E.elapsedMs(st, t) >= st.plannedMs && st.acceptedOvertime;
  const key = `${st.phase}:${paused}:${overtime}:${timerMode}`;
  if (key != buttonsKey) {
    buttonsKey = key;
    const list = idle ? [button("Начать фокус", "start-focus", "lt-primary")] : [
      timerMode == "Stopwatch" ? button(st.phase == "focus" ? "На перерыв" : "На фокус", "toggle-mode", "lt-primary")
        : st.phase == "focus" ? button("Начать перерыв", "start-break", "lt-primary") : button("Начать фокус", "start-focus", "lt-primary"),
      paused ? button("Продолжить", "resume") : button("Пауза", "pause"),
      overtime && button("Не считать переработку", "uncount-overtime", "lt-wide"),
      button("Стоп", "stop", "lt-stop")];
    els.buttons.replaceChildren(...list.filter(Boolean));
  }

  // сводка: серия и месяц (с живым фокусом), сегодня по темам
  const sum = E.summary(), liveToday = E.countedTodayMs(st, t), liveTopic = st.topic.trim() || "Фокус";
  const tip = topics => topics.map(([k, ms]) => `${k} — ${clockOf(ms)}`).join("\n") || "Записей нет";
  els.streak.textContent = `Серия ${sum.streak.days} дн · ${clockOf(sum.streak.totalMs + E.countedSinceMs(st, t, sum.resetAt))}`;
  els.streak.title = `Серия — дни подряд с фокусом\n${tip(sum.streak.topics)}`;
  els.month.textContent = `Месяц ${clockOf(sum.month.totalMs + E.countedMonthMs(st, t))}`;
  els.month.title = `За месяц\n${tip(sum.month.topics)}`;
  const today = new Map(sum.today.topics);
  if (liveToday > 0) today.set(liveTopic, (today.get(liveTopic) ?? 0) + liveToday);
  const rows = [...today].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const todayKey = JSON.stringify(rows.map(([k, ms]) => [k, Math.floor(ms / 1000)]));
  if (els.today.dataset.key != todayKey) {
    els.today.dataset.key = todayKey;
    els.today.replaceChildren(...(rows.length ? rows.map(([k, ms]) => h("div", { class: "lt-today-row" },
      h("span", { text: k }), h("span", { text: clockOf(ms) + (k == liveTopic && liveToday > 0 ? " ●" : ""), title: k == liveTopic && liveToday > 0 ? `в том числе идёт сейчас: ${clockOf(liveToday)}` : "" })))
      : [h("div", { class: "lt-dim", text: "Сегодня фокуса ещё не было" })]));
  }
  const g = JSON.stringify(["month", "week", "streak"].map(p => E.goalRows(p)));
  if (g != goalsKey) {
    goalsKey = g;
    els.goals.replaceChildren(...[goalsBlock("month", "Цели на месяц"), goalsBlock("week", "Цели на неделю"), goalsBlock("streak", "Цели на серию")].filter(Boolean));
  }
  const status = D().journalError || (D().writeError ? `Запись журнала не удалась — ${E.pendingCount()} ждут (Журнал → «Повторить»)` : "");
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
if (!mini) openPanel(["settings", "stats", "journal", "day"].includes(q.get("panel")) ? q.get("panel") : "stats");
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
