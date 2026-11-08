// Поиск по картинке в Google Lens (общий для Home и адресной строки): POST multipart на lens.google.com/v3/upload, поле encoded_image.
// Тело собирает FormData (Response отдаёт байты и Content-Type с boundary), в поток — без потери байтов.
// FormData/Response/createImageBitmap — оконные API, поэтому окно приходит параметром.
export const MAX_IMG = 20 * 1024 * 1024;
export async function lensRequest(file, win) {
  const bmp = await win.createImageBitmap(file); // не картинка — исключение
  const fd = new win.FormData();
  fd.append("encoded_image", file, "image");
  fd.append("processed_image_dimensions", `${bmp.width},${bmp.height}`);
  bmp.close();
  const r = new win.Response(fd), buf = await r.arrayBuffer();
  const bin = Cc["@mozilla.org/io/arraybuffer-input-stream;1"].createInstance(Ci.nsIArrayBufferInputStream);
  bin.setData(buf, 0, buf.byteLength);
  const postData = Cc["@mozilla.org/network/mime-input-stream;1"].createInstance(Ci.nsIMIMEInputStream);
  postData.addHeader("Content-Type", r.headers.get("content-type"));
  postData.setData(bin);
  return { url: `https://lens.google.com/v3/upload?hl=${Services.locale.appLocaleAsBCP47}&re=df&st=${Date.now()}&ep=gisbubb`, postData };
}
