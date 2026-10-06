import io
import json
from pathlib import Path

import ollama
from PIL import Image
import pillow_heif

pillow_heif.register_heif_opener()

MODEL = "gemma3:4b"
PHOTOS_DIR = Path(__file__).resolve().parent.parent / "test_photos"
PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}

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
    if photo_path.suffix.lower() != ".heic":
        return photo_path.read_bytes()

    image = Image.open(photo_path).convert("RGB")
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
        try:
            result = ask_outdoor(photo)
        except Exception as exc:
            print(f"{photo}: ERROR - {exc}")
            continue

        total += 1
        is_correct = result.get("outdoor") == expected
        if is_correct:
            correct += 1
        mark = "✅" if is_correct else "❌"
        print(f"{mark} {photo}: {result}")

    print(f"\n{correct}/{total} correct")


if __name__ == "__main__":
    main()
