// ==UserScript==
// @name           Luminoctis: LumiTime (движок)
// @description    Фокус-таймер LumiTime (порт плагина Obsidian «Focus Cycle Timer»): фокус → перерыв → длинный перерыв, журнал, статистика, цели. Один на всё приложение — идёт, даже когда Home закрыта или выгружена.
// ==/UserScript==

// Один экземпляр (chrome://userscripts/content/lumi-time.sys.mjs): его берут страница Home (home/time*.js) и блок сайтов (js/lumi-focus.uc.js).
// Сам движок не тикает каждую секунду: время считается из отметок (как в плагине), один таймер — на момент «время вышло»,
// второй — сохранение состояния раз в 15 с, пока цикл идёт. Интерфейс тикает сам, пока страница видна.
// Данные (папка Home, home/store.js): time/settings.json, time/state.json (идущий цикл, выбор, неотписанные записи), time/journal.json.
// Записи журнала — тот же формат, что у плагина (kind Focus/Break/Long break, Countdown/Stopwatch, Completed/Stopped); подписи — в интерфейсе.
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";

import { pageUrl } from "./lumi-paths.sys.mjs";
const { t, locale } = ChromeUtils.importESModule(new URL("lumi-i18n.sys.mjs", import.meta.url).href);
import { shiftDate, emptyDaily, normDaily, applyMark, dailyStats, moveTask, setTaskIcon } from "./lumi-time-daily.sys.mjs"; // ежедневные задачи: чистая логика отдельно (проверка в node)
export { shiftDate, dailyStats, cycleMark, toggleMark } from "./lumi-time-daily.sys.mjs";
const STORE_URL = pageUrl("home/store.js");
const store = () => ChromeUtils.importESModule(STORE_URL);
const FILES = { settings: "time/settings.json", state: "time/state.json", journal: "time/journal.json", daily: "time/daily.json" };
export const dayFile = date => `time/days/${date}.json`;
const MIN = 60000;
const STATE_VERSION = 3;
const uuid = () => Services.uuid.generateUUID().toString().slice(1, -1);

// ---------- часы (подменяются в проверках) ----------
let clock = () => Date.now();
export const now = () => clock();
export function setClock(fn) { clock = fn || (() => Date.now()); schedule(); }

// ---------- ядро (core.ts) ----------
function idleState(completedFocuses = 0) {
  return { version: STATE_VERSION, phase: "idle", startedAt: 0, plannedMs: 0, adjustmentMs: 0,
    runningSince: null, pausedSince: null, active: [], pauses: [],
    acceptedOvertime: false, notified: false, topic: "", pair: { focus: 25, rest: 5 },
    longBreak: 20, every: 4, completedFocuses };
}
const intervals = v => Array.isArray(v) && v.every(r => Array.isArray(r) && r.length == 2 && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] >= r[0]);
function isTimerState(v) {
  return !!v && typeof v == "object" && [1, 2, 3].includes(v.version) && ["idle", "focus", "break", "long-break"].includes(v.phase)
    && Number.isFinite(v.startedAt) && Number.isFinite(v.plannedMs) && v.plannedMs >= 0
    && (v.adjustmentMs === undefined || Number.isSafeInteger(v.adjustmentMs))
    && (v.runningSince === null || Number.isFinite(v.runningSince)) && (v.pausedSince === null || Number.isFinite(v.pausedSince))
    && intervals(v.active) && intervals(v.pauses) && typeof v.acceptedOvertime == "boolean" && typeof v.notified == "boolean"
    && typeof v.topic == "string" && !!v.pair && Number.isFinite(v.pair.focus) && Number.isFinite(v.pair.rest)
    && Number.isFinite(v.longBreak) && Number.isInteger(v.every) && v.every > 0
    && Number.isInteger(v.completedFocuses) && v.completedFocuses >= 0
    && (v.timerMode === undefined || v.timerMode == "Countdown" || v.timerMode == "Stopwatch");
}
function restoreTimerState(v) {
  if (!isTimerState(v)) return null;
  if (v.version == STATE_VERSION) return v;
  return { ...v, version: STATE_VERSION, timerMode: v.timerMode ?? "Countdown",
    acceptedOvertime: v.version == 1 && v.phase != "idle" ? true : v.acceptedOvertime };
}
function activeMs(s, t) {
  return s.active.reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0) + (s.runningSince === null ? 0 : Math.max(0, t - s.runningSince));
}
export const elapsedMs = (s, t) => Math.max(0, activeMs(s, t) + (s.adjustmentMs ?? 0));
export function countedMs(s, t) { const e = elapsedMs(s, t); return s.acceptedOvertime ? e : Math.min(e, s.plannedMs); }

function creditedIntervals(active, plannedMs, acceptedOvertime, adjustmentMs, endedAt) {
  let remaining = Math.max(0, active.reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0) + adjustmentMs);
  if (!acceptedOvertime) remaining = Math.min(remaining, plannedMs);
  const out = [];
  for (const [a, b] of active) {
    const len = Math.min(Math.max(0, b - a), remaining);
    if (len > 0) out.push([a, a + len]);
    remaining -= len;
    if (remaining <= 0) break;
  }
  if (remaining > 0) out.push([endedAt - remaining, endedAt]);
  return out;
}
function countedInRange(s, t, from, to) {
  const list = [...s.active];
  if (s.runningSince !== null) list.push([s.runningSince, Math.max(t, s.runningSince)]);
  let total = 0;
  for (const [a, b] of creditedIntervals(list, s.plannedMs, s.acceptedOvertime, s.adjustmentMs ?? 0, t)) total += Math.max(0, Math.min(b, to) - Math.max(a, from));
  return total;
}
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d; };
export function countedTodayMs(s, t) {
  if (s.phase != "focus") return 0;
  const a = dayStart(t), b = new Date(a); b.setDate(b.getDate() + 1);
  return countedInRange(s, t, a.getTime(), b.getTime());
}
function countedWeekMs(s, t) {
  if (s.phase != "focus") return 0;
  const a = dayStart(t); a.setDate(a.getDate() - (a.getDay() + 6) % 7);
  const b = new Date(a); b.setDate(b.getDate() + 7);
  return countedInRange(s, t, a.getTime(), b.getTime());
}
export function countedMonthMs(s, t) {
  if (s.phase != "focus") return 0;
  const a = dayStart(t); a.setDate(1);
  const b = new Date(a); b.setMonth(b.getMonth() + 1);
  return countedInRange(s, t, a.getTime(), b.getTime());
}
export const countedSinceMs = (s, t, from) => (s.phase == "focus" ? countedInRange(s, t, from, t) : 0);

const pad = v => String(v).padStart(2, "0");
export function formatClock(ms) {
  const sec = Math.floor(Math.max(0, ms) / 1000), m = Math.floor(sec / 60), h = Math.floor(m / 60);
  return h ? `${pad(h)}:${pad(m % 60)}:${pad(sec % 60)}` : `${pad(m)}:${pad(sec % 60)}`;
}
// вид таймера: main — крупные цифры, extra — «+мм:сс не в зачёт», progress — доля кольца
export function display(s, at) {
  if (s.phase == "idle") return { main: "00:00", extra: "", progress: 1 };
  const e = elapsedMs(s, at);
  if (s.timerMode == "Stopwatch") return { main: formatClock(e), extra: "", progress: 1 };
  const over = Math.max(0, e - s.plannedMs);
  return {
    main: over > 0 && s.acceptedOvertime ? `+${formatClock(over)}` : formatClock(Math.max(0, s.plannedMs - e)),
    extra: over > 0 && !s.acceptedOvertime ? t("+{0} не в зачёт", formatClock(over)) : "",
    progress: Math.max(0, 1 - e / s.plannedMs),
  };
}
function startFocus(prev, t, pair, longBreak, every, topic, timerMode = "Countdown") {
  return { ...idleState(prev.completedFocuses), phase: "focus", startedAt: t, acceptedOvertime: true, timerMode,
    plannedMs: timerMode == "Stopwatch" ? 0 : pair.focus * MIN, runningSince: t, topic: topic.trim() || "Фокус", // l10n-skip: хранимая тема по умолчанию
    pair: { ...pair }, longBreak, every };
}
function startBreak(prev, t) {
  if (prev.phase != "focus") throw new Error("Фокус не идёт"); // l10n-skip
  const count = prev.completedFocuses + 1, long = count >= prev.every;
  return { ...idleState(long ? 0 : count), phase: long ? "long-break" : "break", acceptedOvertime: true,
    startedAt: t, plannedMs: (long ? prev.longBreak : prev.pair.rest) * MIN,
    runningSince: t, pair: { ...prev.pair }, longBreak: prev.longBreak, every: prev.every };
}
function startStopwatchSegment(prev, t, phase, topic = "") {
  return { ...idleState(prev.completedFocuses), phase, startedAt: t, plannedMs: 0, runningSince: t,
    acceptedOvertime: true, timerMode: "Stopwatch", topic: phase == "focus" ? topic.trim() || "Фокус" : "", // l10n-skip
    pair: { ...prev.pair }, longBreak: prev.longBreak, every: prev.every };
}
export function pause(s, t) {
  if (s.phase == "idle" || s.runningSince === null) return;
  s.active.push([s.runningSince, Math.max(t, s.runningSince)]);
  s.runningSince = null;
  s.pausedSince = t;
}
export function resume(s, t) {
  if (s.phase == "idle" || s.pausedSince === null) return;
  s.pauses.push([s.pausedSince, Math.max(t, s.pausedSince)]);
  s.pausedSince = null;
  s.runningSince = t;
}
function uncountOvertime(s, t) { if (s.phase != "idle" && elapsedMs(s, t) >= s.plannedMs) s.acceptedOvertime = false; }
function adjustElapsed(s, t, minutes) {
  if (s.phase == "idle") return false;
  const e = elapsedMs(s, t);
  if (minutes < 0 && e < MIN) return false;
  s.adjustmentMs = (s.adjustmentMs ?? 0) + minutes * MIN;
  if (e >= s.plannedMs && elapsedMs(s, t) < s.plannedMs) s.notified = false;
  return true;
}
export function finish(s, t, result, id, timezoneOffset) {
  if (s.phase == "idle") throw new Error("Цикл не идёт"); // l10n-skip
  const active = [...s.active], pauses = [...s.pauses];
  if (s.runningSince !== null) active.push([s.runningSince, Math.max(t, s.runningSince)]);
  if (s.pausedSince !== null) pauses.push([s.pausedSince, Math.max(t, s.pausedSince)]);
  return { version: 1, id, kind: s.phase == "focus" ? "Focus" : s.phase == "break" ? "Break" : "Long break",
    topic: s.phase == "focus" ? s.topic.trim() || "Фокус" : "", result, // l10n-skip
    startedAt: s.startedAt, endedAt: t, timezoneOffset,
    plannedMs: s.plannedMs, adjustmentMs: s.adjustmentMs ?? 0, acceptedOvertime: s.acceptedOvertime, active, pauses,
    timerMode: s.timerMode ?? "Countdown" };
}
function countedIntervals(r) {
  if (r.countedOverrideMs !== undefined) {
    const actual = r.active.reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0);
    return creditedIntervals(r.active, r.countedOverrideMs, true, r.countedOverrideMs - actual, r.endedAt);
  }
  return creditedIntervals(r.active, r.plannedMs, r.acceptedOvertime, r.adjustmentMs ?? 0, r.endedAt);
}
export const countedRecordMs = r => countedIntervals(r).reduce((sum, [a, b]) => sum + b - a, 0);
export function adjustRecordDuration(r, minutes) {
  const next = countedRecordMs(r) + minutes * MIN;
  if (!Number.isSafeInteger(next) || next < (r.manual ? 1 : 3 * MIN)) return null;
  return { ...r, countedOverrideMs: next };
}
// правило «≥3 мин»: короче — в журнал не идёт (кроме добавленных вручную)
const shouldLog = r => !!r.manual || countedRecordMs(r) >= 3 * MIN;
function isRecord(v) {
  return !!v && typeof v == "object" && v.version === 1 && typeof v.id == "string"
    && ["Focus", "Break", "Long break"].includes(v.kind) && typeof v.topic == "string" && ["Completed", "Stopped"].includes(v.result)
    && Number.isFinite(v.startedAt) && Number.isFinite(v.endedAt) && Number.isFinite(v.timezoneOffset) && Number.isFinite(v.plannedMs)
    && (v.adjustmentMs === undefined || Number.isSafeInteger(v.adjustmentMs))
    && (v.countedOverrideMs === undefined || (Number.isSafeInteger(v.countedOverrideMs) && v.countedOverrideMs >= 0))
    && typeof v.acceptedOvertime == "boolean" && (v.manual === undefined || typeof v.manual == "boolean")
    && (v.timerMode === undefined || v.timerMode == "Countdown" || v.timerMode == "Stopwatch")
    && intervals(v.active) && intervals(v.pauses);
}
const latestRecord = records => records.reduce((best, r) => (!best || r.endedAt >= best.endedAt ? r : best), null);

// ---------- настройки (settings.ts) ----------
export const validMinutes = v => Number.isInteger(v) && v >= 1 && v <= 720;
export const validCount = v => Number.isInteger(v) && v >= 1 && v <= 24;
export const validGoalHours = v => Number.isFinite(v) && v > 0 && v <= 744;
const validSoundFile = v => typeof v == "string" && v.length <= 1000 && /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)$/i.test(v.trim());
// «https://www.youtube.com/watch» → «youtube.com»; не домен — null
export function normDomain(v) {
  const d = String(v).trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/^(\*\.|www\.)/, "");
  return /^[^\s/:.]+(\.[^\s/:.]+)+$/.test(d) ? d : null;
}
// цвета тем — ключи палитры листов LumiNotes (COLORS в home/notes-md.mjs; хранится ключ, не hex)
export const TOPIC_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "gray"];
const DEFAULT_SETTINGS = {
  version: 1,
  pairs: [{ focus: 25, rest: 5 }, { focus: 45, rest: 10 }, { focus: 50, rest: 10 }, { focus: 60, rest: 15 }],
  longBreaks: [15, 20, 30], counts: [2, 3, 4, 6, 8],
  presets: [{ id: "classic", name: "Classic", pairIndex: 0, longBreak: 20, every: 4 }], // новые пользователи: английские имена (у старых в файле может быть «Классика» — показывается переведённой)
  topics: ["Study", "Work", "Reading"], topicColors: {},
  sound: true, soundPreset: "classic", soundFile: "", volume: 50, systemNotifications: true,
  monthGoalsEnabled: false, monthGoalHours: null, topicMonthGoals: [],
  weekGoalsEnabled: false, weekGoalHours: null, topicWeekGoals: [],
  streakGoalsEnabled: false, streakGoalHours: null, topicStreakGoals: [],
  dailyEnabled: true, // блок «Каждый день»
  // блок сайтов: у каждого пресета свой (presets[].block = { enabled, sites, breaks }); верхние поля — для режима «Свой» (без пресета)
  blockEnabled: false, blockSites: [], blockBreaks: false, // breaks: блокировать и в перерывах («строгий режим»)
};
function topicGoals(v) {
  return Array.isArray(v) ? v.filter(g => g && typeof g.topic == "string" && g.topic.trim() && validGoalHours(g.hours))
    .map(g => ({ topic: g.topic.trim(), hours: g.hours }))
    .filter((g, i, all) => all.findIndex(x => x.topic.toLocaleLowerCase() == g.topic.toLocaleLowerCase()) == i) : [];
}
export function loadSettings(data) {
  const raw = data && typeof data == "object" ? data : {}, D = DEFAULT_SETTINGS;
  const pairs = Array.isArray(raw.pairs) ? raw.pairs.filter(p => p && validMinutes(p.focus) && validMinutes(p.rest)).map(p => ({ focus: p.focus, rest: p.rest })) : [];
  const longBreaks = Array.isArray(raw.longBreaks) ? raw.longBreaks.filter(validMinutes) : [];
  const counts = Array.isArray(raw.counts) ? raw.counts.filter(validCount) : [];
  const topics = Array.isArray(raw.topics) ? raw.topics.filter(t => typeof t == "string" && t.trim()).map(t => t.trim()) : [];
  const bool = (k) => (typeof raw[k] == "boolean" ? raw[k] : D[k]);
  const sites = v => (Array.isArray(v) ? [...new Set(v.map(normDomain).filter(Boolean))] : []);
  // миграция: у пресета без block берётся прежний общий блок (список и «в перерывах» не теряются); новые пресеты создаются с block выкл.
  const blockOf = b => (b && typeof b == "object" ? { enabled: b.enabled === true, sites: sites(b.sites), breaks: b.breaks === true }
    : { enabled: bool("blockEnabled"), sites: sites(raw.blockSites), breaks: bool("blockBreaks") });
  const presets = Array.isArray(raw.presets) ? raw.presets.filter(p => p && typeof p.id == "string" && typeof p.name == "string"
    && Number.isInteger(p.pairIndex) && p.pairIndex >= 0 && p.pairIndex < (pairs.length || D.pairs.length)
    && validMinutes(p.longBreak) && validCount(p.every)).map(p => ({ id: p.id, name: p.name, pairIndex: p.pairIndex, longBreak: p.longBreak, every: p.every, block: blockOf(p.block) })) : [];
  const hours = k => (typeof raw[k] == "number" && validGoalHours(raw[k]) ? raw[k] : null);
  return {
    version: 1,
    pairs: pairs.length ? pairs : structuredClone(D.pairs),
    longBreaks: longBreaks.length ? [...new Set(longBreaks)] : [...D.longBreaks],
    counts: counts.length ? [...new Set(counts)] : [...D.counts],
    presets: presets.length ? presets : structuredClone(D.presets).map(p => ({ ...p, block: blockOf(null) })),
    topics: topics.length ? [...new Set(topics)] : [...D.topics],
    topicColors: Object.fromEntries(Object.entries(raw.topicColors && typeof raw.topicColors == "object" ? raw.topicColors : {}).filter(([k, v]) => k.trim() && TOPIC_COLORS.includes(v))),
    sound: bool("sound"),
    soundPreset: ["bell", "chime"].includes(raw.soundPreset) ? raw.soundPreset : "classic",
    soundFile: validSoundFile(raw.soundFile) ? raw.soundFile.trim() : "",
    volume: typeof raw.volume == "number" && raw.volume >= 0 && raw.volume <= 100 ? raw.volume : D.volume,
    systemNotifications: bool("systemNotifications"),
    monthGoalsEnabled: bool("monthGoalsEnabled"), monthGoalHours: hours("monthGoalHours"), topicMonthGoals: topicGoals(raw.topicMonthGoals),
    weekGoalsEnabled: bool("weekGoalsEnabled"), weekGoalHours: hours("weekGoalHours"), topicWeekGoals: topicGoals(raw.topicWeekGoals),
    streakGoalsEnabled: bool("streakGoalsEnabled"), streakGoalHours: hours("streakGoalHours"), topicStreakGoals: topicGoals(raw.topicStreakGoals),
    dailyEnabled: bool("dailyEnabled"),
    blockEnabled: bool("blockEnabled"), blockBreaks: bool("blockBreaks"),
    blockSites: sites(raw.blockSites),
  };
}

// ---------- даты, статистика (statistics.ts, log.ts) ----------
export const localDate = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// интервалы по дням (полночь делит сессию между днями; день — по поясу начала записи)
function addByDate(target, list, offset) {
  for (const [a, b] of list) {
    let cur = a;
    while (cur < b) {
      const shifted = cur - offset * MIN;
      const limit = Math.min(b, (Math.floor(shifted / 86400000) + 1) * 86400000 + offset * MIN);
      const day = new Date(shifted).toISOString().slice(0, 10);
      target.set(day, (target.get(day) ?? 0) + limit - cur);
      cur = limit;
    }
  }
}
function focusTimeByDateAndTopic(records, since = -Infinity) {
  const days = new Map();
  for (const r of records) {
    if (r.kind != "Focus") continue;
    const byDate = new Map();
    addByDate(byDate, countedIntervals(r).map(([a, b]) => [Math.max(a, since), b]).filter(([a, b]) => b > a), r.timezoneOffset);
    const topic = r.topic.trim() || "Фокус"; // l10n-skip
    for (const [date, ms] of byDate) {
      const topics = days.get(date) ?? new Map();
      topics.set(topic, (topics.get(topic) ?? 0) + ms);
      days.set(date, topics);
    }
  }
  return days;
}
const byTime = (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]);
function summarizeDays(days, include, streakDays = 0) {
  const totals = new Map();
  for (const [date, topics] of days) if (include(date)) for (const [t, ms] of topics) totals.set(t, (totals.get(t) ?? 0) + ms);
  const topics = [...totals].sort(byTime);
  return { totalMs: topics.reduce((s, [, ms]) => s + ms, 0), topics, days: streakDays };
}

export function chartYAxisTicks(maxMs, period) {
  const step = period == "year" ? 10 : 1;
  const max = Math.max(step, Math.ceil(Math.max(0, maxMs) / 3600000 / step) * step);
  return Array.from({ length: max / step + 1 }, (_, i) => i * step);
}
export function shiftStatisticsDate(date, period, dir) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  if (period == "year") return new Date(d.getFullYear() + dir, 0, 1, 12);
  if (period == "month") return new Date(d.getFullYear(), d.getMonth() + dir, 1, 12);
  d.setDate(d.getDate() + dir * 7);
  return d;
}
const fmt = (opts, d) => new Intl.DateTimeFormat(locale, opts).format(d);
function calendar(period, at) {
  const y = at.getFullYear(), m = at.getMonth(), next = d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  if (period == "year") {
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const from = new Date(y, i, 1);
      return { key: localDate(from).slice(0, 7), label: fmt({ month: "short" }, from).replace(".", ""), startDate: localDate(from), endDate: localDate(new Date(y, i + 1, 1)) };
    });
    return { startDate: `${y}-01-01`, endDate: `${y + 1}-01-01`, buckets, title: String(y) };
  }
  if (period == "month") {
    const count = new Date(y, m + 1, 0).getDate();
    const buckets = Array.from({ length: count }, (_, i) => {
      const from = new Date(y, m, i + 1);
      return { key: localDate(from), label: String(i + 1), startDate: localDate(from), endDate: localDate(next(from)) };
    });
    const title = fmt({ month: "long", year: "numeric" }, at).replace(/ г\.$/, "");
    return { startDate: localDate(new Date(y, m, 1)), endDate: localDate(new Date(y, m + 1, 1)), buckets, title: title[0].toUpperCase() + title.slice(1) };
  }
  const start = new Date(y, m, at.getDate());
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  const buckets = Array.from({ length: 7 }, (_, i) => {
    const from = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { key: localDate(from), label: fmt({ weekday: "short" }, from), startDate: localDate(from), endDate: localDate(next(from)) };
  });
  const last = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { startDate: buckets[0].startDate, endDate: buckets[6].endDate, buckets,
    title: `${fmt({ day: "numeric", month: "short" }, start)} — ${fmt({ day: "numeric", month: "short", year: "numeric" }, last).replace(/ г\.$/, "")}` }; // l10n-skip: суффикс года ru
}
export function buildStatistics(records, period, at = new Date(now())) {
  const range = calendar(period, at);
  const buckets = range.buckets.map(b => ({ ...b, focusMs: 0, breakMs: 0 }));
  const byKey = new Map(buckets.map(b => [b.key, b]));
  const unique = new Map(records.map(r => [r.id, r]));
  const topics = new Map(), focusDays = new Set(), sessions = new Set();
  let focusMs = 0, breakMs = 0;
  for (const r of unique.values()) {
    const byDate = new Map();
    addByDate(byDate, countedIntervals(r), r.timezoneOffset);
    let counts = false;
    for (const [date, ms] of byDate) {
      if (date < range.startDate || date >= range.endDate || ms <= 0) continue;
      const b = byKey.get(period == "year" ? date.slice(0, 7) : date);
      if (!b) continue;
      if (r.kind == "Focus") {
        b.focusMs += ms; focusMs += ms; focusDays.add(date);
        const tp = r.topic.trim() || "Фокус"; // l10n-skip
        topics.set(tp, (topics.get(tp) ?? 0) + ms);
        counts = true;
      } else { b.breakMs += ms; breakMs += ms; }
    }
    if (r.kind == "Focus" && counts) sessions.add(r.id);
  }
  return { title: range.title, startDate: range.startDate, endDate: range.endDate, buckets, focusMs, breakMs,
    focusSessions: sessions.size, averageFocusMs: sessions.size ? focusMs / sessions.size : 0, focusDays: focusDays.size,
    topics: [...topics].sort(byTime) };
}
// журнал по дням, новые сверху: строки (тип, режим, тема, длительность, пауза, итог) и фокус за день
export function journalDays(records = data.records) {
  const days = new Map();
  for (const r of [...records].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))) {
    const active = new Map(), paused = new Map();
    addByDate(active, countedIntervals(r), r.timezoneOffset);
    addByDate(paused, r.pauses, r.timezoneOffset);
    for (const date of new Set([...active.keys(), ...paused.keys()])) {
      const day = days.get(date) ?? { date, rows: [], focusMs: 0, breakMs: 0 };
      const ms = active.get(date) ?? 0;
      day.rows.push({ record: r, ms, pausedMs: paused.get(date) ?? 0 });
      if (r.kind == "Focus") day.focusMs += ms; else day.breakMs += ms;
      days.set(date, day);
    }
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- состояние движка ----------
// data.state — идущий цикл; data.selection — выбор в панели (пара, длинный перерыв, «каждые N», пресет, тема)
export const data = { loaded: false, settings: loadSettings(null), state: idleState(), selection: null, timerMode: "Countdown",
  records: [], resets: [], foreign: [], journalError: null, writeError: null, rev: 0,
  daily: emptyDaily(), dailyError: null, dailyWriteError: null }; // ежедневные задачи (time/daily.json)
const dirty = new Map();   // записи, ещё не записанные в journal.json (лежат и в state.json — не пропадут)
let allowed = new Set();   // «всё равно открыть» — до конца текущего фокуса
let queue = Promise.resolve(), alarm = null, saver = null, loading = null, gen = 0;
const listeners = new Set();

// подписка интерфейса; вызывается после каждого действия (не каждую секунду). Вернёт отписку.
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function bump(kind = "change") {
  data.rev++;
  for (const fn of listeners) { try { fn(kind); } catch (e) { listeners.delete(fn); } } // закрытая страница — «dead object»
}

function initialSelection(saved) {
  const s = data.settings, p = s.presets[0];
  return {
    pairIndex: saved && s.pairs[saved.pairIndex] ? saved.pairIndex : p?.pairIndex ?? 0,
    longBreak: saved && s.longBreaks.includes(saved.longBreak) ? saved.longBreak : p?.longBreak ?? s.longBreaks[0],
    every: saved && s.counts.includes(saved.every) ? saved.every : p?.every ?? 4,
    presetId: saved && s.presets.some(x => x.id == saved.presetId) ? saved.presetId : saved ? "" : p?.id ?? "",
    topic: saved && typeof saved.topic == "string" ? saved.topic : "",
  };
}

export const init = () => (loading ??= load());
// перечитать всё из папки (смена папки данных; в проверках — как после перезапуска браузера)
export function reload() { loading = null; return init(); }

async function load() {
  const my = ++gen, st = store();
  clearTimeout(alarm); clearTimeout(saver);
  await queue; // дописать начатое в прежнюю папку
  let settingsRaw = null, saved = null, journal = null, journalError = null, daily = emptyDaily(), dailyError = null;
  try { settingsRaw = await st.readJSON(FILES.settings, null); } catch (e) { console.error("LumiTime settings:", e); }
  try { saved = await st.readJSON(FILES.state, null); } catch (e) { console.error("LumiTime state:", e); }
  try {
    journal = await st.readJSON(FILES.journal, null);
    if (journal && !Array.isArray(journal.records)) throw new Error(t("нет списка records"));
  } catch (e) { journalError = t("Журнал не читается ({0}): {1}. Записи не теряются — ждут исправления файла.", FILES.journal, t(e.message ?? String(e))); }
  try { daily = normDaily(await st.readJSON(FILES.daily, null)); } catch (e) { dailyError = t("Файл «Каждый день» не читается ({0}): {1}. Он не будет перезаписан.", FILES.daily, t(e.message ?? String(e))); }
  if (my != gen) return;
  data.daily = daily; data.dailyError = dailyError; data.dailyWriteError = null;
  data.settings = loadSettings(settingsRaw);
  data.selection = initialSelection(saved?.selection);
  data.state = saved?.version === 1 ? restoreTimerState(saved.state) ?? idleState() : idleState();
  data.timerMode = data.state.phase != "idle" ? data.state.timerMode ?? "Countdown" : saved?.timerMode == "Stopwatch" ? "Stopwatch" : "Countdown";
  // после перезапуска незаконченный цикл открывается на паузе (пауза — с последнего сохранения)
  const wasRunning = data.state.phase != "idle" && data.state.runningSince !== null;
  if (wasRunning) {
    const t = now();
    pause(data.state, Math.min(t, Math.max(data.state.runningSince, saved?.savedAt ?? t)));
  }
  const byId = new Map();
  data.foreign = [];
  for (const r of journal?.records ?? []) isRecord(r) ? byId.set(r.id, r) : data.foreign.push(r); // чужое не выбрасываем
  dirty.clear();
  for (const r of Array.isArray(saved?.outbox) ? saved.outbox.filter(isRecord) : []) { byId.set(r.id, r); dirty.set(r.id, r); }
  data.records = [...byId.values()];
  data.resets = Array.isArray(journal?.resets) ? journal.resets.filter(e => e && typeof e.id == "string" && Number.isFinite(e.at)) : [];
  data.journalError = journalError;
  data.writeError = null;
  allowed = new Set();
  data.loaded = true;
  // при загрузке ничего не пишем, если нечего сохранять (папка данных может быть ещё не выбрана — не мусорим в Documents)
  if (dirty.size) flush();
  else if (wasRunning) persist();
  schedule();
  bump("load");
}

const plain = v => JSON.parse(JSON.stringify(v));
function write(rel, obj) {
  const snapshot = plain(obj);
  return (queue = queue.then(() => store().writeJSON(rel, snapshot)));
}
function persist() {
  if (!data.loaded) return;
  write(FILES.state, { version: 1, savedAt: now(), state: data.state, selection: data.selection, timerMode: data.timerMode,
    outbox: [...dirty.values()] }).catch(e => { data.writeError = String(e.message ?? e); console.error("LumiTime state:", e); });
}
// журнал целиком (атомарно, store.writeJSON с .tmp); битый журнал не затираем
function flush() {
  if (data.journalError) return persist();
  const sent = new Map(dirty);
  write(FILES.journal, { version: 1, records: [...data.records].sort((a, b) => a.startedAt - b.startedAt), resets: data.resets, ...(data.foreign.length ? { foreign: data.foreign } : {}) })
    .then(() => {
      for (const [id, r] of sent) if (dirty.get(id) === r) dirty.delete(id);
      data.writeError = null;
      persist();
      bump("journal");
    }, e => { data.writeError = String(e.message ?? e); console.error("LumiTime journal:", e); persist(); bump("journal"); });
}
export const pendingCount = () => dirty.size;
export const flushJournal = () => { flush(); return queue; };
export const whenSaved = () => queue.catch(() => {});

function putRecord(r) {
  const i = data.records.findIndex(x => x.id == r.id);
  i < 0 ? data.records.push(r) : (data.records[i] = r);
  dirty.set(r.id, r);
}
function enqueue(r) { if (shouldLog(r)) putRecord(r); }
const done = (s, t, result) => finish(s, t, result, uuid(), new Date(s.startedAt).getTimezoneOffset());

function schedule() {
  clearTimeout(alarm); clearTimeout(saver);
  const s = data.state;
  if (!data.loaded || s.phase == "idle" || s.runningSince === null) return;
  saver = setTimeout(() => { persist(); schedule(); }, 15000);
  if (s.timerMode != "Stopwatch" && !s.notified) alarm = setTimeout(check, Math.min(2 ** 31 - 1, Math.max(0, s.plannedMs - elapsedMs(s, now())) + 50));
}
// «время вышло»: звук + системное уведомление (один раз за цикл). В проверках вызывается вручную при подменённых часах.
export function check() {
  const s = data.state;
  if (s.phase != "idle" && s.timerMode != "Stopwatch" && !s.notified && elapsedMs(s, now()) >= s.plannedMs) {
    s.notified = true;
    persist();
    alertFinished(s.phase);
    bump("alert");
  }
  schedule();
}

// ---------- действия (main.ts act) ----------
// start-focus | start-break | pause | resume | stop | uncount-overtime | toggle-mode
export function act(action) {
  if (!data.loaded) return;
  const t = now(), s = data.state;
  if (action == "start-focus") {
    if (s.phase == "focus") return;
    if (s.phase == "break" || s.phase == "long-break") enqueue(done(s, t, "Completed"));
    const pair = data.settings.pairs[data.selection.pairIndex] ?? data.settings.pairs[0];
    data.state = startFocus(s, t, pair, data.selection.longBreak, data.selection.every, data.selection.topic, data.timerMode);
    data.state.presetId = data.selection.presetId; // пресет цикла — его блок сайтов
  } else if (action == "start-break") {
    if (s.phase != "focus") return;
    enqueue(done(s, t, "Completed"));
    data.state = startBreak(s, t);
    data.state.presetId = s.presetId;
  } else if (action == "pause") pause(s, t);
  else if (action == "resume") resume(s, t);
  else if (action == "toggle-mode" && data.timerMode == "Stopwatch" && s.phase != "idle") {
    enqueue(done(s, t, "Completed"));
    data.state = startStopwatchSegment(s, t, s.phase == "focus" ? "break" : "focus", data.selection.topic);
    data.state.presetId = s.presetId;
  } else if (action == "uncount-overtime") uncountOvertime(s, t);
  else if (action == "stop" && s.phase != "idle") {
    // стоп сохраняет прерванный фокус (и отрезок секундомера), прерванный перерыв — нет
    if (s.timerMode == "Stopwatch" || s.phase == "focus") enqueue(done(s, t, "Stopped"));
    data.state = idleState(s.completedFocuses);
  } else return;
  if (data.state.phase != "focus") allowed = new Set();
  if (dirty.size) flush();
  persist();
  schedule();
  bump();
}
export function changeSelection(patch) { data.selection = { ...data.selection, ...patch }; persist(); bump(); }
// тема меняется и во время фокуса (вся сессия — под последней темой); без bump — поле ввода не перерисовывается
export function changeTopic(topic) {
  data.selection.topic = topic;
  if (data.state.phase == "focus") data.state.topic = topic;
  persist();
}
export function changeTimerMode(mode) {
  if (data.state.phase != "idle" || !["Countdown", "Stopwatch"].includes(mode)) return;
  data.timerMode = mode; persist(); bump();
}
// ±1 мин: во время цикла — к прошедшему времени; без цикла — к последней записи журнала
export function adjust(minutes) {
  if (data.state.phase != "idle") {
    if (!adjustElapsed(data.state, now(), minutes)) return false;
    persist(); schedule(); bump();
    return true;
  }
  const last = latestRecord(data.records), next = last && adjustRecordDuration(last, minutes);
  if (!next) return false;
  putRecord(next); flush(); bump();
  return true;
}
export function lastRecord() { return latestRecord(data.records); }
// запись вручную: addManual({ kind, topic, minutes }) или addManual(kind, topic, durationMs); минуты — целые 1..600
export function addManual(kind, topic, durationMs) {
  if (kind && typeof kind == "object") {
    const { minutes } = kind;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) return false;
    ({ kind, topic = "" } = kind); durationMs = minutes * MIN;
  }
  if (!["Focus", "Break"].includes(kind) || !(durationMs > 0)) return false;
  const endedAt = now(), startedAt = endedAt - durationMs;
  putRecord({ version: 1, id: uuid(), kind, topic: kind == "Focus" ? topic.trim().slice(0, 200) || "Фокус" : "", result: "Completed", // l10n-skip
    startedAt, endedAt, timezoneOffset: new Date(startedAt).getTimezoneOffset(), plannedMs: durationMs,
    acceptedOvertime: false, manual: true, active: [[startedAt, endedAt]], pauses: [], timerMode: data.timerMode });
  flush(); bump();
  return true;
}
// «Сбросить серию»: новая серия начнётся со следующего фокуса
export function endStreak() {
  data.resets.push({ version: 1, id: uuid(), at: now() });
  flush(); bump();
}
export async function saveSettings(next) {
  data.settings = loadSettings(next);
  data.selection = initialSelection(data.selection);
  bump("settings");
  await write(FILES.settings, data.settings);
  persist();
}

// новая тема из выпадающего списка: в настройки (если такой ещё нет) и выбрать
export async function addTopic(name) {
  const t = String(name).trim().slice(0, 200);
  if (!t) return false;
  const known = data.settings.topics.find(x => x.toLocaleLowerCase() == t.toLocaleLowerCase());
  if (!known) await saveSettings({ ...data.settings, topics: [...data.settings.topics, t] });
  changeTopic(known ?? t);
  changeSelection({});
  return true;
}

// ---------- ежедневные задачи (home/time.js, блок «Каждый день»; логика — lumi-time-daily.sys.mjs) ----------
// Данные общие для всех окон и Home (движок один), интерфейс обновляется по bump("daily"). Нечитаемый файл не перезаписываем (dailyError).
function dailySet(next) {
  if (!data.loaded || data.dailyError) return false;
  data.daily = next; data.dailyWriteError = null;
  bump("daily");
  write(FILES.daily, next).catch(e => { data.dailyWriteError = String(e.message ?? e); console.error("LumiTime daily:", e); bump("daily"); });
  return true;
}
export const dailyToday = () => localDate(now());
export function dailyAdd(name) {
  const text = String(name).trim().slice(0, 200);
  return !!text && dailySet({ ...data.daily, tasks: [...data.daily.tasks, { id: uuid(), name: text, created: dailyToday() }] });
}
export function dailyRename(id, name) {
  const text = String(name).trim().slice(0, 200);
  return !!text && data.daily.tasks.some(t => t.id == id) && dailySet({ ...data.daily, tasks: data.daily.tasks.map(t => (t.id == id ? { ...t, name: text } : t)) });
}
// удаление стирает и историю отметок задачи
export function dailyRemove(id) {
  if (!data.daily.tasks.some(t => t.id == id)) return false;
  const marks = {};
  for (const [date, m] of Object.entries(data.daily.marks)) { const { [id]: _, ...rest } = m; if (Object.keys(rest).length) marks[date] = rest; }
  return dailySet({ ...data.daily, tasks: data.daily.tasks.filter(t => t.id != id), marks });
}
// value: 1 сделал | 0 не сделал | null снять; date — день от создания задачи до сегодня
export const dailyReorder = (id, index) => { const next = moveTask(data.daily, id, index); return !!next && dailySet(next); };
export const dailySetIcon = (id, icon) => { const next = setTaskIcon(data.daily, id, icon); return !!next && dailySet(next); };
export function dailyMark(id, date, value) {
  const next = applyMark(data.daily, id, date, value, dailyToday());
  return !!next && dailySet(next);
}
export const dailyStatsOf = (id, today = dailyToday()) => dailyStats(data.daily, id, today);

// ---------- сводки ----------
let cache = { key: "", value: null };
// сегодня / неделя / месяц / серия (дни подряд; от последнего «сброса серии»); живой фокус добавляет интерфейс
export function summary() {
  const t = now(), today = localDate(t), key = `${data.rev}|${today}`;
  if (cache.key == key) return cache.value;
  const resetAt = data.resets.reduce((m, e) => Math.max(m, e.at), 0);
  const all = focusTimeByDateAndTopic(data.records), sinceReset = resetAt ? focusTimeByDateAndTopic(data.records, resetAt) : all;
  let cur = sinceReset.has(today) ? today : shiftDate(today, -1);
  const streak = new Set();
  while (sinceReset.has(cur)) { streak.add(cur); cur = shiftDate(cur, -1); }
  const weekStart = shiftDate(today, -((new Date(`${today}T00:00:00`).getDay() + 6) % 7)), month = today.slice(0, 7);
  const value = {
    today: summarizeDays(all, d => d == today), week: summarizeDays(all, d => d >= weekStart && d <= today),
    month: summarizeDays(all, d => d.startsWith(month)), streak: summarizeDays(sinceReset, d => streak.has(d), streak.size), resetAt,
  };
  cache = { key, value };
  return value;
}
const goalTime = ms => { const m = Math.floor(Math.max(0, ms) / MIN), h = Math.floor(m / 60); return h ? t("{0} ч {1} мин", h, pad(m % 60)) : t("{0} мин", m); };
function monthFraction(d) {
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return (d.getDate() - 1 + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400) / days;
}
const weekFraction = d => ((d.getDay() + 6) % 7 + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400) / 7;
// цели периода (month | week | streak): строки { label, percent, actual, goal, pace } с живым фокусом; null — цели не заданы
export function goalRows(period) {
  const s = data.settings, st = data.state, tm = now(), sum = summary();
  const c = {
    month: { on: s.monthGoalsEnabled, total: s.monthGoalHours, topics: s.topicMonthGoals, sum: sum.month, live: countedMonthMs(st, tm), elapsed: monthFraction(new Date(tm)) },
    week: { on: s.weekGoalsEnabled, total: s.weekGoalHours, topics: s.topicWeekGoals, sum: sum.week, live: countedWeekMs(st, tm), elapsed: weekFraction(new Date(tm)) },
    streak: { on: s.streakGoalsEnabled, total: s.streakGoalHours, topics: s.topicStreakGoals, sum: sum.streak, live: countedSinceMs(st, tm, sum.resetAt), elapsed: null },
  }[period];
  if (!c.on || (c.total === null && !c.topics.length)) return null;
  const byTopic = new Map();
  for (const [topic, ms] of c.sum.topics) byTopic.set(topic.toLocaleLowerCase(), (byTopic.get(topic.toLocaleLowerCase()) ?? 0) + ms);
  const liveTopic = (st.topic.trim() || "Фокус").toLocaleLowerCase(); // l10n-skip
  const row = (label, hours, ms) => {
    const goal = hours * 3600000, percent = Math.round(ms / goal * 100);
    const delta = c.elapsed === null ? 0 : Math.round((ms - goal * c.elapsed) / MIN);
    const pace = c.elapsed === null ? (ms >= goal ? t("цель достигнута") : t("осталось {0}", goalTime(Math.ceil((goal - ms) / MIN) * MIN)))
      : delta == 0 ? t("в графике") : delta > 0 ? t("опережение {0}", goalTime(delta * MIN)) : t("отставание {0}", goalTime(-delta * MIN));
    return { label, percent, actual: goalTime(ms), goal: t("{0} ч", Number(hours.toFixed(2))), pace, ahead: delta >= 0 };
  };
  const rows = c.total === null ? [] : [row(t("Всего"), c.total, c.sum.totalMs + c.live)];
  for (const g of c.topics) {
    const k = g.topic.toLocaleLowerCase();
    rows.push(row(g.topic, g.hours, (byTopic.get(k) ?? 0) + (st.phase == "focus" && liveTopic == k ? c.live : 0)));
  }
  return rows;
}

// ---------- звук и уведомления ----------
let audio = null; // { win, ctx } — AudioContext живёт в окне браузера (у модуля своего нет)
function context() {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  if (!win) return null;
  if (!audio || audio.win != win || audio.win.closed || audio.ctx.state == "closed") audio = { win, ctx: new win.AudioContext() };
  return audio;
}
// Синтез сигналов без файлов: общий граф для живого и офлайн-контекста (образцы dev/sound-preview).
// Колокол — негармоничные обертоны с разным затуханием; перезвон — калимба (синус + быстрый «тук»); двойной — тёплый треугольник через ФНЧ.
const NOTE = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5 };
const BELL = [[1, 1, 2.4], [2.0, 0.45, 1.5], [2.76, 0.3, 1.0], [4.07, 0.14, 0.6], [5.4, 0.07, 0.35]]; // [кратность, громкость, затухание с]
const reverbs = new WeakMap();
function reverb(ctx) {
  let ir = reverbs.get(ctx);
  if (!ir) {
    const len = Math.floor(ctx.sampleRate * 1.8);
    ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    reverbs.set(ctx, ir);
  }
  return ir;
}
function voice(ctx, out, at, freq, parts, attack, wave = "sine") {
  for (const [ratio, amp, decay] of parts) {
    const f = freq * ratio;
    if (f > 9000) continue;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = wave; osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(amp, at + attack);
    g.gain.setTargetAtTime(0, at + attack, decay / 4);
    osc.connect(g); g.connect(out);
    osc.start(at); osc.stop(at + attack + decay * 2);
  }
}
// phase: "focus" — фраза вниз (отдых), "break" — вверх (за работу). Возвращает длительность в секундах.
export function buildSound(ctx, dest, preset, phase, volume, at = 0) {
  const master = ctx.createGain(), comp = ctx.createDynamicsCompressor();
  master.gain.value = Math.max(0, Math.min(100, volume)) / 100 * 0.5;
  master.connect(comp); comp.connect(dest);
  const mix = ctx.createGain(), wet = ctx.createGain(), conv = ctx.createConvolver();
  conv.buffer = reverb(ctx); wet.gain.value = 0.25;
  mix.connect(master); mix.connect(conv); conv.connect(wet); wet.connect(master);
  const dir = notes => (phase == "break" ? notes.slice().reverse() : notes); // списки записаны «вниз»
  if (preset == "bell") {
    dir([NOTE.A5, NOTE.E5]).forEach((f, i) => voice(ctx, mix, at + i * 0.55, f, BELL.map(p => [p[0], p[1] * 0.5, p[2]]), 0.008));
    return 3;
  }
  if (preset == "chime") {
    const tock = [[1, 1, 1.1], [3, 0.12, 0.12], [4, 0.06, 0.08]];
    dir([NOTE.C6, NOTE.G5, NOTE.E5, NOTE.C5]).forEach((f, i) => voice(ctx, mix, at + i * 0.13, f, tock.map(p => [p[0], p[1] * 0.55, p[2]]), 0.004));
    return 2.6;
  }
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400; lp.connect(mix);
  dir([NOTE.E5, NOTE.C5]).forEach((f, i) => voice(ctx, lp, at + i * 0.4, f, [[1, 0.6, 0.9], [2, 0.12, 0.5]], 0.03, "triangle"));
  return 2.2;
}
export function playSound(phase = "focus") {
  const s = data.settings;
  if (!s.sound) return;
  try {
    const a = context();
    if (!a) return;
    if (s.soundFile) {
      const player = new a.win.Audio(PathUtils.toFileURI(s.soundFile));
      player.volume = s.volume / 100;
      player.play().catch(e => console.error("LumiTime sound:", e));
      return;
    }
    const ctx = a.ctx;
    ctx.resume().then(() => buildSound(ctx, ctx.destination, s.soundPreset, phase, s.volume, ctx.currentTime + 0.02)).catch(() => {});
  } catch (e) { console.error("LumiTime sound:", e); }
}
// короткий «тик» для галочек Daily Log
export function playCheckSound(checked) {
  if (!data.settings.sound) return;
  try {
    const ctx = context()?.ctx;
    ctx?.resume().then(() => {
      const at = ctx.currentTime, tone = ctx.createOscillator(), gain = ctx.createGain();
      tone.frequency.setValueAtTime(checked ? 660 : 520, at);
      tone.frequency.exponentialRampToValueAtTime(checked ? 880 : 440, at + 0.09);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, data.settings.volume / 2500), at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      tone.connect(gain); gain.connect(ctx.destination);
      tone.start(at); tone.stop(at + 0.13);
    }).catch(() => {});
  } catch (e) { console.error(e); }
}
export let lastAlert = null; // { at, text } — для проверок и интерфейса
export function notify(text) {
  try {
    const n = Cc["@mozilla.org/alert-notification;1"].createInstance(Ci.nsIAlertNotification);
    n.init("lumitime", "", "LumiTime", text);
    Cc["@mozilla.org/alerts-service;1"].getService(Ci.nsIAlertsService).showAlert(n);
    return true;
  } catch (e) { console.error("LumiTime notification:", e); return false; }
}
function alertFinished(phase) {
  const text = phase == "focus" ? t("Время фокуса вышло. Начни перерыв, когда будешь готов.") : t("Перерыв закончился. Можно начинать фокус.");
  lastAlert = { at: now(), text };
  playSound(phase);
  if (data.settings.systemNotifications) notify(text);
}

// ---------- блок сайтов во время фокуса (js/lumi-focus.uc.js) ----------
const hhmm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
// блок текущего цикла: пресет цикла (state.presetId) или, без пресета («Свой»), общие поля настроек
function blockFor(st = data.state) {
  const s = data.settings, p = s.presets.find(x => x.id == st.presetId);
  return p ? p.block : { enabled: s.blockEnabled, sites: s.blockSites, breaks: s.blockBreaks };
}
// сайт списка, под который подпадает хост (поддомены тоже); общая для фокуса и строгого режима (lumi-strict.sys.mjs)
export function matchHost(host, sites) {
  const h = host.toLowerCase().replace(/^www\./, "");
  return sites.find(d => h == d || h.endsWith("." + d)) ?? null;
}
const matchSite = host => matchHost(host, blockFor().sites);
// идёт ли цикл сейчас: "focus" | "break" (перерыв, в т.ч. длинный) | null (нет цикла или пауза) — для строгого режима
export function activePhase() {
  const st = data.state;
  return !data.loaded || st.phase == "idle" || st.runningSince === null ? null : st.phase == "focus" ? "focus" : "break";
}
// адрес сайта блокируется? → { site, until: "чч:мм" | null (секундомер) } или null. Идущий фокус (не пауза); перерыв — только при blockBreaks.
export function focusBlock(host) {
  const st = data.state, b = blockFor(st);
  if (!data.loaded || !b.enabled || !b.sites.length || st.phase == "idle" || (st.phase != "focus" && !b.breaks) || st.runningSince === null || !host) return null;
  const site = matchSite(host);
  if (!site || allowed.has(site)) return null;
  const t = now();
  return { site, phase: st.phase, until: st.timerMode == "Stopwatch" ? null : hhmm(t + Math.max(0, st.plannedMs - elapsedMs(st, t))) };
}
// «Всё равно открыть» — сайт открыт до конца этого фокуса
export function allowSite(host) { const site = matchSite(host); if (site) allowed.add(site); }

// смена папки данных — перечитать всё оттуда
Services.prefs.addObserver("luminoctis.home.dir", () => { if (data.loaded) reload(); });
// выход из браузера: сохранить момент (после запуска цикл откроется на паузе с этого места)
Services.obs.addObserver(() => persist(), "quit-application-granted");
