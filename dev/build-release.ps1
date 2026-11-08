# Собирает релиз мода: dev\dist\Luminoctis-<версия>.zip (+ .sha256, только hex). Версия — из theme.json; тег на GitHub: v<версия>.
# -Root — откуда брать файлы (по умолчанию репозиторий), -OutDir — куда класть (по умолчанию dev\dist).
param([string]$Root = (Split-Path $PSScriptRoot -Parent), [string]$OutDir = (Join-Path $PSScriptRoot 'dist'))
$ErrorActionPreference = 'Stop'
$ver = ([IO.File]::ReadAllText((Join-Path $Root 'theme.json')) | ConvertFrom-Json).version
$stage = Join-Path ([IO.Path]::GetTempPath()) "luminoctis-build-$ver"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $stage, $OutDir -Force | Out-Null
foreach ($n in 'install.cmd', 'installer', 'js', 'settings', 'home', 'sounds', 'vendor', 'chrome.css', 'preferences.json', 'theme.json', 'README.md', 'LICENSE') {
  $p = Join-Path $Root $n
  if (Test-Path $p) { Copy-Item $p $stage -Recurse }
}
Remove-Item (Join-Path $stage 'sounds\src') -Recurse -Force -ErrorAction SilentlyContinue # исходники звуков (wav) в архив не идут
$zip = Join-Path $OutDir "Luminoctis-$ver.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression.FileSystem
# Свой цикл: ZipFile.CreateFromDirectory и Compress-Archive в PowerShell 5.1 пишут «» в путях, а nsIZipReader нужен «/»
$z = [IO.Compression.ZipFile]::Open($zip, "Create")
foreach ($f in Get-ChildItem $stage -Recurse -File) {
  $name = $f.FullName.Substring($stage.Length + 1).Replace("\", "/")
  [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $f.FullName, $name, "Optimal")
}
$z.Dispose()
Remove-Item $stage -Recurse -Force
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText("$zip.sha256", $hash, (New-Object Text.UTF8Encoding($false)))
"$zip`n$hash"
