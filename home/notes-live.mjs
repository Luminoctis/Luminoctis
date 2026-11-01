// LumiNotes: живой редактор листа-документа (как Live Preview в Obsidian), без внешних библиотек.
// Источник истины — строка Markdown (doc). Каждая строка документа — блок .lumi-ln с оформлением; сама разметка (** * ~~ ` # [](…) - [ ]) лежит в DOM
// отдельными span'ами .md-mark, поэтому текст DOM всегда равен исходнику, а положение каретки = смещение в тексте (Range.toString считает и скрытое).
// Разметка скрыта CSS (display:none), пока каретка/выделение её не касается: тогда фрагмент помечается .act (строка — .on) и маркеры видны приглушённо.
// Весь ввод идёт через beforeinput → правка модели → перерисовка изменившихся строк → каретка по смещению. Родной undo ломается при перерисовке — своя история.
// Составной ввод (IME) родной: во время него DOM не трогаем, после compositionend читаем текст из DOM и перерисовываем.
// Поддержано: # … ######, **жирный**/__жирный__, *курсив*/_курсив_, ~~зачёркнутый~~, `код`, [текст](url), голые https-ссылки, списки - * + (вложенные, Tab/Shift+Tab),
// задачи - [ ] / - [x] (настоящая галочка), цитата "> ", разделитель ---, даты 🛫/📅 ГГГГ-ММ-ДД. Остальное показывается как текст.
const HEAD = /^(#{1,6})([ \t])/;
const LIST = /^([ \t]*)([-*+]) (\[[ xX]\](?: |$))?/;
const QUOTE = /^>[ ]?/;
const HR = /^ {0,3}([-*_])(?: ?\1){2,}[ \t]*$/;
// 1 код, 2–3 ссылка [подпись](адрес), 4 **, 5 __, 6 ~~, 7 *, 8 _, 9 голая ссылка, 10 дата
const INL = /`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(\S(?:[^\n]*?\S)?)\*\*|(?<![\w_])__(\S(?:[^\n]*?\S)?)__(?![\w_])|~~(\S(?:[^\n]*?\S)?)~~|(?<![\w*])\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?![\w*])|(?<![\w_])_(\S(?:[^_\n]*?\S)?)_(?![\w_])|(https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]])|([\u{1F6EB}\u{1F4C5}]️?[ \t]*\d{4}-\d{2}-\d{2})/gu;
const WORD = /[\p{L}\p{N}_]/u;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const cols = ws => { let c = 0; for (const ch of ws) c += ch == "\t" ? 4 : 1; return c; };
const pad2 = n => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

// ---------- разбор строки → дерево (смещения s/e — от начала строки) ----------
function parseInline(text, base, plain) { // plain — внутри подписи ссылки (ссылок нет)
  const out = [];
  let at = 0;
  for (const m of text.matchAll(INL)) {
    if (plain && (m[2] !== undefined || m[9] !== undefined)) continue;
    if (m.index > at) out.push({ k: "t", s: text.slice(at, m.index) });
    const s = base + m.index, e = s + m[0].length;
    at = m.index + m[0].length;
    const wrap = (k, n, inner) => out.push({ k, s, e, open: m[0].slice(0, n), close: m[0].slice(m[0].length - n), kids: parseInline(inner, s + n, plain) });
    if (m[1] !== undefined) out.push({ k: "code", s, e, open: "`", close: "`", kids: [{ k: "t", s: m[1] }] });
    else if (m[2] !== undefined) out.push({ k: "a", s, e, open: "[", close: `](${m[3]})`, href: m[3], kids: parseInline(m[2], s + 1, true) });
    else if (m[4] !== undefined) wrap("b", 2, m[4]);
    else if (m[5] !== undefined) wrap("b", 2, m[5]);
    else if (m[6] !== undefined) wrap("s", 2, m[6]);
    else if (m[7] !== undefined) wrap("i", 1, m[7]);
    else if (m[8] !== undefined) wrap("i", 1, m[8]);
    else if (m[9] !== undefined) out.push({ k: "url", s: m[9], href: m[9] });
    else out.push({ k: "date", s: m[10] });
  }
  if (at < text.length) out.push({ k: "t", s: text.slice(at) });
  return out;
}
const mark = (txt, cls = "") => el("span", "md-mark" + cls, txt);
function dateState(text, done, today) { // как метки дат в карточках: off / late / today / wait / go
  const d = /\d{4}-\d{2}-\d{2}/.exec(text)[0], due = text.codePointAt(0) == 0x1F4C5;
  if (done) return "off";
  if (due) return today > d ? "late" : today == d ? "today" : "go";
  return today < d ? "wait" : "go";
}
function build(nodes, ctx) {
  return nodes.map(n => {
    if (n.k == "t") return document.createTextNode(n.s);
    if (n.k == "url") { const a = el("span", "lf-url", n.s); a.dataset.href = n.href; return a; }
    if (n.k == "date") { const d = el("span", "lf-date", n.s); d.dataset.state = dateState(n.s, ctx.done, ctx.today); return d; }
    const f = el("span", `lf lf-${n.k}`);
    f.dataset.s = n.s;
    f.dataset.e = n.e;
    if (n.href) f.dataset.href = n.href;
    f.append(mark(n.open), ...build(n.kids, ctx), mark(n.close));
    return f;
  });
}
function buildLine(s, today) { // одна строка текста → .lumi-ln; всё текстовое содержимое строки (включая маркеры) остаётся в DOM
  const ln = el("div", "lumi-ln"), ctx = { done: false, today };
  const body = from => { const c = el("span", "lc"); c.append(...build(parseInline(s.slice(from), from, false), ctx)); return c; };
  let m;
  if (!s) { ln.append(document.createElement("br")); return ln; }
  if (HR.test(s)) { ln.classList.add("hr"); ln.append(s); }
  else if ((m = HEAD.exec(s))) {
    ln.classList.add("h");
    ln.dataset.level = m[1].length;
    ln.append(mark(m[0], " blk"), body(m[0].length));
  } else if ((m = LIST.exec(s))) {
    const [all, ws, ch, cb] = m;
    ln.classList.add("li");
    ln.style.setProperty("--d", Math.ceil(cols(ws) / 4));
    if (ws) ln.append(el("span", "md-ws", ws));
    ln.append(el("span", "lumi-lm" + (cb ? " task" : ""), ch + " "));
    if (cb) {
      ctx.done = /[xX]/.test(cb);
      ln.classList.add("task");
      if (ctx.done) ln.classList.add("done");
      const c = el("span", "lumi-cb" + (ctx.done ? " chk" : ""), cb);
      c.dataset.s = ws.length + 2;
      c.dataset.e = ws.length + 2 + cb.length;
      ln.append(c);
    }
    ln.append(body(all.length));
  } else if ((m = QUOTE.exec(s))) {
    ln.classList.add("q");
    ln.append(mark(m[0], " blk"), body(m[0].length));
  } else ln.append(body(0));
  return ln;
}

// ---------- редактор ----------
// opts: text, onChange(text), onLink(href), onBlur()
export function createLive({ text = "", onChange, onLink, onBlur } = {}) {
  const root = el("div", "lumi-cards lumi-doc lumi-live");
  root.contentEditable = "plaintext-only";
  if (root.contentEditable != "plaintext-only") root.contentEditable = "true";
  root.spellcheck = false;
  root.setAttribute("role", "textbox");
  root.setAttribute("aria-multiline", "true");
  let doc = text.replace(/\r\n?/g, "\n"), lines = doc.split("\n");
  let shown = [], dirty = true; // shown — строки, нарисованные сейчас; dirty — DOM мог измениться без нас (IME), перерисовать всё
  let focused = false, composing = false, comp = null, act = [];
  const hist = { undo: [], redo: [] };
  let last = { kind: null, t: 0, ws: false, caret: -1 };

  const starts = () => { let o = 0; return lines.map(l => { const s = o; o += l.length + 1; return s; }); };
  const lineAt = abs => { let o = 0; for (let i = 0; i < lines.length; i++) { if (abs <= o + lines[i].length) return i; o += lines[i].length + 1; } return lines.length - 1; };
  const readDom = () => [...root.childNodes].map(n => n.textContent).join("\n").replace(/\r/g, "");

  function rebuild() { // перерисовываются только изменившиеся строки (общие начало и конец остаются как были)
    let i = 0, j = 0;
    if (!dirty) {
      const n = Math.min(shown.length, lines.length);
      while (i < n && shown[i] === lines[i]) i++;
      while (j < n - i && shown[shown.length - 1 - j] === lines[lines.length - 1 - j]) j++;
    }
    const kids = root.children, drop = shown.length - i - j, ref = dirty ? null : kids[i + drop] ?? null;
    if (dirty) root.replaceChildren(); else for (let k = 0; k < drop; k++) kids[i].remove();
    const df = document.createDocumentFragment(), today = todayStr();
    for (const l of lines.slice(i, lines.length - j)) df.append(buildLine(l, today));
    root.insertBefore(df, ref);
    shown = lines.slice();
    dirty = false;
    root.toggleAttribute("data-empty", doc === "");
  }

  // ---------- каретка: DOM ↔ смещение в тексте ----------
  function offsetOf(node, off) {
    if (node === root) return off < lines.length ? starts()[off] : doc.length;
    const ln = (node.nodeType == 3 ? node.parentElement : node).closest(".lumi-ln");
    if (!ln) return doc.length;
    const r = document.createRange();
    r.setStart(ln, 0);
    r.setEnd(node, off);
    return starts()[Array.prototype.indexOf.call(root.children, ln)] + r.toString().length;
  }
  function selOffsets() {
    const s = getSelection();
    if (!s.rangeCount || !root.contains(s.anchorNode) || !root.contains(s.focusNode)) return null;
    const x = offsetOf(s.anchorNode, s.anchorOffset), y = offsetOf(s.focusNode, s.focusOffset);
    return { a: Math.min(x, y), b: Math.max(x, y) };
  }
  function pointAt(abs) {
    let i = 0, o = 0;
    while (i < lines.length - 1 && abs > o + lines[i].length) { o += lines[i].length + 1; i++; }
    const ln = root.children[i], col = abs - o;
    if (!lines[i]) return [ln, 0];
    const w = document.createTreeWalker(ln, NodeFilter.SHOW_TEXT);
    let n, acc = 0;
    while ((n = w.nextNode())) { // скрытый отступ (.md-ws) — не место для каретки
      if (col <= acc + n.length && !n.parentElement.closest(".md-ws")) return [n, col - acc];
      acc += n.length;
    }
    return [ln, ln.childNodes.length];
  }
  // какие маркеры показать: строки с кареткой/выделением (.on), фрагменты, которых оно касается (.act), галочка — только если каретка внутри её текста (.raw)
  function paint(a, b) {
    for (const n of act) n.classList.remove("on", "act", "raw");
    act = [];
    if (!focused) return;
    const st = starts(), i1 = lineAt(b);
    for (let i = lineAt(a); i <= i1; i++) {
      const ln = root.children[i];
      if (!ln) continue;
      const ra = a - st[i], rb = b - st[i];
      ln.classList.add("on");
      act.push(ln);
      for (const f of ln.querySelectorAll(".lf")) if (ra <= +f.dataset.e && rb >= +f.dataset.s) { f.classList.add("act"); act.push(f); }
      const c = ln.querySelector(".lumi-cb");
      if (c && (ra == rb ? +c.dataset.s < ra && ra < +c.dataset.e : ra < +c.dataset.e && rb > +c.dataset.s)) { c.classList.add("raw"); act.push(c); }
    }
  }
  function place(a, b = a) { // сначала маркеры (чтобы каретка не оказалась в скрытом узле), потом выделение
    paint(a, b);
    if (document.activeElement !== root) return;
    const [n1, o1] = pointAt(a), [n2, o2] = pointAt(b);
    getSelection().setBaseAndExtent(n1, o1, n2, o2);
    const ln = root.children[lineAt(b)];
    if (ln) { // прокрутить только сам редактор, не страницу
      const r = ln.getBoundingClientRect(), c = root.getBoundingClientRect();
      if (r.bottom > c.bottom) root.scrollTop += r.bottom - c.bottom + 4; else if (r.top < c.top) root.scrollTop -= c.top - r.top + 4;
    }
  }
  function onSel() {
    if (!root.isConnected) return document.removeEventListener("selectionchange", onSel);
    if (composing) return;
    const o = selOffsets();
    if (o && focused) paint(o.a, o.b);
  }
  document.addEventListener("selectionchange", onSel);

  // ---------- правка модели и история ----------
  function note(kind, ch, sel) { // новый шаг истории: пауза, другой вид правки, каретка ушла, новое слово
    const t = performance.now(), ws = !!ch && /^\s+$/.test(ch);
    if (!hist.undo.length || kind == "other" || kind != last.kind || t - last.t > 900 || sel.a != last.caret || sel.b != sel.a || (kind == "ins" && !ws && last.ws)) {
      hist.undo.push({ text: doc, a: sel.a, b: sel.b });
      if (hist.undo.length > 300) hist.undo.shift();
    }
    hist.redo.length = 0;
    last = { kind, t, ws, caret: -1 };
  }
  function commit(next, a, b, kind, ch, before) {
    if (next === doc && !dirty) return place(a, b);
    note(kind, ch, before ?? { a: 0, b: 0 });
    doc = next;
    lines = doc.split("\n");
    rebuild();
    last.caret = a == b ? a : -1;
    place(a, b);
    onChange?.(doc);
  }
  const edit = (from, to, ins, kind, sel, caret = from + ins.length) => commit(doc.slice(0, from) + ins + doc.slice(to), caret, caret, kind, ins, sel);
  function restore(e) {
    doc = e.text;
    lines = doc.split("\n");
    rebuild();
    last = { kind: null, t: 0, ws: false, caret: -1 };
    place(e.a, e.b);
    onChange?.(doc);
  }
  function undo() {
    const e = hist.undo.pop();
    if (!e) return;
    const cur = selOffsets() ?? { a: doc.length, b: doc.length };
    hist.redo.push({ text: doc, a: cur.a, b: cur.b });
    restore(e);
  }
  function redo() {
    const e = hist.redo.pop();
    if (!e) return;
    const cur = selOffsets() ?? { a: doc.length, b: doc.length };
    hist.undo.push({ text: doc, a: cur.a, b: cur.b });
    restore(e);
  }
  function wordEdge(p, dir) { // граница слова: пробелы, затем слово (буквы/цифры) или знаки
    const at = i => (dir < 0 ? doc[i - 1] : doc[i]), lim = dir < 0 ? 0 : doc.length;
    let i = p;
    while (i != lim && /[ \t]/.test(at(i))) i += dir;
    if (i != lim && at(i) == "\n") return i + dir;
    const w = i != lim && WORD.test(at(i));
    while (i != lim && at(i) != "\n" && !/[ \t]/.test(at(i)) && WORD.test(at(i)) == w) i += dir;
    return i;
  }
  function del(sel, dir, unit) {
    let { a, b } = sel;
    if (a == b) {
      const st = starts(), i = lineAt(a), col = a - st[i], line = lines[i];
      if (unit == "word") { if (dir < 0) a = wordEdge(a, -1); else b = wordEdge(b, 1); }
      else if (unit == "line") { if (dir < 0) a = st[i]; else b = st[i] + line.length; }
      else if (dir < 0) {
        const mk = (LIST.exec(line) ?? HEAD.exec(line) ?? QUOTE.exec(line))?.[0].length; // Backspace сразу после маркера убирает маркер целиком
        if (mk && col == mk) a = st[i];
        else if (a > 0) a -= /[\uDC00-\uDFFF]/.test(doc[a - 1]) && a > 1 ? 2 : 1;
      } else if (b < doc.length) b += /[\uD800-\uDBFF]/.test(doc[b]) ? 2 : 1;
    }
    if (a == b) return;
    edit(a, b, "", "del", sel, a);
  }
  function enter(sel) { // Enter: в списке продолжает список (пустой пункт — выход из списка), в цитате — цитату
    const st = starts(), i = lineAt(sel.a), line = lines[i], col = sel.a - st[i];
    const l = LIST.exec(line), q = !l && QUOTE.exec(line), mk = l ?? q;
    if (mk && col >= mk[0].length) {
      if (sel.a == sel.b && !line.slice(mk[0].length).trim()) return edit(st[i], st[i] + line.length, "", "other", sel, st[i]);
      return edit(sel.a, sel.b, "\n" + (l ? l[1] + l[2] + " " + (l[3] ? "[ ] " : "") : mk[0]), "other", sel);
    }
    edit(sel.a, sel.b, "\n", "other", sel);
  }
  function tab(sel, back) { // Tab / Shift+Tab: отступ пунктов списка (таб, как пишет serialize); вне списка Tab — символ табуляции
    const st = starts(), i0 = lineAt(sel.a), i1 = lineAt(sel.b), next = lines.slice();
    const cut = []; // [начало строки, +1 вставлено | −k убрано]
    for (let i = i0; i <= i1; i++) {
      if (!LIST.test(lines[i])) continue;
      if (!back) { next[i] = "\t" + lines[i]; cut.push([st[i], 1]); }
      else {
        const k = lines[i][0] == "\t" ? 1 : Math.min(4, /^ */.exec(lines[i])[0].length);
        if (k) { next[i] = lines[i].slice(k); cut.push([st[i], -k]); }
      }
    }
    if (!cut.length) { if (back || sel.a != sel.b) return false; edit(sel.a, sel.b, "\t", "other", sel); return true; }
    const at = p => cut.reduce((acc, [s, d]) => acc + (d > 0 ? (p >= s ? d : 0) : -Math.min(Math.max(p - s, 0), -d)), p);
    commit(next.join("\n"), at(sel.a), at(sel.b), "other", "", sel);
    return true;
  }

  // ---------- события ----------
  root.addEventListener("beforeinput", e => {
    if (composing || e.isComposing) return; // составной ввод — родной
    const t = e.inputType, sel = selOffsets();
    if (!sel) return;
    const D = { deleteContentBackward: [-1, "char"], deleteContentForward: [1, "char"], deleteWordBackward: [-1, "word"], deleteWordForward: [1, "word"],
      deleteSoftLineBackward: [-1, "line"], deleteHardLineBackward: [-1, "line"], deleteSoftLineForward: [1, "line"], deleteHardLineForward: [1, "line"] }[t];
    if (t == "insertText") { e.preventDefault(); const d = e.data ?? e.dataTransfer?.getData("text/plain"); if (d) edit(sel.a, sel.b, d, "ins", sel); }
    else if (t == "insertParagraph") { e.preventDefault(); enter(sel); }
    else if (t == "insertLineBreak") { e.preventDefault(); edit(sel.a, sel.b, "\n", "other", sel); }
    else if (D) { e.preventDefault(); del(sel, ...D); }
    else if (t == "deleteByCut" || t == "deleteContent") { e.preventDefault(); if (sel.a != sel.b) edit(sel.a, sel.b, "", "other", sel, sel.a); }
    else if (t == "historyUndo") { e.preventDefault(); undo(); }
    else if (t == "historyRedo") { e.preventDefault(); redo(); }
    else if (t.startsWith("format") || t.startsWith("insertFromPaste") || t == "insertFromDrop") e.preventDefault(); // оформления нет, вставка — в paste
  });
  root.addEventListener("input", e => { // родная правка, которую мы не перехватили: прочитать текст и перерисовать
    if (composing || e.isComposing) return;
    const t = readDom();
    if (t === doc) return;
    const sel = selOffsets() ?? { a: t.length, b: t.length };
    dirty = true;
    commit(t, sel.a, sel.a, "other", "", sel);
  });
  root.addEventListener("compositionstart", () => { composing = true; comp = selOffsets(); });
  root.addEventListener("compositionend", () => {
    composing = false;
    const t = readDom(), sel = selOffsets() ?? { a: t.length, b: t.length };
    dirty = true;
    commit(t, sel.a, sel.a, "other", "", comp ?? sel);
    comp = null;
  });
  root.addEventListener("paste", e => { // только текст: оформление и картинки из буфера не нужны
    e.preventDefault();
    const sel = selOffsets(), t = (e.clipboardData?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n");
    if (sel && t) edit(sel.a, sel.b, t, "other", sel);
  });
  const clip = (e, cut) => { // копируем исходный текст вместе со скрытой разметкой
    const sel = selOffsets();
    if (!sel || sel.a == sel.b) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", doc.slice(sel.a, sel.b));
    if (cut) edit(sel.a, sel.b, "", "other", sel, sel.a);
  };
  root.addEventListener("copy", e => clip(e, false));
  root.addEventListener("cut", e => clip(e, true));
  root.addEventListener("dragover", e => e.preventDefault());
  root.addEventListener("drop", e => e.preventDefault());
  root.addEventListener("keydown", e => {
    if (e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && e.code == "KeyZ") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && !e.altKey && e.code == "KeyY") { e.preventDefault(); redo(); }
    else if (e.key == "Enter" && !mod) { e.preventDefault(); const sel = selOffsets(); if (sel) e.shiftKey ? edit(sel.a, sel.b, "\n", "other", sel) : enter(sel); } // Shift+Enter — просто перенос
    else if (e.key == "Tab" && !mod && !e.altKey) { const sel = selOffsets(); if (sel && tab(sel, e.shiftKey)) e.preventDefault(); }
    else if (e.key == "Escape") { e.preventDefault(); e.stopPropagation(); root.blur(); }
  });
  root.addEventListener("mousedown", e => { if (e.target.closest?.(".lumi-cb:not(.raw)")) e.preventDefault(); }); // галочка не уводит каретку
  root.addEventListener("click", e => {
    const cb = e.target.closest?.(".lumi-cb:not(.raw)"), link = e.target.closest?.(".lf-a, .lf-url");
    if (cb) { // [ ] ↔ [x] прямо в тексте строки; выделение остаётся на месте
      const i = Array.prototype.indexOf.call(root.children, cb.parentNode), p = starts()[i] + +cb.dataset.s + 1, sel = selOffsets();
      const next = doc.slice(0, p) + (doc[p] == " " ? "x" : " ") + doc.slice(p + 1);
      commit(next, sel?.a ?? 0, sel?.b ?? 0, "other", "", sel ?? { a: 0, b: 0 });
    } else if (link && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onLink?.(link.dataset.href); }
  });
  root.addEventListener("focus", () => { focused = true; onSel(); });
  root.addEventListener("blur", () => { focused = false; paint(0, 0); onBlur?.(); });

  rebuild();
  const api = { el: root, get text() { return doc; }, place, sel: selOffsets, undo, redo, focus() { root.focus(); place(doc.length); } };
  root._live = api; // для dev/check-home-notes.js
  return api;
}
