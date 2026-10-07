import io
import json
import time
from pathlib import Path

import ollama
from PIL import Image
import pillow_heif

pillow_heif.register_heif_opener()

MODEL = "gemma3:4b"
PHOTOS_DIR = Path(__file__).resolve().parent.parent / "test_photos"
PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
TARGET_WIDTH = 1024

PROMPT = (
    "Look at this photo and decide if it was taken outdoors. "
    'Reply with ONLY JSON in this exact format: {"outdoor": true, "reason": "..."} '
    "or {\"outdoor\": false, \"reason\": \"...\"}. No other text."
)


def find_photos(root: Path):
    return sorted(
        path for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in PHOTO_EXTENSIONS
    )


def load_image_bytes(photo_path: Path) -> bytes:
    image = Image.open(photo_path).convert("RGB")

    if image.width > TARGET_WIDTH:
        ratio = TARGET_WIDTH / image.width
        new_size = (TARGET_WIDTH, round(image.height * ratio))
        image = image.resize(new_size, Image.LANCZOS)

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


def ask_outdoor(photo_path: Path) -> dict:
    response = ollama.chat(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": PROMPT,
                "images": [load_image_bytes(photo_path)],
            }
        ],
        format="json",
    )
    content = response["message"]["content"]
    return json.loads(content)


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
            result = ask_outdoor(photo)
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
