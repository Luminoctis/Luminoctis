// LumiTime: панели «Настройки», «Статистика», «Журнал», «День» (кнопки внизу столбца таймера, home/time.js).
// Открытая панель — body[lumi-time-panel=имя]: часы и доски уезжают вправо, панель выезжает слева, столбец таймера остаётся (time.css).
// Данные — у движка (js/lumi-time.sys.mjs, один на всё приложение); Daily Log — свои файлы time/days/гггг-мм-дд.json (home/store.js).
import { JS } from "./paths.js";
import * as store from "./store.js";
export const E = ChromeUtils.importESModule(JS("lumi-time.sys.mjs"));

// ---------- мелочи ----------
// h("div", { class, text, title, on: { click }, ...атрибуты/свойства }, ...дети)
export function h(tag, props = {}, ...kids) {
  const el = tag == "svg" || props.svg ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false || k == "svg") continue;
    if (k == "text") el.textContent = v;
    else if (k == "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k in el && !(el instanceof SVGElement) && k != "list") el[k] = v;
    else el.setAttribute(k == "class" ? "class" : k, v === true ? "" : v);
  }
  el.append(...kids.flat(Infinity).filter(k => k != null && k !== false));
  return el;
}
// как replaceChildren, но пропускает null/false и раскрывает списки
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));
export const s = (tag, attrs = {}, ...kids) => h(tag, { ...attrs, svg: true }, ...kids);
export const KIND = { Focus: "Фокус", Break: "Перерыв", "Long break": "Длинный перерыв" };
export const MODE = { Countdown: "Отсчёт", Stopwatch: "Секундомер" };
export const RESULT = { Completed: "Завершено", Stopped: "Остановлено" };
export const clockOf = ms => E.formatClock(ms);
// «1 ч 05 мин» / «12 мин»
export function hm(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000), hrs = Math.floor(m / 60);
  return hrs ? `${hrs} ч ${String(m % 60).padStart(2, "0")} мин` : `${m} мин`;
}
const plain = v => JSON.parse(JSON.stringify(v));
const dateTitle = (date, opts = { weekday: "short", day: "numeric", month: "long" }) =>
  new Intl.DateTimeFormat("ru", opts).format(new Date(`${date}T12:00:00`));
const field = (label, ...control) => h("label", { class: "lt-field" }, h("span", { text: label }), ...control);
const select = (options, value, onchange) => {
  const el = h("select", { on: { change: () => onchange(el.value) } }, options.map(([v, t]) => h("option", { value: String(v), text: t })));
  el.value = String(value);
  return el;
};
const toggle = (label, checked, onchange, hint) => h("label", { class: "lt-toggle" },
  h("input", { type: "checkbox", checked, on: { change: e => onchange(e.target.checked) } }),
  h("span", {}, h("b", { text: label }), hint && h("small", { text: hint })));
function topicList() {
  let dl = document.getElementById("lt-topic-list");
  if (!dl) document.body.append(dl = h("datalist", { id: "lt-topic-list" }));
  dl.replaceChildren(...E.data.settings.topics.map(t => h("option", { value: t })));
  return "lt-topic-list";
}
// подтверждение вторым нажатием (без системных окон)
function confirmButton(text, confirmText, action, cls = "") {
  const b = h("button", { class: cls, text, on: { click: () => {
    if (b.dataset.armed) return action();
    b.dataset.armed = "1"; b.textContent = confirmText; b.classList.add("lt-danger");
    setTimeout(() => { delete b.dataset.armed; b.textContent = text; b.classList.remove("lt-danger"); }, 3000);
  } } });
  return b;
}
// цели периода (статистика и столбец таймера): строки с полосой, процентом и темпом
export function goalsBlock(period, title) {
  const rows = E.goalRows(period);
  if (!rows) return null;
  return h("div", { class: "lt-goals" }, h("h4", { text: title }), rows.map(r => h("div", { class: "lt-goal" },
    h("div", { class: "lt-goal-line" }, h("span", { text: r.label }), h("span", { class: r.ahead ? "lt-ahead" : "lt-behind", text: `${r.percent}% · ${r.actual} / ${r.goal} · ${r.pace}` })),
    h("div", { class: "lt-goal-track", role: "progressbar", "aria-valuenow": String(Math.min(100, r.percent)) },
      h("div", { class: "lt-goal-fill", style: `width:${Math.min(100, Math.max(0, r.percent))}%` })))));
}

// ---------- каркас панели ----------
const TITLES = { settings: "Настройки LumiTime", stats: "Статистика", journal: "Журнал", day: "День" };
let panel = null, body = null, current = null, view = null;
function ensure() {
  if (panel) return;
  panel = h("section", { id: "lumi-time-panel", role: "dialog", inert: true },
    h("header", {}, h("h2"), h("button", { class: "lt-close", title: "Закрыть (Esc)", text: "×", on: { click: () => closePanel() } })),
    body = h("div", { class: "lt-panel-body" }));
  document.body.append(panel);
  document.addEventListener("keydown", e => { if (e.key == "Escape" && current && !e.defaultPrevented) { e.preventDefault(); closePanel(); } });
}
export const panelName = () => current;
export function openPanel(name) {
  ensure();
  if (current == name) return document.body.hasAttribute("lumi-full") ? undefined : closePanel(); // в большом режиме панель всегда открыта: повтор клика ничего не делает
  current = name;
  panel.querySelector("h2").textContent = TITLES[name];
  panel.setAttribute("aria-label", TITLES[name]);
  panel.dataset.panel = name;
  body.replaceChildren();
  body.scrollTop = 0;
  view = VIEWS[name](body);
  panel.inert = false;
  document.body.setAttribute("lumi-time-panel", name);
  document.dispatchEvent(new CustomEvent("lumi-time-panel", { detail: name }));
}
export function closePanel() {
  if (!current || document.body.hasAttribute("lumi-full")) return;
  current = null; view = null;
  panel.inert = true;
  document.body.removeAttribute("lumi-time-panel");
  document.dispatchEvent(new CustomEvent("lumi-time-panel", { detail: null }));
}
export function refreshPanel(kind) { try { view?.update?.(kind); } catch (e) { console.error(e); } }

// ---------- Настройки ----------
function settingsView(root) {
  const save = async mutate => {
    const next = plain(E.data.settings);
    mutate(next);
    await E.saveSettings(next);
  };
  const num = (value, min, max, step, onchange, cls = "lt-num") => h("input", { type: "number", class: cls, value: value ?? "", min, max, step,
    on: { change: e => { const v = e.target.value.trim() === "" ? null : Number(e.target.value); e.target.classList.toggle("lt-bad", !onchange(v)); } } });
  const list = (value, valid, onchange) => h("input", { type: "text", value: value.join(", "),
    on: { change: e => { const v = [...new Set(e.target.value.split(",").map(x => Number(x.trim())))]; const ok = v.length && v.every(valid); e.target.classList.toggle("lt-bad", !ok); if (ok) onchange(v); } } });

  function render() {
    const S = E.data.settings;
    fill(root, 
      h("h3", { text: "Фокус и перерыв" }),
      h("div", { class: "lt-rows" }, S.pairs.map((p, i) => h("div", { class: "lt-row" },
        h("span", { class: "lt-row-label", text: `Пара ${i + 1}` }),
        num(p.focus, 1, 720, 1, v => E.validMinutes(v) && !void save(n => (n.pairs[i].focus = v))),
        h("span", { text: "/" }),
        num(p.rest, 1, 720, 1, v => E.validMinutes(v) && !void save(n => (n.pairs[i].rest = v))),
        h("span", { class: "lt-dim", text: "мин" }),
        h("button", { class: "lt-x", title: "Удалить пару", text: "×", disabled: S.pairs.length == 1, on: { click: () => save(n => {
          n.pairs.splice(i, 1);
          n.presets = n.presets.filter(x => x.pairIndex != i).map(x => ({ ...x, pairIndex: x.pairIndex > i ? x.pairIndex - 1 : x.pairIndex }));
        }).then(render) } })))),
      h("button", { class: "lt-add", text: "+ Пара", on: { click: () => save(n => n.pairs.push({ focus: 25, rest: 5 })).then(render) } }),
      field("Длинные перерывы, мин (через запятую)", list(S.longBreaks, E.validMinutes, v => save(n => {
        n.longBreaks = v; n.presets = n.presets.filter(x => v.includes(x.longBreak));
      }).then(render))),
      field("Длинный перерыв после N фокусов (через запятую)", list(S.counts, E.validCount, v => save(n => {
        n.counts = v; n.presets = n.presets.filter(x => v.includes(x.every));
      }).then(render))),

      h("h3", { text: "Пресеты" }),
      h("div", { class: "lt-rows" }, S.presets.map((p, i) => h("div", { class: "lt-preset-item" }, h("div", { class: "lt-row lt-preset" },
        h("input", { type: "text", value: p.name, maxLength: 60, on: { change: e => { const v = e.target.value.trim(); e.target.classList.toggle("lt-bad", !v); if (v) save(n => (n.presets[i].name = v)); } } }),
        select(S.pairs.map((x, j) => [j, `${x.focus}/${x.rest}`]), p.pairIndex, v => save(n => (n.presets[i].pairIndex = Number(v)))),
        select(S.longBreaks.map(x => [x, `${x} мин`]), p.longBreak, v => save(n => (n.presets[i].longBreak = Number(v)))),
        select(S.counts.map(x => [x, `×${x}`]), p.every, v => save(n => (n.presets[i].every = Number(v)))),
        h("button", { class: "lt-x", title: "Удалить пресет", text: "×", on: { click: () => save(n => n.presets.splice(i, 1)).then(render) } })),
        h("details", { class: "lt-block", open: p.block.enabled },
          h("summary", { text: p.block.enabled ? "Блок сайтов · включён" : "Блок сайтов" }),
          blockEditor(S, i))))),
      h("button", { class: "lt-add", text: "+ Пресет", on: { click: () => save(n => n.presets.push({ id: crypto.randomUUID(), name: "Новый пресет",
        pairIndex: 0, longBreak: n.longBreaks[0], every: n.counts[0], block: { enabled: false, sites: [], breaks: false } })).then(render) } }),

      h("h3", { text: "Темы" }),
      h("p", { class: "lt-dim", text: "Список тем в выпадающем списке таймера. «Новая тема…» там же добавляет тему сюда. Переименование меняет и цели по теме; старые записи журнала остаются под прежним названием." }),
      h("div", { class: "lt-rows" }, S.topics.map((t, i) => h("div", { class: "lt-row" },
        h("input", { type: "text", class: "lt-grow", value: t, maxLength: 200, on: { change: e => {
          const v = e.target.value.trim(), dup = E.data.settings.topics.some((x, j) => j != i && x.toLocaleLowerCase() == v.toLocaleLowerCase());
          e.target.classList.toggle("lt-bad", !v || dup);
          if (v && !dup) save(n => {
            const old = n.topics[i];
            n.topics[i] = v;
            for (const k of ["topicMonthGoals", "topicWeekGoals", "topicStreakGoals"]) for (const g of n[k]) if (g.topic.toLocaleLowerCase() == old.toLocaleLowerCase()) g.topic = v;
          });
        } } }),
        h("button", { class: "lt-x", title: "Удалить тему", text: "×", disabled: S.topics.length == 1, on: { click: () => save(n => n.topics.splice(i, 1)).then(render) } })))),
      h("button", { class: "lt-add", text: "+ Тема", on: { click: () => save(n => {
        let k = n.topics.length + 1;
        while (n.topics.some(t => t.toLocaleLowerCase() == `тема ${k}`)) k++;
        n.topics.push(`Тема ${k}`);
      }).then(render) } }),

      h("h3", { text: "Звук и уведомления" }),
      toggle("Звук", S.sound, v => save(n => (n.sound = v))),
      field("Сигнал", select([["classic", "Двойной сигнал"], ["bell", "Колокол"], ["chime", "Перезвон"]], S.soundPreset, v => save(n => (n.soundPreset = v)))),
      h("div", { class: "lt-field" }, h("span", { text: "Свой файл (заменяет сигнал)" }),
        h("div", { class: "lt-row" },
          h("span", { class: "lt-file", title: S.soundFile, text: S.soundFile ? S.soundFile.split(/[\\/]/).pop() : "не выбран" }),
          h("button", { text: "Выбрать…", on: { click: pickSound } }),
          S.soundFile && h("button", { class: "lt-x", title: "Убрать файл", text: "×", on: { click: () => save(n => (n.soundFile = "")).then(render) } }))),
      field(`Громкость: ${S.volume}%`, h("input", { type: "range", min: 0, max: 100, step: 5, value: S.volume,
        on: { input: e => (e.target.previousSibling.textContent = `Громкость: ${e.target.value}%`), change: e => save(n => (n.volume = Number(e.target.value))) } })),
      h("div", { class: "lt-row" }, h("button", { text: "▶ Проверить звук", on: { click: () => E.playSound() } }),
        h("button", { text: "Проверить уведомление", on: { click: () => E.notify("Уведомления LumiTime работают.") } })),
      toggle("Системные уведомления", S.systemNotifications, v => save(n => (n.systemNotifications = v)), "Когда время фокуса или перерыва вышло"),

      goalSettings("Цели на месяц", "monthGoalsEnabled", "monthGoalHours", "topicMonthGoals"),
      goalSettings("Цели на неделю (пн–вс)", "weekGoalsEnabled", "weekGoalHours", "topicWeekGoals"),
      goalSettings("Цели на серию дней", "streakGoalsEnabled", "streakGoalHours", "topicStreakGoals"),
      h("div", { class: "lt-row" }, h("span", { class: "lt-dim", text: "Серия — дни подряд с фокусом." }),
        confirmButton("Сбросить серию", "Точно сбросить?", () => { E.endStreak(); render(); })),

      h("h3", { text: "Блок сайтов без пресета" }),
      h("p", { class: "lt-dim", text: "Блок настраивается у каждого пресета (выше, «Блок сайтов»). Здесь — для таймера «Свой», когда длительности выбраны вручную." }),
      blockEditor(S, -1),

      h("p", { class: "lt-dim", text: `Файлы: ${store.path("time")}` }),
    );
  }
  // блок сайтов пресета i (или «Свой», i = -1): вкл/выкл, «и в перерывах», список
  function blockEditor(S, i) {
    const b = i < 0 ? { enabled: S.blockEnabled, sites: S.blockSites, breaks: S.blockBreaks } : S.presets[i].block;
    const set = (n, k, v) => (i < 0 ? (n[{ enabled: "blockEnabled", sites: "blockSites", breaks: "blockBreaks" }[k]] = v) : (n.presets[i].block[k] = v));
    return h("div", { class: "lt-block-body" },
      toggle("Блокировать сайты", b.enabled, v => save(n => set(n, "enabled", v)).then(() => i >= 0 && render()),
        "Пока идёт фокус (не пауза), эти сайты и их поддомены открываются заглушкой «Фокус — вернись после чч:мм»"),
      toggle("Блокировать и в перерывах", b.breaks, v => save(n => set(n, "breaks", v)), "Строгий режим: сайты закрыты и во время перерыва. Выключено — только во время фокуса"),
      h("textarea", { class: "lt-sites", rows: 4, placeholder: "youtube.com\nreddit.com", value: b.sites.join("\n"),
        on: { change: e => save(n => set(n, "sites", e.target.value.split(/[\s,]+/).map(E.normDomain).filter(Boolean)))
          .then(() => (e.target.value = (i < 0 ? E.data.settings.blockSites : E.data.settings.presets[i].block.sites).join("\n"))) } }));
  }
  function goalSettings(title, onKey, totalKey, topicsKey) {
    const S = E.data.settings;
    return h("div", { class: "lt-goal-settings" },
      h("h3", { text: title }),
      toggle("Показывать цели", S[onKey], v => save(n => (n[onKey] = v)).then(render)),
      S[onKey] && h("div", { class: "lt-rows" },
        h("div", { class: "lt-row" }, h("span", { class: "lt-row-label", text: "Всего, ч" }),
          num(S[totalKey], 0.25, 744, 0.25, v => (v === null || E.validGoalHours(v)) && !void save(n => (n[totalKey] = v)), "lt-num lt-wide")),
        S[topicsKey].map((g, i) => h("div", { class: "lt-row" },
          h("input", { type: "text", value: g.topic, list: topicList(), on: { change: e => {
            const v = e.target.value.trim(), dup = E.data.settings[topicsKey].some((x, j) => j != i && x.topic.toLocaleLowerCase() == v.toLocaleLowerCase());
            e.target.classList.toggle("lt-bad", !v || dup);
            if (v && !dup) save(n => (n[topicsKey][i].topic = v));
          } } }),
          num(g.hours, 0.25, 744, 0.25, v => E.validGoalHours(v) && !void save(n => (n[topicsKey][i].hours = v))),
          h("span", { class: "lt-dim", text: "ч" }),
          h("button", { class: "lt-x", title: "Удалить цель", text: "×", on: { click: () => save(n => n[topicsKey].splice(i, 1)).then(render) } }))),
        h("button", { class: "lt-add", text: "+ Цель по теме", on: { click: () => save(n => {
          const used = new Set(n[topicsKey].map(x => x.topic.toLocaleLowerCase()));
          n[topicsKey].push({ topic: n.topics.find(t => !used.has(t.toLocaleLowerCase())) ?? `Тема ${n[topicsKey].length + 1}`, hours: 1 });
        }).then(render) } })));
  }
  function pickSound() {
    const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window.browsingContext, "Звук LumiTime", Ci.nsIFilePicker.modeOpen);
    fp.appendFilter("Аудио", "*.mp3;*.wav;*.ogg;*.oga;*.m4a;*.aac;*.flac;*.opus;*.webm");
    fp.open(rv => { if (rv == Ci.nsIFilePicker.returnOK && fp.file) save(n => (n.soundFile = fp.file.path)).then(render); });
  }
  render();
  return { update(kind) { if (kind == "load") render(); } };
}

// ---------- Статистика ----------
function statsView(root) {
  let period = "week", at = new Date(E.now());
  const chart = st => {
    const W = 640, H = 220, L = 34, B = 22, T = 8, max = Math.max(0, ...st.buckets.map(b => b.focusMs + b.breakMs));
    const ticks = E.chartYAxisTicks(max, period), top = ticks.at(-1) * 3600000, y = ms => H - B - (H - B - T) * ms / top;
    const bw = (W - L) / st.buckets.length, gap = Math.min(6, bw * 0.25);
    return s("svg", { viewBox: `0 0 ${W} ${H}`, class: "lt-chart", role: "img", "aria-label": "График фокуса и перерывов" },
      ticks.map(t => s("g", {}, s("line", { x1: L, x2: W, y1: y(t * 3600000), y2: y(t * 3600000), class: "lt-grid" }),
        s("text", { x: L - 6, y: y(t * 3600000) + 4, "text-anchor": "end", class: "lt-axis" }, `${t} ч`))),
      st.buckets.map((b, i) => {
        const x = L + i * bw + gap / 2, w = bw - gap;
        return s("g", { class: "lt-bar" },
          s("title", {}, `${b.label}: фокус ${hm(b.focusMs)}, перерывы ${hm(b.breakMs)}`),
          b.focusMs > 0 && s("rect", { x, width: w, y: y(b.focusMs), height: H - B - y(b.focusMs), rx: 3, class: "lt-bar-focus" }),
          b.breakMs > 0 && s("rect", { x, width: w, y: y(b.focusMs + b.breakMs), height: y(b.focusMs) - y(b.focusMs + b.breakMs), rx: 3, class: "lt-bar-break" }),
          (period != "month" || i % 2 == 0 || st.buckets.length < 20) && s("text", { x: x + w / 2, y: H - 6, "text-anchor": "middle", class: "lt-axis" }, b.label));
      }));
  };
  function render() {
    const st = E.buildStatistics(E.data.records, period, at), maxTopic = st.topics[0]?.[1] ?? 0;
    const go = dir => { at = E.shiftStatisticsDate(at, period, dir); render(); };
    fill(root, 
      h("div", { class: "lt-seg" }, [["week", "Неделя"], ["month", "Месяц"], ["year", "Год"]].map(([p, t]) =>
        h("button", { text: t, "aria-pressed": String(p == period), on: { click: () => { period = p; render(); } } }))),
      h("div", { class: "lt-period" }, h("button", { class: "lt-nav-arrow", title: "Назад", text: "‹", on: { click: () => go(-1) } }),
        h("b", { class: "lt-period-title", text: st.title }),
        h("button", { class: "lt-nav-arrow", title: "Вперёд", text: "›", on: { click: () => go(1) } }),
        h("button", { class: "lt-link", text: "Сейчас", on: { click: () => { at = new Date(E.now()); render(); } } })),
      h("div", { class: "lt-cards" },
        [["Фокус", clockOf(st.focusMs)], ["Перерывы", clockOf(st.breakMs)], ["Сессий фокуса", String(st.focusSessions)],
          ["Средняя сессия", clockOf(st.averageFocusMs)], ["Дней с фокусом", String(st.focusDays)]]
          .map(([k, v], i) => h("div", { class: `lt-card${i == 0 ? " lt-card-main" : ""}` }, h("small", { text: k }), h("b", { text: v })))),
      chart(st),
      h("div", { class: "lt-legend" }, h("span", { class: "lt-key-focus", text: "Фокус" }), h("span", { class: "lt-key-break", text: "Перерывы" })),
      h("h3", { text: "По темам" }),
      st.topics.length ? h("div", { class: "lt-topics" }, st.topics.map(([t, ms]) => h("div", { class: "lt-topic" },
        h("span", { text: t }), h("span", { class: "lt-dim", text: `${clockOf(ms)} · ${Math.round(ms / st.focusMs * 100)}%` }),
        h("div", { class: "lt-goal-track" }, h("div", { class: "lt-goal-fill", style: `width:${ms / maxTopic * 100}%` })))))
        : h("p", { class: "lt-dim", text: "За этот период фокуса нет." }),
      goalsBlock("month", "Цели на месяц"), goalsBlock("week", "Цели на неделю"), goalsBlock("streak", "Цели на серию"),
      E.data.journalError && h("p", { class: "lt-error", text: E.data.journalError }),
    );
  }
  render();
  return { update(kind) { if (kind != "settings") render(); } };
}

// ---------- Журнал ----------
function journalView(root) {
  let shown = 14;
  function render() {
    const days = E.journalDays(), last = E.lastRecord(), S = E.data;
    const type = select([["Focus", "Фокус"], ["Break", "Перерыв"]], "Focus", v => (topic.hidden = v != "Focus"));
    const topic = h("input", { type: "text", maxLength: 200, list: topicList(), placeholder: "Тема", value: S.selection.topic.trim() || S.settings.topics[0] || "" });
    const hours = h("input", { type: "number", class: "lt-num", min: 0, max: 23, step: 1, value: 0, title: "часы" });
    const mins = h("input", { type: "number", class: "lt-num", min: 0, max: 59, step: 1, value: 25, title: "минуты" });
    const add = () => {
      const ms = (Number(hours.value) * 60 + Number(mins.value)) * 60000;
      const ok = Number.isInteger(Number(hours.value)) && Number.isInteger(Number(mins.value)) && ms > 0 && ms <= 24 * 3600000;
      mins.classList.toggle("lt-bad", !ok);
      if (ok) E.addManual(type.value, topic.value, ms);
    };
    fill(root, 
      h("div", { class: "lt-box" },
        h("div", { class: "lt-row" },
          h("span", { class: "lt-grow", text: last ? `Последняя: ${KIND[last.kind]}${last.kind == "Focus" ? ` · ${last.topic}` : ""} · ${clockOf(E.countedRecordMs(last))}` : "Записей пока нет" }),
          h("button", { title: "Убрать минуту у последней записи", text: "−1 мин", disabled: !last || !E.adjustRecordDuration(last, -1), on: { click: () => E.adjust(-1) } }),
          h("button", { title: "Добавить минуту к последней записи", text: "+1 мин", disabled: !last, on: { click: () => E.adjust(1) } })),
        S.state.phase != "idle" && h("small", { class: "lt-dim", text: "Пока идёт цикл, ± в кольце правят его время; здесь — последняя запись журнала." })),
      h("div", { class: "lt-box" }, h("b", { text: "Добавить время вручную" }),
        h("div", { class: "lt-row lt-manual" }, type, topic, hours, h("span", { text: "ч" }), mins, h("span", { text: "мин" }),
          h("button", { class: "lt-primary", text: "Добавить", on: { click: add } }))),
      S.journalError && h("p", { class: "lt-error", text: S.journalError }),
      S.writeError && h("p", { class: "lt-error", text: `Запись не удалась: ${S.writeError}. Записи (${E.pendingCount()}) ждут.` }),
      E.pendingCount() > 0 && h("button", { text: `Повторить запись (${E.pendingCount()})`, on: { click: () => E.flushJournal() } }),
      days.length ? days.slice(0, shown).map(d => h("div", { class: "lt-day" },
        h("div", { class: "lt-day-head" }, h("b", { text: dateTitle(d.date, { weekday: "short", day: "numeric", month: "long", year: "numeric" }) }),
          h("span", { class: "lt-dim", text: `фокус ${clockOf(d.focusMs)}${d.breakMs ? ` · перерывы ${clockOf(d.breakMs)}` : ""}` })),
        h("table", { class: "lt-table" },
          h("thead", {}, h("tr", {}, ["Тип", "Режим", "Тема", "Время", "Пауза", "Итог"].map(t => h("th", { text: t })))),
          h("tbody", {}, d.rows.map(({ record: r, ms, pausedMs }) => h("tr", { class: r.kind == "Focus" ? "lt-row-focus" : "" },
            h("td", { text: KIND[r.kind] }), h("td", { text: (MODE[r.timerMode ?? "Countdown"]) + (r.manual ? " · вручную" : "") }),
            h("td", { text: r.kind == "Focus" ? r.topic : "—" }), h("td", { text: clockOf(ms) }),
            h("td", { text: pausedMs ? clockOf(pausedMs) : "—" }), h("td", { text: RESULT[r.result] })))))))
        : h("p", { class: "lt-dim", text: "Журнал пуст. Сессии от 3 минут записываются сами; короче — можно добавить вручную." }),
      days.length > shown && h("button", { class: "lt-add", text: "Показать ещё", on: { click: () => { shown += 14; render(); } } }),
      h("p", { class: "lt-dim", text: `Файл: ${store.path("time/journal.json")}` }),
    );
  }
  render();
  return { update(kind) { if (kind != "settings" && !root.contains(document.activeElement)) render(); } };
}

// ---------- День (Daily Log): задачи-чекбоксы и комментарии на каждый день ----------
function dayView(root) {
  let date = E.localDate(E.now()), day = null, error = null, saving = Promise.resolve();
  const empty = d => ({ version: 1, date: d, tasks: [], comments: [] });
  const valid = v => v && typeof v == "object" && Array.isArray(v.tasks) && Array.isArray(v.comments);
  async function load(d) {
    date = d; error = null; day = null;
    try {
      const v = await store.readJSON(E.dayFile(d), null);
      if (v && !valid(v)) throw new Error("неизвестный формат");
      if (d == date) day = v ?? empty(d);
    } catch (e) { error = `Файл дня не читается (${E.dayFile(d)}): ${e.message ?? e}. Он не будет перезаписан.`; }
    render();
  }
  const save = () => {
    const snap = plain(day), rel = E.dayFile(snap.date);
    saving = saving.then(() => store.writeJSON(rel, snap)).catch(e => { error = `Не сохранилось: ${e.message ?? e}`; render(); });
    return saving;
  };
  const change = fn => { fn(day); save(); render(); };
  function render() {
    const today = E.localDate(E.now()), focus = E.journalDays().find(d => d.date == date);
    const done = day ? day.tasks.filter(t => t.done).length : 0, total = day?.tasks.length ?? 0, pct = total ? Math.round(done / total * 100) : 0;
    const newTask = h("input", { type: "text", class: "lt-grow", placeholder: "Новая задача — Enter", maxLength: 500,
      on: { keydown: e => { if (e.key == "Enter" && newTask.value.trim()) { const text = newTask.value.trim(); change(d => d.tasks.push({ id: crypto.randomUUID(), text, done: false })); root.querySelector(".lt-new-task")?.focus(); } } } });
    newTask.classList.add("lt-new-task");
    const note = h("textarea", { rows: 3, placeholder: "Комментарий к дню… (Ctrl+Enter — добавить)", maxLength: 4000,
      on: { keydown: e => { if (e.key == "Enter" && e.ctrlKey) addNote(); } } });
    const addNote = () => { const text = note.value.trim(); if (text) change(d => d.comments.push({ id: crypto.randomUUID(), text, at: E.now() })); };
    fill(root, 
      h("div", { class: "lt-period" },
        h("button", { class: "lt-nav-arrow", title: "Предыдущий день", text: "‹", on: { click: () => load(E.shiftDate(date, -1)) } }),
        h("b", { class: "lt-period-title", text: dateTitle(date, { weekday: "long", day: "numeric", month: "long" }) + (date == today ? " · сегодня" : "") }),
        h("button", { class: "lt-nav-arrow", title: "Следующий день", text: "›", on: { click: () => load(E.shiftDate(date, 1)) } }),
        date != today && h("button", { class: "lt-link", text: "Сегодня", on: { click: () => load(today) } })),
      h("div", { class: "lt-cards" },
        h("div", { class: "lt-card lt-card-main" }, h("small", { text: "Задачи" }), h("b", { text: `${done} / ${total}` }),
          h("div", { class: "lt-goal-track" }, h("div", { class: "lt-goal-fill", style: `width:${pct}%` }))),
        h("div", { class: "lt-card" }, h("small", { text: "Фокус за день" }), h("b", { text: clockOf(focus?.focusMs ?? 0) }))),
      error && h("p", { class: "lt-error", text: error }),
      day && h("h3", { text: "Задачи" }),
      day && h("ul", { class: "lt-tasks" }, day.tasks.map((t, i) => h("li", { class: t.done ? "lt-done" : "" },
        h("label", {}, h("input", { type: "checkbox", checked: t.done, on: { change: e => { E.playCheckSound(e.target.checked); change(d => (d.tasks[i].done = e.target.checked)); } } }),
          h("span", { text: t.text })),
        h("button", { class: "lt-x", title: "Удалить задачу", text: "×", on: { click: () => change(d => d.tasks.splice(i, 1)) } })))),
      day && h("div", { class: "lt-row" }, newTask),
      day && h("h3", { text: "Комментарии" }),
      day && h("div", { class: "lt-comments" }, day.comments.map((c, i) => h("div", { class: "lt-comment" },
        h("small", { class: "lt-dim", text: new Date(c.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) }),
        h("p", { text: c.text }),
        h("button", { class: "lt-x", title: "Удалить комментарий", text: "×", on: { click: () => change(d => d.comments.splice(i, 1)) } })))),
      day && note,
      day && h("button", { class: "lt-add", text: "Добавить комментарий", on: { click: addNote } }),
    );
  }
  root.lumiDay = { load: d => load(d), get: () => day, saved: () => saving }; // для проверок
  load(date);
  return { update(kind) { if (kind == "journal" && !root.contains(document.activeElement)) render(); } };
}

const VIEWS = { settings: settingsView, stats: statsView, journal: journalView, day: dayView };
