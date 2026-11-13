"""Writes THIRD_PARTY_NOTICES.txt: the licences of everything bundled in the desktop app.

Run it with the backend's virtual environment after installing requirements-desktop.txt
and running `npm install` in frontend (build-msix.ps1 does this on every build):

    backend\\venv\\Scripts\\python.exe packaging\\make_notices.py

It lists the Python packages the app needs at runtime (requirements.txt plus pywebview and
everything they depend on, not build tools like PyInstaller), Python itself, and the
JavaScript packages and font that end up in the frontend build.
"""
import json
import os
import re
import sys
from importlib import metadata

from packaging.markers import default_environment
from packaging.requirements import Requirement

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUTPUT = os.path.join(ROOT, "THIRD_PARTY_NOTICES.txt")

# Runtime requirements: requirements.txt plus the desktop window.
TOP_LEVEL = [
    line.split("#")[0].strip()
    for line in open(os.path.join(ROOT, "backend", "requirements.txt"), encoding="utf-8")
    if line.split("#")[0].strip()
] + ["pywebview"]

# JavaScript packages whose code or styles end up in frontend/out.
FRONTEND = ["next", "react", "react-dom", "scheduler", "@swc/helpers", "lucide-react", "tailwindcss", "geist"]

LICENSE_FILE = re.compile(r"(LICEN[CS]E|COPYING|NOTICE)", re.IGNORECASE)
RULE = "=" * 78


def python_packages():
    """Every installed distribution the top-level requirements need, with their extras."""
    found = {}
    queue = [Requirement(r) for r in TOP_LEVEL]
    while queue:
        req = queue.pop()
        try:
            dist = metadata.distribution(req.name)
        except metadata.PackageNotFoundError:
            continue  # only needed on other platforms
        name = dist.metadata["Name"]
        if name.lower() in found:
            continue
        found[name.lower()] = dist
        for dep in dist.requires or []:
            dep = Requirement(dep)
            if dep.marker is None or any(
                dep.marker.evaluate({**default_environment(), "extra": extra})
                for extra in (req.extras or {""})
            ):
                queue.append(dep)
    return sorted(found.values(), key=lambda d: d.metadata["Name"].lower())


def python_license_texts(dist):
    texts = []
    for file in dist.files or []:
        if LICENSE_FILE.search(os.path.basename(str(file))) and not str(file).endswith(".py"):
            try:
                texts.append(file.read_text(encoding="utf-8").strip())
            except (OSError, UnicodeDecodeError):
                pass
    return texts


def section(title, licence, texts):
    body = "\n\n".join(texts) if texts else f"Licensed under: {licence or 'see the package'}"
    return f"{RULE}\n{title}\nLicence: {licence or 'see below'}\n{RULE}\n\n{body}\n\n"


def main():
    out = [
        "DoubleShift: Training Scheduler\n"
        "Third party notices\n\n"
        "DoubleShift is licensed under the GNU Affero General Public License v3.0 only\n"
        "(see LICENSE). It includes the following software, each under its own licence.\n\n"
    ]

    python_licence = os.path.join(sys.base_prefix, "LICENSE.txt")
    out.append(section(
        f"Python {sys.version.split()[0]}",
        "PSF-2.0 (and the licences of the components Python includes, listed below)",
        [open(python_licence, encoding="utf-8").read().strip()] if os.path.exists(python_licence) else [],
    ))

    for dist in python_packages():
        meta = dist.metadata
        licence = meta.get("License-Expression") or meta.get("License")
        if licence and len(licence) > 80:  # some packages put the whole text here
            licence = None
        out.append(section(f"{meta['Name']} {dist.version} (Python)", licence, python_license_texts(dist)))

    for name in FRONTEND:
        folder = os.path.join(ROOT, "frontend", "node_modules", *name.split("/"))
        with open(os.path.join(folder, "package.json"), encoding="utf-8") as f:
            pkg = json.load(f)
        texts = [
            open(os.path.join(folder, f), encoding="utf-8").read().strip()
            for f in sorted(os.listdir(folder))
            if LICENSE_FILE.search(f) and os.path.isfile(os.path.join(folder, f))
        ]
        title = f"{name} {pkg['version']} (JavaScript)"
        if name == "geist":
            title += ", including the Geist font"
        out.append(section(title, pkg.get("license"), texts))

    out.append(
        f"{RULE}\nPyInstaller bootloader\n{RULE}\n\n"
        "DoubleShift.exe starts through the PyInstaller bootloader, licensed under the GPL 2.0\n"
        "or later with the PyInstaller exception, which allows it in programs under any licence.\n"
        "See https://pyinstaller.org/en/stable/license.html\n"
    )

    with open(OUTPUT, "w", encoding="utf-8", newline="\r\n") as f:
        f.write("".join(out))
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
