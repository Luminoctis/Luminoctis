// Часы Luminoctis Home: одна функция «время → DOM» и 10 стилей — CSS-классы lumi-clock-<стиль> (home/clock.css).
// Настройки: luminoctis.home.clock.style / .h12 / .seconds / .date / .size (% от обычного размера, 50–150). Тот же модуль рисует превью стилей в настройках
// (settings.js: new Clock(el, "flip")). Текст .lumi-clock-time — всегда «чч:мм[:сс]» (цифры сегментов и перелистывания — пустые <i> и attr()).
const PREF = "luminoctis.home.clock.";
export const STYLES = {
  digital: "Цифровые", thin: "Тонкие", segment: "Сегменты", flip: "Перелистывание", analog: "Стрелки",
  neon: "Неон", outline: "Контур", stacked: "Столбиком", serif: "С засечками", terminal: "Терминал",
};
export function options() {
  const style = Services.prefs.getStringPref(PREF + "style", "digital");
  return {
    style: STYLES[style] ? style : "digital",
    h12: Services.prefs.getBoolPref(PREF + "h12", false),
    seconds: Services.prefs.getBoolPref(PREF + "seconds", false),
    date: Services.prefs.getBoolPref(PREF + "date", true),
    size: Math.min(150, Math.max(50, Services.prefs.getIntPref(PREF + "size", 100))),
  };
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
    start();
  }
  update(now, o) {
    const style = this.fixed || o.style;
    if (this.style != style) {
      if (this.style) this.root.classList.remove("lumi-clock-" + this.style);
      this.root.classList.add("lumi-clock-" + (this.style = style));
    }
    if (!this.fixed) this.root.style.setProperty("--clock-scale", o.size / 100); // превью стилей в настройках не масштабируются
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
    this.date.hidden = !o.date;
    this.date.textContent = now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
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
let timer = 0;
const tickAll = () => { const now = new Date(), o = options(); for (const c of clocks) c.update(now, o); return now; };
function start() {
  if (timer) return;
  const tick = () => { const now = tickAll(); timer = setTimeout(tick, 1000 - now.getMilliseconds()); };
  timer = setTimeout(tick, 1000 - new Date().getMilliseconds());
  const onPref = () => tickAll();
  Services.prefs.addObserver(PREF, onPref);
  window.addEventListener("unload", () => { Services.prefs.removeObserver(PREF, onPref); clearTimeout(timer); });
}

// на странице Home — часы в #lumi-clock
const home = document.getElementById("lumi-clock");
if (home) window.lumiClock = new Clock(home);
