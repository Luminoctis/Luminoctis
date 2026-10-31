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
Start-Sleep 2 # parent.lock отпускается не мгновенно
& (Join-Path $PSScriptRoot 'install.ps1') -ProfileDir $ProfileDir -ZenDir (Split-Path $ZenExe -Parent) -Update *>&1 | ForEach-Object { Log "$_" }
$code = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
Log "install.ps1 завершился с кодом $code"
if ($Relaunch) { Start-Process $ZenExe -ArgumentList '-profile', "`"$ProfileDir`""; Log 'Zen запущен' }
# чистим распакованный релиз, но только во временной папке обновления (не репозиторий при ручном запуске)
$tmp = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if ((Split-Path $tmp -Leaf) -like "luminoctis-update-*") { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
