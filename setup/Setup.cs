// Luminoctis-Setup: графический установщик. Вся логика установки — installer\install.ps1 (внутри ресурса payload.zip);
// здесь только окно, зонды (-Probe) и разбор меток ##STEP/##DONE/##ERROR. Сборка: dev\build-setup.ps1.
// Строки и языки — Strings.cs (10 языков, выбор в шапке окна; по умолчанию язык Windows).
// Тестовые ключи: --profile <папка> (профиль вместо основного), --shot <экран> <png> [--lang <код>] (снимок без показа окна),
// --auto install|uninstall (без кликов, только вместе с --profile; итог в --log <файл>, код выхода 0/1), --lang <код>,
// --selfcheck <файл> (проверка словаря строк: все 10 языков есть у каждой строки; результат в файл, код выхода 0/1; зовёт build-setup.ps1).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
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
  public string ZenDir, Profile, Installed, DataDir; // DataDir — pref luminoctis.home.dir профиля (null = папка по умолчанию)
  public bool Sine;
  public List<Prof> Profiles = new List<Prof>();
  public List<Mod> Mods = new List<Mod>();
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
  Action redraw;                        // перерисовка текущего экрана при смене языка
  string[] ov = new string[4];         // ключи окна подтверждения: заголовок, текст, «да», «нет»
  string pTitle, pStep;                // ключи заголовка и шага экрана хода (pTitle == null — «Luminoctis <версия>»)
  bool relang;
  DispatcherTimer poll;
  FrameworkElement[] screens;
  bool busy;
  string dataDir;                      // папка данных мода (null = «Документы\Luminoctis Home», pref не пишем)

  T F<T>(string n) where T : class { return (T)Root.FindName(n); }
  TextBlock Tb(string n) { return F<TextBlock>(n); }
  Button Bt(string n) { return F<Button>(n); }
  void Vis(string n, bool v) { F<UIElement>(n).Visibility = v ? Visibility.Visible : Visibility.Collapsed; }
  Brush Col(string hex) { return (Brush)new BrushConverter().ConvertFromString(hex); }
  static bool Same(string a, string b) { return a != null && b != null && string.Equals(a.TrimEnd('\\'), b.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase); }

  public void Build() {
    using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("ui.xaml")) Root = (FrameworkElement)XamlReader.Load(s);
    screens = new[] { F<FrameworkElement>("ScWelcome"), F<FrameworkElement>("ScInfo"), F<FrameworkElement>("ScMods"), F<FrameworkElement>("ScProg") };
    var cb = F<ComboBox>("Lang");
    foreach (var n in Str.Names) cb.Items.Add(n);
    cb.SelectedIndex = Str.Cur;
    cb.SelectionChanged += (s, e) => { if (cb.SelectedIndex >= 0 && cb.SelectedIndex != Str.Cur) { Str.Cur = cb.SelectedIndex; ApplyLang(); } };
    F<UIElement>("Header").MouseLeftButtonDown += (s, e) => { if (Win != null && e.ButtonState == MouseButtonState.Pressed) Win.DragMove(); };
    Bt("BtnMin").Click += (s, e) => { if (Win != null) Win.WindowState = WindowState.Minimized; };
    Bt("BtnClose").Click += (s, e) => { if (Win != null) Win.Close(); };
    Bt("IPrimary").Click += (s, e) => { if (infoP != null) infoP(); };
    Bt("ISecondary").Click += (s, e) => { if (infoS != null) infoS(); };
    Bt("ILink").Click += (s, e) => { if (infoL != null) infoL(); };
    Bt("ICopy").Click += (s, e) => { try { Clipboard.SetText(log.ToString()); Bt("ICopy").Content = Str.T("err.copied"); } catch { } };
    Bt("ONo").Click += (s, e) => Vis("Overlay", false);
    Bt("OYes").Click += (s, e) => { Vis("Overlay", false); if (confirmYes != null) confirmYes(); };
    Bt("WAdvLink").Click += (s, e) => ToggleAdv();
    Bt("WBackups").Click += (s, e) => OpenBackups();
    Bt("WDataPick").Click += (s, e) => PickData();
    Bt("WPrimary").Click += (s, e) => Go(false);
    Bt("WSecondary").Click += (s, e) => Confirm("un.title", "un.text", "un.yes", "cancel", () => Go(true));
    Bt("MContinue").Click += (s, e) => {
      var ch = F<StackPanel>("MList").Children.OfType<CheckBox>().Where(c => c.IsChecked == true).Select(c => (string)c.Tag).ToList();
      Run(false, ch);
    };
    ApplyLang();
  }

  // ---------- Язык ----------
  // шрифты с запасом под иероглифы; арабский есть в Segoe UI
  static string Fonts(string code) { return code == "zh" ? "Segoe UI, Microsoft YaHei UI" : code == "ja" ? "Segoe UI, Yu Gothic UI, Meiryo UI" : "Segoe UI"; }

  void ApplyLang() {
    var code = Str.Codes[Str.Cur];
    Root.FlowDirection = Str.Rtl ? FlowDirection.RightToLeft : FlowDirection.LeftToRight;
    Root.Language = XmlLanguage.GetLanguage(code);
    Root.SetValue(System.Windows.Documents.TextElement.FontFamilyProperty, new FontFamily(Fonts(code)));
    Tb("HTitle").Text = Str.T("app");
    Bt("WAdvLink").Content = Str.T("w.adv");
    Bt("WBackups").Content = Str.T("w.backups");
    Bt("MContinue").Content = Str.T("mods.btn");
    Tb("WAdvLabel").Text = Str.T("w.profile");
    Tb("WDataLabel").Text = Str.T("w.data");
    Bt("WDataPick").Content = Str.T("w.datapick");
    relang = true;
    try {
      if (redraw != null) redraw();
      if (F<UIElement>("Overlay").Visibility == Visibility.Visible) ApplyOverlay();
    } finally { relang = false; }
  }

  // ---------- Экраны ----------
  public void Show(FrameworkElement sc, bool anim = true) {
    foreach (var s in screens) s.Visibility = s == sc ? Visibility.Visible : Visibility.Collapsed;
    if (anim && !Shot && !relang) {
      var tt = new TranslateTransform(0, 14);
      sc.RenderTransform = tt;
      sc.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(220)));
      tt.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(14, 0, TimeSpan.FromMilliseconds(260)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
    } else { sc.BeginAnimation(UIElement.OpacityProperty, null); sc.Opacity = 1; sc.RenderTransform = null; }
  }

  // аргументы — ключи строк (no == null: одна кнопка)
  public void Confirm(string title, string text, string yes, string no, Action onYes) {
    ov = new[] { title, text, yes, no };
    confirmYes = onYes;
    ApplyOverlay();
    Vis("Overlay", true);
  }

  void ApplyOverlay() {
    Tb("OTitle").Text = Str.T(ov[0]); Tb("OText").Text = Str.T(ov[1]);
    Bt("OYes").Content = Str.T(ov[2]); Bt("ONo").Content = ov[3] == null ? "" : Str.T(ov[3]);
    Vis("ONo", ov[3] != null);
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
    redraw = ShowWelcomeKeepAdv;
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
    if (open) FillProfiles();
  }

  void FillProfiles() {
    var box = F<StackPanel>("WProfiles"); box.Children.Clear();
    foreach (var pf in pr.Profiles) {
      var rb = new RadioButton { GroupName = "prof", Content = pf.Name + (pf.IsDefault ? Str.T("w.default") : ""), Tag = pf.Dir, IsChecked = Same(pf.Dir, profile), Style = (Style)Root.FindResource("Radio") };
      rb.Checked += (s, e) => { var d = (string)((RadioButton)s).Tag; if (!Same(d, profile)) ReProbe(d); };
      box.Children.Add(rb);
    }
    Tb("WDataPath").Text = dataDir ?? DefaultData();
  }

  static string DefaultData() { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Luminoctis Home"); }

  // выбранная папка — родитель: данные кладём в её подпапку «Luminoctis Home», а не россыпью в корень
  void PickData() {
    var p = FolderPicker.Pick(Win, Str.T("w.data"), dataDir ?? DefaultData());
    if (p == null) return;
    if (!string.Equals(Path.GetFileName(p.TrimEnd('\\')), "Luminoctis Home", StringComparison.OrdinalIgnoreCase)) p = Path.Combine(p, "Luminoctis Home");
    dataDir = p;
    Tb("WDataPath").Text = p;
  }

  void OpenBackups() {
    var d = profile == null ? null : Path.Combine(profile, "luminoctis-backup");
    if (d != null && Directory.Exists(d)) Process.Start(new ProcessStartInfo("explorer.exe", "\"" + d + "\"") { UseShellExecute = true });
    else Confirm("nobk.title", "nobk.text", "ok", null, null);
  }

  // ---------- Зонды и запуск PowerShell ----------
  string Script { get { return Path.Combine(Tmp, "installer", "install.ps1"); } }

  // аргумент в кавычках; завершающие \ (корень диска D:\) удваиваем, иначе они съедают закрывающую кавычку
  static string Q(string s) { return "\"" + System.Text.RegularExpressions.Regex.Replace(s, @"(\\+)$", "$1$1") + "\""; }

  static string PsExe() {
    var p = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
    return File.Exists(p) ? p : "powershell.exe";
  }

  // возвращает код выхода; строки stdout/stderr — в onLine (из рабочего потока)
  int Ps(string args, Action<string> onLine) {
    var psi = new ProcessStartInfo(PsExe(), "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Q(Script) + " " + args) {
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
    var args = "-Probe" + (prof != null ? " -ProfileDir " + Q(prof) : "") + (ZenOverride != null ? " -ZenDir " + Q(ZenOverride) : "");
    string json = null;
    Ps(args, l => { if (l.StartsWith("{")) json = l; });
    if (json == null) return null;
    var d = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(json);
    var r = new Probe();
    Func<string, string> s = k => d.ContainsKey(k) ? d[k] as string : null;
    r.ZenDir = s("zenDir"); r.Profile = s("profile"); r.Installed = s("installedVersion"); r.DataDir = s("dataDir");
    r.Sine = d["sine"] is bool && (bool)d["sine"];
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
    Prog(null, "p.check");
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
      pr = r; dataDir = r.DataDir;
      profile = Forced ? profile : (r.Profile ?? (r.Profiles.Count > 0 ? r.Profiles[0].Dir : null));
      if (!Forced && r.Profile == null && profile != null && !keepWelcome) { BeginProbe(profile, true); return; } // нет профиля по умолчанию: берём первый
      AfterProbe();
    }, TaskScheduler.FromCurrentSynchronizationContext());
  }

  void ReProbe(string prof) {
    profile = prof; Bt("WPrimary").IsEnabled = false; Bt("WSecondary").IsEnabled = false;
    Task.Run(() => DoProbe(prof)).ContinueWith(t => {
      var r = t.Status == TaskStatus.RanToCompletion ? t.Result : null;
      if (r != null) { if (r.ZenDir == null) r.ZenDir = pr.ZenDir; pr = r; dataDir = r.DataDir; }
      ShowWelcomeKeepAdv();
    }, TaskScheduler.FromCurrentSynchronizationContext());
  }

  void ShowWelcomeKeepAdv() {
    var open = F<UIElement>("WAdv").Visibility == Visibility.Visible;
    ShowWelcome();
    if (open) { Vis("WAdv", true); Vis("WLogo", false); Vis("WDesc", false); FillProfiles(); }
  }

  void AfterProbe() {
    if (Auto) { AutoRun(); return; }
    if (pr.ZenDir == null) { ShowNoZen(); return; }
    if (pr.Sine) { ShowSine(); return; }
    if (profile == null) { ShowNoProf(); return; }
    ShowWelcome();
  }

  void ShowSine() {
    redraw = ShowSine;
    ShowInfo("S", "#bb9af7", Str.T("sine.title"), Str.T("sine.text"), Str.T("close"), () => Win.Close());
  }

  void ShowNoProf() {
    redraw = ShowNoProf;
    ShowInfo("Z", "#e0af68", Str.T("noprof.title"), Str.T("noprof.text"), Str.T("close"), () => Win.Close());
  }

  void ShowNoZen(string textKey = "nozen.text") {
    redraw = () => ShowNoZen(textKey);
    ShowInfo("?", "#e0af68", Str.T("nozen.title"), Str.T(textKey), Str.T("nozen.pick"), PickZen, null, null, Str.T("nozen.get"),
      () => Process.Start(new ProcessStartInfo("https://zen-browser.app") { UseShellExecute = true }));
  }

  void PickZen() {
    var p = FolderPicker.Pick(Win, Str.T("nozen.pick"), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles));
    if (p == null) return;
    if (!File.Exists(Path.Combine(p, "zen.exe"))) { ShowNoZen("nozen.bad"); return; }
    ZenOverride = p; Start();
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
    redraw = ShowZenRunning;
    ShowInfo("Z", "#e0af68", Str.T("run.title"), Str.T("run.text"), Str.T("run.btn"),
      () => Confirm("runc.title", "runc.text", "runc.yes", "cancel", CloseZen), Str.T("cancel"), () => { StopPoll(); ShowWelcome(); });
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
    redraw = ShowMods;
    Tb("MTitle").Text = Str.T("mods.title"); Tb("MText").Text = Str.T("mods.text");
    var l = F<StackPanel>("MList");
    var off = l.Children.OfType<CheckBox>().Where(c => c.IsChecked != true).Select(c => (string)c.Tag).ToList(); // снятые галочки переживают смену языка
    l.Children.Clear();
    foreach (var m in pr.Mods) {
      l.Children.Add(new CheckBox { Content = m.Name, Tag = m.Id, IsChecked = !off.Contains(m.Id), Style = (Style)Root.FindResource("Check") });
      if (m.Name.IndexOf("Transparent Zen", StringComparison.OrdinalIgnoreCase) >= 0)
        l.Children.Add(new TextBlock { Text = Str.T("mods.tz"), FontSize = 12, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(34, -4, 0, 6),
          Foreground = (Brush)new BrushConverter().ConvertFromString("#7982a9") });
    }
    Show(F<FrameworkElement>("ScMods"));
  }

  void SetProgress(double v) {
    var bar = F<ProgressBar>("PBar");
    if (Shot || Auto) bar.Value = v; else bar.BeginAnimation(RangeBase.ValueProperty, new DoubleAnimation(v, TimeSpan.FromMilliseconds(300)));
  }

  void Run(bool un, List<string> disable) {
    busy = true; uninstall = un; log.Clear();
    Prog(un ? "p.uninstall" : "p.install", "step.zen");
    Vis("PBar", true); F<ProgressBar>("PBar").BeginAnimation(RangeBase.ValueProperty, null); F<ProgressBar>("PBar").Value = 0;
    SetClose(false);
    Show(F<FrameworkElement>("ScProg"));
    var args = "-Yes -ProfileDir " + Q(profile) + " -ZenDir " + Q(pr.ZenDir);
    if (un) args += " -Uninstall";
    else if (disable != null && disable.Count > 0) args += " -DisableMods " + Q(string.Join(",", disable));
    else args += " -KeepMods";
    if (!un && dataDir != null) args += " -DataDir " + Q(dataDir);
    string done = null, err = null; var sw = Stopwatch.StartNew();
    var ui = TaskScheduler.FromCurrentSynchronizationContext();
    Task.Run(() => Ps(args, l => {
      lock (log) log.AppendLine(l);
      var m = Regex.Match(l, @"^##STEP (\d+)/(\d+) (.*)$");
      if (m.Success) {
        int n = int.Parse(m.Groups[1].Value), tot = int.Parse(m.Groups[2].Value); var key = m.Groups[3].Value.Trim();
        Root.Dispatcher.BeginInvoke(new Action(() => {
          if (Str.Has("step." + key)) Prog(pTitle, "step." + key);
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

  void Prog(string title, string step) {
    pTitle = title; pStep = step; redraw = () => Prog(pTitle, pStep);
    Tb("PTitle").Text = title == null ? "Luminoctis " + Version : Str.T(title);
    Tb("PTitle").FlowDirection = title == null ? FlowDirection.LeftToRight : Root.FlowDirection; // имя с версией не должно «переворачиваться» в арабском
    Tb("PStep").Text = Str.T(step);
  }

  void DoneScreen(string done) {
    if (Auto) { Finish(true, "ok " + done); return; }
    redraw = () => DoneScreen(done);
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

  // install.ps1 шлёт «##ERROR код» или «##ERROR код|аргумент»; текст берём из словаря ("e."+код), неизвестное показываем как есть
  static string Reason(string err) {
    var p = err.Split(new[] { '|' }, 2);
    if (!Str.Has("e." + p[0])) return err;
    return p.Length > 1 ? Str.T("e." + p[0], p[1]) : Str.T("e." + p[0]);
  }

  void FailScreen(string err, string where) {
    busy = false;
    if (Auto) { Finish(false, "error " + err + "\n" + log); return; }
    redraw = () => FailScreen(err, where);
    var text = Str.T("err.text") + (string.IsNullOrEmpty(err) ? "" : "\n\n" + Str.T("err.reason", Reason(err)));
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
    log.AppendLine("Zen: C:\\Program Files\\Zen Browser"); log.AppendLine("##STEP 2/6 profile"); log.AppendLine("Profile: " + profile);
    log.AppendLine("Error: the profile is in use."); log.AppendLine("##ERROR busy");
    Start(); // ставит экран «Проверяю…», дальше перекрываем нужным
    switch (name) {
      case "welcome-fresh": ShowWelcome(); break;
      case "welcome-installed": pr.Installed = "0.3.2"; ShowWelcome(); break;
      case "welcome-advanced": pr.Installed = "0.4.0"; ShowWelcome(); ToggleAdv(); break;
      case "welcome-data": pr.Installed = "0.4.0"; dataDir = @"E:\Luminoctis Home"; ShowWelcome(); ToggleAdv(); break;
      case "zen-running": ShowZenRunning(); StopPoll(); break;
      case "mods": ShowMods(); break;
      case "progress": Prog("p.install", "step.files"); Vis("PBar", true); F<ProgressBar>("PBar").Value = 66; Show(F<FrameworkElement>("ScProg"), false); break;
      case "done": DoneScreen("0.4.0"); break;
      case "error": FailScreen("busy", "run"); break;
      case "error-details": FailScreen("busy", "run"); infoL(); break;
      case "uninstall-confirm": pr.Installed = "0.4.0"; ShowWelcome(); Confirm("un.title", "un.text", "un.yes", "cancel", null); break;
      case "uninstall-done": uninstall = true; DoneScreen("uninstall"); break;
      case "sine": pr.Sine = true; AfterProbe(); break;
      case "nozen": ShowNoZen(); break;
      case "noprofile": ShowNoProf(); break;
      default: throw new Exception("unknown screen " + name);
    }
  }
}

// Выбор папки окном Проводника (IFileOpenDialog с FOS_PICKFOLDERS); старый FolderBrowserDialog .NET — лишь маленькое дерево папок
static class FolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialog { }
  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog { // порядок методов = vtable; объявлены только до GetResult
    [PreserveSig] int Show(IntPtr owner);
    void SetFileTypes(uint n, IntPtr spec); void SetFileTypeIndex(uint i); void GetFileTypeIndex(out uint i);
    void Advise(IntPtr sink, out uint cookie); void Unadvise(uint cookie);
    void SetOptions(uint fos); void GetOptions(out uint fos);
    void SetDefaultFolder(IShellItem si); void SetFolder(IShellItem si); void GetFolder(out IShellItem si); void GetCurrentSelection(out IShellItem si);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name); void GetFileName(out IntPtr name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title); void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text); void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
    void GetResult(out IShellItem si);
  }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv); void GetParent(out IShellItem si);
    void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem si);

  // null — отмена; start — папка, с которой открыть окно (берётся ближайшая существующая сверху)
  public static string Pick(Window owner, string title, string start) {
    var d = (IFileDialog)new FileOpenDialog();
    try {
      d.SetOptions(0x20 | 0x40 | 0x800); // PICKFOLDERS | FORCEFILESYSTEM | PATHMUSTEXIST
      d.SetTitle(title);
      while (!string.IsNullOrEmpty(start) && !Directory.Exists(start)) start = Path.GetDirectoryName(start);
      if (!string.IsNullOrEmpty(start)) { IShellItem f; SHCreateItemFromParsingName(start, IntPtr.Zero, typeof(IShellItem).GUID, out f); d.SetFolder(f); }
      var h = owner == null ? IntPtr.Zero : new System.Windows.Interop.WindowInteropHelper(owner).Handle;
      if (d.Show(h) != 0) return null; // 0x800704C7 — отмена
      IShellItem r; d.GetResult(out r);
      string path; r.GetDisplayName(0x80058000, out path); // SIGDN_FILESYSPATH
      return path;
    } finally { Marshal.ReleaseComObject(d); }
  }
}

static class Program {
  static string Extract(out string version) {
    using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
    using (var z = new ZipArchive(s, ZipArchiveMode.Read)) {
      using (var r = new StreamReader(z.GetEntry("theme.json").Open(), Encoding.UTF8))
        version = (string)((Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(r.ReadToEnd()))["version"];
      var dir = Path.Combine(Path.GetTempPath(), "luminoctis-setup-" + version + "-" + Guid.NewGuid().ToString("N").Substring(0, 8)); // своя папка у каждого запуска
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

  // winexe не печатает в консоль, поэтому итог пишем в файл; сборка (dev\build-setup.ps1) читает код выхода
  static int SelfCheck(string outFile) {
    var bad = Str.Check();
    File.WriteAllText(outFile, bad == null ? "ok " + Str.Count + " strings x " + Str.Codes.Length + " languages" : bad, new UTF8Encoding(false));
    return bad == null ? 0 : 1;
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
        case "--lang": Str.Cur = Str.Index(a[++i]); break;
        case "--selfcheck": return SelfCheck(a[++i]);
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
