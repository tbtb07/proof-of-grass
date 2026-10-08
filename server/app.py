import socket
import time

from flask import Flask, jsonify, render_template, request

from outdoor_check import ask_gemma, prepare_image_bytes, warm_up

app = Flask(__name__)


def get_local_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/check", methods=["POST"])
def check():
    t_start = time.perf_counter()

    photo = request.files.get("photo")
    if photo is None:
        return jsonify({"error": "No photo uploaded"}), 400
    raw_bytes = photo.read()

    t_received = time.perf_counter()
    print(f"[/check] receive upload: {t_received - t_start:.2f}s ({len(raw_bytes)} bytes)", flush=True)

    try:
        image_bytes = prepare_image_bytes(raw_bytes)
        t_prepared = time.perf_counter()
        print(f"[/check] convert/resize: {t_prepared - t_received:.2f}s", flush=True)

        result = ask_gemma(image_bytes)
        t_done = time.perf_counter()
        print(f"[/check] gemma call: {t_done - t_prepared:.2f}s", flush=True)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    print(f"[/check] total: {t_done - t_start:.2f}s", flush=True)
    return jsonify(result)


@app.route("/status")
def status():
    return jsonify({
        "unlocked": False,
        "until": None,
        "phone_url": f"http://{get_local_ip()}:5050",
    })


if __name__ == "__main__":
    print("Warming up Gemma...", flush=True)
    start = time.perf_counter()
    warm_up()
    print(f"Gemma loaded in {time.perf_counter() - start:.1f}s", flush=True)
    app.run(host="0.0.0.0", port=5050)
