// Часы Luminoctis Home: одна функция «время → DOM» и 10 стилей — CSS-классы lumi-clock-<стиль> (home/clock.css).
// Настройки: luminoctis.home.clock.style / .h12 / .seconds / .date / .size (% от обычного размера, 50–150) /
// .color (palette|accent|white|custom + .custom «#rrggbb») / .legibility (off|shadow|auto) / .datefmt (long|medium|short|iso|off). Тот же модуль рисует превью стилей в настройках
// (settings.js: new Clock(el, "flip")). Текст .lumi-clock-time — всегда «чч:мм[:сс]» (цифры сегментов и перелистывания — пустые <i> и attr()).
import { JS } from "./paths.js";
const { t, locale } = ChromeUtils.importESModule(JS("lumi-i18n.sys.mjs"));
const PREF = "luminoctis.home.clock.";
export const STYLES = {
  digital: t("Цифровые"), thin: t("Тонкие"), segment: t("Сегменты"), flip: t("Перелистывание"), analog: t("Стрелки"),
  neon: t("Неон"), outline: t("Контур"), stacked: t("Столбиком"), serif: t("С засечками"), terminal: t("Терминал"),
};
export function options() {
  const style = Services.prefs.getStringPref(PREF + "style", "digital");
  return {
    style: STYLES[style] ? style : "digital",
    h12: Services.prefs.getBoolPref(PREF + "h12", false),
    seconds: Services.prefs.getBoolPref(PREF + "seconds", false),
    date: Services.prefs.getBoolPref(PREF + "date", true),
    size: Math.min(150, Math.max(50, Services.prefs.getIntPref(PREF + "size", 100))),
    color: Services.prefs.getStringPref(PREF + "color", "palette"),
    custom: Services.prefs.getStringPref(PREF + "custom", "#ffffff"),
    legibility: Services.prefs.getStringPref(PREF + "legibility", "off"),
    datefmt: Services.prefs.getBoolPref(PREF + "date", true) ? Services.prefs.getStringPref(PREF + "datefmt", "long") : "off",
  };
}
const DATE = {
  long: { weekday: "long", day: "numeric", month: "long" },
  medium: { weekday: "short", day: "numeric", month: "short" },
  short: { day: "2-digit", month: "2-digit", year: "numeric" },
};
const dateText = (now, f) => f == "iso" ? `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` : now.toLocaleDateString(locale, DATE[f] ?? DATE.long);

// Авто-контраст: яркость обоев за часами (центр кадра с учётом затемнения) → тёмный текст на светлых обоях. Считает только страница Home.
let wallTone = "light";
export function retone() {
  if (Services.prefs.getStringPref(PREF + "legibility", "off") != "auto") return (wallTone = "light"); // считаем только когда нужно
  const w = window.lumiWallpaper, el = w?.current?.el;
  const nw = el?.naturalWidth || el?.videoWidth, nh = el?.naturalHeight || el?.videoHeight;
  if (!nw || !nh) return (wallTone = "light"); // цветной фон/рабочий стол/ещё не загружено
  try {
    const va = innerWidth / innerHeight, ia = nw / nh;
    const vw = ia > va ? nh * va : nw, vh = ia > va ? nh : nw / va; // видимая при cover часть картинки
    const c = document.createElement("canvas");
    c.width = 32; c.height = 18;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(el, (nw - vw * 0.4) / 2, (nh - vh * 0.4) / 2, vw * 0.4, vh * 0.4, 0, 0, 32, 18);
    const px = g.getImageData(0, 0, 32, 18).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    const dim = Math.min(Math.max(Services.prefs.getIntPref("luminoctis.home.wallpaper.dim", 25), 0), 90) / 100;
    wallTone = (sum / (px.length / 4)) * (1 - dim) > 0.55 ? "dark" : "light";
  } catch {}
  return wallTone;
}

const SEGS = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg"]; // семь сегментов по цифрам
const pad = n => String(n).padStart(2, "0");
const svg = (tag, attrs) => {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
function dial() {
  const s = svg("svg", { viewBox: "-50 -50 100 100", class: "lumi-clock-dial", "aria-hidden": "true" });
  s.append(svg("circle", { r: 48, class: "face" }));
  for (let i = 0; i < 60; i++)
    s.append(svg("line", { y1: -46, y2: i % 5 ? -43 : -39, class: i % 5 ? "tick" : "tick major", transform: `rotate(${i * 6})` }));
  for (const [cls, len] of [["hour", -24], ["minute", -36], ["second", -40]])
    s.append(svg("line", { y1: 6, y2: len, class: "hand " + cls }));
  s.append(svg("circle", { r: 2.5, class: "pin" }));
  return s;
}

export class Clock {
  constructor(root, fixedStyle = null) {
    this.root = root;
    this.fixed = fixedStyle;
    this.dial = dial();
    this.time = Object.assign(document.createElement("div"), { className: "lumi-clock-time" });
    this.date = Object.assign(document.createElement("div"), { className: "lumi-clock-date" });
    root.classList.add("lumi-clock");
    root.replaceChildren(this.dial, this.time, this.date);
    this.layout = "";
    clocks.add(this);
    this.update(new Date(), options());
    start(); schedule(); // новый стиль «Стрелки» (превью) требует секундного тика
  }
  update(now, o) {
    const style = this.fixed || o.style;
    if (this.style != style) {
      if (this.style) this.root.classList.remove("lumi-clock-" + this.style);
      this.root.classList.add("lumi-clock-" + (this.style = style));
    }
    if (!this.fixed) { // превью стилей в настройках не масштабируются и не красятся
      this.root.style.setProperty("--clock-scale", o.size / 100);
      const dark = o.legibility == "auto" && wallTone == "dark";
      const col = dark ? "#14161c" : o.color == "accent" ? getComputedStyle(document.documentElement).getPropertyValue("--lumi-accent").trim()
        : o.color == "white" ? "#ffffff" : o.color == "custom" && /^#[0-9a-f]{6}$/i.test(o.custom) ? o.custom : "";
      if (col) this.root.style.setProperty("--clock-color", col); else this.root.style.removeProperty("--clock-color");
      this.root.classList.toggle("lumi-clock-tint", !!col);
      this.root.classList.toggle("lumi-clock-shadow", o.legibility == "shadow");
      this.root.classList.toggle("lumi-clock-dark", dark);
    }
    const h24 = now.getHours();
    const groups = [pad(o.h12 ? h24 % 12 || 12 : h24), pad(now.getMinutes())];
    if (o.seconds) groups.push(pad(now.getSeconds()));
    const layout = groups.length + (o.h12 ? "a" : "");
    if (layout != this.layout) this.build(groups.length, o.h12);
    this.layout = layout;
    const flip = style == "flip";
    groups.join("").split("").forEach((c, i) => {
      const d = this.digits[i];
      if (d.dataset.c == c) return;
      d.dataset.p = d.dataset.c ?? c; // прежняя цифра — для перелистывания
      d.dataset.c = c;
      d.firstChild.data = c;
      for (const seg of d.querySelectorAll("i")) seg.classList.toggle("on", SEGS[c].includes(seg.dataset.s));
      if (flip) { d.classList.remove("flip"); void d.offsetWidth; d.classList.add("flip"); }
    });
    if (this.ampm) this.ampm.textContent = h24 < 12 ? "AM" : "PM";
    this.root.classList.toggle("lumi-clock-seconds", o.seconds);
    // стрелки (стиль «Стрелки»); плавная секундная не нужна — тик раз в секунду
    const m = now.getMinutes() + now.getSeconds() / 60, h = (h24 % 12) + m / 60;
    const [hh, mm, ss] = this.dial.querySelectorAll(".hand");
    hh.setAttribute("transform", `rotate(${h * 30})`);
    mm.setAttribute("transform", `rotate(${m * 6})`);
    ss.setAttribute("transform", `rotate(${now.getSeconds() * 6})`);
    this.date.hidden = o.datefmt == "off";
    if (!this.date.hidden) { const t = dateText(now, o.datefmt); if (this.date.textContent != t) this.date.textContent = t; }
  }
  build(count, h12) {
    this.digits = [];
    const parts = [];
    for (let g = 0; g < count; g++) {
      if (g) parts.push(Object.assign(document.createElement("span"), { className: "sep", textContent: ":" }));
      const group = Object.assign(document.createElement("span"), { className: "g g" + g });
      for (let k = 0; k < 2; k++) {
        const d = Object.assign(document.createElement("span"), { className: "c" });
        d.append(document.createTextNode(""), ...[..."abcdefg"].map(s => {
          const seg = Object.assign(document.createElement("i"), { className: "s" + s });
          seg.dataset.s = s;
          return seg;
        }));
        this.digits.push(d);
        group.append(d);
      }
      parts.push(group);
    }
    this.ampm = h12 ? Object.assign(document.createElement("span"), { className: "ampm" }) : null;
    this.time.replaceChildren(...parts);
    this.root.querySelector(":scope > .ampm")?.remove();
    if (this.ampm) this.time.after(this.ampm); // вне .lumi-clock-time: её текст — только цифры
  }
  remove() { clocks.delete(this); }
}

const clocks = new Set();
let timer = 0, started = false;
const tickAll = () => { const now = new Date(), o = options(); for (const c of clocks) c.update(now, o); return now; };
// не тикаем, пока страница скрыта (document.hidden); при показе — сразу сверить время
const schedule = () => {
  clearTimeout(timer);
  timer = 0;
  if (document.hidden) return;
  // секунды видны (цифры или секундная стрелка) — тик раз в секунду, иначе раз в минуту
  const wait = now => ((options().seconds || [...clocks].some(c => c.style == "analog")) ? 1000 - now.getMilliseconds() : 60000 - now.getSeconds() * 1000 - now.getMilliseconds());
  const tick = () => { const now = tickAll(); timer = setTimeout(tick, wait(now)); };
  timer = setTimeout(tick, wait(new Date()));
};
function start() {
  if (started) return;
  started = true;
  schedule();
  const onPref = () => { if (window.lumiClock) retone(); tickAll(); schedule(); };
  const onVis = () => { if (!document.hidden) { if (window.lumiClock) retone(); tickAll(); } schedule(); };
  Services.prefs.addObserver(PREF, onPref);
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("unload", () => { Services.prefs.removeObserver(PREF, onPref); document.removeEventListener("visibilitychange", onVis); clearTimeout(timer); });
}

// на странице Home — часы в #lumi-clock
const home = document.getElementById("lumi-clock");
if (home) {
  window.lumiClock = new Clock(home);
  // авто-контраст: заново считаем при смене обоев (слои в #lumi-wallpaper), затемнения и возврате на Home
  const again = () => { const t = wallTone; retone(); if (t != wallTone) tickAll(); };
  let later = 0;
  new MutationObserver(() => { clearTimeout(later); later = setTimeout(again, 900); }).observe(document.getElementById("lumi-wallpaper"), { childList: true, subtree: true });
  const onWall = () => { clearTimeout(later); later = setTimeout(again, 200); };
  Services.prefs.addObserver("luminoctis.home.wallpaper.", onWall);
  window.addEventListener("unload", () => Services.prefs.removeObserver("luminoctis.home.wallpaper.", onWall));
  window.lumiClock.retone = () => { retone(); tickAll(); };
  setTimeout(again, 1500);
}
