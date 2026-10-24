// Эквалайзер Luminoctis Home: спектр звука вкладок браузера (актор home/eq-actor.sys.mjs) → свой визуализатор и веб-обои Wallpaper Engine.
// Работает, только пока Home видна: ~30 раз в секунду спрашивает вкладки со звуком (атрибут soundplaying) во всех окнах.
// Prefs: luminoctis.home.eq.enabled (по умолчанию выкл. — подключение меняет звуковой граф страницы), luminoctis.home.eq.style (off|bars|ring).
// Веб-обои получают 128 чисел (64 L + 64 R) и без эквалайзера — нулями, как Wallpaper Engine без звука.
import * as we from "./we.js";

const prefs = Services.prefs, ON = "luminoctis.home.eq.enabled", STYLE = "luminoctis.home.eq.style";
const ACTOR_URL = "chrome://userchrome/content/luminoctis/home/eq-actor.sys.mjs";
const N = 128, ZERO = new Array(N).fill(0);
const on = () => prefs.getBoolPref(ON, false), style = () => prefs.getStringPref(STYLE, "bars");

function register() {
  try { ChromeUtils.registerWindowActor("LumiEq", { parent: { esModuleURI: ACTOR_URL }, child: { esModuleURI: ACTOR_URL }, allFrames: true,
    remoteTypes: ["web", "webIsolated", "webCOOP+COEP", "file"], // сайты и file://
    safeForUntrustedWebProcess: true }); } // без него Gecko не пускает актор в процессы сайтов; родительская сторона ничего не умеет — безопасно
  catch (e) { if (e.name != "NotSupportedError") console.error("Luminoctis эквалайзер:", e); } // уже зарегистрирован (другая Home)
}

// спектр всех играющих вкладок (максимум по каждой полосе); нет звука — null
export async function pull() {
  const asks = [];
  for (const w of Services.wm.getEnumerator("navigator:browser"))
    for (const t of w.gZenWorkspaces?.allStoredTabs ?? w.gBrowser.tabs) {
      if (!t.hasAttribute("soundplaying") || t.hasAttribute("muted")) continue;
      for (const bc of t.linkedBrowser?.browsingContext?.getAllBrowsingContextsInSubtree() ?? [])
        try { asks.push(bc.currentWindowGlobal.getActor("LumiEq").sendQuery("spectrum").catch(() => null)); } catch {}
    }
  let out = null;
  for (const s of await Promise.all(asks)) {
    if (!s?.length) continue;
    out ??= new Array(N).fill(0);
    for (let i = 0; i < N; i++) out[i] = Math.max(out[i], s[i] || 0);
  }
  return out;
}

// ---------- визуализатор: холст поверх обоев, под часами и досками ----------
const root = document.getElementById("lumi-wallpaper");
const canvas = Object.assign(document.createElement("canvas"), { className: "lumi-eq" });
root.append(canvas);
const g = canvas.getContext("2d");
const level = new Float32Array(N);
let drawn = false, accent = "#7aa2f7", accentAt = 0;

function draw(arr) { // arr = null — эквалайзер выключен: стереть сразу, без затухания
  if (!arr) { level.fill(0); arr = ZERO; }
  let any = false;
  for (let i = 0; i < N; i++) { level[i] = Math.max(arr[i], level[i] * 0.86); any ||= level[i] > 0.01; }
  const dpr = devicePixelRatio, W = innerWidth, H = innerHeight;
  if (canvas.width != Math.round(W * dpr) || canvas.height != Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  drawn = any;
  if (!any) return;
  if (Date.now() - accentAt > 1000) { accentAt = Date.now(); accent = getComputedStyle(document.documentElement).getPropertyValue("--lumi-accent").trim() || accent; }
  g.fillStyle = g.strokeStyle = accent;
  const half = N / 2;
  if (style() == "ring") {
    const r = document.getElementById("lumi-clock").getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, r0 = Math.max(r.width, r.height) / 2 + 22;
    g.lineWidth = Math.max(2, (2 * Math.PI * r0) / N * 0.5);
    g.lineCap = "round";
    g.globalAlpha = 0.7;
    g.beginPath();
    for (let i = 0; i < half; i++) // левый канал — справа сверху вниз, правый — зеркально слева; низкие частоты сверху
      for (const [v, a] of [[level[i], (i / half) * Math.PI], [level[half + i], -(i / half) * Math.PI]]) {
        const len = 3 + v * 64, s = Math.sin(a), c = -Math.cos(a);
        g.moveTo(cx + s * r0, cy + c * r0);
        g.lineTo(cx + s * (r0 + len), cy + c * (r0 + len));
      }
    g.stroke();
  } else { // столбики над досками: басы в центре, левый канал влево, правый вправо
    const box = document.getElementById("lumi-notes").getBoundingClientRect();
    const width = box.width * 0.7, x0 = box.left + (box.width - width) / 2, base = box.top - 6, step = width / N, bw = Math.max(2, step * 0.6);
    const grad = g.createLinearGradient(0, base - 110, 0, base);
    grad.addColorStop(0, accent); grad.addColorStop(1, "transparent");
    g.fillStyle = grad;
    g.globalAlpha = 0.85;
    for (let i = 0; i < half; i++)
      for (const [v, k] of [[level[i], half - 1 - i], [level[half + i], half + i]]) {
        const h = Math.max(2, v * 110);
        g.beginPath();
        g.roundRect(x0 + k * step + (step - bw) / 2, base - h, bw, h, bw / 2);
        g.fill();
      }
  }
  g.globalAlpha = 1;
}

// ---------- цикл: только пока Home видна ----------
let timer = 0, busy = false, last = ZERO, fake = null;
async function tick() {
  if (busy) return;
  const eq = on(), listen = we.hasListeners();
  if (!eq && !listen && !drawn) return;
  busy = true;
  try {
    last = fake ?? (eq ? await pull() : null) ?? ZERO;
    if (listen) we.feed(last);
    draw(eq && style() != "off" ? last : null);
  } catch (e) { console.warn("Luminoctis эквалайзер:", e); }
  finally { busy = false; }
}
function run() {
  clearInterval(timer);
  timer = 0;
  if (on()) register();
  if (!document.hidden) timer = setInterval(tick, 33);
}
document.addEventListener("visibilitychange", run);
prefs.addObserver("luminoctis.home.eq.", run);
window.addEventListener("unload", () => { prefs.removeObserver("luminoctis.home.eq.", run); clearInterval(timer); });
run();

// для проверок (dev/check-home-we.js): fake — подставной спектр вместо вкладок
window.lumiEq = { pull, tick, get last() { return last; }, get level() { return [...level]; }, set fake(a) { fake = a; }, get running() { return !!timer; } };
