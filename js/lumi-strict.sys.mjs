// ==UserScript==
// @name           Luminoctis: строгий режим (списки сайтов по расписанию)
// @description    Списки сайтов с днями недели и временем; в это время (и/или во время фокуса LumiTime) сайты закрыты заглушкой без кнопки «Всё равно открыть».
// ==/UserScript==

// Чистая логика + prefs. Решение «блокировать?» — block(host, now, phase); зовёт js/lumi-focus.uc.js, настройки правят lists через save().
// pref luminoctis.strict.enabled (bool) — общий выключатель; luminoctis.strict.lists — JSON-массив списков:
// { id, name, sites: [домены], days: [0..6] (0 = пн), from: "HH:MM", to: "HH:MM", focus: "off"|"focus"|"focus+breaks", on: true }
// Расписание может переходить через полночь (22:00–07:00): день недели — день начала интервала. from == to — расписания нет.
const { t } = ChromeUtils.importESModule(new URL("lumi-i18n.sys.mjs", import.meta.url).href);
import { normDomain, matchHost, activePhase, now as engineNow } from "./lumi-time.sys.mjs";

export const PREF_ENABLED = "luminoctis.strict.enabled", PREF_LISTS = "luminoctis.strict.lists";
const FOCUS_MODES = ["off", "focus", "focus+breaks"];
const hm = v => (typeof v == "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
const minutes = v => +v.slice(0, 2) * 60 + +v.slice(3);
const uuid = () => Services.uuid.generateUUID().toString().slice(1, -1);

export const enabled = () => Services.prefs.getBoolPref(PREF_ENABLED, false);
export function newList(n = 1) {
  return { id: uuid(), name: t("Список {0}", n), sites: [], days: [0, 1, 2, 3, 4], from: "09:00", to: "18:00", focus: "off", on: true };
}
function clean(l) {
  if (!l || typeof l != "object") return null;
  return {
    id: typeof l.id == "string" && l.id ? l.id : uuid(),
    name: typeof l.name == "string" ? l.name.slice(0, 80) : "",
    sites: Array.isArray(l.sites) ? [...new Set(l.sites.map(normDomain).filter(Boolean))] : [],
    days: Array.isArray(l.days) ? [...new Set(l.days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [],
    from: hm(l.from) ?? "09:00", to: hm(l.to) ?? "18:00",
    focus: FOCUS_MODES.includes(l.focus) ? l.focus : "off", on: l.on !== false,
  };
}
export function lists() {
  try {
    const v = JSON.parse(Services.prefs.getStringPref(PREF_LISTS, "[]"));
    return Array.isArray(v) ? v.map(clean).filter(Boolean) : [];
  } catch { return []; }
}
export function save(next) { Services.prefs.setStringPref(PREF_LISTS, JSON.stringify(next.map(clean).filter(Boolean))); }

// конец текущего интервала расписания списка (мс) или null, если сейчас вне расписания
function scheduleEnd(l, t) {
  if (!l.days.length || l.from == l.to) return null;
  const d = new Date(t), cur = d.getHours() * 60 + d.getMinutes(), f = minutes(l.from), e = minutes(l.to);
  const dow = (d.getDay() + 6) % 7, at = (dayShift, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayShift, 0, m).getTime();
  if (f < e) return l.days.includes(dow) && cur >= f && cur < e ? at(0, e) : null;
  if (l.days.includes(dow) && cur >= f) return at(1, e);
  if (l.days.includes((dow + 6) % 7) && cur < e) return at(0, e);
  return null;
}

// сайт блокируется? → { site, list, until, kind: "strict" } | null. phase — "focus" | "break" | null (по умолчанию из движка LumiTime)
export function block(host, t = engineNow(), phase = activePhase()) {
  if (!host || !enabled()) return null;
  for (const l of lists()) {
    if (!l.on || !l.sites.length) continue;
    const site = matchHost(host, l.sites);
    if (!site) continue;
    const until = scheduleEnd(l, t);
    if (until !== null) return { site, list: l.name, until, kind: "strict" };
    if ((l.focus == "focus" && phase == "focus") || (l.focus == "focus+breaks" && phase)) return { site, list: l.name, until: null, kind: "strict" };
  }
  return null;
}
