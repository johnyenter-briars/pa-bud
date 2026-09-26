$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "..\shared\build-package.ps1") -Browser firefox
