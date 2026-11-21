// Карточка «Что нового» под поиском Home: один раз после обновления мода. Тексты — home/whatsnew.json (версия → язык → пункты, запасной язык — en).
// Состояние — pref luminoctis.whatsnew.seen (версия): пусто = первая установка (просто запоминаем, ничего не показываем); показ только если версия мода больше seen.
// Нет пунктов для версии — молча запоминаем. Не показывается в приватном окне. Скрыт поиск — карточка стоит на его месте (она следом в #lumi-first).
import { JS } from "./paths.js";
const { t, lang } = ChromeUtils.importESModule(JS("lumi-i18n.sys.mjs"));
const upd = ChromeUtils.importESModule(JS("lumi-update.sys.mjs"));
const SEEN = "luminoctis.whatsnew.seen";
const parts = v => String(v).split(".").map(n => parseInt(n) || 0);
const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) != (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

async function init() {
  if (window.browsingContext.usePrivateBrowsing) return;
  const cur = await upd.installedVersion();
  if (!cur) return;
  const seen = Services.prefs.getStringPref(SEEN, "");
  const done = () => Services.prefs.setStringPref(SEEN, cur);
  if (!seen) return done(); // первая установка
  if (!newer(cur, seen)) return;
  let items;
  try { const v = (await (await fetch(new URL("whatsnew.json", import.meta.url).href)).json())[cur]; items = v?.[lang] || v?.en; } catch {}
  if (!items?.length) return done();
  const card = document.createElement("section"), head = document.createElement("div"), title = document.createElement("h2"), x = document.createElement("button"), ul = document.createElement("ul");
  card.id = "lumi-whatsnew"; head.className = "lumi-wn-head"; title.className = "lumi-wn-title"; x.className = "lumi-wn-close"; ul.className = "lumi-wn-list";
  card.setAttribute("aria-label", t("Что нового в Luminoctis {0}", cur));
  title.textContent = t("Что нового в Luminoctis {0}", cur);
  x.type = "button"; x.title = x.ariaLabel = t("Закрыть");
  x.textContent = "✕";
  x.onclick = () => { done(); card.remove(); };
  for (const s of items) { const li = document.createElement("li"); li.textContent = s; ul.append(li); }
  head.append(title, x);
  card.append(head, ul);
  document.getElementById("lumi-search").after(card);
}
window.lumiWhatsNew = { ready: init().catch(e => console.error("whatsnew", e)), newer };
