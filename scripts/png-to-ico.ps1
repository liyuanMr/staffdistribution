# 把 PNG 转成多尺寸 .ico（16~256），供 csc /win32icon 使用。
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/png-to-ico.ps1 -InputPath public/xxx.png -OutputPath build/app-icon.ico
param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [int[]]$Sizes = @(16, 24, 32, 48, 64, 128, 256)
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $InputPath))
$frames = New-Object System.Collections.ArrayList

try {
  foreach ($size in $Sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.Clear([System.Drawing.Color]::Transparent)
      $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
    } finally {
      $g.Dispose()
    }

    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = $data.Stride
    $raw = New-Object byte[] ($stride * $size)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $raw, 0, $raw.Length)
    $bmp.UnlockBits($data)
    $bmp.Dispose()

    $rowBytes = $size * 4
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    # BITMAPINFOHEADER，高度写两倍（含 AND 掩码）
    $bw.Write([UInt32]40)
    $bw.Write([Int32]$size)
    $bw.Write([Int32]($size * 2))
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]0)
    $bw.Write([UInt32]($rowBytes * $size))
    $bw.Write([Int32]0)
    $bw.Write([Int32]0)
    $bw.Write([UInt32]0)
    $bw.Write([UInt32]0)
    for ($y = $size - 1; $y -ge 0; $y--) {
      $bw.Write($raw, ($y * $stride), $rowBytes)
    }
    $maskStride = [int]([Math]::Floor(($size + 31) / 32) * 4)
    $zeros = New-Object byte[] ($maskStride * $size)
    $bw.Write($zeros, 0, $zeros.Length)
    $bw.Flush()
    [void]$frames.Add([PSCustomObject]@{ Size = $size; Bytes = $ms.ToArray() })
    $bw.Dispose()
    $ms.Dispose()
  }
} finally {
  $src.Dispose()
}

$count = $frames.Count
$offset = 6 + 16 * $count
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($out)
$w.Write([UInt16]0)
$w.Write([UInt16]1)
$w.Write([UInt16]$count)
foreach ($f in $frames) {
  $dim = if ($f.Size -ge 256) { 0 } else { $f.Size }
  $w.Write([Byte]$dim)
  $w.Write([Byte]$dim)
  $w.Write([Byte]0)
  $w.Write([Byte]0)
  $w.Write([UInt16]1)
  $w.Write([UInt16]32)
  $w.Write([UInt32]$f.Bytes.Length)
  $w.Write([UInt32]$offset)
  $offset += $f.Bytes.Length
}
foreach ($f in $frames) {
  $w.Write($f.Bytes, 0, $f.Bytes.Length)
}
$w.Flush()

$outDir = Split-Path -Parent $OutputPath
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}
[System.IO.File]::WriteAllBytes($OutputPath, $out.ToArray())
$w.Dispose()
$out.Dispose()
Write-Host "[png-to-ico] $InputPath -> $OutputPath ($($Sizes -join ', '))"
