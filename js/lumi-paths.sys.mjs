// Адреса файлов мода для двух способов установки: fx-autoconfig (chrome://userscripts, chrome://userchrome) и Sine (chrome://sine/content/<id>/…).
// Без побочных эффектов. jsUrl — файл из js/ (рядом с этим); pageUrl — файл страниц (settings/…, home/…).
const sine = import.meta.url.startsWith("chrome://sine/");
export const jsUrl = name => new URL(name, import.meta.url).href;
export const pageUrl = rel => (sine ? new URL("../" + rel, import.meta.url).href : "chrome://userchrome/content/luminoctis/" + rel);
