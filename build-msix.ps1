<#
Builds the DoubleShift desktop app and its MSIX package.

  .\build-msix.ps1                      Build dist\DoubleShift and dist\DoubleShift-<version>.msix
  .\build-msix.ps1 -CertPath test.pfx   Also sign the MSIX, to install it on this PC for testing

The Store signs the package itself, so a package for the Store needs no -CertPath.
Needs: Node.js, backend\venv with requirements-desktop.txt installed, and the Windows SDK.
See packaging\README.md.
#>
param(
    [string]$CertPath,
    [string]$CertPassword
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$python = Join-Path $root 'backend\venv\Scripts\python.exe'
$dist = Join-Path $root 'dist'
$build = Join-Path $root 'build'
$staging = Join-Path $build 'msix'

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

function Run($exe) {
    & $exe @args
    if ($LASTEXITCODE -ne 0) { throw "$exe failed (exit code $LASTEXITCODE)" }
}

# The Windows SDK tools, from the newest SDK installed.
function SdkTool($name) {
    $found = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\$name" -ErrorAction SilentlyContinue |
        Sort-Object { [version]$_.Directory.Parent.Name } -Descending | Select-Object -First 1
    if (-not $found) { throw "$name wasn't found. Install the Windows SDK." }
    $found.FullName
}

# --- Checks before building ---
if (-not (Test-Path $python)) { throw 'backend\venv is missing. See packaging\README.md.' }
$manifest = Get-Content (Join-Path $root 'packaging\AppxManifest.xml') -Raw
if ($manifest -match 'REPLACE-ME') { throw 'Fill in the REPLACE-ME values in packaging\AppxManifest.xml first (from Partner Center).' }
$required = 'Square44x44Logo', 'Square150x150Logo', 'StoreLogo'
$missing = $required | Where-Object { -not (Get-ChildItem (Join-Path $root "packaging\Assets\$_*.png") -ErrorAction SilentlyContinue) }
if ($missing) { throw "packaging\Assets is missing: $($missing -join ', '). See packaging\README.md." }

# MSIX versions have four parts; the Store needs the last one to be 0.
$version = (Get-Content (Join-Path $root 'frontend\package.json') -Raw | ConvertFrom-Json).version
$msixVersion = "$version.0"

Step "Frontend build (version $version)"
Push-Location (Join-Path $root 'frontend')
# npm.cmd, not npm: PowerShell's npm.ps1 rereads the typed command line, so it loses
# arguments passed on through Run.
try { Run npm.cmd ci; Run npm.cmd run build } finally { Pop-Location }

Step 'Third party notices'
Run $python -I (Join-Path $root 'packaging\make_notices.py')

Step 'DoubleShift.exe'
Push-Location (Join-Path $root 'backend')
try {
    Run $python -m PyInstaller doubleshift.spec --noconfirm --distpath $dist --workpath (Join-Path $build 'pyinstaller')
} finally { Pop-Location }

Step 'MSIX'
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
Copy-Item (Join-Path $dist 'DoubleShift') $staging -Recurse
Copy-Item (Join-Path $root 'packaging\Assets') (Join-Path $staging 'Assets') -Recurse
Copy-Item (Join-Path $root 'LICENSE') (Join-Path $staging 'LICENSE.txt')
Copy-Item (Join-Path $root 'THIRD_PARTY_NOTICES.txt') $staging
$manifest -replace '(<Identity[^>]*Version=")[^"]*', "`${1}$msixVersion" |
    Set-Content (Join-Path $staging 'AppxManifest.xml') -Encoding UTF8

# resources.pri lets Windows pick the right logo size for each screen. It's made from a
# folder holding only the logos and the manifest, so makepri doesn't index the whole app.
$priRoot = Join-Path $build 'pri'
if (Test-Path $priRoot) { Remove-Item $priRoot -Recurse -Force }
New-Item -ItemType Directory $priRoot | Out-Null
Copy-Item (Join-Path $root 'packaging\Assets') (Join-Path $priRoot 'Assets') -Recurse
Copy-Item (Join-Path $staging 'AppxManifest.xml') $priRoot
$priConfig = Join-Path $build 'priconfig.xml'
Run (SdkTool 'makepri.exe') createconfig /cf $priConfig /dq en-US /pv 10.0.0 /o
Run (SdkTool 'makepri.exe') new /pr $priRoot /cf $priConfig /of (Join-Path $staging 'resources.pri') /o

$msix = Join-Path $dist "DoubleShift-$msixVersion.msix"
Run (SdkTool 'makeappx.exe') pack /d $staging /p $msix /o

if ($CertPath) {
    Step 'Signing for testing'
    $signArgs = @('sign', '/fd', 'SHA256', '/f', $CertPath)
    if ($CertPassword) { $signArgs += @('/p', $CertPassword) }
    Run (SdkTool 'signtool.exe') @signArgs $msix
}

Write-Host "`nDone: $msix" -ForegroundColor Green
