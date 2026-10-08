import json
from datetime import datetime
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
SETTINGS_PATH = DATA_DIR / "settings.json"
STATE_PATH = DATA_DIR / "state.json"

DEFAULT_SETTINGS = {
    "break_minutes": 20,
    "unlock_minutes": 60,
}

DEFAULT_STATE = {
    "break_started_at": None,
    "unlocked_until": None,
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


def load_settings() -> dict:
    return _read_json(SETTINGS_PATH, DEFAULT_SETTINGS)


def load_state() -> dict:
    return _read_json(STATE_PATH, DEFAULT_STATE)


def save_state(state: dict):
    _write_json(STATE_PATH, state)


def now() -> datetime:
    """The server's own clock. Never derive timing from a photo's EXIF
    timestamp - a phone's clock or EXIF data can't be trusted."""
    return datetime.now()


def to_iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def from_iso(s: str) -> datetime:
    return datetime.fromisoformat(s)
