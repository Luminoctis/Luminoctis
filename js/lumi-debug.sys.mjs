// Окно отладки (js/lumi-debug.uc.js): подмена настроек на время отладки. Прежние значения запоминаются один раз и возвращаются restorePrefs().
const saved = new Map(); // имя -> прежнее значение | undefined (своего значения не было)

export function setBoolPref(name, value) {
  if (!saved.has(name)) saved.set(name, Services.prefs.prefHasUserValue(name) ? Services.prefs.getBoolPref(name) : undefined);
  Services.prefs.setBoolPref(name, value);
}
export function restorePrefs() {
  for (const [name, value] of saved) value === undefined ? Services.prefs.clearUserPref(name) : Services.prefs.setBoolPref(name, value);
  saved.clear();
}
