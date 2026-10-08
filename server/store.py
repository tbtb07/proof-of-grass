import json
from datetime import datetime
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
SETTINGS_PATH = DATA_DIR / "settings.json"
SETTINGS_EXAMPLE_PATH = DATA_DIR / "settings.example.json"
STATE_PATH = DATA_DIR / "state.json"

DEFAULT_SETTINGS = {
    "break_minutes": 20,
    "unlock_minutes": 60,
    "emergency_minutes": 15,
    "emergency_uses_per_day": 2,
    "password_hash": None,
    "pending_break_minutes": None,
    "pending_from": None,
}

DEFAULT_STATE = {
    "break_started_at": None,
    "break_minutes_at_start": None,
    "unlocked_until": None,
    "emergency_date": None,
    "emergency_used_today": 0,
}


def _read_json(path: Path, default: dict) -> dict:
    if not path.exists():
        _write_json(path, default)
        return dict(default)
    with path.open() as f:
        data = json.load(f)
    return {**default, **data}


def _write_json(path: Path, data: dict):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        json.dump(data, f, indent=2)


def _settings_defaults() -> dict:
    """What to write to settings.json the first time it's needed. Prefers
    settings.example.json (tracked in git) over the hardcoded defaults, so
    a fresh clone starts from the same template everyone commits to."""
    if SETTINGS_EXAMPLE_PATH.exists():
        with SETTINGS_EXAMPLE_PATH.open() as f:
            example = json.load(f)
        return {**DEFAULT_SETTINGS, **example}
    return dict(DEFAULT_SETTINGS)


def load_settings() -> dict:
    return _read_json(SETTINGS_PATH, _settings_defaults())


def resolve_settings() -> dict:
    """Loads settings and, if a pending break_minutes change's effective
    date has arrived, promotes it to the real value and clears the
    pending fields. Call this instead of load_settings() anywhere a
    route needs the current settings."""
    settings = load_settings()
    pending = settings.get("pending_break_minutes")
    pending_from = settings.get("pending_from")
    if pending is not None and pending_from is not None and date_key(now()) >= pending_from:
        settings["break_minutes"] = pending
        settings["pending_break_minutes"] = None
        settings["pending_from"] = None
        save_settings(settings)
    return settings


def load_state() -> dict:
    return _read_json(STATE_PATH, DEFAULT_STATE)


def save_state(state: dict):
    _write_json(STATE_PATH, state)


def save_settings(settings: dict):
    _write_json(SETTINGS_PATH, settings)


def now() -> datetime:
    """The server's own clock. Never derive timing from a photo's EXIF
    timestamp - a phone's clock or EXIF data can't be trusted."""
    return datetime.now()


def to_iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def from_iso(s: str) -> datetime:
    return datetime.fromisoformat(s)


def date_key(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d")
