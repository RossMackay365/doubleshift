# Packaging

DoubleShift ships in two forms: a Docker image and a Windows app. Both are the same thing inside: the backend serving the frontend's static build. This page describes how each one is put together. For what the app does, see the [root README](../README.md).

## Docker

The [Dockerfile](../Dockerfile) builds one image in two stages. A Node stage builds the frontend into a static site. A Python stage installs the backend and copies that site in, and Uvicorn serves both on port 8000.

```bash
docker compose up
```

[docker-compose.yml](../docker-compose.yml) runs the image with:

- **Schedules** in `./schedules` on your computer, so you can see, back up and share the files.
- **A volume** for housekeeping: the recently opened list.
- **A memory limit** of 1.5 GB, so a very large schedule can't take down the host. Raise `mem_limit` and `memswap_limit` if the scheduler needs more.

## Windows App

The Windows app is built in two steps.

1. **The app.** [PyInstaller](https://pyinstaller.org/) bundles `backend/desktop.py`, Python, the solver, the frontend build and the example schedules into `dist\DoubleShift\DoubleShift.exe` (`backend/doubleshift.spec`). The app runs the backend on this computer only and shows it in its own window, using Windows' built-in WebView2.
2. **The package.** The app folder, the logos and the manifest are packed into an MSIX, the format the Microsoft Store uses. The Store signs the package when it is published.

The MSIX adds what a plain exe can't: a Start menu entry, clean install and uninstall, updates through the Store, and opening `.doubleshift` files by double-click.

### What Is in This Folder

| File | What it is |
|---|---|
| `AppxManifest.xml` | The package description: identity, name, logos and the `.doubleshift` file association |
| `Assets/` | The logos inside the package, in the sizes Windows asks for |
| `DoubleShift.ico` | The icon of the exe and its window |
| `Store/` | Artwork for the Store listing. Not packaged |
| `make_notices.py` | Writes `THIRD_PARTY_NOTICES.txt` at the repo root |
| `../build-msix.ps1` | Builds the app and the package |

### Building It Yourself

You need Node.js, Python 3.12 and the [Windows SDK](https://developer.microsoft.com/windows/downloads/windows-sdk/). Set up the Python environment once:

```powershell
cd backend
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements-desktop.txt
```

Then, from the repo root:

```powershell
.\build-msix.ps1
```

This builds the frontend, writes the third party notices, builds the app in `dist\DoubleShift`, and packs `dist\DoubleShift-<version>.msix`. You can run `dist\DoubleShift\DoubleShift.exe` straight away.

The MSIX itself is unsigned, so Windows won't install it as it is. The identity in `AppxManifest.xml` belongs to the official Store listing. To install or publish your own build as an MSIX, change `Name` and `Publisher` in the manifest to your own, and sign the package with a certificate for that publisher (`.\build-msix.ps1 -CertPath <your .pfx>`).

### Version

The version comes from `version` in `frontend/package.json`. The build writes it into the manifest with a fourth part added, so `1.2.0` becomes `1.2.0.0`. The guide's About section shows the same version.

## Where Your Data Lives

| | Windows app | Docker |
|---|---|---|
| Schedules (`.doubleshift` files) | `Documents\DoubleShift` | `./schedules` |
| Recently opened list | The app's data folder | The `doubleshift-data` volume |
| Log | `doubleshift.log` in the app's data folder | `docker compose logs` |

Uninstalling the Windows app removes its data folder but keeps your schedules in Documents.

## Licence Files

DoubleShift is under the AGPL, and it bundles other open source software. Every build carries both licences with it. The Windows app includes `LICENSE` and `THIRD_PARTY_NOTICES.txt`. `make_notices.py` writes the notices on every build from the Python and JavaScript packages that end up in the app, so the list never goes out of date.
