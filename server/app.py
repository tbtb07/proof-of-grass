import socket

from flask import Flask, jsonify

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
    return "Proof of Grass"


@app.route("/status")
def status():
    return jsonify({
        "unlocked": False,
        "until": None,
        "phone_url": f"http://{get_local_ip()}:5050",
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050)
