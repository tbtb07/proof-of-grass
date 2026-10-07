import io
import json

import ollama
from PIL import Image
import pillow_heif

pillow_heif.register_heif_opener()

MODEL = "gemma3:4b"
TARGET_WIDTH = 1024

PROMPT = (
    "Look at this photo and decide if it was taken outdoors. "
    'Reply with ONLY JSON in this exact format: {"outdoor": true, "reason": "..."} '
    "or {\"outdoor\": false, \"reason\": \"...\"}. No other text."
)


def prepare_image_bytes(raw_bytes: bytes) -> bytes:
    image = Image.open(io.BytesIO(raw_bytes)).convert("RGB")

    if image.width > TARGET_WIDTH:
        ratio = TARGET_WIDTH / image.width
        new_size = (TARGET_WIDTH, round(image.height * ratio))
        image = image.resize(new_size, Image.LANCZOS)

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


def check_outdoor(raw_bytes: bytes) -> dict:
    image_bytes = prepare_image_bytes(raw_bytes)
    response = ollama.chat(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": PROMPT,
                "images": [image_bytes],
            }
        ],
        format="json",
    )
    content = response["message"]["content"]
    return json.loads(content)
