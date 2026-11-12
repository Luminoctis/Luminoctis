// LumiTime: ежедневные задачи («Каждый день») — чистая логика без диска и без браузера (проверка: dev/check-time-daily.mjs).
// Файл данных time/daily.json: { version:1, tasks:[{ id, name, created: "гггг-мм-дд" }], marks:{ "гггг-мм-дд": { id: 1 (сделал) | 0 (не сделал) } } }.
// Нет отметки = не отмечено. Даты — местные (граница дня как у остального LumiTime — местная полночь).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const dailyDate = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export function shiftDate(date, days) {
  const v = new Date(`${date}T00:00:00Z`);
  v.setUTCDate(v.getUTCDate() + days);
  return v.toISOString().slice(0, 10);
}
export const emptyDaily = () => ({ version: 1, tasks: [], marks: {} });

// содержимое файла → модель. Нет файла (null) — пусто; не тот формат — бросает (вызывающий не пишет поверх такого файла).
// shortcut: задачи/отметки с неверными полями молча отбрасываются и пропадут при следующей записи; пока формат пишем только мы — достаточно
export function normDaily(raw) {
  if (raw == null) return emptyDaily();
  if (typeof raw != "object" || !Array.isArray(raw.tasks) || (raw.marks != null && typeof raw.marks != "object")) throw new Error("неизвестный формат"); // l10n-skip: показывается через t() в движке
  const tasks = [], ids = new Set();
  for (const t of raw.tasks) {
    const name = typeof t?.name == "string" ? t.name.trim().slice(0, 200) : "";
    if (!name || typeof t.id != "string" || !t.id || ids.has(t.id) || !DATE_RE.test(t.created)) continue;
    ids.add(t.id);
    tasks.push({ id: t.id, name, created: t.created });
  }
  const marks = {};
  for (const [date, m] of Object.entries(raw.marks ?? {})) {
    if (!DATE_RE.test(date) || !m || typeof m != "object") continue;
    for (const [id, v] of Object.entries(m)) if (ids.has(id) && (v === 1 || v === 0)) (marks[date] ??= {})[id] = v;
  }
  return { version: 1, tasks, marks };
}

// отметка задачи за день: ставит 1 | 0, null снимает. Новая модель; даты вне created..today и неизвестная задача — null (ничего не меняется)
export function applyMark(daily, id, date, value, today) {
  const task = daily.tasks.find(t => t.id == id);
  if (!task || !DATE_RE.test(date) || date < task.created || date > today || ![1, 0, null].includes(value)) return null;
  const marks = { ...daily.marks }, day = { ...marks[date] };
  if (value === null) delete day[id]; else day[id] = value;
  if (Object.keys(day).length) marks[date] = day; else delete marks[date];
  return { ...daily, marks };
}
// следующее состояние по клику: пусто → ✓ → ✗ → пусто (календарь статистики); кнопки ✓/✗ в блоке зовут toggleMark
export const cycleMark = v => (v === 1 ? 0 : v === 0 ? null : 1);
export const toggleMark = (cur, want) => (cur === want ? null : want);

// статистика задачи на день today: { current, best, pct30, pctAll, doneAll, days }
// Серия — подряд идущие «сделал»; сегодняшний день без отметки серию не рвёт (его ещё можно сделать), «не сделал» рвёт.
// Процент = сделал / прошедших дней от создания задачи; сегодня без отметки в знаменатель не входит. Нет дней — null.
export function dailyStats(daily, id, today) {
  const task = daily.tasks.find(t => t.id == id);
  if (!task || task.created > today) return { current: 0, best: 0, pct30: null, pctAll: null, doneAll: 0, days: 0 };
  const from30 = shiftDate(today, -29);
  let run = 0, best = 0, done = 0, days = 0, done30 = 0, days30 = 0;
  for (let d = task.created; d <= today; d = shiftDate(d, 1)) {
    const m = daily.marks[d]?.[id];
    if (m === 1) { run++; best = Math.max(best, run); } else if (!(d == today && m === undefined)) run = 0;
    if (d == today && m === undefined) continue;
    days++; done += m === 1;
    if (d >= from30) { days30++; done30 += m === 1; }
  }
  const pct = (a, b) => (b ? Math.round(a / b * 100) : null);
  return { current: run, best, pct30: pct(done30, days30), pctAll: pct(done, days), doneAll: done, days };
}
