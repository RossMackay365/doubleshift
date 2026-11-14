import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone

from platformdirs import user_data_dir, user_documents_dir

# Each schedule is one .doubleshift file (JSON) in Documents\DoubleShift, so users can
# see, back up and share them, and they survive uninstalling the app. The file name is
# the schedule name. AppData only holds housekeeping (the recently opened list), which
# is fine to lose on uninstall.
#
# DOUBLESHIFT_SCHEDULES_DIR and DOUBLESHIFT_DATA_DIR override the folders (Docker uses these).
SCHEDULES_DIR = os.getenv("DOUBLESHIFT_SCHEDULES_DIR") or os.path.join(user_documents_dir(), "DoubleShift")
DATA_DIR = os.getenv("DOUBLESHIFT_DATA_DIR") or user_data_dir("DoubleShift", appauthor=False)
RECENT_PATH = os.path.join(DATA_DIR, "recent.json")

EXTENSION = ".doubleshift"
# Bump when the file format changes, and keep reading older versions.
FILE_VERSION = 1
CONTENT_FIELDS = ("data", "settings", "last_run")
RECENT_COUNT = 3  # what fits on the home page without scrolling
INVALID_NAME_CHARS = '\\/:*?"<>|'


def init():
    os.makedirs(SCHEDULES_DIR, exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)
    _add_examples()


# The example schedules (backend/examples) are copied into the schedules folder the first
# time the app runs, and listed under Recently Opened, so a new user has something to open
# straight away. An install can't write to Documents, so the app does it. A file the user
# already has is never replaced. The marker lives in AppData, so a reinstall adds any
# deleted examples back.
EXAMPLES_DIR = (
    os.path.join(sys._MEIPASS, "examples") if getattr(sys, "frozen", False)
    else os.path.join(os.path.dirname(__file__), "..", "examples")
)
# Listed in this order, top first.
EXAMPLES = ("Simple Example", "Complex Example")
EXAMPLES_MARKER = os.path.join(DATA_DIR, "examples-added")


def _add_examples():
    if os.path.exists(EXAMPLES_MARKER):
        return
    for name in reversed(EXAMPLES):  # the recent list puts the last one added on top
        source = os.path.join(EXAMPLES_DIR, name + EXTENSION)
        path = os.path.join(SCHEDULES_DIR, name + EXTENSION)
        if not os.path.isfile(source):
            continue
        if not os.path.exists(path):
            shutil.copyfile(source, path)
        _add_recent(path)
    open(EXAMPLES_MARKER, "w").close()


def _summary(path):
    return {
        "path": path,
        "name": os.path.basename(path)[: -len(EXTENSION)],
        "modified_at": datetime.fromtimestamp(os.path.getmtime(path), timezone.utc).isoformat(),
    }


def _check_path(path):
    if not path.lower().endswith(EXTENSION):
        raise ValueError("This file is not a DoubleShift schedule.")


def _write(path, contents):
    # Write to a temporary file first, then swap it in, so a crash mid-save never
    # leaves a half-written schedule.
    file = {"version": FILE_VERSION, **{field: contents.get(field) for field in CONTENT_FIELDS}}
    fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(file, f, indent=2)
    os.replace(tmp_path, path)


def validate_contents(file):
    """Check a parsed .doubleshift file and return just its contents. Raises ValueError."""
    if not isinstance(file, dict) or not isinstance(file.get("version"), int):
        raise ValueError("This file is not a DoubleShift schedule.")
    if file["version"] > FILE_VERSION:
        raise ValueError("This schedule was made with a newer version of DoubleShift. Please update the app to open it.")
    return {field: file.get(field) for field in CONTENT_FIELDS}


def list_schedules():
    """Schedules in the schedules folder, most recently modified first."""
    paths = [
        os.path.join(SCHEDULES_DIR, f) for f in os.listdir(SCHEDULES_DIR) if f.lower().endswith(EXTENSION)
    ]
    return sorted((_summary(p) for p in paths), key=lambda s: s["modified_at"], reverse=True)


def create_schedule(name, contents=None, rename_if_taken=False):
    """Create <name>.doubleshift in the schedules folder and return its summary.

    If the name is taken, either raise FileExistsError or (for imports) pick "name (2)" etc.
    """
    name = name.strip()
    if not name:
        raise ValueError("Please give your schedule a name.")
    if any(c in INVALID_NAME_CHARS for c in name):
        raise ValueError(f"A schedule name can't contain these characters: {' '.join(INVALID_NAME_CHARS)}")

    path = os.path.join(SCHEDULES_DIR, name + EXTENSION)
    copy = 2
    while os.path.exists(path):
        if not rename_if_taken:
            raise FileExistsError(f'You already have a schedule named "{name}". Please choose another name.')
        path = os.path.join(SCHEDULES_DIR, f"{name} ({copy}){EXTENSION}")
        copy += 1

    _write(path, contents or {})
    return _summary(path)


def read_schedule(path):
    """Return the schedule's summary and contents, or None if the file doesn't exist.
    Also records it as recently opened. Raises ValueError for a file that isn't a valid schedule."""
    _check_path(path)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            file = json.load(f)
    except json.JSONDecodeError:
        raise ValueError("This file is not a DoubleShift schedule.")
    contents = validate_contents(file)
    _add_recent(path)
    return {**_summary(path), **contents}


def save_schedule(path, contents):
    _check_path(path)
    _write(path, contents)


def delete_schedule(path):
    """Delete a schedule's file and take it off the recent list. On Windows the file goes to
    the Recycle Bin, so it can be restored; elsewhere (Docker) there's no Recycle Bin, so it's
    deleted for good. Raises FileNotFoundError if it's already gone, OSError if it can't be
    deleted (for example while another program has it open)."""
    _check_path(path)
    if not os.path.isfile(path):
        raise FileNotFoundError(path)
    if sys.platform == "win32":
        from send2trash import send2trash

        send2trash(os.path.abspath(path))  # it needs a clean Windows path (backslashes)
    else:
        os.remove(path)
    _remove_recent(path)


# --- Recently opened ---

def _load_recent():
    try:
        with open(RECENT_PATH, encoding="utf-8") as f:
            return [p for p in json.load(f) if isinstance(p, str)]
    except (OSError, ValueError):
        return []


def _add_recent(path):
    path = os.path.abspath(path)
    key = os.path.normcase(path)
    recent = [path] + [p for p in _load_recent() if os.path.normcase(p) != key]
    with open(RECENT_PATH, "w", encoding="utf-8") as f:
        json.dump(recent[:RECENT_COUNT], f, indent=2)


def _remove_recent(path):
    key = os.path.normcase(os.path.abspath(path))
    recent = [p for p in _load_recent() if os.path.normcase(p) != key]
    with open(RECENT_PATH, "w", encoding="utf-8") as f:
        json.dump(recent, f, indent=2)


def recent_schedules():
    """Recently opened schedules, skipping any that have since been moved or deleted."""
    return [_summary(p) for p in _load_recent() if os.path.isfile(p)]
