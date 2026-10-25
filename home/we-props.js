// Редактор свойств обоев Wallpaper Engine (project.json → general.properties), как панель свойств в самой WE.
// Типы: slider, bool, color («r g b» 0..1), combo, textinput, text (просто подпись); file/directory/scenetexture и др. — не показываются.
// Порядок — order, подписи — localization обоев (we.item → loc), условия condition («a.value == 1 && !b.value») — свой маленький разбор, без eval.
// Значения сохраняет и применяет вызывающий (home/wallpaper.js): onChange(key, value, live) — live = true, пока тянут ползунок.

const TYPES = new Set(["slider", "bool", "color", "combo", "textinput", "text"]);
const KNOWN = { ui_browse_properties_scheme_color: "Цветовая схема", ui_browse_properties_alignment: "Выравнивание" };
// подпись: из localization, общие ключи WE — по-русски, остальные ui_… — «Что-то такое»; html-теги из подписей WE убираются
export function label(item, s) {
  s = String(s ?? "");
  const t = item.loc?.[s] ?? KNOWN[s.toLowerCase()] ?? (/^ui_/i.test(s) ? s.replace(/^ui_(browse_properties_)?/i, "").replace(/_/g, " ") : s);
  const plain = String(t).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}
export const fields = item => Object.entries(item.props ?? {})
  .filter(([, p]) => p && TYPES.has(String(p.type).toLowerCase()))
  .sort(([a, p], [b, q]) => (Number(p.order) || 0) - (Number(q.order) || 0) || a.localeCompare(b));

// условие показа свойства: || && ! ( ) == != === !== < > <= >=, операнды — имя.value, числа, строки, true/false.
// Не разобралось — свойство показывается.
const TOK = /\s*(\|\||&&|===|!==|==|!=|<=|>=|[()!<>]|-?\d+(?:\.\d+)?|"[^"]*"|'[^']*'|[A-Za-z_]\w*(?:\.value)?)/y;
export function cond(src, get) {
  if (!src || typeof src != "string") return true;
  const t = [];
  TOK.lastIndex = 0;
  for (let m; TOK.lastIndex < src.length && (m = TOK.exec(src));) t.push(m[1]);
  if (TOK.lastIndex < src.trim().length && src.slice(TOK.lastIndex).trim()) return true;
  let i = 0;
  const atom = () => {
    const x = t[i++];
    if (x == "!") return !atom();
    if (x == "(") { const v = or(); if (t[i++] != ")") throw 0; return v; }
    if (x == "true" || x == "false") return x == "true";
    if (/^-?\d/.test(x)) return Number(x);
    if (/^["']/.test(x)) return x.slice(1, -1);
    if (/^[A-Za-z_]/.test(x)) return get(x.replace(/\.value$/, ""));
    throw 0;
  };
  const cmp = () => {
    const a = atom(), op = t[i];
    if (!["==", "!=", "===", "!==", "<", ">", "<=", ">="].includes(op)) return a;
    i++;
    const b = atom();
    return { "==": a == b, "===": a === b, "!=": a != b, "!==": a !== b, "<": a < b, ">": a > b, "<=": a <= b, ">=": a >= b }[op];
  };
  const and = () => { let v = cmp(); while (t[i] == "&&") { i++; v = cmp() && v; } return v; };
  const or = () => { let v = and(); while (t[i] == "||") { i++; v = and() || v; } return v; };
  try { const v = or(); return i == t.length ? !!v : true; } catch { return true; }
}

const hex2 = n => Math.round(Math.min(Math.max(n, 0), 1) * 255).toString(16).padStart(2, "0");
const toHex = v => { const c = String(v ?? "").trim().split(/\s+/).map(Number); return c.length >= 3 && c.every(Number.isFinite) ? "#" + c.slice(0, 3).map(hex2).join("") : "#000000"; };
const fromHex = h => [1, 3, 5].map(i => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3).replace(/\.?0+$/, "") || "0").join(" ");
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

// строит ряды свойств в box; values — текущие значения (свои поверх project.json), меняется на месте
export function build(box, item, values, onChange) {
  const rows = [];
  const get = k => (k in values ? values[k] : item.props?.[k]?.value);
  const refresh = () => { for (const [r, p] of rows) r.hidden = !cond(p.condition, get); };
  for (const [key, p] of fields(item)) {
    const type = String(p.type).toLowerCase(), text = label(item, p.text ?? key), v = get(key);
    const set = (val, live = false) => { values[key] = val; refresh(); onChange(key, val, live); };
    let row;
    if (type == "text") row = el("p", { className: "wp-prop-text", textContent: text });
    else if (type == "bool") {
      const c = el("input", { type: "checkbox", checked: !!v });
      c.addEventListener("change", () => set(c.checked));
      row = el("label", { className: "wp-prop wp-prop-bool" }, c, el("span", { textContent: text }));
    } else {
      let input;
      if (type == "slider") {
        const frac = p.fraction ?? !Number.isInteger(Number(p.step ?? 1));
        const step = Number(p.step) > 0 ? Number(p.step) : frac ? 10 ** -(Number(p.precision) || 2) : 1;
        const r = el("input", { type: "range", min: Number(p.min ?? 0), max: Number(p.max ?? 100), step, value: Number(v ?? 0) });
        const out = el("output", { value: String(r.value) });
        r.addEventListener("input", () => { out.value = r.value; set(Number(r.value), true); });
        r.addEventListener("change", () => set(Number(r.value)));
        input = el("span", { className: "wp-prop-range" }, r, out);
      } else if (type == "color") {
        input = el("input", { type: "color", value: toHex(v) });
        input.addEventListener("input", () => set(fromHex(input.value), true));
        input.addEventListener("change", () => set(fromHex(input.value)));
      } else if (type == "combo") {
        const opts = Array.isArray(p.options) ? p.options : [];
        input = el("select", {}, ...opts.map((o, i) => el("option", { value: String(i), textContent: label(item, o?.label ?? o?.value), selected: String(o?.value) == String(v) })));
        input.addEventListener("change", () => set(opts[Number(input.value)]?.value));
      } else { // textinput
        input = el("input", { type: "text", value: String(v ?? ""), spellcheck: false });
        input.addEventListener("change", () => set(input.value));
      }
      row = el("label", { className: "wp-prop" }, el("span", { textContent: text }), input);
    }
    row.dataset.key = key;
    rows.push([row, p]);
    box.append(row);
  }
  refresh();
  return rows.length;
}
