# Packaging

Everything for building the Windows app and its MSIX package for the Microsoft Store.

| File | What it is |
|---|---|
| `AppxManifest.xml` | The package description: identity, name, logos, `.doubleshift` file association |
| `Assets/` | The logos inside the package (you make these, see below) |
| `DoubleShift.ico` | The exe and window icon (you make this) |
| `make_notices.py` | Writes `THIRD_PARTY_NOTICES.txt` at the repo root |
| `../build-msix.ps1` | Builds it all |

## One-time setup

1. **Tools:** Node.js, Python 3.12 and the [Windows SDK](https://developer.microsoft.com/windows/downloads/windows-sdk/) (for makeappx, makepri and signtool).
2. **Python environment:**
   ```powershell
   cd backend
   python -m venv venv
   .\venv\Scripts\python.exe -m pip install -r requirements-desktop.txt
   ```
3. **Identity:** in `AppxManifest.xml`, replace each `REPLACE-ME` value with the one from Partner Center (Product management > Product identity), exactly as shown there.
4. **Logos:** make the files below.

## Logos

Transparent PNGs in `Assets/`. The manifest names the base file (`Square44x44Logo.png`) and Windows picks the size it needs, so each file has a size in its name. At least the `scale-100` and `scale-200` files are needed; the rest look sharper on high resolution screens.

| File | Shown in | Sizes in pixels |
|---|---|---|
| `Square44x44Logo.scale-100.png` … `scale-400` | Start menu list, taskbar | 100: 44, 125: 55, 150: 66, 200: 88, 400: 176 |
| `Square44x44Logo.targetsize-16_altform-unplated.png` (and 24, 32, 48, 256) | Taskbar, File Explorer | 16, 24, 32, 48, 256 |
| `Square150x150Logo.scale-100.png` … `scale-400` | Start menu tile | 100: 150, 125: 188, 150: 225, 200: 300, 400: 600 |
| `StoreLogo.scale-100.png` … `scale-400` | Installer, package logo | 100: 50, 125: 63, 150: 75, 200: 100, 400: 200 |

Also make `packaging/DoubleShift.ico` (16, 20, 24, 32, 40, 48, 64 and 256 pixels in one file) for the exe, and `frontend/src/app/icon.png` (512 × 512) for the browser tab in Docker.

## Building

```powershell
.\build-msix.ps1
```

This builds the frontend, writes the third party notices, builds `dist\DoubleShift\DoubleShift.exe`, and packs `dist\DoubleShift-<version>.msix`. The version comes from `frontend/package.json` (`1.2.0` becomes `1.2.0.0`).

## Testing the MSIX on your PC

The Store signs the package, but to install it yourself it needs a test signature.

1. **Once:** make a test certificate. The subject must match the manifest's `Publisher` exactly.
   ```powershell
   $cert = New-SelfSignedCertificate -Type Custom -Subject "CN=<your Publisher value>" -KeyUsage DigitalSignature `
     -FriendlyName "DoubleShift test" -CertStoreLocation Cert:\CurrentUser\My `
     -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
   $password = ConvertTo-SecureString "test" -Force -AsPlainText
   Export-PfxCertificate -Cert $cert -FilePath packaging\test.pfx -Password $password
   ```
   Then, in PowerShell as administrator, trust it:
   ```powershell
   Import-PfxCertificate -FilePath packaging\test.pfx -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password $password
   ```
2. **Build and sign:** `.\build-msix.ps1 -CertPath packaging\test.pfx -CertPassword test`
3. **Install:** double-click the `.msix`, or `Add-AppxPackage dist\DoubleShift-<version>.msix`.
4. **Check** that it starts from the Start menu, opens `.doubleshift` files by double-click, runs and stops a schedule, and keeps your schedules in Documents\DoubleShift after you uninstall it.
5. **Certification kit:** run *Windows App Cert Kit* from the Start menu (as administrator), choose the `.msix`, and fix anything it reports before you submit.
6. **Uninstall the test copy** before installing from the Store, because both have the same identity.

`*.pfx` files are in `.gitignore`. Never commit one.

## Releasing a version

1. Raise `version` in `frontend/package.json` (each Store submission needs a higher version).
2. Commit and push.
3. `.\build-msix.ps1`, then test.
4. Tag the release on GitHub with the same version (`v1.2.0`), so the source for every version people install is public, as the AGPL requires:
   ```powershell
   git tag -a v1.2.0 -m "DoubleShift 1.2.0"
   git push origin v1.2.0
   ```
   Then on GitHub, open **Releases > Draft a new release**, choose the tag, describe what's new, and attach the zipped `dist\DoubleShift` folder if you want people to be able to download the app directly.
5. Upload `dist\DoubleShift-<version>.msix` in a new Partner Center submission.
