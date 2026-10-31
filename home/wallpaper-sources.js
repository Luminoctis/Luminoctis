// Источники обоев Luminoctis Home (используются home/wallpaper.js). Каждый источник — async-функция без аргументов,
// возвращает список { source, id, kind, url|file, page, author }. Сбой источника не страшен: wallpaper.js его просто пропускает.
// Настройки — luminoctis.home.wallpaper.*; ключи: key.wallhaven (необязательный, нужен для NSFW), key.unsplash, key.pexels.
// Сеть идёт через net.json — в проверках (dev/check-wallpaper-sources.js) он подменяется заглушкой.
// Безопасность: Yande.re, Konachan, Safebooru — только safe (в запросе и фильтром), Reddit — без over_18, Wallhaven — SFW (+ Sketchy;
// NSFW только если задан ключ Wallhaven и включена отметка).
import * as store from "./store.js";

const P = "luminoctis.home.wallpaper.", prefs = Services.prefs;
const bool = (n, d = false) => prefs.getBoolPref(P + n, d), str = (n, d = "") => prefs.getStringPref(P + n, d);
export const IMG = /\.(jpe?g|png|webp|gif|apng|avif|bmp|svg)$/i, VID = /\.(mp4|webm|ogv)$/i;
const words = () => str("query").trim();
const sorting = () => str("sorting", "random"); // random | toplist | hot
const key = name => str("key." + name).trim();

export const net = {
  async json(url, headers) {
    const r = await fetch(url, { credentials: "omit", headers });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  },
};
// теги boorus: слова запроса (до 4) + порядок
const tagsOf = (...fixed) => encodeURIComponent([...fixed, ...words().split(/\s+/).filter(Boolean).slice(0, 4),
  sorting() == "random" ? "order:random" : "order:score"].join(" "));
const landscape = p => p.width > p.height;

export const localDir = () => str("folder").trim() || store.path("wallpapers/local");
export const sources = {
  async wallhaven() {
    const legacy = str("category", "all"); // старая настройка «Всё / Аниме / Общие» — значения по умолчанию для новых отметок
    const cats = [bool("wh.general", legacy != "anime"), bool("wh.anime", legacy != "general"), bool("wh.people")].map(Number).join("");
    const k = key("wallhaven");
    const q = new URLSearchParams({ q: words(), categories: cats == "000" ? "100" : cats,
      purity: `1${Number(bool("wh.sketchy"))}${Number(!!k && bool("wh.nsfw"))}`, sorting: sorting() == "hot" ? "hot" : sorting() == "toplist" ? "toplist" : "random" });
    if (sorting() == "toplist") q.set("topRange", "1M");
    const ratios = str("wh.ratios") || "landscape", atleast = str("wh.atleast"); // пусто = горизонтальные, any = любые
    if (ratios != "any") q.set("ratios", ratios);
    if (atleast) q.set("atleast", atleast);
    if (k) q.set("apikey", k);
    const { data } = await net.json("https://wallhaven.cc/api/v1/search?" + q);
    return data.map(w => ({ source: "wallhaven", id: w.id, kind: "image", url: w.path, page: w.url }));
  },
  async unsplash() {
    const k = key("unsplash");
    if (!k) return [];
    const q = new URLSearchParams({ count: "20", orientation: "landscape", client_id: k });
    if (words()) q.set("query", words());
    const list = await net.json("https://api.unsplash.com/photos/random?" + q);
    return list.map(p => ({ source: "unsplash", id: p.id, kind: "image", url: p.urls.raw + (p.urls.raw.includes("?") ? "&" : "?") + "w=2560&q=80",
      page: p.links?.html, author: p.user?.name }));
  },
  async pexels() {
    const k = key("pexels");
    if (!k) return [];
    const url = words() ? "https://api.pexels.com/v1/search?" + new URLSearchParams({ query: words(), orientation: "landscape", per_page: "40" })
      : "https://api.pexels.com/v1/curated?per_page=40";
    const { photos } = await net.json(url, { Authorization: k });
    return photos.filter(landscape).map(p => ({ source: "pexels", id: String(p.id), kind: "image", url: p.src.large2x || p.src.original, page: p.url, author: p.photographer }));
  },
  async reddit() {
    const subs = str("reddit.subs", "wallpapers, wallpaper").split(/[\s,]+/).filter(s => /^\w{2,21}$/.test(s)).slice(0, 5);
    const lists = await Promise.allSettled(subs.map(s => net.json(`https://www.reddit.com/r/${s}/top.json?t=week&limit=50`)));
    return lists.flatMap(r => r.status != "fulfilled" ? [] : r.value.data.children.map(c => c.data).filter(d => {
      if (d.over_18 || d.is_video || !/^https:\/\/[^/]+\/[^?#]+\.(jpe?g|png|webp)(\?.*)?$/i.test(d.url ?? "")) return false;
      const s = d.preview?.images?.[0]?.source;
      return !s || landscape(s); // размер известен — только горизонтальные
    }).map(d => ({ source: "reddit", id: d.id, kind: "image", url: d.url, page: "https://www.reddit.com" + d.permalink, author: d.author })));
  },
  async konachan() { // konachan.net — безопасное зеркало
    const posts = await net.json(`https://konachan.net/post.json?limit=40&tags=${tagsOf("rating:safe")}`);
    return posts.filter(p => p.rating == "s" && landscape(p)).map(p => ({ source: "konachan", id: String(p.id), kind: "image",
      url: new URL(p.jpeg_url || p.file_url, "https://konachan.net").href, page: `https://konachan.net/post/show/${p.id}`, author: p.author }));
  },
  async yandere() {
    const posts = await net.json(`https://yande.re/post.json?limit=40&tags=${tagsOf("rating:s")}`);
    return posts.filter(p => p.rating == "s" && landscape(p)).map(p => ({ source: "yandere", id: String(p.id), kind: "image",
      url: p.jpeg_url || p.file_url, page: `https://yande.re/post/show/${p.id}`, author: p.author }));
  },
  async safebooru() { // dapi: случайная «страница» вместо order:random; теги по умолчанию — scenery, иначе пусто = новые подряд
    const tags = encodeURIComponent((words().split(/\s+/).filter(Boolean).slice(0, 4).join(" ") || "scenery") + " rating:general");
    const posts = await net.json(`https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=40&pid=${Math.floor(Math.random() * 40)}&tags=${tags}`);
    return posts.filter(p => landscape(p) && (!p.rating || /^(s|safe|general)$/i.test(p.rating))).map(p => ({ source: "safebooru", id: String(p.id), kind: "image",
      url: p.file_url || `https://safebooru.org/images/${p.directory}/${p.image}`, page: `https://safebooru.org/index.php?page=post&s=view&id=${p.id}`, author: p.owner }));
  },
  async apod() {
    const list = await net.json("https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&count=10");
    return [list].flat().filter(a => a.media_type == "image" && (a.hdurl || a.url)).map(a => ({ source: "apod", id: a.date, kind: "image",
      url: a.hdurl || a.url, page: "https://apod.nasa.gov/apod/ap" + a.date.slice(2).replaceAll("-", "") + ".html", author: a.title }));
  },
  async wikimedia() { // картинка дня Википедии за три последних дня (за ещё не вышедший день будет 404 — пропускаем)
    const days = [0, 1, 2].map(i => new Date(Date.now() - i * 864e5));
    const rs = await Promise.allSettled(days.map(d => net.json("https://api.wikimedia.org/feed/v1/wikipedia/en/featured/" +
      [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, "0"), String(d.getUTCDate()).padStart(2, "0")].join("/"))));
    return rs.flatMap((r, i) => {
      const im = r.status == "fulfilled" && r.value.image;
      const thumb = im?.thumbnail?.source, big = im?.image?.width > 2560 && thumb?.replace(/\/\d+px-/, "/2560px-"); // оригинал бывает 8000+ px — берём миниатюру 2560
      const src = im && [big, im.image?.source, thumb].find(u => u && /\.(jpe?g|png|webp)$/i.test(new URL(u).pathname));
      return src ? [{ source: "wikimedia", id: days[i].toISOString().slice(0, 10), kind: "image", url: src, page: im.file_page, author: im.description?.text }] : [];
    });
  },
  async bing() {
    const { images } = await net.json("https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=ru-RU");
    return images.map(i => ({ source: "bing", id: i.startdate, kind: "image", url: `https://www.bing.com${i.urlbase}_UHD.jpg`, page: i.copyrightlink, author: i.copyright }));
  },
  async local() {
    let files;
    try { files = await IOUtils.getChildren(localDir()); } catch { return []; } // папки нет — пусто
    return files.filter(f => IMG.test(f) || VID.test(f)).sort()
      .map(f => ({ source: "local", id: PathUtils.filename(f), kind: VID.test(f) ? "video" : "image", file: f, page: f }));
  },
};
export const SOURCES = Object.keys(sources);
const NEEDS_KEY = { unsplash: "unsplash", pexels: "pexels" };
// включён ли источник: ему нужна своя отметка (и ключ, если он ключевой). По умолчанию включён только Wallhaven
export const sourceOn = s => bool("src." + s, s == "wallhaven") && !(NEEDS_KEY[s] && !key(NEEDS_KEY[s]));
