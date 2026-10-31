// Адреса модулей из js/ для страниц (settings/, home/): fx-autoconfig — chrome://userscripts, Sine — соседняя папка мода.
export const JS = name => (import.meta.url.startsWith("chrome://sine/") ? new URL("../js/" + name, import.meta.url).href : "chrome://userscripts/content/" + name);
