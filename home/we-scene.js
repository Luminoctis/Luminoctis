// Главная картинка сцены Wallpaper Engine из scene.pkg — без привилегий (чистый JS: работает и в node для проверки).
// PKG: строка версии (u32 длина + latin1), u32 число файлов, у каждого имя + u32 offset + u32 length; данные — сразу за таблицей.
// TEX: "TEXV0005" "TEXI0001" (format, flags, texW, texH, imgW, imgH, unk) и контейнер TEXB0001–0004
// (0003+: imageFormat FreeImage, -1 = сырые пиксели, иначе внутри PNG/JPG…; 0004: ещё isVideoMp4), затем мипмапы.
// Главная текстура — самый большой по площади видимый непрозрачный слой-картинка верхнего уровня из scene.json.
const td = new TextDecoder(), latin = new TextDecoder("latin1");

export function readPkg(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  const str = dec => { const n = u32(); const s = dec.decode(bytes.subarray(o, o + n)); o += n; return s; };
  if (!str(latin).startsWith("PKGV")) throw new Error("не scene.pkg");
  const n = u32(), table = [];
  for (let i = 0; i < n; i++) table.push([str(td), u32(), u32()]);
  const files = new Map(table.map(([name, off, len]) => [name, bytes.subarray(o + off, o + off + len)]));
  return files;
}

const json = (files, name) => { try { return JSON.parse(td.decode(files.get(name))); } catch { return null; } };
const vec = v => (typeof v == "string" ? v.split(/\s+/).map(Number) : null);
const SKIP = /(^|\/)(masks|effects)\/|_depth/i;
// имя .tex главного слоя; запасной путь — самая большая подходящая текстура пакета
export function mainTexture(files) {
  const scene = json(files, "scene.json");
  let best = null, area = 0;
  for (const ob of scene?.objects ?? []) {
    if (!ob.image || ob.parent != null || ob.visible === false || ob.visible?.value === false) continue;
    if (typeof ob.alpha == "number" && ob.alpha < 1) continue;
    const mat = json(files, json(files, ob.image)?.material ?? "");
    const tex = mat?.passes?.[0]?.textures?.[0];
    const name = tex && `materials/${tex}.tex`;
    if (!name || SKIP.test(name) || !files.has(name)) continue;
    const [w, h] = vec(ob.size) ?? [0, 0], [sx, sy] = vec(ob.scale) ?? [1, 1], a = w * h * Math.abs(sx * sy);
    if (a > area) { area = a; best = name; } // при равенстве — нижний слой (раньше в списке)
  }
  if (best) return best;
  for (const [name, b] of files) if (name.endsWith(".tex") && !SKIP.test(name) && b.length > (files.get(best)?.length ?? 0)) best = name;
  return best;
}

// .tex → { width, height (видимая часть), image: { mime, bytes } } или { …, rgba (texW×texH), texW }
export function readTex(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = at => latin.decode(bytes.subarray(at, at + 8));
  if (tag(0) != "TEXV0005" || tag(9) != "TEXI0001") throw new Error("не TEX");
  let o = 18;
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; }, i32 = () => { const v = dv.getInt32(o, true); o += 4; return v; };
  const format = u32(); u32(); const texW = u32(), texH = u32(), width = u32(), height = u32(); u32();
  const cont = tag(o); o += 9;
  const ver = +cont.slice(4);
  if (!cont.startsWith("TEXB") || !(ver >= 1 && ver <= 4)) throw new Error("контейнер " + cont);
  u32(); // число картинок (у анимированных — кадры), берём первую
  const imageFormat = ver >= 3 ? i32() : -1;
  if (ver >= 4 && u32()) throw new Error("видео-текстура");
  if (!u32()) throw new Error("нет мипмапов");
  const mw = u32(), mh = u32(), lz4 = ver >= 2 ? u32() : 0, full = ver >= 2 ? u32() : 0, size = u32();
  let data = bytes.subarray(o, o + size);
  if (lz4) data = unlz4(data, full);
  if (imageFormat != -1) return { width, height, image: { mime: MIME[imageFormat] ?? "image/png", bytes: data } };
  return { width: Math.min(width, mw), height: Math.min(height, mh), texW: mw, rgba: pixels(format, data, mw, mh) };
}
const MIME = { 0: "image/bmp", 2: "image/jpeg", 13: "image/png", 25: "image/gif", 35: "image/webp" }; // коды FreeImage

export function unlz4(src, size) {
  const out = new Uint8Array(size);
  let i = 0, o = 0;
  while (i < src.length) {
    const t = src[i++];
    let n = t >> 4;
    if (n == 15) { let b; do { b = src[i++]; n += b; } while (b == 255); }
    out.set(src.subarray(i, i + n), o); i += n; o += n;
    if (i >= src.length) break;
    const off = src[i] | (src[i + 1] << 8); i += 2;
    let m = (t & 15) + 4;
    if ((t & 15) == 15) { let b; do { b = src[i++]; m += b; } while (b == 255); }
    for (let k = 0; k < m; k++, o++) out[o] = out[o - off]; // совпадение может перекрываться — по байту
  }
  if (o != size) throw new Error("LZ4: размер не сошёлся");
  return out;
}

// сырые пиксели формата WE → RGBA w×h
function pixels(format, d, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  if (format == 0) { out.set(d.subarray(0, out.length)); return out; }
  if (format == 8 || format == 9) { // RG88 / R8 — серые
    const step = format == 8 ? 2 : 1;
    for (let p = 0; p < w * h; p++) { const v = d[p * step]; out.set([v, v, v, format == 8 ? d[p * 2 + 1] : 255], p * 4); }
    return out;
  }
  const bs = format == 7 ? 8 : format == 4 || format == 6 ? 16 : 0;
  if (!bs) throw new Error("формат текстуры " + format);
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4), col = new Uint8Array(16), alpha = new Uint8Array(16), pal = new Uint8Array(8);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let b = (by * bw + bx) * bs;
    if (format == 4) { // DXT5: два опорных значения альфы + 3-битные индексы
      const a0 = d[b], a1 = d[b + 1];
      pal[0] = a0; pal[1] = a1;
      if (a0 > a1) for (let k = 1; k < 7; k++) pal[k + 1] = ((7 - k) * a0 + k * a1) / 7;
      else { for (let k = 1; k < 5; k++) pal[k + 1] = ((5 - k) * a0 + k * a1) / 5; pal[6] = 0; pal[7] = 255; }
      let bits = 0, nb = 0, q = b + 2;
      for (let k = 0; k < 16; k++) { if (nb < 3) { bits |= d[q++] << nb; nb += 8; } alpha[k] = pal[bits & 7]; bits >>= 3; nb -= 3; }
      b += 8;
    } else if (format == 6) { // DXT3: явные 4-битные альфы
      for (let k = 0; k < 16; k++) alpha[k] = ((d[b + (k >> 1)] >> ((k & 1) * 4)) & 15) * 17;
      b += 8;
    } else alpha.fill(255);
    const c0 = d[b] | (d[b + 1] << 8), c1 = d[b + 2] | (d[b + 3] << 8), four = format != 7 || c0 > c1;
    const rgb = c => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
    const p0 = rgb(c0), p1 = rgb(c1);
    for (let k = 0; k < 3; k++) {
      col[k] = p0[k]; col[4 + k] = p1[k];
      col[8 + k] = four ? (2 * p0[k] + p1[k]) / 3 : (p0[k] + p1[k]) / 2;
      col[12 + k] = four ? (p0[k] + 2 * p1[k]) / 3 : 0;
    }
    col[3] = col[7] = col[11] = 255; col[15] = four ? 255 : 0;
    const idx = d[b + 4] | (d[b + 5] << 8) | (d[b + 6] << 16) | (d[b + 7] << 24);
    for (let k = 0; k < 16; k++) {
      const x = bx * 4 + (k & 3), y = by * 4 + (k >> 2);
      if (x >= w || y >= h) continue;
      const c = ((idx >>> (2 * k)) & 3) * 4, q = (y * w + x) * 4;
      out[q] = col[c]; out[q + 1] = col[c + 1]; out[q + 2] = col[c + 2];
      out[q + 3] = format == 7 ? col[c + 3] : alpha[k];
    }
  }
  return out;
}

// scene.pkg (байты) → результат readTex главной текстуры (+ name)
export function extract(bytes) {
  const files = readPkg(bytes), name = mainTexture(files);
  if (!name) throw new Error("в сцене нет картинки");
  return { name, ...readTex(files.get(name)) };
}
