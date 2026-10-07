"""Mock Proof of Grass server for testing the extension locally.

Stands in for the real Flask server (server/app.py) so the extension can be
tested without Flask. Standard library only.

Run from the repo root:
    python3 extension/mock_server.py
Stop with Ctrl+C.
"""

import json
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer

# ===================== SWITCH HERE =====================
# False = LOCKED   (extension blocks tracked sites over the limit)
# True  = UNLOCKED (extension allows tracked sites)
# Save the file and restart this server after changing it.
MOCK_UNLOCKED = False
# =======================================================

PORT = 5050


def status_body():
    return {
        "unlocked": MOCK_UNLOCKED,
        "until": "test" if MOCK_UNLOCKED else None,
        "phone_url": f"http://localhost:{PORT}",
    }


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] == "/status":
            body = status_body()
            self.send_json(200, body)
            state = "UNLOCKED" if body["unlocked"] else "LOCKED"
            self.log(f"GET /status -> 200 {state}")
        else:
            self.send_json(404, {"error": "not found"})
            self.log(f"GET {self.path} -> 404")

    def send_json(self, code, data):
        payload = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def log(self, message):
        print(f"[{datetime.now():%H:%M:%S}] {message}", flush=True)

    def log_message(self, format, *args):
        pass  # silence the default access log; we print our own lines


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    mode = "UNLOCKED" if MOCK_UNLOCKED else "LOCKED"
    print(f"Mock server on http://localhost:{PORT}  (mode: {mode})", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
