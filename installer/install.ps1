# Установщик мода Luminoctis для Zen Browser (Windows, PowerShell 5.1).
# Запуск: install.cmd (двойной клик). Параметры:
#   -ZenDir <папка программы Zen>   вместо поиска по реестру
#   -ProfileDir <папка профиля>     вместо выбора из profiles.ini (для тестов)
#   -Uninstall                      убрать мод
#   -Yes                            отвечать «да» на все вопросы
#   -Probe                          ничего не менять, вывести одну строку JSON (Zen, профили, версия, мешающие моды, Sine) — для Luminoctis-Setup.exe
#   -DisableMods <id,id> / -KeepMods  заранее решить, какие мешающие моды выключить (без вопроса); для графического установщика
#   -Update                         как -Yes, но выключенные ранее моды Zen заново не трогает (зовёт update.ps1 при обновлении из мода)
# Повторный запуск = обновление/починка. Источники берутся от корня репозитория (папка выше installer\).
param([string]$ZenDir, [string]$ProfileDir, [switch]$Uninstall, [switch]$Yes, [switch]$Update, [switch]$Probe, [string]$DisableMods, [switch]$KeepMods)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = Split-Path $PSScriptRoot -Parent
$utf8 = New-Object Text.UTF8Encoding($false)
$marker = '/* luminoctis-installer */'
$importLine = '@import url("luminoctis/chrome.css"); ' + $marker
$overlap = @('Transparent Zen', 'Sidebar Expand on Hover', 'Load Bar', 'Better Unloaded Tabs')
# Настройки Zen, которые нужны моду (значения — как в prefs.js). Не user.js: его значения навсегда бы блокировали выбор пользователя.
$prefDefs = [ordered]@{
  'toolkit.legacyUserProfileCustomizations.stylesheets' = 'true'
  'zen.workspaces.separate-essentials'                  = 'false'
  'zen.view.use-single-toolbar'                         = 'false'
  'zen.view.compact.enable-at-startup'                  = 'true'
  'zen.view.compact.hide-toolbar'                       = 'true'
  'zen.view.compact.hide-tabbar'                        = 'false'
  'zen.view.sidebar-expanded'                           = 'true'
  'zen.view.show-newtab-button-top'                     = 'false'
  'browser.download.autohideButton'                     = 'false'
  'browser.urlbar.scotchBonnet.enableOverride'          = 'true'
  'browser.urlbar.unifiedSearchButton.always'           = 'true'
}

function Fail($m, $code, $arg) {
  Write-Host "Ошибка: $m" -ForegroundColor Red
  $tag = if ($code) { if ($arg) { "$code|$arg" } else { $code } } else { $m }
  Write-Host "##ERROR $tag"; exit 1
}
# метки для графического установщика: ##STEP n/всего ключ, ##DONE версия|uninstall, ##ERROR код[|аргумент]
# (текст по коду берёт setup\Strings.cs, ключ "e.<код>"; без кода показывается сам текст)
function Step($n, $total, $key) { Write-Host "##STEP $n/$total $key" }
function Ask($q) {
  if ($Yes -or $Update) { Write-Host "$q [да]"; return $true }
  $a = Read-Host "$q (Y/n)"
  return ($a -eq '' -or $a -match '^[YyДд]')
}
function Same($a, $b) { (Test-Path $b) -and ((Get-FileHash $a).Hash -eq (Get-FileHash $b).Hash) }
function Read-Ini($path) {
  $r = @(); $cur = $null
  foreach ($l in (Get-Content $path -Encoding UTF8)) {
    if ($l -match '^\[(.+)\]\s*$') { $cur = @{ Section = $Matches[1] }; $r += , $cur }
    elseif ($cur -and $l -match '^([^=]+)=(.*)$') { $cur[$Matches[1]] = $Matches[2].Trim() }
  }
  $r
}
function Find-Zen {
  $found = @()
  foreach ($hive in 'HKLM:', 'HKCU:') {
    foreach ($base in 'SOFTWARE\Mozilla', 'SOFTWARE\WOW6432Node\Mozilla') {
      $k = "$hive\$base"
      if (-not (Test-Path $k)) { continue }
      foreach ($c in (Get-ChildItem $k | Where-Object { $_.PSChildName -like 'Zen Browser *' } | Sort-Object PSChildName -Descending)) {
        $exe = (Get-ItemProperty "$($c.PSPath)\bin" -ErrorAction SilentlyContinue).PathToExe
        if ($exe -and (Test-Path $exe)) { $found += $exe }
      }
    }
  }
  if ($found) { return (Split-Path $found[0] -Parent) }
  if (Test-Path 'C:\Program Files\Zen Browser\zen.exe') { return 'C:\Program Files\Zen Browser' }
  $null
}
function Pref-Re($name) { '^\s*user_pref\("' + [regex]::Escape($name) + '",' }
function Get-PrefRaw($lines, $name) {
  $m = @($lines | Where-Object { $_ -match (Pref-Re $name) })
  if (-not $m) { return $null }
  if ($m[-1] -match '^\s*user_pref\("[^"]+",\s*(.*)\);\s*$') { return $Matches[1] }
  $null
}
# Убирает из prefs.js строки перечисленных настроек и дописывает новые ($add: имя -> сырое значение).
function Set-Prefs($file, $names, $add) {
  $lines = if (Test-Path $file) { [IO.File]::ReadAllLines($file, $utf8) } else { @() }
  $keep = @($lines | Where-Object { $l = $_; -not ($names | Where-Object { $l -match (Pref-Re $_) }) })
  foreach ($k in $add.Keys) { $keep += "user_pref(`"$k`", $($add[$k]));" }
  [IO.File]::WriteAllLines($file, [string[]]$keep, $utf8)
}
function Remove-IfEmpty($d) { if ((Test-Path $d) -and -not (Get-ChildItem $d -Force)) { Remove-Item $d -Force } }
function Read-Mods($f) { if (Test-Path $f) { [IO.File]::ReadAllText($f) | ConvertFrom-Json } else { [pscustomobject]@{} } }
function Write-Mods($mods, $f) { [IO.File]::WriteAllText($f, ($mods | ConvertTo-Json -Depth 10), $utf8) }

# ===== Проба (ничего не меняет) =====
if ($Probe) {
  $zd = if ($ZenDir) { $ZenDir } else { Find-Zen }
  if ($zd -and -not (Test-Path (Join-Path $zd 'zen.exe'))) { $zd = $null }
  $zData = Join-Path $env:APPDATA 'zen'
  $plist = @(); $pdef = $null
  $pini = Join-Path $zData 'profiles.ini'
  if (Test-Path $pini) {
    $iniDef = $null
    $inst0 = Join-Path $zData 'installs.ini'
    if (Test-Path $inst0) { $iniDef = @(Read-Ini $inst0 | Where-Object { $_.Default } | ForEach-Object { Join-Path $zData ($_.Default -replace '/', '\') })[0] }
    foreach ($e in @(Read-Ini $pini | Where-Object { $_.Path })) {
      $d = if ($e.IsRelative -eq '1') { Join-Path $zData ($e.Path -replace '/', '\') } else { $e.Path -replace '/', '\' }
      $isDef = if ($iniDef) { $d -ieq $iniDef } else { $e.Default -eq '1' }
      $plist += [pscustomobject]@{ name = $e.Name; dir = $d; isDefault = [bool]$isDef }
    }
  }
  $cur = $null
  if ($ProfileDir) { $cur = $ProfileDir } else { $c = @($plist | Where-Object isDefault); if ($c) { $cur = $c[0].dir } }
  $ver = $null; $hitsP = @(); $sine = $false
  if ($cur -and (Test-Path $cur)) {
    $sf = Join-Path $cur 'luminoctis-install.json'
    if (Test-Path $sf) { try { $ver = ([IO.File]::ReadAllText($sf) | ConvertFrom-Json).version } catch {} }
    $mf = Join-Path $cur 'zen-themes.json'
    if (Test-Path $mf) {
      try {
        $pm = [IO.File]::ReadAllText($mf) | ConvertFrom-Json
        $hitsP = @($pm.PSObject.Properties | Where-Object { $n = $_.Value.name; $_.Name -ne 'luminoctis' -and $_.Value.enabled -and $n -and ($overlap | Where-Object { $n -like "*$_*" }) } |
          ForEach-Object { [pscustomobject]@{ id = $_.Name; name = $_.Value.name } })
      } catch {}
    }
    if (Test-Path (Join-Path $cur 'chrome\sine-mods')) { $sine = $true }
  }
  if ($zd) {
    $pd = if ($zd -match '\\scoop\\apps\\') { ($zd -replace '\\apps\\.*$', '') + '\persist\zen-browser\addition' } else { $zd }
    foreach ($cj in (Join-Path $zd 'config.js'), (Join-Path $pd 'config.js')) { if ((Test-Path $cj) -and (Select-String -Path $cj -Pattern 'sine' -Quiet)) { $sine = $true } }
  }
  [ordered]@{ zenDir = $zd; profile = $cur; profiles = $plist; installedVersion = $ver; overlapMods = $hitsP; sine = $sine } | ConvertTo-Json -Compress -Depth 5
  exit 0
}

# --- 1. Zen ---
$total = if ($Uninstall) { 3 } else { 6 }
Step 1 $total 'zen'
if (-not $ZenDir) { $ZenDir = Find-Zen }
if (-not $ZenDir -or -not (Test-Path (Join-Path $ZenDir 'zen.exe'))) { Fail 'Zen не найден. Укажите папку: install.cmd -ZenDir "C:\...\Zen Browser"' 'zen' }
$scoop = $ZenDir -match '\\scoop\\apps\\'
$progDir = $ZenDir
if ($scoop) {
  $progDir = ($ZenDir -replace '\\apps\\.*$', '') + '\persist\zen-browser\addition'
  Write-Host "Scoop: программная часть fx-autoconfig должна лежать в $progDir (она переживёт обновление Zen)."
}
Write-Host "Zen: $ZenDir"

# --- 2. Профиль ---
Step 2 $total 'profile'
$zenData = Join-Path $env:APPDATA 'zen'
if ($ProfileDir) {
  if (-not (Test-Path $ProfileDir)) { Fail "Профиль не найден: $ProfileDir" 'noprofdir' $ProfileDir }
  $profile = (Resolve-Path $ProfileDir).Path
} else {
  $ini = Join-Path $zenData 'profiles.ini'
  if (-not (Test-Path $ini)) { Fail "Не найден $ini. Запустите Zen хотя бы раз." 'noini' }
  $profs = @(Read-Ini $ini | Where-Object { $_.Path } | ForEach-Object {
    $d = if ($_.IsRelative -eq '1') { Join-Path $zenData ($_.Path -replace '/', '\') } else { $_.Path }
    [pscustomobject]@{ Name = $_.Name; Dir = $d }
  })
  $defs = @()
  $inst = Join-Path $zenData 'installs.ini'
  if (Test-Path $inst) {
    $defs = @(Read-Ini $inst | Where-Object { $_.Default } | ForEach-Object { Join-Path $zenData ($_.Default -replace '/', '\') } | Select-Object -Unique)
  }
  $profile = $null
  if ($defs.Count -eq 1) {
    Write-Host "Профиль по умолчанию: $($defs[0])"
    if (Ask 'Ставить в него?') { $profile = $defs[0] }
  }
  if (-not $profile) {
    if (-not $profs) { Fail 'Профили не найдены.' 'noprofs' }
    if ($Yes -or $Update) { Fail 'Профиль не выбран: укажите -ProfileDir.' 'nosel' }
    for ($i = 0; $i -lt $profs.Count; $i++) { Write-Host ("  {0}. {1}  ({2})" -f ($i + 1), $profs[$i].Name, $profs[$i].Dir) }
    $n = [int](Read-Host 'Номер профиля')
    if ($n -lt 1 -or $n -gt $profs.Count) { Fail 'Нет такого номера.' }
    $profile = $profs[$n - 1].Dir
  }
  if (-not (Test-Path $profile)) { Fail "Профиль не найден: $profile" 'noprofdir' $profile }
}
Write-Host "Профиль: $profile"

# Профиль занят? (Zen держит parent.lock открытым)
$lock = Join-Path $profile 'parent.lock'
if (Test-Path $lock) {
  try { [IO.File]::Open($lock, 'Open', 'ReadWrite', 'None').Close() } catch { Fail 'Профиль занят. Закройте Zen и запустите снова.' 'busy' }
}

$chrome = Join-Path $profile 'chrome'
$stateFile = Join-Path $profile 'luminoctis-install.json'
$state = if (Test-Path $stateFile) { [IO.File]::ReadAllText($stateFile) | ConvertFrom-Json } else { $null }
$prefsFile = Join-Path $profile 'prefs.js'
$modsFile = Join-Path $profile 'zen-themes.json'
$uc = Join-Path $chrome 'userChrome.css'
$cacheDirs = @((Join-Path $profile 'startupCache'), (Join-Path $env:LOCALAPPDATA "zen\Profiles\$(Split-Path $profile -Leaf)\startupCache"))

# ===== Удаление =====
if ($Uninstall) {
  Step 3 $total 'uninstall'
  if (-not $state) { Fail 'Следов установки нет (luminoctis-install.json не найден).' 'nostate' }
  foreach ($f in @($state.jsFiles)) { Remove-Item (Join-Path $chrome "JS\$f") -Force -ErrorAction SilentlyContinue }
  foreach ($d in 'luminoctis', 'resources\luminoctis', 'zen-themes\luminoctis') { Remove-Item (Join-Path $chrome $d) -Recurse -Force -ErrorAction SilentlyContinue }
  Remove-IfEmpty (Join-Path $chrome 'resources'); Remove-IfEmpty (Join-Path $chrome 'zen-themes'); Remove-IfEmpty (Join-Path $chrome 'JS')
  if (-not $state.utilsPreExisted -and -not (Test-Path (Join-Path $chrome 'JS'))) { Remove-Item (Join-Path $chrome 'utils') -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path $uc) {
    $left = @([IO.File]::ReadAllLines($uc) | Where-Object { $_ -notlike "*$marker*" })
    if ($state.userChromeCreated -and -not (($left -join '').Trim())) { Remove-Item $uc -Force }
    else { [IO.File]::WriteAllLines($uc, [string[]]$left, $utf8) }
  }
  Remove-IfEmpty $chrome
  $mods = Read-Mods $modsFile
  if (Test-Path $modsFile) {
    $mods.PSObject.Properties.Remove('luminoctis')
    foreach ($id in @($state.disabledMods)) { if ($mods.PSObject.Properties[$id]) { $mods.$id.enabled = $true } }
    Write-Mods $mods $modsFile
  }
  $add = [ordered]@{}
  foreach ($p in $state.prefsBefore.PSObject.Properties) { if ($null -ne $p.Value) { $add[$p.Name] = $p.Value } }
  Set-Prefs $prefsFile @($prefDefs.Keys) $add
  foreach ($c in $cacheDirs) { Remove-Item $c -Recurse -Force -ErrorAction SilentlyContinue }
  Remove-Item $stateFile -Force
  Write-Host 'Luminoctis удалён. Настройки мода (luminoctis.*) и резервные копии (luminoctis-backup) оставлены.'
  Write-Host 'Программная часть fx-autoconfig в папке Zen оставлена на месте (она безвредна без скриптов).'
  Write-Host '##DONE uninstall'
  exit 0
}

# --- 3. Sine ---
if (Test-Path (Join-Path $chrome 'sine-mods')) { Fail 'Найден Sine (chrome\sine-mods). Luminoctis с ним не совместим: Sine подменяет загрузчик скриптов. Удалите Sine или используйте другой профиль.' 'sine' }
foreach ($cj in (Join-Path $ZenDir 'config.js'), (Join-Path $progDir 'config.js')) {
  if ((Test-Path $cj) -and (Select-String -Path $cj -Pattern 'sine' -Quiet)) { Fail "В $cj упоминается Sine. Luminoctis с ним не совместим." 'sine' }
}

# --- 4. Программная часть fx-autoconfig ---
Step 3 $total 'program'
$srcProg = Join-Path $root 'vendor\fx-autoconfig\program'
$pairs = @(
  @{ S = (Join-Path $srcProg 'config.js'); T = (Join-Path $progDir 'config.js') },
  @{ S = (Join-Path $srcProg 'defaults\pref\config-prefs.js'); T = (Join-Path $progDir 'defaults\pref\config-prefs.js') }
)
foreach ($p in $pairs) { if (-not (Test-Path $p.S)) { Fail "Нет файла установщика: $($p.S)" 'nosrc' $p.S } }
$programByUs = [bool]($state -and $state.programInstalledByUs)
if (-not ($pairs | Where-Object { -not (Same $_.S $_.T) })) {
  Write-Host 'fx-autoconfig в папке Zen уже установлен — пропускаю.'
} else {
  if ((Test-Path $pairs[0].T) -and -not (Ask 'В папке Zen уже есть другой config.js. Заменить?')) { Fail 'Без fx-autoconfig скрипты мода не работают.' 'noac' }
  Write-Host 'Ставлю fx-autoconfig в папку Zen (нужны права администратора)...'
  $q = { param($s) $s.Replace("'", "''") }
  $cmd = "New-Item -ItemType Directory -Force '$(& $q (Split-Path $pairs[1].T -Parent))' | Out-Null; " +
         (($pairs | ForEach-Object { "Copy-Item '$(& $q $_.S)' '$(& $q $_.T)' -Force" }) -join '; ')
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($scoop -or $isAdmin) { Invoke-Expression $cmd }
  else {
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
    try { Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $enc } catch { Fail 'Запрос прав администратора отклонён.' 'uac' }
  }
  if ($pairs | Where-Object { -not (Same $_.S $_.T) }) { Fail 'Не удалось скопировать fx-autoconfig в папку Zen.' 'copyfail' }
  $programByUs = $true
}

# --- 5. Резервная копия ---
Step 4 $total 'backup'
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$bk = Join-Path $profile "luminoctis-backup\$ts"
New-Item -ItemType Directory -Force $bk | Out-Null
foreach ($f in 'chrome\userChrome.css', 'chrome\userContent.css', 'zen-themes.json') {
  $p = Join-Path $profile $f
  if (Test-Path $p) { Copy-Item $p (Join-Path $bk (Split-Path $f -Leaf)) }
}
# Исходные значения настроек запоминаем один раз (при повторной установке в prefs.js уже наши)
$prefsBefore = [ordered]@{}
if ($state -and $state.prefsBefore) { foreach ($p in $state.prefsBefore.PSObject.Properties) { $prefsBefore[$p.Name] = $p.Value } }
# настройки, добавленные в новых версиях, запоминаем при обновлении
$cur = if (Test-Path $prefsFile) { [IO.File]::ReadAllLines($prefsFile, $utf8) } else { @() }
# при повторной установке ставим только такие новые настройки; выбор пользователя в старых не трогаем
$newPrefs = [ordered]@{}
foreach ($k in $prefDefs.Keys) { if (-not $prefsBefore.Contains($k)) { $prefsBefore[$k] = Get-PrefRaw $cur $k; $newPrefs[$k] = $prefDefs[$k] } }
[IO.File]::WriteAllText((Join-Path $bk 'prefs-before.json'), ($prefsBefore | ConvertTo-Json), $utf8)

# --- 6. Профильная часть ---
Step 5 $total 'files'
New-Item -ItemType Directory -Force $chrome | Out-Null
$utilsPre = if ($state) { [bool]$state.utilsPreExisted } else { Test-Path (Join-Path $chrome 'utils') }
Copy-Item (Join-Path $root 'vendor\fx-autoconfig\utils') $chrome -Recurse -Force

$js = Join-Path $chrome 'JS'
New-Item -ItemType Directory -Force $js | Out-Null
if ($state) { foreach ($f in @($state.jsFiles)) { Remove-Item (Join-Path $js $f) -Force -ErrorAction SilentlyContinue } }
$jsSrc = Join-Path $root 'js'
$jsFiles = @(Get-ChildItem $jsSrc -File -Recurse | ForEach-Object { $_.FullName.Substring($jsSrc.Length + 1) })
foreach ($f in $jsFiles) {
  $t = Join-Path $js $f
  New-Item -ItemType Directory -Force (Split-Path $t -Parent) | Out-Null
  Copy-Item (Join-Path $jsSrc $f) $t -Force
}

$res = Join-Path $chrome 'resources\luminoctis'
Remove-Item $res -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $res | Out-Null
Copy-Item (Join-Path $root 'settings') (Join-Path $res 'settings') -Recurse
Copy-Item (Join-Path $root 'home') (Join-Path $res 'home') -Recurse

$lum = Join-Path $chrome 'luminoctis'
New-Item -ItemType Directory -Force $lum | Out-Null
Copy-Item (Join-Path $root 'chrome.css') (Join-Path $lum 'chrome.css') -Force

# userChrome.css: импорт строго первой строкой, один раз
$ucCreated = if ($state) { [bool]$state.userChromeCreated } else { -not (Test-Path $uc) }
$text = if (Test-Path $uc) { [IO.File]::ReadAllText($uc) } else { '' }
if ($text -notlike "*$marker*") { [IO.File]::WriteAllText($uc, $importLine + "`r`n" + $text, $utf8) }
if ($text -match '(?i)file:///[^"'')]*luminoctis[^"'')]*chrome\.css') { Write-Host 'Внимание: в userChrome.css есть старый импорт chrome.css по file:/// — удалите его, иначе стили загрузятся дважды.' -ForegroundColor Yellow }

# Мод в списке модов Zen (как в dev\create-profile.ps1): настройки на странице «Моды», стили идут через userChrome.css
$mod = Join-Path $chrome 'zen-themes\luminoctis'
New-Item -ItemType Directory -Force $mod | Out-Null
Copy-Item (Join-Path $root 'preferences.json'), (Join-Path $root 'README.md') $mod -Force
[IO.File]::WriteAllText((Join-Path $mod 'chrome.css'), '/* Luminoctis: стили подключены через userChrome.css */', $utf8)
$mods = Read-Mods $modsFile
$theme = [IO.File]::ReadAllText((Join-Path $root 'theme.json')) | ConvertFrom-Json
$entry = $theme | Select-Object *
# поля Sine (scripts, fork) списку модов Zen не нужны
foreach ($n in 'scripts', 'fork') { $entry.PSObject.Properties.Remove($n) }
$entry | Add-Member -Force enabled $true
$mods | Add-Member -Force luminoctis $entry

# --- 7. Пересекающиеся моды Zen ---
$disabled = @(); if ($state) { $disabled = @($state.disabledMods) }
$hits = @($mods.PSObject.Properties | Where-Object {
  $n = $_.Value.name
  $_.Name -ne 'luminoctis' -and $_.Value.enabled -and $n -and ($overlap | Where-Object { $n -like "*$_*" })
})
if ($hits -and -not $Update) {
  Write-Host 'Эти моды Zen делают то же, что Luminoctis, и мешают ему:'
  $hits | ForEach-Object { Write-Host "  - $($_.Value.name)" }
  if ($KeepMods) { Write-Host 'Оставляю включёнными.' }
  elseif ($DisableMods) {
    $ids = @($DisableMods -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    foreach ($h in $hits) { if ($ids -contains $h.Name) { $h.Value.enabled = $false; $disabled += $h.Name; Write-Host "Выключен: $($h.Value.name)" } }
  }
  elseif (Ask 'Выключить их?') { foreach ($h in $hits) { $h.Value.enabled = $false; $disabled += $h.Name } }
}
Write-Mods $mods $modsFile

# --- настройки Zen ---
Step 6 $total 'prefs'
Set-Prefs $prefsFile @($newPrefs.Keys) $newPrefs
foreach ($c in $cacheDirs) { Remove-Item $c -Recurse -Force -ErrorAction SilentlyContinue }

# --- 8. Состояние ---
[ordered]@{
  version = $theme.version; date = (Get-Date -Format 's'); backup = $bk; zenDir = $ZenDir
  programInstalledByUs = $programByUs; utilsPreExisted = $utilsPre; userChromeCreated = $ucCreated
  jsFiles = $jsFiles; disabledMods = @($disabled | Select-Object -Unique); prefsBefore = $prefsBefore
} | ConvertTo-Json -Depth 5 | ForEach-Object { [IO.File]::WriteAllText($stateFile, $_, $utf8) }

Write-Host "Luminoctis $($theme.version) установлен. Резервная копия: $bk" -ForegroundColor Green
Write-Host 'Запустите Zen.'
Write-Host "##DONE $($theme.version)"
