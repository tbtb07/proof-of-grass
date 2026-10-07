import socket

from flask import Flask, jsonify, render_template, request

from outdoor_check import check_outdoor

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
    photo = request.files.get("photo")
    if photo is None:
        return jsonify({"error": "No photo uploaded"}), 400

    try:
        result = check_outdoor(photo.read())
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    return jsonify(result)


@app.route("/status")
def status():
    return jsonify({
        "unlocked": False,
        "until": None,
        "phone_url": f"http://{get_local_ip()}:5050",
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050)
