// Настройки цвета Windows, мешающие прозрачному режиму окна («Прозрачный» и «Обои»). Общий для плашки окна (lumi-win-colors.uc.js) и страницы настроек.
// Правильно: «Эффекты прозрачности» вкл (Personalize\EnableTransparency=1, нет ключа = 1); «Цвет акцента на заголовках окон и границах» выкл (DWM\ColorPrevalence=0);
// «Цвет акцента в меню Пуск и на панели задач» выкл (Personalize\ColorPrevalence=0). Нет ключа ColorPrevalence = 0 (норма).
// Проверки подменяют _io = { read(path, name) → число|null, write(path, name, value), broadcast(), open(url) }, чтобы не трогать настоящий реестр.
export const PERS = String.raw`Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`, DWM = String.raw`Software\Microsoft\Windows\DWM`;
const WANT = [
  { id: "transparency", path: PERS, name: "EnableTransparency", want: 1, def: 1 },
  { id: "dwm", path: DWM, name: "ColorPrevalence", want: 0, def: 0 },
  { id: "taskbar", path: PERS, name: "ColorPrevalence", want: 0, def: 0 },
];
export const DISMISS = "luminoctis.look.winHint.dismissed", MODE = "luminoctis.look.window", TOPIC = "lumi-win-colors-changed";

// чтение — open (нет ключа → исключение → null, ничего не создаём); запись — create (ключа может не быть)
const key = (path, access, make) => {
  const k = Cc["@mozilla.org/windows-registry-key;1"].createInstance(Ci.nsIWindowsRegKey);
  k[make ? "create" : "open"](k.ROOT_KEY_CURRENT_USER, path, access);
  return k;
};
const real = {
  read(path, name) {
    try {
      const k = key(path, Ci.nsIWindowsRegKey.ACCESS_READ);
      try { return k.hasValue(name) ? k.readIntValue(name) : null; } finally { k.close(); }
    } catch { return null; }
  },
  write(path, name, value) {
    const k = key(path, Ci.nsIWindowsRegKey.ACCESS_WRITE, true);
    try { k.writeIntValue(name, value); } finally { k.close(); }
  },
  // WM_SETTINGCHANGE "ImmersiveColorSet" всем окнам: DWM и проводник подхватывают цвета сразу
  broadcast() {
    const fn = sender();
    if (fn) fn(0xffff, 0x1a, 0, "ImmersiveColorSet", 2, 3000, null); // HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_ABORTIFHUNG
  },
  open(url) {
    Cc["@mozilla.org/uriloader/external-protocol-service;1"].getService(Ci.nsIExternalProtocolService)
      .loadURI(Services.io.newURI(url), Services.scriptSecurityManager.getSystemPrincipal());
  },
};
let send;
// объявление SendMessageTimeoutW (проверка может убедиться, что оно собирается, не вызывая его)
export function sender() {
  if (send !== undefined) return send;
  try {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const lib = ctypes.open("user32.dll");
    send = lib.declare("SendMessageTimeoutW", ctypes.winapi_abi, ctypes.intptr_t,
      ctypes.intptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.char16_t.ptr, ctypes.uint32_t, ctypes.uint32_t, ctypes.uintptr_t.ptr);
  } catch { send = null; }
  return send;
}

export const lumiWinColors = {
  _io: real,
  real,
  // { active: прозрачный режим, issues: [id…], dismissed }
  check() {
    const m = Services.prefs.getStringPref(MODE, "");
    const issues = WANT.filter(w => (this._io.read(w.path, w.name) ?? w.def) != w.want).map(w => w.id);
    return { active: m == "transparent" || m == "wallpaper", issues, dismissed: Services.prefs.getBoolPref(DISMISS, false) };
  },
  fix() {
    for (const w of WANT) if ((this._io.read(w.path, w.name) ?? w.def) != w.want) this._io.write(w.path, w.name, w.want);
    try { this._io.broadcast(); } catch {}
    Services.obs.notifyObservers(null, TOPIC);
    return this.check();
  },
  openSettings() { this._io.open("ms-settings:colors"); },
};
