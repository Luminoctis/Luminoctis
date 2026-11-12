// LumiTime: панели «Настройки», «Статистика», «Журнал», «День» (кнопки внизу столбца таймера, home/time.js).
// Открытая панель — body[lumi-time-panel=имя]: часы и доски уезжают вправо, панель выезжает слева, столбец таймера остаётся (time.css).
// Данные — у движка (js/lumi-time.sys.mjs, один на всё приложение); Daily Log — свои файлы time/days/гггг-мм-дд.json (home/store.js).
import { JS } from "./paths.js";
import * as store from "./store.js";
import { COLORS } from "./notes-md.mjs";
import { ICONS } from "./time-icons.mjs";
export const E = ChromeUtils.importESModule(JS("lumi-time.sys.mjs"));
const { t, locale } = ChromeUtils.importESModule(JS("lumi-i18n.sys.mjs"));

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
export const KIND = () => ({ Focus: t("Фокус"), Break: t("Перерыв"), "Long break": t("Длинный перерыв") });
export const MODE = () => ({ Countdown: t("Отсчёт"), Stopwatch: t("Секундомер") });
const RESULT = () => ({ Completed: t("Завершено"), Stopped: t("Остановлено") });
// тема по умолчанию «Фокус» хранится в данных по-русски — переводим только показ
export const topicName = k => (k === "Фокус" ? t("Фокус") : k); // l10n-skip
// цвет темы (настройки LumiTime → Темы): ключ палитры листов LumiNotes → hex; null — без цвета
export const topicColor = k => COLORS[E.data.settings.topicColors?.[k]] ?? null;
const COLOR_NAMES = () => ({ red: t("Красный"), orange: t("Оранжевый"), yellow: t("Жёлтый"), green: t("Зелёный"), teal: t("Бирюзовый"), blue: t("Синий"), purple: t("Фиолетовый"), pink: t("Розовый"), gray: t("Серый") });
// название темы с цветной точкой (.lt-tc::before, time.css); без цвета — просто текст, как раньше
export const topicTag = (k, tag = "span") => { const c = topicColor(k); return h(tag, c ? { class: "lt-tc", style: `--tc:${c}`, text: topicName(k) } : { text: topicName(k) }); };
// пресет по умолчанию у старых пользователей хранится как «Классика» — показываем переведённым (новый — «Classic», как есть)
export const presetName = n => (n === "Классика" ? t("Классика") : n); // l10n-skip
export const clockOf = ms => E.formatClock(ms);
// «1 ч 05 мин» / «12 мин»
export function hm(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000), hrs = Math.floor(m / 60);
  return hrs ? t("{0} ч {1} мин", hrs, String(m % 60).padStart(2, "0")) : t("{0} мин", m);
}
const plain = v => JSON.parse(JSON.stringify(v));
const dateTitle = (date, opts = { weekday: "short", day: "numeric", month: "long" }) =>
  new Intl.DateTimeFormat(locale, opts).format(new Date(`${date}T12:00:00`));
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
  dl.replaceChildren(...E.data.settings.topics.map(tp => h("option", { value: tp })));
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
    h("div", { class: "lt-goal-line" }, topicTag(r.label), h("span", { class: r.ahead ? "lt-ahead" : "lt-behind", text: `${r.percent}% · ${r.actual} / ${r.goal} · ${r.pace}` })),
    h("div", { class: "lt-goal-track", role: "progressbar", "aria-valuenow": String(Math.min(100, r.percent)) },
      h("div", { class: "lt-goal-fill", style: `width:${Math.min(100, Math.max(0, r.percent))}%${topicColor(r.label) ? `;background:${topicColor(r.label)}` : ""}` })))));
}

// ---------- «Каждый день»: ежедневные задачи (движок: E.daily*, логика и формат — js/lumi-time-daily.sys.mjs) ----------
// значок задачи (линейный, home/time-icons.mjs); неизвестный id или «без значка» — null
export const dailyIcon = id => (ICONS[id] ? s("svg", { viewBox: "0 0 24 24", class: "lt-ico", "aria-hidden": "true" }, ICONS[id].map(d => s("path", { d }))) : null);
// всё, от чего зависит вид блока в столбце (time.js перерисовывает блок, только когда это изменилось; в том числе в полночь — меняется день)
export const dailyKey = () => JSON.stringify([E.data.daily, E.dailyToday(), E.data.dailyError, E.data.dailyWriteError, E.data.settings.dailyEnabled]);
// блок в столбце: на сегодня ✓ сделал / ✗ не сделал (повторный клик по той же кнопке снимает); задачи правятся в настройках большого LumiTime («Изменить», onEdit)
export function dailyBlock(onEdit) {
  const { daily, dailyError, dailyWriteError, settings } = E.data;
  if (!settings.dailyEnabled) return null;
  const today = E.dailyToday(), tasks = daily.tasks, mark = k => daily.marks[today]?.[k.id];
  const done = tasks.filter(k => mark(k) === 1).length;
  return h("div", { class: "lt-daily" },
    h("div", { class: "lt-today-head" }, h("h4", { text: t("Каждый день") + (tasks.length ? ` · ${done}/${tasks.length}` : "") }),
      !dailyError && h("button", { class: "lt-add-btn", text: t("Изменить"), title: t("Открыть настройки ежедневных задач"), on: { click: onEdit } })),
    dailyError && h("p", { class: "lt-error", text: dailyError }),
    dailyWriteError && h("p", { class: "lt-error", text: t("Не сохранилось: {0}", dailyWriteError) }),
    !tasks.length && !dailyError && h("button", { class: "lt-link lt-daily-empty", text: t("Задач нет — добавь их в настройках"), on: { click: onEdit } }),
    tasks.map(k => {
      const m = mark(k), streak = E.dailyStatsOf(k.id).current;
      return h("div", { class: "lt-daily-row" }, dailyIcon(k.icon), h("span", { class: "lt-daily-name", text: k.name, title: k.name }),
        streak > 0 && h("small", { class: "lt-dim", text: t("{0} дн", streak), title: t("Серия дней подряд") }),
        h("button", { class: "lt-daily-yes", text: "✓", title: t("Сделал (ещё раз — снять отметку)"), "aria-label": t("Сделал"), "aria-pressed": String(m === 1),
          on: { click: () => E.dailyMark(k.id, today, E.toggleMark(m, 1)) } }),
        h("button", { class: "lt-daily-no", text: "✗", title: t("Не сделал (ещё раз — снять отметку)"), "aria-label": t("Не сделал"), "aria-pressed": String(m === 0),
          on: { click: () => E.dailyMark(k.id, today, E.toggleMark(m, 0)) } }));
    }));
}
// статистика по каждой задаче: серия, лучшая серия, % за 30 дней и за всё время, календарь последних 12 недель (клик по прошлому дню меняет отметку: пусто → ✓ → ✗ → пусто)
function dailyStatsBlock() {
  const { daily, settings } = E.data;
  if (!settings.dailyEnabled || !daily.tasks.length) return null;
  const today = E.dailyToday(), WEEKS = 12, pct = v => (v === null ? "—" : `${v}%`);
  const monday = E.shiftDate(today, -((new Date(`${today}T12:00:00`).getDay() + 6) % 7)), first = E.shiftDate(monday, -7 * (WEEKS - 1));
  const dates = Array.from({ length: WEEKS * 7 }, (_, i) => E.shiftDate(first, i)); // по неделям: 7 подряд — пн…вс
  const monDays = [0, 2, 4, 6].map(i => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: "short" })); // 1 января 2024 — понедельник
  return [h("h3", { text: t("Каждый день") }), daily.tasks.map(k => {
    const st = E.dailyStatsOf(k.id);
    return h("div", { class: "lt-daily-stat" },
      h("div", { class: "lt-daily-stat-head" }, h("b", {}, dailyIcon(k.icon), k.name), h("small", { class: "lt-dim", text: t("с {0} · сделано {1} из {2}", dateTitle(k.created, { day: "numeric", month: "long" }), st.doneAll, st.days) })),
      h("div", { class: "lt-cards" }, [[t("Серия"), t("{0} дн", st.current)], [t("Лучшая серия"), t("{0} дн", st.best)], [t("За 30 дней"), pct(st.pct30)], [t("За всё время"), pct(st.pctAll)]]
        .map(([k, v], i) => h("div", { class: `lt-card${i == 0 ? " lt-card-main" : ""}` }, h("small", { text: k }), h("b", { text: v })))),
      h("div", { class: "lt-cal" },
        h("div", { class: "lt-cal-days" }, [monDays[0], "", monDays[1], "", monDays[2], "", monDays[3]].map(d => h("span", { text: d && d[0].toLocaleUpperCase(locale) + d.slice(1) }))),
        h("div", { class: "lt-cal-grid", role: "group", "aria-label": t("Отметки: {0}", k.name) }, dates.map(date => {
          const m = daily.marks[date]?.[k.id];
          return h("button", { class: `lt-cell${m === 1 ? " lt-cell-yes" : m === 0 ? " lt-cell-no" : ""}${date == today ? " lt-cell-today" : ""}`, text: m === 1 ? "✓" : m === 0 ? "✗" : "",
            disabled: date < k.created || date > today, title: dateTitle(date) + " — " + (m === 1 ? t("сделал") : m === 0 ? t("не сделал") : t("не отмечено")),
            on: { click: () => E.dailyMark(k.id, date, E.cycleMark(m)) } });
        }))));
  })];
}

// ---------- каркас панели ----------
const TITLES = () => ({ settings: t("Настройки LumiTime"), stats: t("Статистика"), journal: t("Журнал"), day: t("День") });
let panel = null, body = null, current = null, view = null;
function ensure() {
  if (panel) return;
  panel = h("section", { id: "lumi-time-panel", role: "dialog", inert: true },
    h("header", {}, h("h2"), h("button", { class: "lt-close", title: t("Закрыть (Esc)"), text: "×", on: { click: () => closePanel() } })),
    body = h("div", { class: "lt-panel-body" }));
  document.body.append(panel);
  document.addEventListener("keydown", e => { if (e.key == "Escape" && current && !e.defaultPrevented) { e.preventDefault(); closePanel(); } });
}
export const panelName = () => current;
// section — якорь внутри панели (data-section), к которому прокрутить: «Изменить» в мини-окне ведёт на настройки → «Каждый день»
const toSection = section => section && body.querySelector(`[data-section="${CSS.escape(section)}"]`)?.scrollIntoView({ block: "start" });
export function openPanel(name, section) {
  ensure();
  if (current == name) return document.body.hasAttribute("lumi-full") ? toSection(section) : closePanel(); // в большом режиме панель всегда открыта: повтор клика ничего не делает
  current = name;
  const title = TITLES()[name];
  panel.querySelector("h2").textContent = title;
  panel.setAttribute("aria-label", title);
  panel.dataset.panel = name;
  body.replaceChildren();
  body.scrollTop = 0;
  view = VIEWS[name](body);
  toSection(section);
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
  let colorOpen = null; // тема, у которой открыта палитра цвета
  const save = async mutate => {
    const next = plain(E.data.settings);
    mutate(next);
    await E.saveSettings(next);
  };
  const num = (value, min, max, step, onchange, cls = "lt-num") => h("input", { type: "number", class: cls, value: value ?? "", min, max, step,
    on: { change: e => { const v = e.target.value.trim() === "" ? null : Number(e.target.value); e.target.classList.toggle("lt-bad", !onchange(v)); } } });
  const list = (value, valid, onchange) => h("input", { type: "text", value: value.join(", "),
    on: { change: e => { const v = [...new Set(e.target.value.split(",").map(x => Number(x.trim())))]; const ok = v.length && v.every(valid); e.target.classList.toggle("lt-bad", !ok); if (ok) onchange(v); } } });

  let dailyBox = null;
  function render() {
    const S = E.data.settings;
    fill(root, 
      h("h3", { text: t("Фокус и перерыв") }),
      h("div", { class: "lt-rows" }, S.pairs.map((p, i) => h("div", { class: "lt-row" },
        h("span", { class: "lt-row-label", text: t("Пара {0}", i + 1) }),
        num(p.focus, 1, 720, 1, v => E.validMinutes(v) && !void save(n => (n.pairs[i].focus = v))),
        h("span", { text: "/" }),
        num(p.rest, 1, 720, 1, v => E.validMinutes(v) && !void save(n => (n.pairs[i].rest = v))),
        h("span", { class: "lt-dim", text: t("мин") }),
        h("button", { class: "lt-x", title: t("Удалить пару"), text: "×", disabled: S.pairs.length == 1, on: { click: () => save(n => {
          n.pairs.splice(i, 1);
          n.presets = n.presets.filter(x => x.pairIndex != i).map(x => ({ ...x, pairIndex: x.pairIndex > i ? x.pairIndex - 1 : x.pairIndex }));
        }).then(render) } })))),
      h("button", { class: "lt-add", text: t("+ Пара"), on: { click: () => save(n => n.pairs.push({ focus: 25, rest: 5 })).then(render) } }),
      field(t("Длинные перерывы, мин (через запятую)"), list(S.longBreaks, E.validMinutes, v => save(n => {
        n.longBreaks = v; n.presets = n.presets.filter(x => v.includes(x.longBreak));
      }).then(render))),
      field(t("Длинный перерыв после N фокусов (через запятую)"), list(S.counts, E.validCount, v => save(n => {
        n.counts = v; n.presets = n.presets.filter(x => v.includes(x.every));
      }).then(render))),

      h("h3", { text: t("Пресеты") }),
      h("div", { class: "lt-rows" }, S.presets.map((p, i) => h("div", { class: "lt-preset-item" }, h("div", { class: "lt-row lt-preset" },
        h("input", { type: "text", value: presetName(p.name), maxLength: 60, on: { change: e => { const v = e.target.value.trim(); e.target.classList.toggle("lt-bad", !v); if (v) save(n => (n.presets[i].name = v)); } } }),
        select(S.pairs.map((x, j) => [j, `${x.focus}/${x.rest}`]), p.pairIndex, v => save(n => (n.presets[i].pairIndex = Number(v)))),
        select(S.longBreaks.map(x => [x, t("{0} мин", x)]), p.longBreak, v => save(n => (n.presets[i].longBreak = Number(v)))),
        select(S.counts.map(x => [x, `×${x}`]), p.every, v => save(n => (n.presets[i].every = Number(v)))),
        h("button", { class: "lt-x", title: t("Удалить пресет"), text: "×", on: { click: () => save(n => n.presets.splice(i, 1)).then(render) } })),
        h("details", { class: "lt-block", open: p.block.enabled },
          h("summary", { text: p.block.enabled ? t("Блок сайтов · включён") : t("Блок сайтов") }),
          blockEditor(S, i))))),
      h("button", { class: "lt-add", text: t("+ Пресет"), on: { click: () => save(n => n.presets.push({ id: crypto.randomUUID(), name: t("Новый пресет"),
        pairIndex: 0, longBreak: n.longBreaks[0], every: n.counts[0], block: { enabled: false, sites: [], breaks: false } })).then(render) } }),

      h("h3", { text: t("Темы") }),
      h("p", { class: "lt-dim", text: t("Список тем в выпадающем списке таймера. «Новая тема…» там же добавляет тему сюда. Переименование меняет и цели по теме; старые записи журнала остаются под прежним названием.") }),
      h("div", { class: "lt-rows" }, S.topics.map((tp, i) => h("div", { class: "lt-row" },
        h("button", { class: "lt-swatch lt-swatch-btn" + (topicColor(tp) ? "" : " lt-swatch-none"), title: t("Цвет темы"), "aria-label": t("Цвет темы"), style: topicColor(tp) ? `background:${topicColor(tp)}` : null,
          on: { click: () => { colorOpen = colorOpen === tp ? null : tp; render(); } } }),
        h("input", { type: "text", class: "lt-grow", value: tp, maxLength: 200, on: { change: e => {
          const v = e.target.value.trim(), dup = E.data.settings.topics.some((x, j) => j != i && x.toLocaleLowerCase() == v.toLocaleLowerCase());
          e.target.classList.toggle("lt-bad", !v || dup);
          if (v && !dup) save(n => {
            const old = n.topics[i];
            n.topics[i] = v;
            if (n.topicColors[old]) { n.topicColors[v] = n.topicColors[old]; delete n.topicColors[old]; }
            for (const k of ["topicMonthGoals", "topicWeekGoals", "topicStreakGoals"]) for (const g of n[k]) if (g.topic.toLocaleLowerCase() == old.toLocaleLowerCase()) g.topic = v;
          });
        } } }),
        h("button", { class: "lt-x", title: t("Удалить тему"), text: "×", disabled: S.topics.length == 1, on: { click: () => save(n => { delete n.topicColors[n.topics[i]]; n.topics.splice(i, 1); }).then(render) } }),
        colorOpen === tp && h("div", { class: "lt-palette" }, [...Object.entries(COLORS), [null, null]].map(([k, hex]) => h("button", { class: "lt-swatch" + (k ? "" : " lt-swatch-none") + ((S.topicColors[tp] ?? null) == k ? " on" : ""),
          title: k ? COLOR_NAMES()[k] : t("Без цвета"), "aria-label": k ? COLOR_NAMES()[k] : t("Без цвета"), style: hex ? `background:${hex}` : null,
          on: { click: () => { colorOpen = null; save(n => (k ? (n.topicColors[tp] = k) : delete n.topicColors[tp])).then(render); } } })))))),
      h("button", { class: "lt-add", text: t("+ Тема"), on: { click: () => save(n => {
        let k = n.topics.length + 1;
        while (n.topics.some(x => x.toLocaleLowerCase() == t("Тема {0}", k).toLocaleLowerCase())) k++;
        n.topics.push(t("Тема {0}", k));
      }).then(render) } }),

      h("h3", { text: t("Звук и уведомления") }),
      toggle(t("Звук"), S.sound, v => save(n => (n.sound = v))),
      field(t("Сигнал"), select(E.SOUND_PRESETS.map(k => [k, t("Сигнал {0}", k)]), S.soundPreset, v => save(n => (n.soundPreset = v)))),
      h("div", { class: "lt-field" }, h("span", { text: t("Свой файл (заменяет сигнал)") }),
        h("div", { class: "lt-row" },
          h("span", { class: "lt-file", title: S.soundFile, text: S.soundFile ? S.soundFile.split(/[\\/]/).pop() : t("не выбран") }),
          h("button", { text: t("Выбрать…"), on: { click: pickSound } }),
          S.soundFile && h("button", { class: "lt-x", title: t("Убрать файл"), text: "×", on: { click: () => save(n => (n.soundFile = "")).then(render) } }))),
      field(t("Громкость: {0}%", S.volume), h("input", { type: "range", min: 0, max: 100, step: 5, value: S.volume,
        on: { input: e => (e.target.previousSibling.textContent = t("Громкость: {0}%", e.target.value)), change: e => save(n => (n.volume = Number(e.target.value))) } })),
      h("div", { class: "lt-row" }, h("button", { text: t("▶ Проверить звук"), on: { click: () => E.playSound() } }), // играет выбранный сигнал
        h("button", { text: t("Проверить уведомление"), on: { click: () => E.notify(t("Уведомления LumiTime работают.")) } })),
      toggle(t("Системные уведомления"), S.systemNotifications, v => save(n => (n.systemNotifications = v)), t("Когда время фокуса или перерыва вышло")),

      goalSettings(t("Цели на серию дней"), "streakGoalsEnabled", "streakGoalHours", "topicStreakGoals"),
      h("div", { class: "lt-row" }, h("span", { class: "lt-dim", text: t("Серия — дни подряд с фокусом.") }),
        confirmButton(t("Сбросить серию"), t("Точно сбросить?"), () => { E.endStreak(); render(); })),
      goalSettings(t("Цели на неделю (пн–вс)"), "weekGoalsEnabled", "weekGoalHours", "topicWeekGoals"),
      goalSettings(t("Цели на месяц"), "monthGoalsEnabled", "monthGoalHours", "topicMonthGoals"),

      h("h3", { text: t("Каждый день"), "data-section": "daily" }),
      toggle(t("Показывать «Каждый день»"), S.dailyEnabled, v => save(n => (n.dailyEnabled = v)), t("Ежедневные задачи в окне LumiTime и их статистика")),
      dailyBox = h("div", { class: "lt-dl" }),

      h("h3", { text: t("Блок сайтов без пресета") }),
      h("p", { class: "lt-dim", text: t("Блок настраивается у каждого пресета (выше, «Блок сайтов»). Здесь — для таймера «Свой», когда длительности выбраны вручную.") }),
      blockEditor(S, -1),

      h("p", { class: "lt-dim", text: t("Файлы: {0}", store.path("time")) }),
    );
  }
  // блок сайтов пресета i (или «Свой», i = -1): вкл/выкл, «и в перерывах», список
  function blockEditor(S, i) {
    const b = i < 0 ? { enabled: S.blockEnabled, sites: S.blockSites, breaks: S.blockBreaks } : S.presets[i].block;
    const set = (n, k, v) => (i < 0 ? (n[{ enabled: "blockEnabled", sites: "blockSites", breaks: "blockBreaks" }[k]] = v) : (n.presets[i].block[k] = v));
    return h("div", { class: "lt-block-body" },
      toggle(t("Блокировать сайты"), b.enabled, v => save(n => set(n, "enabled", v)).then(() => i >= 0 && render()),
        t("Пока идёт фокус (не пауза), эти сайты и их поддомены открываются заглушкой «Фокус — вернись после чч:мм»")),
      toggle(t("Блокировать и в перерывах"), b.breaks, v => save(n => set(n, "breaks", v)), t("Строгий режим: сайты закрыты и во время перерыва. Выключено — только во время фокуса")),
      h("textarea", { class: "lt-sites", rows: 4, placeholder: "youtube.com\nreddit.com", value: b.sites.join("\n"),
        on: { change: e => save(n => set(n, "sites", e.target.value.split(/[\s,]+/).map(E.normDomain).filter(Boolean)))
          .then(() => (e.target.value = (i < 0 ? E.data.settings.blockSites : E.data.settings.presets[i].block.sites).join("\n"))) } }));
  }
  function goalSettings(title, onKey, totalKey, topicsKey) {
    const S = E.data.settings;
    return h("div", { class: "lt-goal-settings" },
      h("h3", { text: title }),
      toggle(t("Показывать цели"), S[onKey], v => save(n => (n[onKey] = v)).then(render)),
      S[onKey] && h("div", { class: "lt-rows" },
        h("div", { class: "lt-row" }, h("span", { class: "lt-row-label", text: t("Всего, ч") }),
          num(S[totalKey], 0.25, 744, 0.25, v => (v === null || E.validGoalHours(v)) && !void save(n => (n[totalKey] = v)), "lt-num lt-wide")),
        S[topicsKey].map((g, i) => h("div", { class: "lt-row" },
          h("input", { type: "text", value: g.topic, list: topicList(), on: { change: e => {
            const v = e.target.value.trim(), dup = E.data.settings[topicsKey].some((x, j) => j != i && x.topic.toLocaleLowerCase() == v.toLocaleLowerCase());
            e.target.classList.toggle("lt-bad", !v || dup);
            if (v && !dup) save(n => (n[topicsKey][i].topic = v));
          } } }),
          num(g.hours, 0.25, 744, 0.25, v => E.validGoalHours(v) && !void save(n => (n[topicsKey][i].hours = v))),
          h("span", { class: "lt-dim", text: t("ч") }),
          h("button", { class: "lt-x", title: t("Удалить цель"), text: "×", on: { click: () => save(n => n[topicsKey].splice(i, 1)).then(render) } }))),
        h("button", { class: "lt-add", text: t("+ Цель по теме"), on: { click: () => save(n => {
          const used = new Set(n[topicsKey].map(x => x.topic.toLocaleLowerCase()));
          n[topicsKey].push({ topic: n.topics.find(x => !used.has(x.toLocaleLowerCase())) ?? t("Тема {0}", n[topicsKey].length + 1), hours: 1 });
        }).then(render) } })));
  }
  function pickSound() {
    const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window.browsingContext, t("Звук LumiTime"), Ci.nsIFilePicker.modeOpen);
    fp.appendFilter(t("Аудио"), "*.mp3;*.wav;*.ogg;*.oga;*.m4a;*.aac;*.flac;*.opus;*.webm");
    fp.open(rv => { if (rv == Ci.nsIFilePicker.returnOK && fp.file) save(n => (n.soundFile = fp.file.path)).then(render); });
  }
  const renderDaily = () => { closeIconPicker(); dailyEditor(dailyBox); };
  render();
  renderDaily();
  return { update(kind) { if (kind == "load") { render(); renderDaily(); } else if (kind == "daily") renderDaily(); } };
}

// ---------- Настройки: «Каждый день» (список задач: добавить, переименовать, удалить, порядок перетаскиванием, значок) ----------
function dailyEditor(box) {
  const { daily, dailyError, dailyWriteError } = E.data;
  const hadFocus = box.querySelector(".lt-daily-new") == document.activeElement;
  const add = h("input", { type: "text", class: "lt-daily-new", placeholder: t("Новая задача — Enter"), maxLength: 200, "aria-label": t("Новая ежедневная задача"),
    on: { keydown: e => { if (e.key == "Enter" && e.target.value.trim()) E.dailyAdd(e.target.value); } } });
  const list = h("div", { class: "lt-dl-list" }, daily.tasks.map(k => {
    const del = confirmButton("×", t("Стереть?"), () => E.dailyRemove(k.id), "lt-x");
    del.title = t("Удалить задачу вместе с историей отметок (нажми дважды)");
    const slot = h("button", { class: "lt-dl-icon", title: t("Значок задачи"), "aria-label": t("Значок задачи"), on: { click: () => iconPicker(slot, k) } },
      dailyIcon(k.icon) ?? h("span", { class: "lt-dl-noicon" }));
    const grip = h("span", { class: "lt-dl-grip", text: "⋮⋮", title: t("Перетащи, чтобы изменить порядок") });
    grip.addEventListener("pointerdown", e => dragRow(e, row, list, k.id));
    const row = h("div", { class: "lt-row lt-dl-row", "data-id": k.id }, grip, slot,
      h("input", { type: "text", class: "lt-grow", value: k.name, maxLength: 200, "aria-label": t("Название задачи"),
        on: { change: e => { if (!E.dailyRename(k.id, e.target.value)) e.target.value = k.name; } } }), del);
    return row;
  }));
  box.replaceChildren(...[dailyError && h("p", { class: "lt-error", text: dailyError }), dailyWriteError && h("p", { class: "lt-error", text: t("Не сохранилось: {0}", dailyWriteError) }),
    !daily.tasks.length && !dailyError && h("p", { class: "lt-dim", text: t("Задач нет — добавь то, что повторяется каждый день") }), list, !dailyError && add].filter(Boolean));
  if (hadFocus) add.focus();
}
// перетаскивание за ручку: строка двигается в списке прямо по ходу (DOM), в движок порядок пишется один раз при отпускании
function dragRow(e, row, list, id) {
  if (e.button) return;
  e.preventDefault();
  const doc = row.ownerDocument, from = [...list.children].indexOf(row); // слушаем документ, а не ручку: курсор уходит за её пределы
  row.classList.add("lt-dl-drag");
  const move = ev => {
    const others = [...list.children].filter(r => r != row);
    const next = others.find(r => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
    if (next) list.insertBefore(row, next); else list.append(row);
  };
  const end = ev => {
    doc.removeEventListener("pointermove", move); doc.removeEventListener("pointerup", end); doc.removeEventListener("pointercancel", end);
    row.classList.remove("lt-dl-drag");
    const to = [...list.children].indexOf(row);
    if (ev.type != "pointercancel" && to != from) E.dailyReorder(id, to);
  };
  doc.addEventListener("pointermove", move); doc.addEventListener("pointerup", end); doc.addEventListener("pointercancel", end);
}
// выбор значка: небольшое окошко-сетка у кнопки; клик мимо и Esc закрывают
let iconPop = null;
function closeIconPicker() {
  iconPop?.remove(); iconPop = null;
  document.removeEventListener("pointerdown", iconOutside, true); document.removeEventListener("keydown", iconEsc, true);
}
const iconOutside = e => { if (iconPop && !iconPop.contains(e.target)) closeIconPicker(); };
const iconEsc = e => { if (e.key == "Escape" && iconPop) { e.preventDefault(); e.stopPropagation(); closeIconPicker(); } };
function iconPicker(anchor, task) {
  const was = iconPop && iconPop.dataset.id == task.id;
  closeIconPicker();
  if (was) return;
  const pick = id => { closeIconPicker(); E.dailySetIcon(task.id, id); };
  iconPop = h("div", { class: "lt-icon-pop", role: "dialog", "aria-label": t("Значок задачи"), "data-id": task.id },
    h("button", { class: "lt-icon-none" + (task.icon ? "" : " on"), text: t("Без значка"), on: { click: () => pick("") } }),
    h("div", { class: "lt-icon-grid" }, Object.keys(ICONS).map(id => h("button", { class: "lt-icon-cell" + (task.icon == id ? " on" : ""), "data-icon": id, "aria-label": id, /* без title: id — английское имя, подсказка без перевода хуже, чем никакой */ on: { click: () => pick(id) } }, dailyIcon(id)))));
  document.body.append(iconPop);
  const r = anchor.getBoundingClientRect(), w = iconPop.offsetWidth, hh = iconPop.offsetHeight;
  iconPop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
  iconPop.style.top = Math.max(8, r.bottom + 6 + hh > innerHeight - 8 ? r.top - hh - 6 : r.bottom + 6) + "px";
  document.addEventListener("pointerdown", iconOutside, true); document.addEventListener("keydown", iconEsc, true);
}

// ---------- Статистика ----------
function statsView(root) {
  let period = "week", at = new Date(E.now());
  const chart = st => {
    const W = 640, H = 220, L = 34, B = 22, T = 8, max = Math.max(0, ...st.buckets.map(b => b.focusMs + b.breakMs));
    const ticks = E.chartYAxisTicks(max, period), top = ticks.at(-1) * 3600000, y = ms => H - B - (H - B - T) * ms / top;
    const bw = (W - L) / st.buckets.length, gap = Math.min(6, bw * 0.25);
    return s("svg", { viewBox: `0 0 ${W} ${H}`, class: "lt-chart", role: "img", "aria-label": t("График фокуса и перерывов") },
      ticks.map(tk => s("g", {}, s("line", { x1: L, x2: W, y1: y(tk * 3600000), y2: y(tk * 3600000), class: "lt-grid" }),
        s("text", { x: L - 6, y: y(tk * 3600000) + 4, "text-anchor": "end", class: "lt-axis" }, t("{0} ч", tk)))),
      st.buckets.map((b, i) => {
        const x = L + i * bw + gap / 2, w = bw - gap;
        return s("g", { class: "lt-bar" },
          s("title", {}, t("{0}: фокус {1}, перерывы {2}", b.label, hm(b.focusMs), hm(b.breakMs))),
          b.focusMs > 0 && s("rect", { x, width: w, y: y(b.focusMs), height: H - B - y(b.focusMs), rx: 3, class: "lt-bar-focus" }),
          b.breakMs > 0 && s("rect", { x, width: w, y: y(b.focusMs + b.breakMs), height: y(b.focusMs) - y(b.focusMs + b.breakMs), rx: 3, class: "lt-bar-break" }),
          (period != "month" || i % 2 == 0 || st.buckets.length < 20) && s("text", { x: x + w / 2, y: H - 6, "text-anchor": "middle", class: "lt-axis" }, b.label));
      }));
  };
  function render() {
    const st = E.buildStatistics(E.data.records, period, at), maxTopic = st.topics[0]?.[1] ?? 0;
    const go = dir => { at = E.shiftStatisticsDate(at, period, dir); render(); };
    fill(root, 
      h("div", { class: "lt-seg" }, [["week", t("Неделя")], ["month", t("Месяц")], ["year", t("Год")]].map(([p, lb]) =>
        h("button", { text: lb, "aria-pressed": String(p == period), on: { click: () => { period = p; render(); } } }))),
      h("div", { class: "lt-period" }, h("button", { class: "lt-nav-arrow", title: t("Назад"), text: "‹", on: { click: () => go(-1) } }),
        h("b", { class: "lt-period-title", text: st.title }),
        h("button", { class: "lt-nav-arrow", title: t("Вперёд"), text: "›", on: { click: () => go(1) } }),
        h("button", { class: "lt-link", text: t("Сейчас"), on: { click: () => { at = new Date(E.now()); render(); } } })),
      h("div", { class: "lt-cards" },
        [[t("Фокус"), clockOf(st.focusMs)], [t("Перерывы"), clockOf(st.breakMs)], [t("Сессий фокуса"), String(st.focusSessions)],
          [t("Средняя сессия"), clockOf(st.averageFocusMs)], [t("Дней с фокусом"), String(st.focusDays)]]
          .map(([k, v], i) => h("div", { class: `lt-card${i == 0 ? " lt-card-main" : ""}` }, h("small", { text: k }), h("b", { text: v })))),
      chart(st),
      h("div", { class: "lt-legend" }, h("span", { class: "lt-key-focus", text: t("Фокус") }), h("span", { class: "lt-key-break", text: t("Перерывы") })),
      h("h3", { text: t("По темам") }),
      st.topics.length ? h("div", { class: "lt-topics" }, st.topics.map(([tp, ms]) => h("div", { class: "lt-topic" },
        topicTag(tp), h("span", { class: "lt-dim", text: `${clockOf(ms)} · ${Math.round(ms / st.focusMs * 100)}%` }),
        h("div", { class: "lt-goal-track" }, h("div", { class: "lt-goal-fill", style: `width:${ms / maxTopic * 100}%${topicColor(tp) ? `;background:${topicColor(tp)}` : ""}` })))))
        : h("p", { class: "lt-dim", text: t("За этот период фокуса нет.") }),
      goalsBlock("streak", t("Цели на серию")), goalsBlock("week", t("Цели на неделю")), goalsBlock("month", t("Цели на месяц")),
      dailyStatsBlock(),
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
    const type = select([["Focus", t("Фокус")], ["Break", t("Перерыв")]], "Focus", v => (topic.hidden = v != "Focus"));
    const topic = h("input", { type: "text", maxLength: 200, list: topicList(), placeholder: t("Тема"), value: S.selection.topic.trim() || S.settings.topics[0] || "" });
    const hours = h("input", { type: "number", class: "lt-num", min: 0, max: 23, step: 1, value: 0, title: t("часы") });
    const mins = h("input", { type: "number", class: "lt-num", min: 0, max: 59, step: 1, value: 25, title: t("минуты") });
    const add = () => {
      const ms = (Number(hours.value) * 60 + Number(mins.value)) * 60000;
      const ok = Number.isInteger(Number(hours.value)) && Number.isInteger(Number(mins.value)) && ms > 0 && ms <= 24 * 3600000;
      mins.classList.toggle("lt-bad", !ok);
      if (ok) E.addManual(type.value, topic.value, ms);
    };
    fill(root, 
      h("div", { class: "lt-box" },
        h("div", { class: "lt-row" },
          h("span", { class: "lt-grow", text: last ? (last.kind == "Focus" ? t("Последняя: {0} · {1} · {2}", KIND()[last.kind], topicName(last.topic), clockOf(E.countedRecordMs(last))) : t("Последняя: {0} · {1}", KIND()[last.kind], clockOf(E.countedRecordMs(last)))) : t("Записей пока нет") }),
          h("button", { title: t("Убрать минуту у последней записи"), text: t("−1 мин"), disabled: !last || !E.adjustRecordDuration(last, -1), on: { click: () => E.adjust(-1) } }),
          h("button", { title: t("Добавить минуту к последней записи"), text: t("+1 мин"), disabled: !last, on: { click: () => E.adjust(1) } })),
        S.state.phase != "idle" && h("small", { class: "lt-dim", text: t("Пока идёт цикл, ± в кольце правят его время; здесь — последняя запись журнала.") })),
      h("div", { class: "lt-box" }, h("b", { text: t("Добавить время вручную") }),
        h("div", { class: "lt-row lt-manual" }, type, topic, hours, h("span", { text: t("ч") }), mins, h("span", { text: t("мин") }),
          h("button", { class: "lt-primary", text: t("Добавить"), on: { click: add } }))),
      S.journalError && h("p", { class: "lt-error", text: S.journalError }),
      S.writeError && h("p", { class: "lt-error", text: t("Запись не удалась: {0}. Записи ({1}) ждут.", S.writeError, E.pendingCount()) }),
      E.pendingCount() > 0 && h("button", { text: t("Повторить запись ({0})", E.pendingCount()), on: { click: () => E.flushJournal() } }),
      days.length ? days.slice(0, shown).map(d => h("div", { class: "lt-day" },
        h("div", { class: "lt-day-head" }, h("b", { text: dateTitle(d.date, { weekday: "short", day: "numeric", month: "long", year: "numeric" }) }),
          h("span", { class: "lt-dim", text: d.breakMs ? t("фокус {0} · перерывы {1}", clockOf(d.focusMs), clockOf(d.breakMs)) : t("фокус {0}", clockOf(d.focusMs)) })),
        h("table", { class: "lt-table" },
          h("thead", {}, h("tr", {}, [t("Тип"), t("Режим"), t("Тема"), t("Время"), t("Пауза"), t("Итог")].map(lb => h("th", { text: lb })))),
          h("tbody", {}, d.rows.map(({ record: r, ms, pausedMs }) => h("tr", { class: r.kind == "Focus" ? "lt-row-focus" : "" },
            h("td", { text: KIND()[r.kind] }), h("td", { text: r.manual ? t("{0} · вручную", MODE()[r.timerMode ?? "Countdown"]) : MODE()[r.timerMode ?? "Countdown"] }),
            r.kind == "Focus" ? topicTag(r.topic, "td") : h("td", { text: "—" }), h("td", { text: clockOf(ms) }),
            h("td", { text: pausedMs ? clockOf(pausedMs) : "—" }), h("td", { text: RESULT()[r.result] })))))))
        : h("p", { class: "lt-dim", text: t("Журнал пуст. Сессии от 3 минут записываются сами; короче — можно добавить вручную.") }),
      days.length > shown && h("button", { class: "lt-add", text: t("Показать ещё"), on: { click: () => { shown += 14; render(); } } }),
      h("p", { class: "lt-dim", text: t("Файл: {0}", store.path("time/journal.json")) }),
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
      if (v && !valid(v)) throw new Error(t("неизвестный формат"));
      if (d == date) day = v ?? empty(d);
    } catch (e) { error = t("Файл дня не читается ({0}): {1}. Он не будет перезаписан.", E.dayFile(d), e.message ?? e); }
    render();
  }
  const save = () => {
    const snap = plain(day), rel = E.dayFile(snap.date);
    saving = saving.then(() => store.writeJSON(rel, snap)).catch(e => { error = t("Не сохранилось: {0}", e.message ?? e); render(); });
    return saving;
  };
  const change = fn => { fn(day); save(); render(); };
  function render() {
    const today = E.localDate(E.now()), focus = E.journalDays().find(d => d.date == date);
    const done = day ? day.tasks.filter(t => t.done).length : 0, total = day?.tasks.length ?? 0, pct = total ? Math.round(done / total * 100) : 0;
    const newTask = h("input", { type: "text", class: "lt-grow", placeholder: t("Новая задача — Enter"), maxLength: 500,
      on: { keydown: e => { if (e.key == "Enter" && newTask.value.trim()) { const text = newTask.value.trim(); change(d => d.tasks.push({ id: crypto.randomUUID(), text, done: false })); root.querySelector(".lt-new-task")?.focus(); } } } });
    newTask.classList.add("lt-new-task");
    const note = h("textarea", { rows: 3, placeholder: t("Комментарий к дню… (Ctrl+Enter — добавить)"), maxLength: 4000,
      on: { keydown: e => { if (e.key == "Enter" && e.ctrlKey) addNote(); } } });
    const addNote = () => { const text = note.value.trim(); if (text) change(d => d.comments.push({ id: crypto.randomUUID(), text, at: E.now() })); };
    fill(root, 
      h("div", { class: "lt-period" },
        h("button", { class: "lt-nav-arrow", title: t("Предыдущий день"), text: "‹", on: { click: () => load(E.shiftDate(date, -1)) } }),
        h("b", { class: "lt-period-title", text: dateTitle(date, { weekday: "long", day: "numeric", month: "long" }) + (date == today ? t(" · сегодня") : "") }),
        h("button", { class: "lt-nav-arrow", title: t("Следующий день"), text: "›", on: { click: () => load(E.shiftDate(date, 1)) } }),
        date != today && h("button", { class: "lt-link", text: t("Сегодня"), on: { click: () => load(today) } })),
      h("div", { class: "lt-cards" },
        h("div", { class: "lt-card lt-card-main" }, h("small", { text: t("Задачи") }), h("b", { text: `${done} / ${total}` }),
          h("div", { class: "lt-goal-track" }, h("div", { class: "lt-goal-fill", style: `width:${pct}%` }))),
        h("div", { class: "lt-card" }, h("small", { text: t("Фокус за день") }), h("b", { text: clockOf(focus?.focusMs ?? 0) }))),
      error && h("p", { class: "lt-error", text: error }),
      day && h("h3", { text: t("Задачи") }),
      day && h("ul", { class: "lt-tasks" }, day.tasks.map((tk, i) => h("li", { class: tk.done ? "lt-done" : "" },
        h("label", {}, h("input", { type: "checkbox", checked: tk.done, on: { change: e => { E.playCheckSound(e.target.checked); change(d => (d.tasks[i].done = e.target.checked)); } } }),
          h("span", { text: tk.text })),
        h("button", { class: "lt-x", title: t("Удалить задачу"), text: "×", on: { click: () => change(d => d.tasks.splice(i, 1)) } })))),
      day && h("div", { class: "lt-row" }, newTask),
      day && h("h3", { text: t("Комментарии") }),
      day && h("div", { class: "lt-comments" }, day.comments.map((c, i) => h("div", { class: "lt-comment" },
        h("small", { class: "lt-dim", text: new Date(c.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) }),
        h("p", { text: c.text }),
        h("button", { class: "lt-x", title: t("Удалить комментарий"), text: "×", on: { click: () => change(d => d.comments.splice(i, 1)) } })))),
      day && note,
      day && h("button", { class: "lt-add", text: t("Добавить комментарий"), on: { click: addNote } }),
    );
  }
  root.lumiDay = { load: d => load(d), get: () => day, saved: () => saving }; // для проверок
  load(date);
  return { update(kind) { if (kind == "journal" && !root.contains(document.activeElement)) render(); } };
}

const VIEWS = { settings: settingsView, stats: statsView, journal: journalView, day: dayView };
