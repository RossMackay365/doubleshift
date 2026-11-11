import json
import os
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
RECENT_COUNT = 5
INVALID_NAME_CHARS = '\\/:*?"<>|'


def init():
    os.makedirs(SCHEDULES_DIR, exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)


def _summary(path):
    return {
        "path": path,
        "name": os.path.basename(path)[: -len(EXTENSION)],
        "modified_at": datetime.fromtimestamp(os.path.getmtime(path), timezone.utc).isoformat(),
    }


def _check_path(path):
    if not path.lower().endswith(EXTENSION):
        raise ValueError(f"Not a {EXTENSION} file")


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
        raise ValueError("Schedule name is required.")
    if any(c in INVALID_NAME_CHARS for c in name):
        raise ValueError(f"Schedule name can't contain any of {INVALID_NAME_CHARS}")

    path = os.path.join(SCHEDULES_DIR, name + EXTENSION)
    copy = 2
    while os.path.exists(path):
        if not rename_if_taken:
            raise FileExistsError(f'A schedule named "{name}" already exists.')
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


def recent_schedules():
    """Recently opened schedules, skipping any that have since been moved or deleted."""
    return [_summary(p) for p in _load_recent() if os.path.isfile(p)]
