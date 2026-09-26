param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("chrome", "firefox")]
    [string]$Browser
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$browserRoot = Join-Path $repoRoot $Browser
$manifestPath = Join-Path $browserRoot "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$distPath = [IO.Path]::GetFullPath((Join-Path $browserRoot "dist"))
$stagePath = [IO.Path]::GetFullPath((Join-Path $distPath ("package-" + [guid]::NewGuid().ToString("N"))))
$zipPath = Join-Path $distPath ("pa-bud-{0}-{1}.zip" -f $Browser, $manifest.version)

# Validate the precise temporary target before creating or removing it.
if ((Split-Path $stagePath -Parent) -ne $distPath -or (Split-Path $stagePath -Leaf) -notmatch '^package-[a-f0-9]{32}$') {
    throw "Invalid staging directory: $stagePath"
}
New-Item -ItemType Directory -Path $stagePath -Force | Out-Null
try {
    Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $stagePath "manifest.json")
    New-Item -ItemType Directory -Path (Join-Path $stagePath "src"), (Join-Path $stagePath "icons") | Out-Null
    # Copy only files named by the manifest, never fixtures, tests, or exports.
    $assets = @($manifest.content_scripts | ForEach-Object { $_.js; $_.css })
    $assets += @($manifest.icons.PSObject.Properties | ForEach-Object { $_.Value })
    foreach ($asset in ($assets | Select-Object -Unique)) {
        if ($asset -notmatch '^(src|icons)/[\w.-]+$') { throw "Unexpected package path: $asset" }
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $asset) -Destination (Join-Path $stagePath $asset)
    }
    Compress-Archive -Path (Join-Path $stagePath "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force
} finally {
    # This unique staging directory was created by this invocation only.
    Remove-Item -LiteralPath $stagePath -Recurse -Force
}
Write-Host "Created $zipPath"
