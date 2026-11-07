// Разбор лога плагина Obsidian «Focus Cycle Timer» (StudyLogs.md) — чистые функции, без ChromeUtils: годятся и для node (dev/check-time-import.mjs).
// Лог между <!-- focus-cycle-timer:start --> и <!-- focus-cycle-timer:end -->:
//   <!-- focus-cycle-timer:record:<urlencoded JSON> -->        — полная запись сессии (тот же формат, что у журнала LumiTime; лишнее поле path отбрасываем)
//   <!-- focus-cycle-timer:daily-record:<urlencoded JSON> -->  — запись «Дня» { version, id, date, markdown }
//   разделы «## гггг-мм-дд» с таблицей | Type | Mode | Topic | Duration | Paused | Result | — человекочитаемая копия; нужна, только если у дня нет строк record
const TAG = "focus-cycle-timer";
const dec = (line, kind) => {
  const head = `<!-- ${TAG}:${kind}:`, i = line.lastIndexOf(" -->");
  return JSON.parse(decodeURIComponent(line.slice(head.length, i < 0 ? undefined : i)));
};
export const parseDuration = v => {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(String(v).trim());
  return m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 : null;
};
// день записи по поясу её начала (так же считает статистика движка)
export const recordDate = r => new Date(r.startedAt - r.timezoneOffset * 60000).toISOString().slice(0, 10);

// → { records, dailies, tableOnly, bad }; records — разобранные JSON (проверка формата — у движка, isRecord)
export function parseLog(text) {
  let src = String(text).replace(/^﻿/, "");
  const a = src.indexOf(`<!-- ${TAG}:start -->`), b = src.indexOf(`<!-- ${TAG}:end -->`);
  if (a >= 0) src = src.slice(a, b > a ? b : undefined);
  const records = [], dailies = [], tableOnly = [];
  let bad = 0, date = null, n = 0;
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    try {
      if (line.startsWith(`<!-- ${TAG}:record:`)) { const { path, ...r } = dec(line, "record"); records.push(r); continue; }
      if (line.startsWith(`<!-- ${TAG}:daily-record:`)) { dailies.push(dec(line, "daily-record")); continue; }
    } catch { bad++; continue; }
    const h = /^## (\d{4}-\d{2}-\d{2})\s*$/.exec(line);
    if (h) { date = h[1]; n = 0; continue; }
    const row = date && /^\|\s*(Focus|Break|Long break)\s*\|(.*)\|\s*$/.exec(line);
    if (!row) continue;
    const [mode, topic, dur, paused, result] = row[2].split("|").map(x => x.trim());
    const ms = parseDuration(dur);
    if (ms === null || !["Completed", "Stopped"].includes(result) || !["Countdown", "Stopwatch"].includes(mode)) { bad++; continue; }
    tableOnly.push({ date, index: ++n, kind: row[1], mode, topic, ms, pausedMs: parseDuration(paused) ?? 0, result });
  }
  return { records, dailies, tableOnly, bad };
}

// строки таблицы дней без строк record → записи (время суток неизвестно: подряд с 12:00; id устойчив — повторный импорт не дублирует)
export function tableRecords(rows, haveDates) {
  const t = new Map(), out = [];
  for (const r of rows) {
    if (haveDates.has(r.date)) continue;
    const [y, m, d] = r.date.split("-").map(Number), noon = new Date(y, m - 1, d, 12);
    const startedAt = t.get(r.date) ?? noon.getTime(), endedAt = startedAt + r.ms;
    t.set(r.date, endedAt + 60000);
    out.push({ version: 1, id: `table-${r.date}-${r.index}`, kind: r.kind, topic: r.kind == "Focus" ? r.topic : "", result: r.result,
      startedAt, endedAt, timezoneOffset: noon.getTimezoneOffset(), plannedMs: r.ms, acceptedOvertime: false, manual: true,
      active: [[startedAt, endedAt]], pauses: [], timerMode: r.mode });
  }
  return out;
}

// запись «Дня» плагина (markdown) → файл дня LumiTime: задачи «- [ ] / - [x]» (хвост « ✅ дата» срезается) и строки «Comment: …»
export function dailyToDay(daily) {
  const [y, m, d] = daily.date.split("-").map(Number), at = new Date(y, m - 1, d, 12).getTime();
  const tasks = [], comments = [];
  for (const line of String(daily.markdown ?? "").split(/\r?\n/)) {
    const t = /^\s*[-*]\s+\[([ xX])\]\s+(.*?)\s*(?:✅\s*\d{4}-\d{2}-\d{2})?\s*$/.exec(line);
    if (t) { if (t[2]) tasks.push({ id: `${daily.id}-t${tasks.length}`, text: t[2].slice(0, 500), done: t[1] != " " }); continue; }
    const c = /^Comment:\s*(.*\S)\s*$/.exec(line);
    if (c) comments.push({ id: `${daily.id}-c${comments.length}`, text: c[1].slice(0, 4000), at });
  }
  return { version: 1, date: daily.date, tasks, comments };
}
