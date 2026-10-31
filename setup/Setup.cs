// Luminoctis-Setup: графический установщик. Вся логика установки — installer\install.ps1 (внутри ресурса payload.zip);
// здесь только окно, зонды (-Probe) и разбор меток ##STEP/##DONE/##ERROR. Сборка: dev\build-setup.ps1.
// Тестовые ключи: --profile <папка> (профиль вместо основного), --shot <экран> <png> [--lang ru|en] (снимок без показа окна),
// --auto install|uninstall (без кликов, только вместе с --profile; итог в --log <файл>, код выхода 0/1), --lang ru|en.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

class Prof { public string Name, Dir; public bool IsDefault; }
class Mod { public string Id, Name; }
class Probe {
  public string ZenDir, Profile, Installed;
  public bool Running, Sine;
  public List<Prof> Profiles = new List<Prof>();
  public List<Mod> Mods = new List<Mod>();
}

static class Str {
  static int L = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ru" ? 0 : 1;
  public static void Lang(string l) { L = l == "ru" ? 0 : 1; }
  public static bool Ru { get { return L == 0; } }
  // ключ -> { русский, английский }
  static readonly Dictionary<string, string[]> S = new Dictionary<string, string[]> {
    {"app", new[]{"Установщик Luminoctis", "Luminoctis Setup"}},
    {"w.desc", new[]{"Тёмное оформление Zen в стиле Tokyo Night: вкладки сверху, боковая рейка и своя стартовая страница.", "A Tokyo Night look for Zen: a top tab strip, a side rail and a start page of its own."}},
    {"w.install", new[]{"Установить", "Install"}},
    {"w.update", new[]{"Обновить до {0}", "Update to {0}"}},
    {"w.reinstall", new[]{"Переустановить", "Reinstall"}},
    {"w.uninstall", new[]{"Удалить", "Uninstall"}},
    {"w.status", new[]{"Сейчас установлена версия {0}", "Installed version: {0}"}},
    {"w.adv", new[]{"Дополнительно", "Advanced"}},
    {"w.backups", new[]{"Где мои резервные копии", "Where are my backups"}},
    {"w.profile", new[]{"Профиль Zen, в который ставить:", "Zen profile to install into:"}},
    {"w.default", new[]{" · основной", " · default"}},
    {"nobk.title", new[]{"Резервных копий пока нет", "No backups yet"}},
    {"nobk.text", new[]{"Они появятся после установки: перед любыми изменениями установщик сохраняет ваши файлы.", "They appear after an install: Setup saves your files before changing anything."}},
    {"ok", new[]{"Понятно", "OK"}},
    {"cancel", new[]{"Отмена", "Cancel"}},
    {"close", new[]{"Закрыть", "Close"}},
    {"run.title", new[]{"Закройте Zen, чтобы продолжить", "Close Zen to continue"}},
    {"run.text", new[]{"Пока Zen открыт, Luminoctis не установить. Закройте его, и установка продолжится сама.", "Luminoctis can't be installed while Zen is open. Close it and Setup will continue by itself."}},
    {"run.btn", new[]{"Закрыть Zen за меня", "Close Zen for me"}},
    {"runc.title", new[]{"Закрыть Zen?", "Close Zen?"}},
    {"runc.text", new[]{"Zen закроется как обычно. Если он спросит про открытые вкладки, ответьте ему.", "Zen will close the usual way. If it asks about open tabs, just answer it."}},
    {"runc.yes", new[]{"Закрыть Zen", "Close Zen"}},
    {"mods.title", new[]{"Лишние моды", "Overlapping mods"}},
    {"mods.text", new[]{"Эти моды делают то же, что Luminoctis, и могут мешать. Выключим их; при удалении Luminoctis они включатся обратно.", "These mods do the same as Luminoctis and can get in its way. We'll turn them off, and turn them back on if you uninstall Luminoctis."}},
    {"mods.btn", new[]{"Продолжить", "Continue"}},
    {"p.check", new[]{"Проверяю…", "Checking…"}},
    {"p.install", new[]{"Устанавливаю…", "Installing…"}},
    {"p.uninstall", new[]{"Удаляю…", "Removing…"}},
    {"step.zen", new[]{"Ищу Zen", "Looking for Zen"}},
    {"step.profile", new[]{"Проверяю профиль", "Checking your profile"}},
    {"step.program", new[]{"Готовлю Zen к модам", "Preparing Zen for mods"}},
    {"step.backup", new[]{"Делаю резервную копию", "Making a backup"}},
    {"step.files", new[]{"Копирую файлы мода", "Copying mod files"}},
    {"step.prefs", new[]{"Настраиваю Zen", "Setting up Zen"}},
    {"step.uninstall", new[]{"Убираю файлы мода", "Removing mod files"}},
    {"done.title", new[]{"Готово!", "All done!"}},
    {"done.install", new[]{"Luminoctis {0} установлен. Запустите Zen, и всё уже на месте.", "Luminoctis {0} is installed. Start Zen and it's all there."}},
    {"done.uninstall", new[]{"Luminoctis удалён, всё вернули как было.", "Luminoctis is removed, everything is back as it was."}},
    {"launch", new[]{"Запустить Zen", "Start Zen"}},
    {"err.title", new[]{"Что-то пошло не так", "Something went wrong"}},
    {"err.text", new[]{"Установка не закончилась. Ваши файлы в безопасности: копии лежат в папке профиля.", "Setup didn't finish. Your files are safe: copies are kept in your profile folder."}},
    {"err.reason", new[]{"Причина: {0}", "Reason: {0}"}},
    {"err.details", new[]{"Подробности", "Details"}},
    {"err.copy", new[]{"Скопировать лог", "Copy log"}},
    {"err.copied", new[]{"Скопировано", "Copied"}},
    {"err.retry", new[]{"Повторить", "Try again"}},
    {"sine.title", new[]{"Найден Sine", "Sine detected"}},
    {"sine.text", new[]{"У вас стоит Sine: он по-своему загружает моды и не дружит с обычной установкой Luminoctis. Установите Luminoctis через Sine, и всё заработает.", "You have Sine installed. It loads mods its own way and doesn't mix with a regular Luminoctis install. Install Luminoctis through Sine instead."}},
    {"nozen.title", new[]{"Zen не найден", "Zen not found"}},
    {"nozen.text", new[]{"Не получилось найти Zen Browser на этом компьютере. Если он стоит в необычном месте, укажите папку, где лежит zen.exe.", "Setup couldn't find Zen Browser on this computer. If it lives somewhere unusual, point to the folder with zen.exe."}},
    {"nozen.pick", new[]{"Указать папку Zen", "Choose Zen folder"}},
    {"nozen.get", new[]{"Скачать Zen: zen-browser.app", "Get Zen: zen-browser.app"}},
    {"nozen.bad", new[]{"В этой папке нет zen.exe. Выберите папку, где лежит zen.exe.", "There is no zen.exe in that folder. Choose the folder that contains zen.exe."}},
    {"noprof.title", new[]{"Сначала запустите Zen", "Start Zen first"}},
    {"noprof.text", new[]{"Zen ещё ни разу не запускался, поэтому профиля нет. Откройте Zen один раз, закройте и запустите установщик снова.", "Zen has never been started, so there is no profile yet. Open Zen once, close it and run Setup again."}},
    {"un.title", new[]{"Удалить Luminoctis?", "Uninstall Luminoctis?"}},
    {"un.text", new[]{"Файлы мода уберём, настройки Zen и выключенные моды вернём как были.", "Mod files will be removed; your Zen settings and turned-off mods will be restored."}},
    {"un.yes", new[]{"Удалить", "Uninstall"}},
  };
  public static string T(string k, params object[] a) { var s = S[k][L]; return a.Length == 0 ? s : string.Format(s, a); }
}

class Ui {
  public FrameworkElement Root;
  public bool Shot, Auto, AutoUninstall, Forced;
  public string Version, Tmp, ZenOverride, AutoLog;
  public Window Win;
  Probe pr; string profile; bool uninstall;
  readonly StringBuilder log = new StringBuilder();
  Action infoP, infoS, infoL;
  Action confirmYes;
  DispatcherTimer poll;
  FrameworkElement[] screens;
  bool busy;

  T F<T>(string n) where T : class { return (T)Root.FindName(n); }
  TextBlock Tb(string n) { return F<TextBlock>(n); }
  Button Bt(string n) { return F<Button>(n); }
  void Vis(string n, bool v) { F<UIElement>(n).Visibility = v ? Visibility.Visible : Visibility.Collapsed; }
  Brush Col(string hex) { return (Brush)new BrushConverter().ConvertFromString(hex); }
  static bool Same(string a, string b) { return a != null && b != null && string.Equals(a.TrimEnd('\\'), b.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase); }

  public void Build() {
    using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("ui.xaml")) Root = (FrameworkElement)XamlReader.Load(s);
    screens = new[] { F<FrameworkElement>("ScWelcome"), F<FrameworkElement>("ScInfo"), F<FrameworkElement>("ScMods"), F<FrameworkElement>("ScProg") };
    Tb("HTitle").Text = Str.T("app");
    F<UIElement>("Header").MouseLeftButtonDown += (s, e) => { if (Win != null && e.ButtonState == MouseButtonState.Pressed) Win.DragMove(); };
    Bt("BtnMin").Click += (s, e) => { if (Win != null) Win.WindowState = WindowState.Minimized; };
    Bt("BtnClose").Click += (s, e) => { if (Win != null) Win.Close(); };
    Bt("IPrimary").Click += (s, e) => { if (infoP != null) infoP(); };
    Bt("ISecondary").Click += (s, e) => { if (infoS != null) infoS(); };
    Bt("ILink").Click += (s, e) => { if (infoL != null) infoL(); };
    Bt("ICopy").Click += (s, e) => { try { Clipboard.SetText(log.ToString()); Bt("ICopy").Content = Str.T("err.copied"); } catch { } };
    Bt("ONo").Click += (s, e) => Vis("Overlay", false);
    Bt("OYes").Click += (s, e) => { Vis("Overlay", false); if (confirmYes != null) confirmYes(); };
    Bt("WAdvLink").Content = Str.T("w.adv");
    Bt("WBackups").Content = Str.T("w.backups");
    Bt("WAdvLink").Click += (s, e) => ToggleAdv();
    Bt("WBackups").Click += (s, e) => OpenBackups();
    Bt("WPrimary").Click += (s, e) => Go(false);
    Bt("WSecondary").Click += (s, e) => Confirm(Str.T("un.title"), Str.T("un.text"), Str.T("un.yes"), Str.T("cancel"), () => Go(true));
    Bt("MContinue").Content = Str.T("mods.btn");
    Bt("MContinue").Click += (s, e) => {
      var ch = F<StackPanel>("MList").Children.OfType<CheckBox>().Where(c => c.IsChecked == true).Select(c => (string)c.Tag).ToList();
      Run(false, ch);
    };
    Tb("WAdvLabel").Text = Str.T("w.profile");
  }

  // ---------- Экраны ----------
  public void Show(FrameworkElement sc, bool anim = true) {
    foreach (var s in screens) s.Visibility = s == sc ? Visibility.Visible : Visibility.Collapsed;
    if (anim && !Shot) {
      var tt = new TranslateTransform(0, 14);
      sc.RenderTransform = tt;
      sc.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(220)));
      tt.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(14, 0, TimeSpan.FromMilliseconds(260)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
    } else { sc.BeginAnimation(UIElement.OpacityProperty, null); sc.Opacity = 1; sc.RenderTransform = null; }
  }

  public void Confirm(string title, string text, string yes, string no, Action onYes) {
    Tb("OTitle").Text = title; Tb("OText").Text = text;
    Bt("OYes").Content = yes; Bt("ONo").Content = no ?? "";
    Vis("ONo", no != null);
    confirmYes = onYes;
    Vis("Overlay", true);
  }

  public void ShowInfo(string glyph, string color, string title, string text, string primary, Action onP, string secondary = null, Action onS = null, string link = null, Action onL = null) {
    Tb("IGlyph").Text = glyph; Tb("IGlyph").Foreground = Col(color);
    Vis("IIcon", true);
    Tb("ITitle").Text = title; Tb("IText").Text = text;
    Bt("IPrimary").Content = primary; Vis("IPrimary", primary != null); infoP = onP;
    Bt("ISecondary").Content = secondary; Vis("ISecondary", secondary != null); infoS = onS;
    Bt("ILink").Content = link; Vis("ILink", link != null); infoL = onL;
    Vis("IDetails", false); Bt("ICopy").Content = Str.T("err.copy");
    SetClose(true);
    Show(F<FrameworkElement>("ScInfo"));
  }

  void SetClose(bool on) { Bt("BtnClose").IsEnabled = on; }

  public void ShowWelcome() {
    var p = pr;
    var v = Ver(Version); var inst = Ver(p.Installed);
    Tb("WTitle").Text = "Luminoctis " + Version;
    Tb("WDesc").Text = Str.T("w.desc");
    Tb("WStatus").Text = p.Installed != null ? Str.T("w.status", p.Installed) : "";
    Vis("WStatus", p.Installed != null);
    Bt("WPrimary").Content = p.Installed == null ? Str.T("w.install") : (inst != null && v != null && inst < v ? Str.T("w.update", Version) : Str.T("w.reinstall"));
    Bt("WSecondary").Content = Str.T("w.uninstall"); Vis("WSecondary", p.Installed != null);
    Vis("WAdvLink", !Forced && p.Profiles.Count > 0);
    Bt("WPrimary").IsEnabled = true; Bt("WSecondary").IsEnabled = true;
    SetClose(true);
    Show(F<FrameworkElement>("ScWelcome"));
  }

  static System.Version Ver(string s) { System.Version v; return s != null && System.Version.TryParse(s, out v) ? v : null; }

  void ToggleAdv() {
    var open = F<UIElement>("WAdv").Visibility != Visibility.Visible;
    Vis("WAdv", open); Vis("WLogo", !open); Vis("WDesc", !open);
    if (!open) return;
    var box = F<StackPanel>("WProfiles"); box.Children.Clear();
    foreach (var pf in pr.Profiles) {
      var rb = new RadioButton { GroupName = "prof", Content = pf.Name + (pf.IsDefault ? Str.T("w.default") : ""), Tag = pf.Dir, IsChecked = Same(pf.Dir, profile), Style = (Style)Root.FindResource("Radio") };
      rb.Checked += (s, e) => { var d = (string)((RadioButton)s).Tag; if (!Same(d, profile)) ReProbe(d); };
      box.Children.Add(rb);
    }
  }

  void OpenBackups() {
    var d = profile == null ? null : Path.Combine(profile, "luminoctis-backup");
    if (d != null && Directory.Exists(d)) Process.Start(new ProcessStartInfo("explorer.exe", "\"" + d + "\"") { UseShellExecute = true });
    else Confirm(Str.T("nobk.title"), Str.T("nobk.text"), Str.T("ok"), null, null);
  }

  // ---------- Зонды и запуск PowerShell ----------
  string Script { get { return Path.Combine(Tmp, "installer", "install.ps1"); } }

  // возвращает код выхода; строки stdout/stderr — в onLine (из рабочего потока)
  int Ps(string args, Action<string> onLine) {
    var psi = new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + Script + "\" " + args) {
      UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
      StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = Tmp
    };
    using (var p = Process.Start(psi)) {
      DataReceivedEventHandler h = (s, e) => { if (e.Data != null) onLine(e.Data.TrimStart('\uFEFF')); };
      p.OutputDataReceived += h; p.ErrorDataReceived += h;
      p.BeginOutputReadLine(); p.BeginErrorReadLine();
      p.WaitForExit();
      return p.ExitCode;
    }
  }

  Probe DoProbe(string prof) {
    var args = "-Probe" + (prof != null ? " -ProfileDir \"" + prof + "\"" : "") + (ZenOverride != null ? " -ZenDir \"" + ZenOverride + "\"" : "");
    string json = null;
    Ps(args, l => { if (l.StartsWith("{")) json = l; });
    if (json == null) return null;
    var d = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(json);
    var r = new Probe();
    Func<string, string> s = k => d.ContainsKey(k) ? d[k] as string : null;
    r.ZenDir = s("zenDir"); r.Profile = s("profile"); r.Installed = s("installedVersion");
    r.Running = d["zenRunning"] is bool && (bool)d["zenRunning"]; r.Sine = d["sine"] is bool && (bool)d["sine"];
    foreach (var o in (d["profiles"] as System.Collections.IEnumerable) ?? new object[0]) {
      var m = (Dictionary<string, object>)o;
      r.Profiles.Add(new Prof { Name = (string)m["name"], Dir = (string)m["dir"], IsDefault = m["isDefault"] is bool && (bool)m["isDefault"] });
    }
    foreach (var o in (d["overlapMods"] as System.Collections.IEnumerable) ?? new object[0]) {
      var m = (Dictionary<string, object>)o; r.Mods.Add(new Mod { Id = (string)m["id"], Name = (string)m["name"] });
    }
    return r;
  }

  static bool Locked(string dir) {
    var f = Path.Combine(dir, "parent.lock");
    if (!File.Exists(f)) return false;
    try { using (File.Open(f, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { } return false; }
    catch (IOException) { return true; }
    catch { return false; }
  }

  // ---------- Поток работы ----------
  public void Start() {
    Tb("PTitle").Text = "Luminoctis " + Version; Tb("PStep").Text = Str.T("p.check");
    Vis("PBar", false); SetClose(true);
    Show(F<FrameworkElement>("ScProg"), false);
    if (!Shot) BeginProbe(Forced ? profile : null);
  }
  public void SetProfile(string p) { profile = p; }

  void BeginProbe(string prof, bool keepWelcome = false) {
    Task.Run(() => DoProbe(prof)).ContinueWith(t => {
      var r = t.Status == TaskStatus.RanToCompletion ? t.Result : null;
      if (r == null) { FailScreen(null, "probe"); return; }
      if (keepWelcome && pr != null && r.ZenDir == null) r.ZenDir = pr.ZenDir;
      pr = r;
      profile = Forced ? profile : (r.Profile ?? (r.Profiles.Count > 0 ? r.Profiles[0].Dir : null));
      if (!Forced && r.Profile == null && profile != null && !keepWelcome) { BeginProbe(profile, true); return; } // нет профиля по умолчанию: берём первый
      AfterProbe();
    }, TaskScheduler.FromCurrentSynchronizationContext());
  }

  void ReProbe(string prof) {
    profile = prof; Bt("WPrimary").IsEnabled = false; Bt("WSecondary").IsEnabled = false;
    Task.Run(() => DoProbe(prof)).ContinueWith(t => {
      var r = t.Status == TaskStatus.RanToCompletion ? t.Result : null;
      if (r != null) { if (r.ZenDir == null) r.ZenDir = pr.ZenDir; pr = r; }
      ShowWelcomeKeepAdv();
    }, TaskScheduler.FromCurrentSynchronizationContext());
  }

  void ShowWelcomeKeepAdv() {
    var p = pr;
    var open = F<UIElement>("WAdv").Visibility == Visibility.Visible;
    ShowWelcome();
    if (open) { Vis("WAdv", true); Vis("WLogo", false); Vis("WDesc", false); }
  }

  void AfterProbe() {
    if (Auto) { AutoRun(); return; }
    if (pr.ZenDir == null) { ShowNoZen(); return; }
    if (pr.Sine) { ShowInfo("S", "#bb9af7", Str.T("sine.title"), Str.T("sine.text"), Str.T("close"), () => Win.Close()); return; }
    if (profile == null) { ShowInfo("Z", "#e0af68", Str.T("noprof.title"), Str.T("noprof.text"), Str.T("close"), () => Win.Close()); return; }
    ShowWelcome();
  }

  void ShowNoZen(string msg = null) {
    ShowInfo("?", "#e0af68", Str.T("nozen.title"), msg ?? Str.T("nozen.text"), Str.T("nozen.pick"), PickZen, null, null, Str.T("nozen.get"),
      () => Process.Start(new ProcessStartInfo("https://zen-browser.app") { UseShellExecute = true }));
  }

  void PickZen() {
    using (var d = new System.Windows.Forms.FolderBrowserDialog()) {
      if (d.ShowDialog() != System.Windows.Forms.DialogResult.OK) return;
      if (!File.Exists(Path.Combine(d.SelectedPath, "zen.exe"))) { ShowNoZen(Str.T("nozen.bad")); return; }
      ZenOverride = d.SelectedPath; Start();
    }
  }

  void Go(bool un) {
    uninstall = un;
    if (pr.ZenDir == null || profile == null || busy) return;
    if (Locked(profile)) { ShowZenRunning(); return; }
    Proceed();
  }

  void Proceed() {
    if (!uninstall && pr.Mods.Count > 0) { ShowMods(); return; }
    Run(uninstall, null);
  }

  void ShowZenRunning() {
    ShowInfo("Z", "#e0af68", Str.T("run.title"), Str.T("run.text"), Str.T("run.btn"),
      () => Confirm(Str.T("runc.title"), Str.T("runc.text"), Str.T("runc.yes"), Str.T("cancel"), CloseZen), Str.T("cancel"), () => { StopPoll(); ShowWelcome(); });
    StopPoll();
    poll = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1000) };
    poll.Tick += (s, e) => { if (!Locked(profile)) { StopPoll(); Proceed(); } };
    poll.Start();
  }

  void StopPoll() { if (poll != null) { poll.Stop(); poll = null; } }

  // закрывает главное окно zen.exe нужного профиля (CloseMainWindow, без Kill); дальше ждёт опрос parent.lock
  void CloseZen() {
    var def = pr.Profiles.Any(x => x.IsDefault && Same(x.Dir, profile));
    var cur = profile;
    Task.Run(() => {
      try {
        using (var q = new System.Management.ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='zen.exe'"))
          foreach (System.Management.ManagementObject o in q.Get()) {
            var cl = (o["CommandLine"] as string) ?? "";
            if (cl.Contains("-contentproc")) continue;
            var m = Regex.Match(cl, "-profile\\s+(?:\"([^\"]+)\"|(\\S+))");
            var mine = m.Success ? Same(m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value, cur) : def;
            if (mine) try { Process.GetProcessById((int)(uint)o["ProcessId"]).CloseMainWindow(); } catch { }
          }
      } catch { }
    });
  }

  void ShowMods() {
    Tb("MTitle").Text = Str.T("mods.title"); Tb("MText").Text = Str.T("mods.text");
    var l = F<StackPanel>("MList"); l.Children.Clear();
    foreach (var m in pr.Mods) l.Children.Add(new CheckBox { Content = m.Name, Tag = m.Id, IsChecked = true, Style = (Style)Root.FindResource("Check") });
    Show(F<FrameworkElement>("ScMods"));
  }

  void SetProgress(double v) {
    var bar = F<ProgressBar>("PBar");
    if (Shot || Auto) bar.Value = v; else bar.BeginAnimation(RangeBase.ValueProperty, new DoubleAnimation(v, TimeSpan.FromMilliseconds(300)));
  }

  void Run(bool un, List<string> disable) {
    busy = true; uninstall = un; log.Clear();
    Tb("PTitle").Text = Str.T(un ? "p.uninstall" : "p.install"); Tb("PStep").Text = Str.T("step.zen");
    Vis("PBar", true); F<ProgressBar>("PBar").BeginAnimation(RangeBase.ValueProperty, null); F<ProgressBar>("PBar").Value = 0;
    SetClose(false);
    Show(F<FrameworkElement>("ScProg"));
    var args = "-Yes -ProfileDir \"" + profile + "\" -ZenDir \"" + pr.ZenDir + "\"";
    if (un) args += " -Uninstall";
    else if (disable != null && disable.Count > 0) args += " -DisableMods \"" + string.Join(",", disable) + "\"";
    else args += " -KeepMods";
    string done = null, err = null; var sw = Stopwatch.StartNew();
    var ui = TaskScheduler.FromCurrentSynchronizationContext();
    Task.Run(() => Ps(args, l => {
      lock (log) log.AppendLine(l);
      var m = Regex.Match(l, @"^##STEP (\d+)/(\d+) (.*)$");
      if (m.Success) {
        int n = int.Parse(m.Groups[1].Value), tot = int.Parse(m.Groups[2].Value); var key = m.Groups[3].Value.Trim();
        Root.Dispatcher.BeginInvoke(new Action(() => {
          try { Tb("PStep").Text = Str.T("step." + key); } catch { Tb("PStep").Text = key; }
          SetProgress(100.0 * (n - 1) / tot + 100.0 / tot * 0.5);
        }));
      }
      else if (l.StartsWith("##DONE ")) done = l.Substring(7).Trim();
      else if (l.StartsWith("##ERROR ")) err = l.Substring(8).Trim();
    })).ContinueWith(t => {
      var code = t.Status == TaskStatus.RanToCompletion ? t.Result : -1;
      Action fin = () => {
        busy = false;
        if (code == 0 && done != null) { SetProgress(100); DoneScreen(done); } else FailScreen(err, "run");
      };
      var left = 1600 - (int)sw.ElapsedMilliseconds;
      if (left <= 0 || Auto) { fin(); return; }
      SetProgress(100);
      var tm = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(left) };
      tm.Tick += (s, e) => { tm.Stop(); fin(); };
      tm.Start();
    }, ui);
  }

  void DoneScreen(string done) {
    if (Auto) { Finish(true, "ok " + done); return; }
    if (uninstall) ShowInfo("✓", "#9ece6a", Str.T("done.title"), Str.T("done.uninstall"), Str.T("close"), () => Win.Close());
    else ShowInfo("✓", "#9ece6a", Str.T("done.title"), Str.T("done.install", done), Str.T("launch"), LaunchZen, Str.T("close"), () => Win.Close());
  }

  void LaunchZen() {
    try {
      var nonDef = !pr.Profiles.Any(x => x.IsDefault && Same(x.Dir, profile));
      Process.Start(new ProcessStartInfo(Path.Combine(pr.ZenDir, "zen.exe"), nonDef ? "-profile \"" + profile + "\"" : "") { UseShellExecute = false, WorkingDirectory = pr.ZenDir });
    } catch { }
    Win.Close();
  }

  void FailScreen(string err, string where) {
    busy = false;
    if (Auto) { Finish(false, "error " + err + "\n" + log); return; }
    var text = Str.T("err.text") + (string.IsNullOrEmpty(err) ? "" : "\n\n" + Str.T("err.reason", err));
    ShowInfo("!", "#f7768e", Str.T("err.title"), text, Str.T("err.retry"), () => { if (where == "probe") Start(); else if (pr != null) ShowWelcome(); else Start(); }, Str.T("close"), () => Win.Close(), Str.T("err.details"), () => {
      Vis("IDetails", true); Vis("IIcon", false); Vis("ILink", false); Vis("ISecondary", false);
      F<TextBox>("ILog").Text = log.Length > 0 ? log.ToString() : "(" + where + ")";
    });
  }

  // ---------- Автотест ----------
  void AutoRun() {
    if (pr.ZenDir == null) { Finish(false, "no zen"); return; }
    if (pr.Sine) { Finish(false, "sine"); return; }
    if (Locked(profile)) { Finish(false, "profile busy"); return; }
    uninstall = AutoUninstall;
    Run(uninstall, uninstall ? null : pr.Mods.Select(m => m.Id).ToList());
  }

  void Finish(bool ok, string msg) {
    try { File.WriteAllText(AutoLog ?? Path.Combine(Path.GetTempPath(), "luminoctis-setup-auto.log"), (ok ? "RESULT ok" : "RESULT fail") + " " + msg + "\n---\n" + log, new UTF8Encoding(false)); } catch { }
    try { Directory.Delete(Tmp, true); } catch { }
    Environment.Exit(ok ? 0 : 1);
  }

  // ---------- Снимки экранов с примерными данными ----------
  public void Sample(string name) {
    pr = new Probe { ZenDir = @"C:\Program Files\Zen Browser", Profile = @"C:\Users\Me\AppData\Roaming\zen\Profiles\abcd.Default (release)" };
    pr.Profiles.Add(new Prof { Name = "Default (release)", Dir = pr.Profile, IsDefault = true });
    pr.Profiles.Add(new Prof { Name = "Work", Dir = @"C:\Users\Me\AppData\Roaming\zen\Profiles\efgh.Work" });
    profile = pr.Profile;
    pr.Mods.Add(new Mod { Id = "a", Name = "Transparent Zen" }); pr.Mods.Add(new Mod { Id = "b", Name = "Sidebar Expand on Hover" });
    log.Clear();
    log.AppendLine("Zen: C:\\Program Files\\Zen Browser"); log.AppendLine("##STEP 2/6 profile"); log.AppendLine("Профиль: " + profile);
    log.AppendLine("Ошибка: Профиль занят. Закройте Zen и запустите снова."); log.AppendLine("##ERROR Профиль занят. Закройте Zen и запустите снова.");
    Start(); // ставит экран «Проверяю…», дальше перекрываем нужным
    switch (name) {
      case "welcome-fresh": ShowWelcome(); break;
      case "welcome-installed": pr.Installed = "0.3.2"; ShowWelcome(); break;
      case "welcome-advanced": pr.Installed = "0.4.0"; ShowWelcome(); ToggleAdv(); break;
      case "zen-running": ShowZenRunning(); StopPoll(); break;
      case "mods": ShowMods(); break;
      case "progress": Tb("PTitle").Text = Str.T("p.install"); Tb("PStep").Text = Str.T("step.files"); Vis("PBar", true); F<ProgressBar>("PBar").Value = 66; Show(F<FrameworkElement>("ScProg"), false); break;
      case "done": DoneScreen("0.4.0"); break;
      case "error": FailScreen("Профиль занят. Закройте Zen и запустите снова.", "run"); break;
      case "error-details": FailScreen("Профиль занят. Закройте Zen и запустите снова.", "run"); infoL(); break;
      case "uninstall-confirm": pr.Installed = "0.4.0"; ShowWelcome(); Confirm(Str.T("un.title"), Str.T("un.text"), Str.T("un.yes"), Str.T("cancel"), null); break;
      case "uninstall-done": uninstall = true; DoneScreen("uninstall"); break;
      case "sine": pr.Sine = true; AfterProbe(); break;
      case "nozen": ShowNoZen(); break;
      case "noprofile": ShowInfo("Z", "#e0af68", Str.T("noprof.title"), Str.T("noprof.text"), Str.T("close"), null); break;
      default: throw new Exception("unknown screen " + name);
    }
  }
}

static class Program {
  static string Extract(out string version) {
    using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
    using (var z = new ZipArchive(s, ZipArchiveMode.Read)) {
      using (var r = new StreamReader(z.GetEntry("theme.json").Open(), Encoding.UTF8))
        version = (string)((Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(r.ReadToEnd()))["version"];
      var dir = Path.Combine(Path.GetTempPath(), "luminoctis-setup-" + version);
      if (Directory.Exists(dir)) Directory.Delete(dir, true);
      foreach (var e in z.Entries) {
        if (e.FullName.EndsWith("/")) continue;
        var t = Path.Combine(dir, e.FullName.Replace('/', '\\'));
        Directory.CreateDirectory(Path.GetDirectoryName(t));
        e.ExtractToFile(t, true);
      }
      return dir;
    }
  }

  static void SavePng(FrameworkElement root, string path) {
    var host = new Grid { Width = 560, Height = 420, Background = (Brush)new BrushConverter().ConvertFromString("#0d0d12") };
    host.Children.Add(root);
    host.Measure(new Size(560, 420)); host.Arrange(new Rect(0, 0, 560, 420)); host.UpdateLayout();
    var rtb = new RenderTargetBitmap(1120, 840, 192, 192, PixelFormats.Pbgra32);
    rtb.Render(host);
    var enc = new PngBitmapEncoder(); enc.Frames.Add(BitmapFrame.Create(rtb));
    using (var f = File.Create(path)) enc.Save(f);
  }

  [STAThread]
  static int Main(string[] a) {
    string profile = null, shot = null, shotOut = null, auto = null, logf = null;
    for (int i = 0; i < a.Length; i++) {
      switch (a[i]) {
        case "--profile": profile = a[++i]; break;
        case "--shot": shot = a[++i]; shotOut = a[++i]; break;
        case "--auto": auto = a[++i]; break;
        case "--log": logf = a[++i]; break;
        case "--lang": Str.Lang(a[++i]); break;
      }
    }
    if (auto != null && (profile == null || (auto != "install" && auto != "uninstall"))) return 2; // автотест только на указанном профиле
    var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
    var ui = new Ui { Shot = shot != null, Auto = auto != null, AutoUninstall = auto == "uninstall", Forced = profile != null, AutoLog = logf };
    string ver;
    try { ui.Tmp = Extract(out ver); ui.Version = ver; ui.Build(); }
    catch (Exception e) { MessageBox.Show("Setup could not start:\n" + e.Message, "Luminoctis Setup"); return 1; }
    if (shot != null) {
      ui.Sample(shot);
      SavePng(ui.Root, shotOut);
      return 0;
    }
    var win = new Window {
      WindowStyle = WindowStyle.None, AllowsTransparency = true, Background = Brushes.Transparent, ResizeMode = ResizeMode.CanMinimize,
      Width = 560, Height = 420, WindowStartupLocation = WindowStartupLocation.CenterScreen, Title = "Luminoctis Setup", Content = ui.Root, SnapsToDevicePixels = true
    };
    ui.Win = win;
    win.Closed += (s, e) => { try { Directory.Delete(ui.Tmp, true); } catch { } app.Shutdown(); };
    var pf = profile;
    ui.SetProfile(pf);
    app.Startup += (s, e) => { if (!ui.Auto) win.Show(); ui.Start(); }; // контекст синхронизации появляется только внутри цикла сообщений
    app.DispatcherUnhandledException += (s, e) => { try { File.WriteAllText(Path.Combine(Path.GetTempPath(), "luminoctis-setup-crash.log"), e.Exception.ToString()); } catch { } };
    app.Run();
    return 0;
  }
}
