import io
import json

import ollama
from PIL import Image
import pillow_heif

pillow_heif.register_heif_opener()

MODEL = "gemma3:4b"
TARGET_WIDTH = 1024

# Tell Ollama to keep the model loaded in memory indefinitely instead of
# unloading it after its default 5-minute idle timeout.
KEEP_ALIVE = -1

PROMPT = (
    "Look at this photo and decide if it was taken outdoors. "
    'Reply with ONLY JSON in this exact format: {"outdoor": true, "reason": "..."} '
    "or {\"outdoor\": false, \"reason\": \"...\"}. "
    "Keep the reason to one short sentence (max 15 words). No other text."
)

# Caps how many tokens Gemma generates. The reply is short JSON plus one
# short sentence, so this is just a safety limit to stop long-winded replies.
MAX_OUTPUT_TOKENS = 60


def prepare_image_bytes(raw_bytes: bytes) -> bytes:
    image = Image.open(io.BytesIO(raw_bytes)).convert("RGB")

    if image.width > TARGET_WIDTH:
        ratio = TARGET_WIDTH / image.width
        new_size = (TARGET_WIDTH, round(image.height * ratio))
        image = image.resize(new_size, Image.LANCZOS)

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


def ask_gemma(image_bytes: bytes) -> dict:
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
        keep_alive=KEEP_ALIVE,
        options={"num_predict": MAX_OUTPUT_TOKENS},
    )
    content = response["message"]["content"]
    return json.loads(content)


def check_outdoor(raw_bytes: bytes) -> dict:
    image_bytes = prepare_image_bytes(raw_bytes)
    return ask_gemma(image_bytes)


def warm_up():
    """Send a tiny throwaway request so the model is loaded into memory
    before the first real photo comes in, instead of the first user
    request paying that cost."""
    blank = Image.new("RGB", (64, 64), color="white")
    buffer = io.BytesIO()
    blank.save(buffer, format="JPEG")
    ollama.chat(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": "Reply with OK.",
                "images": [buffer.getvalue()],
            }
        ],
        keep_alive=KEEP_ALIVE,
    )
