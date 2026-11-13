# Собирает единый установщик dev\dist\Luminoctis-Setup-<версия>.exe (C# + WPF, csc из Windows; ничего ставить не нужно).
# Внутри: payload.zip (его собирает build-release.ps1), setup\ui.xaml, значок «L» (рисуется здесь). Исходники — setup\ (Setup.cs, Strings.cs, ui.xaml).
# После сборки запускает exe с --selfcheck: если у какой-то строки нет всех 10 языков, сборка падает.
param([string]$Root = (Split-Path $PSScriptRoot -Parent), [string]$OutDir = (Join-Path $PSScriptRoot 'dist'))
$ErrorActionPreference = 'Stop'
$ver = ([IO.File]::ReadAllText((Join-Path $Root 'theme.json')) | ConvertFrom-Json).version
$stage = Join-Path ([IO.Path]::GetTempPath()) "luminoctis-setup-build-$ver"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $stage, $OutDir -Force | Out-Null
& (Join-Path $PSScriptRoot 'build-release.ps1') -Root $Root -OutDir $stage | Out-Null
Copy-Item (Join-Path $stage "Luminoctis-$ver.zip") (Join-Path $stage 'payload.zip')
# Тот же архив + .sha256 кладём рядом с exe: их ждёт обновление из настроек мода (js\lumi-update.sys.mjs) — грузить в релиз вместе с exe
Copy-Item (Join-Path $stage "Luminoctis-$ver.zip"), (Join-Path $stage "Luminoctis-$ver.zip.sha256") $OutDir

# Значок: «L» цветом акцента Tokyo Night на тёмной плашке; размеры 16-64 как BMP, 256 как PNG
Add-Type -AssemblyName System.Drawing
function New-Frame($n) {
  $b = New-Object Drawing.Bitmap $n, $n, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [Drawing.Graphics]::FromImage($b); $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
  $r = [single]($n * 0.22); $d = $r * 2
  $path = New-Object Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $d, $d, 180, 90); $path.AddArc($n - $d, 0, $d, $d, 270, 90); $path.AddArc($n - $d, $n - $d, $d, $d, 0, 90); $path.AddArc(0, $n - $d, $d, $d, 90, 90); $path.CloseFigure()
  $g.FillPath((New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#24283b'))), $path)
  $f = New-Object Drawing.Font 'Consolas', ([single]($n * 0.62)), ([Drawing.FontStyle]::Bold), ([Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object Drawing.StringFormat; $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
  $g.DrawString('L', $f, (New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#7aa2f7'))), (New-Object Drawing.RectangleF 0, ([single]($n * 0.03)), $n, $n), $sf)
  $g.Dispose(); $b
}
$sizes = 16, 24, 32, 48, 64, 256
$blobs = foreach ($n in $sizes) {
  $b = New-Frame $n
  $ms = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter $ms
  if ($n -ge 256) { $b.Save($ms, [Drawing.Imaging.ImageFormat]::Png) }
  else {
    $w.Write([int]40); $w.Write([int]$n); $w.Write([int]($n * 2)); $w.Write([int16]1); $w.Write([int16]32); $w.Write([int]0); $w.Write([int]0); $w.Write([int]0); $w.Write([int]0); $w.Write([int]0); $w.Write([int]0)
    for ($y = $n - 1; $y -ge 0; $y--) { for ($x = 0; $x -lt $n; $x++) { $w.Write([int]($b.GetPixel($x, $y).ToArgb())) } }
    $w.Write((New-Object byte[] ([int]([math]::Ceiling($n / 32.0) * 4 * $n))))
  }
  $w.Flush(); ,$ms.ToArray()
}
$ico = Join-Path $stage 'luminoctis.ico'
$fs = [IO.File]::Create($ico); $w = New-Object IO.BinaryWriter $fs
$w.Write([int16]0); $w.Write([int16]1); $w.Write([int16]$sizes.Count)
$off = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $n = $sizes[$i]; $len = $blobs[$i].Length
  $w.Write([byte]($n % 256)); $w.Write([byte]($n % 256)); $w.Write([byte]0); $w.Write([byte]0); $w.Write([int16]1); $w.Write([int16]32); $w.Write([int]$len); $w.Write([int]$off)
  $off += $len
}
foreach ($bl in $blobs) { $w.Write([byte[]]$bl) }
$w.Close()

$out = Join-Path $OutDir "Luminoctis-Setup-$ver.exe"
Remove-Item $out -Force -ErrorAction SilentlyContinue
$fw = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319'
$wpf = "$fw\WPF"
$refs = "$wpf\PresentationFramework.dll", "$wpf\PresentationCore.dll", "$wpf\WindowsBase.dll", "$fw\System.Xaml.dll", "$fw\System.Core.dll", "$fw\System.IO.Compression.dll", "$fw\System.IO.Compression.FileSystem.dll", "$fw\System.Web.Extensions.dll", "$fw\System.Windows.Forms.dll", "$fw\System.Management.dll", "$fw\System.dll"
$a = @('/nologo', '/target:winexe', '/codepage:65001', '/platform:anycpu', "/out:$out", "/win32icon:$ico", "/win32manifest:$(Join-Path $Root 'setup\app.manifest')",
  "/resource:$stage\payload.zip,payload.zip", "/resource:$(Join-Path $Root 'setup\ui.xaml'),ui.xaml") + ($refs | ForEach-Object { "/reference:$_" }) + (Join-Path $Root 'setup\Setup.cs') + (Join-Path $Root 'setup\Strings.cs')
& "$fw\csc.exe" @a
if ($LASTEXITCODE -ne 0) { throw 'csc: сборка не удалась' }

# Самопроверка словаря строк: у каждой строки все 10 языков и одинаковые {0}. Не прошла — сборка падает, exe удаляется.
$chk = Join-Path $stage 'selfcheck.txt'
$p = Start-Process $out -ArgumentList '--selfcheck', "`"$chk`"" -Wait -PassThru
$res = if (Test-Path $chk) { [IO.File]::ReadAllText($chk, [Text.Encoding]::UTF8).Trim() } else { '(нет результата)' }
if ($p.ExitCode -ne 0) { Remove-Item $out -Force; throw "Самопроверка строк установщика не прошла:`n$res" }
"selfcheck: $res"
Remove-Item $stage -Recurse -Force
"$out`n$((Get-Item $out).Length) bytes"
