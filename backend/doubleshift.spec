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
)
coll = COLLECT(exe, a.binaries, a.datas, name="DoubleShift")
