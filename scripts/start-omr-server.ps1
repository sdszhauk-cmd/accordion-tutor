param(
  [string]$AudiverisCmd = "",
  [string]$NodeExe = "node",
  [string]$TessDataDir = "",
  [int]$Port = 8787
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$serverScript = Join-Path $projectRoot "server\omr-server.mjs"
$localAudiverisCmd = Join-Path $projectRoot ".omr\audiveris\app-5.11.0\bin\Audiveris.bat"
$localTessDataDir = Join-Path $projectRoot ".omr\tessdata"
$fallbackTessDataDir = ""

if (-not $AudiverisCmd) {
  $AudiverisCmd = $localAudiverisCmd
}

if (-not $TessDataDir) {
  if (Test-Path -LiteralPath $localTessDataDir) {
    $TessDataDir = $localTessDataDir
  } elseif (Test-Path -LiteralPath $fallbackTessDataDir) {
    $TessDataDir = $fallbackTessDataDir
  }
}

$nodeIsPath = $NodeExe -match "[/\\]"
if ($nodeIsPath -and -not (Test-Path -LiteralPath $NodeExe)) {
  throw "Node executable not found: $NodeExe"
} elseif (-not $nodeIsPath -and -not (Get-Command $NodeExe -ErrorAction SilentlyContinue)) {
  throw "'$NodeExe' not found on PATH. Install Node.js 18+ or pass -NodeExe with the full path to node.exe."
}

if (-not (Test-Path -LiteralPath $serverScript)) {
  throw "OMR server script not found: $serverScript"
}

if (-not (Test-Path -LiteralPath $AudiverisCmd)) {
  Write-Warning "Audiveris command was not found at: $AudiverisCmd"
  Write-Warning "Pass the correct path with: powershell -ExecutionPolicy Bypass -File .\scripts\start-omr-server.ps1 -AudiverisCmd `"C:\Path\To\Audiveris.bat`""
}

if ($TessDataDir -and (Test-Path -LiteralPath $TessDataDir)) {
  $env:TESSDATA_PREFIX = $TessDataDir
  Write-Host "Using OCR language data: $TessDataDir"
} else {
  Write-Warning "OCR language data was not found. Chord text such as Gm may not be recognized."
}

$env:AUDIVERIS_CMD = $AudiverisCmd
$env:OMR_PORT = [string]$Port

Set-Location -LiteralPath $projectRoot
& $NodeExe $serverScript
