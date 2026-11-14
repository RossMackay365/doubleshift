# PyInstaller build for the DoubleShift desktop app.
#
# Build the frontend first (cd frontend, npm run build), then from this folder:
#   pyinstaller doubleshift.spec
# The app is in dist/DoubleShift (DoubleShift.exe plus its files).

import os
from PyInstaller.utils.hooks import collect_all, collect_submodules

ROOT = os.path.join(SPECPATH, "..")
FRONTEND = os.path.join(ROOT, "frontend", "out")
ICON = os.path.join(ROOT, "packaging", "DoubleShift.ico")

if not os.path.isdir(FRONTEND):
    raise SystemExit("frontend/out is missing. Run `npm run build` in the frontend folder first.")

# OR-Tools loads native libraries that PyInstaller can't find by following imports, and
# uvicorn picks its parts by name at runtime.
datas, binaries, hiddenimports = collect_all("ortools")
hiddenimports += collect_submodules("uvicorn")
datas += [
    (FRONTEND, "frontend"),
    (os.path.join(SPECPATH, "examples"), "examples"),  # copied to Documents on first run
    (os.path.join(ROOT, "LICENSE"), "."),
]

# PyInstaller's default manifest, plus per-monitor DPI awareness: the app renders sharply on
# every screen, whatever its scaling, and the Windows App Cert Kit sees the app as DPI aware.
# This takes priority over the SetProcessDPIAware() call pywebview makes at startup.
MANIFEST = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"></requestedExecutionLevel>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"></supportedOS>
    </application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
    </windowsSettings>
  </application>
</assembly>
"""

a = Analysis(
    ["desktop.py"],
    pathex=[SPECPATH],
    datas=datas,
    binaries=binaries,
    hiddenimports=hiddenimports,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="DoubleShift",
    console=False,
    icon=ICON if os.path.exists(ICON) else None,
    manifest=MANIFEST,
)
coll = COLLECT(exe, a.binaries, a.datas, name="DoubleShift")
