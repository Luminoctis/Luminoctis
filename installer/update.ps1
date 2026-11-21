# Запускается модом (js/lumi-update.sys.mjs) через update.vbs — скрытым окном, без вспышки консоли: ждёт выхода Zen, показывает своё окно
# «Luminoctis обновляется…» с прогрессом, распаковывает архив (-Zip), обновляет профиль установщиком, при -Relaunch поднимает Zen.
# Совместимость: мод 1.0.2 и старше зовёт скрипт без -Lang/-Zip, с уже распакованным релизом (рядом лежит install.ps1 и остальные файлы) — это тоже работает.
# Лог: <профиль>\luminoctis-update.log
param([int]$ZenPid, [string]$ProfileDir, [string]$ZenExe, [switch]$Relaunch, [string]$Lang, [string]$Zip, [int]$HoldMs, [switch]$Offscreen) # HoldMs, Offscreen — только для тестов (снимки; окно за краем экрана, пользователь его не видит)
$ErrorActionPreference = 'Continue'
$ConfirmPreference = 'None' # скрытое окно консоли: любой вопрос повис бы навсегда
$log = Join-Path $ProfileDir 'luminoctis-update.log'
function Log($m) { "$(Get-Date -Format 's') $m" | Out-File $log -Append -Encoding utf8 }
Set-Content $log '' -Encoding utf8

# ---------- строки окна (10 языков мода; язык — от Zen через -Lang, иначе язык Windows) ----------
$Strings = @{
  en = @{ title = 'Updating Luminoctis…'; unpack = 'Unpacking files…'; install = 'Installing the update…'; restart = 'Starting Zen…'; done = 'Done'; errTitle = 'Could not update Luminoctis'; errBody = 'Details are in the log:'; close = 'Close'; busy = 'The Zen profile is still in use. Close all Zen windows and update again.' }
  zh = @{ title = '正在更新 Luminoctis…'; unpack = '正在解压文件…'; install = '正在安装更新…'; restart = '正在启动 Zen…'; done = '完成'; errTitle = '无法更新 Luminoctis'; errBody = '详细信息见日志：'; close = '关闭'; busy = 'Zen 配置文件仍被占用。请关闭所有 Zen 窗口后重新更新。' }
  es = @{ title = 'Actualizando Luminoctis…'; unpack = 'Descomprimiendo archivos…'; install = 'Instalando la actualización…'; restart = 'Iniciando Zen…'; done = 'Listo'; errTitle = 'No se pudo actualizar Luminoctis'; errBody = 'Los detalles están en el registro:'; close = 'Cerrar'; busy = 'El perfil de Zen sigue en uso. Cierra todas las ventanas de Zen y vuelve a actualizar.' }
  ar = @{ title = 'جارٍ تحديث Luminoctis…'; unpack = 'جارٍ فك ضغط الملفات…'; install = 'جارٍ تثبيت التحديث…'; restart = 'جارٍ تشغيل Zen…'; done = 'تم'; errTitle = 'تعذّر تحديث Luminoctis'; errBody = 'التفاصيل في السجل:'; close = 'إغلاق'; busy = 'ملف تعريف Zen ما زال قيد الاستخدام. أغلق كل نوافذ Zen ثم أعد التحديث.' }
  pt = @{ title = 'Atualizando o Luminoctis…'; unpack = 'Descompactando arquivos…'; install = 'Instalando a atualização…'; restart = 'Iniciando o Zen…'; done = 'Concluído'; errTitle = 'Não foi possível atualizar o Luminoctis'; errBody = 'Os detalhes estão no registro:'; close = 'Fechar'; busy = 'O perfil do Zen ainda está em uso. Feche todas as janelas do Zen e atualize novamente.' }
  id = @{ title = 'Memperbarui Luminoctis…'; unpack = 'Mengekstrak berkas…'; install = 'Memasang pembaruan…'; restart = 'Memulai Zen…'; done = 'Selesai'; errTitle = 'Tidak dapat memperbarui Luminoctis'; errBody = 'Detailnya ada di log:'; close = 'Tutup'; busy = 'Profil Zen masih digunakan. Tutup semua jendela Zen lalu perbarui lagi.' }
  fr = @{ title = 'Mise à jour de Luminoctis…'; unpack = 'Extraction des fichiers…'; install = 'Installation de la mise à jour…'; restart = 'Démarrage de Zen…'; done = 'Terminé'; errTitle = 'Impossible de mettre à jour Luminoctis'; errBody = 'Les détails sont dans le journal :'; close = 'Fermer'; busy = 'Le profil de Zen est encore utilisé. Fermez toutes les fenêtres de Zen et relancez la mise à jour.' }
  ja = @{ title = 'Luminoctis を更新しています…'; unpack = 'ファイルを展開しています…'; install = 'アップデートをインストールしています…'; restart = 'Zen を起動しています…'; done = '完了'; errTitle = 'Luminoctis を更新できませんでした'; errBody = '詳細はログを参照してください：'; close = '閉じる'; busy = 'Zen のプロファイルがまだ使用中です。すべての Zen ウィンドウを閉じてからもう一度更新してください。' }
  ru = @{ title = 'Luminoctis обновляется…'; unpack = 'Распаковка файлов…'; install = 'Установка обновления…'; restart = 'Запускаем Zen…'; done = 'Готово'; errTitle = 'Не удалось обновить Luminoctis'; errBody = 'Подробности — в журнале:'; close = 'Закрыть'; busy = 'Профиль Zen ещё занят. Закройте все окна Zen и обновите снова.' }
  de = @{ title = 'Luminoctis wird aktualisiert…'; unpack = 'Dateien werden entpackt…'; install = 'Update wird installiert…'; restart = 'Zen wird gestartet…'; done = 'Fertig'; errTitle = 'Luminoctis konnte nicht aktualisiert werden'; errBody = 'Details stehen im Protokoll:'; close = 'Schließen'; busy = 'Das Zen-Profil wird noch verwendet. Schließen Sie alle Zen-Fenster und aktualisieren Sie erneut.' }
}
if (-not $Lang) { $Lang = (Get-UICulture).TwoLetterISOLanguageName }
$Lang = "$Lang".ToLower()
if (-not $Strings.ContainsKey($Lang)) { $Lang = 'en' }
$T = $Strings[$Lang]

# ---------- окно: отдельный поток STA; главный поток только пишет в $sync ----------
# pct — куда идёт полоса, text — подпись, error/errorLog — показать ошибку и кнопку «Закрыть», closing — закрыть окно, closed — окно закрыто (или не открылось), ready — окно уже рисуется
$sync = [hashtable]::Synchronized(@{ pct = 4; text = ''; error = ''; errorLog = ''; closing = $false; closed = $false; ready = $false; offscreen = [bool]$Offscreen })
$uiCode = {
  param($sync, $T, $rtl)
  try {
    Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Width="440" SizeToContent="Height" WindowStyle="None" AllowsTransparency="True" Background="Transparent" ResizeMode="NoResize"
        WindowStartupLocation="CenterScreen" ShowInTaskbar="True" UseLayoutRounding="True" FontFamily="Segoe UI" Title="Luminoctis">
  <!-- цвета — Tokyo Night, как у установщика: bg1 #1a1b26, raised #24283b, fg #c0caf5, muted #a9b1d6, dim #565f89, accent #7aa2f7 -->
  <Border Margin="18" CornerRadius="16" Background="#1a1b26" BorderBrush="#24283b" BorderThickness="1" Padding="30,30,30,28">
    <Border.Effect><DropShadowEffect BlurRadius="26" ShadowDepth="0" Opacity="0.65"/></Border.Effect>
    <StackPanel>
      <Border Width="64" Height="64" CornerRadius="17" Background="#24283b" HorizontalAlignment="Center" FlowDirection="LeftToRight">
        <Path x:Name="Logo" Width="64" Height="64" Stroke="#7aa2f7" StrokeThickness="2.2" StrokeLineJoin="Round">
          <Path.Effect><DropShadowEffect Color="#7aa2f7" BlurRadius="14" ShadowDepth="0" Opacity="0.9"/></Path.Effect>
        </Path>
      </Border>
      <TextBlock x:Name="Title" FontSize="20" FontWeight="SemiBold" Foreground="#c0caf5" TextAlignment="Center" TextWrapping="Wrap" Margin="0,18,0,0"/>
      <TextBlock x:Name="Info" FontSize="13" Foreground="#a9b1d6" TextAlignment="Center" TextWrapping="Wrap" Margin="0,6,0,0" MinHeight="18"/>
      <TextBlock x:Name="LogPath" FontSize="11" Foreground="#565f89" TextAlignment="Center" TextWrapping="Wrap" Margin="0,6,0,0" FlowDirection="LeftToRight" Visibility="Collapsed"/>
      <Grid x:Name="Track" Height="6" Margin="0,20,0,0">
        <Border Background="#24283b" CornerRadius="3"/>
        <Border x:Name="Fill" Width="0" HorizontalAlignment="Left" Background="#7aa2f7" CornerRadius="3">
          <Border.Effect><DropShadowEffect x:Name="FillGlow" Color="#7aa2f7" BlurRadius="10" ShadowDepth="0" Opacity="0.6"/></Border.Effect>
        </Border>
      </Grid>
      <Button x:Name="CloseBtn" Visibility="Collapsed" HorizontalAlignment="Center" Margin="0,20,0,0" MinWidth="130" Height="34" Foreground="#16161e" FontSize="13" FontWeight="SemiBold" Cursor="Hand">
        <Button.Template><ControlTemplate TargetType="Button">
          <Border x:Name="B" Background="#7aa2f7" CornerRadius="9" Padding="22,0"><ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/></Border>
          <ControlTemplate.Triggers><Trigger Property="IsMouseOver" Value="True"><Setter TargetName="B" Property="Background" Value="#8fb2ff"/></Trigger></ControlTemplate.Triggers>
        </ControlTemplate></Button.Template>
      </Button>
    </StackPanel>
  </Border>
</Window>
'@
    $win = [System.Windows.Markup.XamlReader]::Parse($xaml)
    if ($sync.offscreen) { $win.WindowStartupLocation = 'Manual'; $win.Left = -30000; $win.Top = -30000 }
    if ($rtl) { $win.FlowDirection = [System.Windows.FlowDirection]::RightToLeft }
    $n = @{}; foreach ($k in 'Logo', 'Title', 'Info', 'LogPath', 'Track', 'Fill', 'FillGlow', 'CloseBtn') { $n[$k] = $win.FindName($k) }
    # неоновая «L» — тот же контур, что у установщика (setup\Setup.cs SetLogo)
    $face = New-Object System.Windows.Media.Typeface((New-Object System.Windows.Media.FontFamily('Consolas')), [System.Windows.FontStyles]::Normal, [System.Windows.FontWeights]::SemiBold, [System.Windows.FontStretches]::Normal)
    $ft = New-Object System.Windows.Media.FormattedText('L', [System.Globalization.CultureInfo]::InvariantCulture, [System.Windows.FlowDirection]::LeftToRight, $face, 44, [System.Windows.Media.Brushes]::White)
    $g = $ft.BuildGeometry((New-Object System.Windows.Point(0, 0)))
    $b = $g.Bounds
    $g.Transform = New-Object System.Windows.Media.TranslateTransform((32 - ($b.X + $b.Width / 2)), (32 - ($b.Y + $b.Height / 2)))
    $n.Logo.Data = $g
    $n.Title.Text = $T.title
    $n.CloseBtn.Content = $T.close
    $st = @{ cur = 0.0; err = $false }
    $win.add_MouseLeftButtonDown({ try { $win.DragMove() } catch { } })
    $win.add_KeyDown({ if ($_.Key -eq 'Escape' -and $st.err) { $win.Close() } })
    $n.CloseBtn.add_Click({ $win.Close() })
    $win.add_Closed({ $sync.closed = $true })
    $timer = New-Object System.Windows.Threading.DispatcherTimer
    $timer.Interval = [TimeSpan]::FromMilliseconds(30)
    $timer.add_Tick({
      $sync.ready = $true
      if ($sync.closing) { $win.Close(); return }
      $target = $sync.pct
      if ($sync.error -and -not $st.err) {
        $st.err = $true
        $n.Title.Text = $T.errTitle
        $n.LogPath.Text = $sync.errorLog
        $n.LogPath.Visibility = 'Visible'
        $red = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#f7768e')
        $n.Fill.Background = $red
        $n.FillGlow.Color = [System.Windows.Media.ColorConverter]::ConvertFromString('#f7768e')
        $n.CloseBtn.Visibility = 'Visible'
      }
      if ($st.err) { $n.Info.Text = $sync.error; $target = 100 } else { $n.Info.Text = $sync.text }
      $st.cur += ($target - $st.cur) * 0.2
      $n.Fill.Width = [Math]::Max(0, $n.Track.ActualWidth * [Math]::Min(100, $st.cur) / 100)
    })
    $timer.Start()
    [void]$win.ShowDialog()
  } catch {
    $sync.uiError = "$_"
  } finally {
    $sync.closed = $true
  }
}
$ui = $null
function Show-Window {
  $rs = [runspacefactory]::CreateRunspace()
  $rs.ApartmentState = 'STA'
  $rs.ThreadOptions = 'ReuseThread'
  $rs.Open()
  $script:ui = [powershell]::Create()
  $script:ui.Runspace = $rs
  [void]$script:ui.AddScript($uiCode.ToString()).AddArgument($sync).AddArgument($T).AddArgument($Lang -eq 'ar')
  [void]$script:ui.BeginInvoke()
}
# закрыть окно и дождаться, пока оно исчезнет (до $sec секунд)
function Close-Window([int]$sec = 3) {
  $sync.closing = $true
  for ($i = 0; $i -lt $sec * 20 -and -not $sync.closed; $i++) { Start-Sleep -Milliseconds 50 }
}
# ошибка: подпись в окне, ждём «Закрыть» (если окно не открылось — только лог)
function Show-Error($text) {
  $sync.errorLog = $log
  $sync.error = $text
  for ($i = 0; $i -lt 12000 -and -not $sync.closed; $i++) { Start-Sleep -Milliseconds 50 }
}

Log "Ждём выхода Zen (pid $ZenPid)"
Wait-Process -Id $ZenPid -Timeout 60 -ErrorAction SilentlyContinue
if (Get-Process -Id $ZenPid -ErrorAction SilentlyContinue) { Log 'Zen не закрылся за 60 секунд — обновление отменено'; exit 1 }

Show-Window
$sync.text = $T.unpack
for ($i = 0; $i -lt 100 -and -not $sync.ready -and -not $sync.closed; $i++) { Start-Sleep -Milliseconds 50 } # окно поднимается пару секунд: работаем, когда оно уже видно
# parent.lock отпускается не мгновенно: ждём до 15 с, пока профиль не освободится
$lock = Join-Path $ProfileDir 'parent.lock'
$free = $false
for ($i = 0; $i -lt 30 -and -not $free; $i++) {
  if (-not (Test-Path $lock)) { $free = $true; break }
  try { [IO.File]::Open($lock, 'Open', 'ReadWrite', 'None').Close(); $free = $true } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $free) {
  Log 'Профиль не освободился за 15 секунд — обновление отменено'
  Show-Error $T.busy
  exit 1
}

$failed = ''
# архив распаковываем здесь, а не в Zen: Zen к этому времени закрыт и не зависает на сотне файлов (и антивирус не тормозит его окно)
if ($Zip) {
  $sync.pct = 8
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $z = [IO.Compression.ZipFile]::OpenRead($Zip)
    try {
      $i = 0
      foreach ($e in $z.Entries) {
        $i++
        if (-not $e.Name) { continue }
        $target = [IO.Path]::GetFullPath((Join-Path $root ($e.FullName -replace '\\', '/')))
        if (-not $target.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Недопустимый путь в архиве: $($e.FullName)" }
        if ($e.FullName -like 'installer/*' -and (Test-Path $target)) { continue } # эти файлы уже на месте (и один из них — этот скрипт)
        [void](New-Item -ItemType Directory -Force (Split-Path $target -Parent))
        [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $target, $true)
        $sync.pct = 8 + [int](22 * $i / $z.Entries.Count)
      }
    } finally { $z.Dispose() }
    Log "Архив распакован ($Zip)"
  } catch { $failed = "$_" }
}

if (-not $failed) {
  $sync.pct = 30
  $sync.text = $T.install
  if ($HoldMs) { $sync.pct = 62; Start-Sleep -Milliseconds $HoldMs }
  $errLine = ''
  & (Join-Path $PSScriptRoot 'install.ps1') -ProfileDir $ProfileDir -ZenDir (Split-Path $ZenExe -Parent) -Update *>&1 | ForEach-Object {
    $line = "$_"
    Log $line
    if ($line -match '^##STEP (\d+)/(\d+)') { $sync.pct = 30 + [int](65 * ([int]$Matches[1] - 1) / [int]$Matches[2]) }
    elseif ($line -match '^##ERROR (.*)') { $errLine = $Matches[1] }
  }
  $code = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
  Log "install.ps1 завершился с кодом $code"
  if ($code -ne 0 -or $errLine) { $failed = if ($errLine) { $errLine } else { "install.ps1: код $code" } }
}

if ($failed) {
  Log "Не удалось обновить: $failed"
  Show-Error $T.errBody
} else {
  $sync.pct = 100
  $sync.text = if ($Relaunch) { $T.restart } else { $T.done }
  Start-Sleep -Milliseconds 700 # дать увидеть конец полосы
  Close-Window # окно исчезает до запуска Zen
}
if ($sync.uiError) { Log "Окно не открылось: $($sync.uiError)" }
if ($Relaunch) { Start-Process $ZenExe -ArgumentList '-profile', "`"$ProfileDir`""; Log 'Zen запущен' }
# чистим распакованный релиз, но только во временной папке обновления (не репозиторий при ручном запуске)
$tmp = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if ((Split-Path $tmp -Leaf) -like "luminoctis-update-*") { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
if ($failed) { exit 1 }
