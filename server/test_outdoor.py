import time
from pathlib import Path

from outdoor_check import check_outdoor

PHOTOS_DIR = Path(__file__).resolve().parent.parent / "test_photos"
PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}


def find_photos(root: Path):
    return sorted(
        path for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in PHOTO_EXTENSIONS
    )


def expected_outdoor(photo_path: Path) -> bool:
    return photo_path.parent.name == "outdoor"


def main():
    photos = find_photos(PHOTOS_DIR)
    if not photos:
        print(f"No photos found in {PHOTOS_DIR}")
        return

    correct = 0
    total = 0
    for photo in photos:
        expected = expected_outdoor(photo)
        start = time.perf_counter()
        try:
            result = check_outdoor(photo.read_bytes())
        except Exception as exc:
            elapsed = time.perf_counter() - start
            print(f"{photo}: ERROR - {exc} ({elapsed:.1f}s)")
            continue
        elapsed = time.perf_counter() - start

        total += 1
        is_correct = result.get("outdoor") == expected
        if is_correct:
            correct += 1
        mark = "✅" if is_correct else "❌"
        print(f"{mark} {photo}: {result} ({elapsed:.1f}s)")

    print(f"\n{correct}/{total} correct")


if __name__ == "__main__":
    main()
