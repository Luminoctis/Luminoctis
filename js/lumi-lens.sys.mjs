// Поиск по картинке (общий для Home и адресной строки): searchImageRequest(file, win, engine) → {url, postData} для openTrustedLinkIn.
// Способ зависит от поисковика поля: Google → Lens, Яндекс → «Поиск по картинке», Bing → Visual Search, Baidu → graph.baidu.com; у остальных
// (DuckDuckGo, Brave, Ecosia…) поиска по картинке нет — searchImageRequest отдаёт null, вставка картинки игнорируется. Новый поисковик = строка в ENGINES. Все запросы — https на хосты самих поисковиков.
// Тело собирает FormData (Response отдаёт байты и Content-Type с boundary), в поток — без потери байтов.
// FormData/Response/createImageBitmap — оконные API, поэтому окно приходит параметром.
export const MAX_IMG = 20 * 1024 * 1024;

async function multipart(fd, win) { // FormData → nsIMIMEInputStream с заголовком Content-Type (boundary)
  const r = new win.Response(fd), buf = await r.arrayBuffer();
  const bin = Cc["@mozilla.org/io/arraybuffer-input-stream;1"].createInstance(Ci.nsIArrayBufferInputStream);
  bin.setData(buf, 0, buf.byteLength);
  const postData = Cc["@mozilla.org/network/mime-input-stream;1"].createInstance(Ci.nsIMIMEInputStream);
  postData.addHeader("Content-Type", r.headers.get("content-type"));
  postData.setData(bin);
  return postData;
}

export async function lensRequest(file, win) {
  const bmp = await win.createImageBitmap(file); // не картинка — исключение
  const fd = new win.FormData();
  fd.append("encoded_image", file, "image");
  fd.append("processed_image_dimensions", `${bmp.width},${bmp.height}`);
  bmp.close();
  return { url: `https://lens.google.com/v3/upload?hl=${Services.locale.appLocaleAsBCP47}&re=df&st=${Date.now()}&ep=gisbubb`, postData: await multipart(fd, win) };
}

// Яндекс: два шага — POST multipart (поле upfile) на /images/search?rpt=imageview&format=json отдаёт cbirId загруженной картинки,
// дальше страница результатов /images/search?rpt=imageview&cbir_id=…. Домен — тот же, что у поисковика (yandex.ru/.com/.by…).
async function yandexRequest(file, win, host) {
  await win.createImageBitmap(file); // не картинка — исключение
  const fd = new win.FormData();
  fd.append("upfile", file, "image");
  const r = await win.fetch(`https://${host}/images/search?rpt=imageview&format=json&request=${encodeURIComponent('{"blocks":[{"block":"b-page_type_search-by-image__link"}]}')}`, { method: "POST", body: fd });
  const id = r.ok && (await r.json()).blocks?.[0]?.params?.cbirId; // captcha/error: no id
  if (!id) throw new Error("Yandex: no cbirId (HTTP " + r.status + ")");
  return { url: `https://${host}/images/search?rpt=imageview&cbir_id=${encodeURIComponent(id)}` };
}

// Bing: Visual Search — multipart на /images/search?view=detailv2&iss=sbiupload, поле imageBin = картинка в base64.
// Большие картинки сжимаем (длинная сторона ≤ 1600, JPEG): base64 раздувает тело на треть, а Bing сам ужимает до такого же размера.
async function bingRequest(file, win) {
  const bmp = await win.createImageBitmap(file);
  let blob = file;
  if (file.size > 2 * 1024 * 1024 || Math.max(bmp.width, bmp.height) > 1600) {
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), cv = new win.OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    blob = await cv.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  }
  bmp.close();
  const u8 = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode(...u8.subarray(i, i + 8192));
  const fd = new win.FormData();
  fd.append("imageBin", win.btoa(bin));
  return { url: "https://www.bing.com/images/search?view=detailv2&iss=sbiupload&FORM=SBIHMP", postData: await multipart(fd, win) };
}

// Baidu: прямой POST на graph.baidu.com/upload требует одноразовый Acs-Token, который считает JS самого сайта, поэтому делаем как человек:
// открываем graph.baidu.com/pcpage/index, а после загрузки кладём картинку в файловое поле страницы (frame-скрипт во вкладке) — сайт сам
// грузит её и переходит на результаты. Вызывающий открывает url и затем зовёт after(окно браузера) (его выбранная вкладка открыла url).
const BAIDU_CHILD = `addMessageListener("lumi:baidu", m => {
  let n = 0;
  const go = () => {
    const inp = content.document.querySelector("input[type=file]");
    if (!inp) return ++n < 50 ? content.setTimeout(go, 200) : null;
    const dt = new content.DataTransfer();
    dt.items.add(new content.File([m.data.blob], "image", { type: m.data.blob.type }));
    inp.files = dt.files;
    inp.dispatchEvent(new content.Event("change", { bubbles: true }));
  };
  go();
});`;
async function baiduRequest(file, win) {
  const bmp = await win.createImageBitmap(file); // не картинка — исключение
  bmp.close();
  const after = async (cw = win) => { // cw — окно браузера (у Home win — страница, у адресной строки — оно же)
    const br = cw.gBrowser.selectedBrowser, onBaidu = () => br.currentURI.spec.startsWith("https://graph.baidu.com/"); // .host на about:blank бросает
    for (let i = 0; i < 75 && !(onBaidu() && !br.webProgress.isLoadingDocument); i++) await new Promise(r => cw.setTimeout(r, 200));
    if (!onBaidu()) throw new Error("Baidu: page not loaded");
    br.messageManager.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(BAIDU_CHILD), false);
    br.messageManager.sendAsyncMessage("lumi:baidu", { blob: file });
  };
  return { url: "https://graph.baidu.com/pcpage/index?tpl_from=pc", after };
}

// [проверка хоста поисковика, функция запроса(file, win, host)]; первое совпадение выигрывает; нет совпадения — поиска по картинке нет
const ENGINES = [
  [/(^|\.)google\.[a-z.]+$/, lensRequest],
  [/(^|\.)baidu\.com$/, baiduRequest],
  [/(^|\.)yandex\.[a-z.]+$|^ya\.ru$/, (f, w, host) => yandexRequest(f, w, /^ya\.ru$/.test(host) ? "yandex.ru" : host.replace(/^.*?(yandex\.)/, "$1"))],
  [/(^|\.)bing\.com$/, bingRequest],
];

export const engineHost = engine => { // хост поиска поисковика ("www.google.com"), "" если неизвестен
  try { return engine?.searchUrlDomain || engine?.getSubmission("x").uri.host || ""; } catch { return ""; }
};
export const requestFor = host => ENGINES.find(([re]) => re.test(host || ""))?.[1] || null;
export const supportsImage = engine => !!requestFor(engineHost(engine));
export const searchImageRequest = (file, win, engine) => requestFor(engineHost(engine))?.(file, win, engineHost(engine)) ?? null; // null — поиска по картинке нет
