$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path $PSScriptRoot -Parent
$masterPath = Join-Path $PSScriptRoot 'source\pa-bud-helper-master.png'
$iconDir = Join-Path $repoRoot 'shared\icons'
if (-not (Test-Path -LiteralPath $masterPath)) { throw "Missing icon master: $masterPath" }

$master = [System.Drawing.Image]::FromFile($masterPath)
try {
    if ($master.Width -ne $master.Height) { throw 'The icon master must be square.' }
    foreach ($size in @(16, 32, 48, 128)) {
        $icon = [System.Drawing.Bitmap]::new($size, $size)
        try {
            $drawing = [System.Drawing.Graphics]::FromImage($icon)
            try {
                $drawing.Clear([System.Drawing.Color]::Transparent)
                $drawing.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $drawing.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $drawing.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $drawing.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $drawing.DrawImage($master, [System.Drawing.Rectangle]::new(0, 0, $size, $size))
            } finally { $drawing.Dispose() }
            $icon.Save((Join-Path $iconDir "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $icon.Dispose() }
    }
} finally { $master.Dispose() }

Copy-Item -LiteralPath (Join-Path $iconDir 'icon128.png') -Destination (Join-Path $PSScriptRoot 'store-icon-128.png')
Write-Host 'Updated Chrome, Firefox, and store icons from the shared master.'
