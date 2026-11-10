# Запускается модом (js/lumi-update.sys.mjs) из распакованного релиза: ждёт выхода Zen, обновляет профиль установщиком, при -Relaunch поднимает Zen.
# Лог: <профиль>\luminoctis-update.log
param([int]$ZenPid, [string]$ProfileDir, [string]$ZenExe, [switch]$Relaunch)
$ErrorActionPreference = 'Continue'
$log = Join-Path $ProfileDir 'luminoctis-update.log'
function Log($m) { "$(Get-Date -Format 's') $m" | Out-File $log -Append -Encoding utf8 }
Set-Content $log '' -Encoding utf8
Log "Ждём выхода Zen (pid $ZenPid)"
Wait-Process -Id $ZenPid -Timeout 60 -ErrorAction SilentlyContinue
if (Get-Process -Id $ZenPid -ErrorAction SilentlyContinue) { Log 'Zen не закрылся за 60 секунд — обновление отменено'; exit 1 }
# parent.lock отпускается не мгновенно: ждём до 15 с, пока профиль не освободится
$lock = Join-Path $ProfileDir 'parent.lock'
$free = $false
for ($i = 0; $i -lt 30 -and -not $free; $i++) {
  if (-not (Test-Path $lock)) { $free = $true; break }
  try { [IO.File]::Open($lock, 'Open', 'ReadWrite', 'None').Close(); $free = $true } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $free) {
  Log 'Профиль не освободился за 15 секунд — обновление отменено'
  try { Add-Type -AssemblyName System.Windows.Forms; [void][Windows.Forms.MessageBox]::Show("Профиль Zen ещё занят, обновление Luminoctis отменено. Закройте все окна Zen и запустите обновление снова.`nЛог: $log", 'Luminoctis') } catch { }
  exit 1
}
& (Join-Path $PSScriptRoot 'install.ps1') -ProfileDir $ProfileDir -ZenDir (Split-Path $ZenExe -Parent) -Update *>&1 | ForEach-Object { Log "$_" }
$code = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
Log "install.ps1 завершился с кодом $code"
if ($Relaunch) { Start-Process $ZenExe -ArgumentList '-profile', "`"$ProfileDir`""; Log 'Zen запущен' }
# чистим распакованный релиз, но только во временной папке обновления (не репозиторий при ручном запуске)
$tmp = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if ((Split-Path $tmp -Leaf) -like "luminoctis-update-*") { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
