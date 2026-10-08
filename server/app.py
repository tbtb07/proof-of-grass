import socket
import time
from datetime import timedelta

from flask import Flask, jsonify, render_template, request
from werkzeug.security import check_password_hash

import store
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


@app.route("/break/start", methods=["POST"])
def break_start():
    photo = request.files.get("photo")
    if photo is None:
        return jsonify({"error": "No photo uploaded"}), 400

    try:
        result = ask_gemma(prepare_image_bytes(photo.read()))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    if not result.get("outdoor"):
        return jsonify({"outdoor": False, "reason": result.get("reason"), "can_end_at": None})

    settings = store.resolve_settings()
    state = store.load_state()

    started_at = store.now()
    break_minutes = settings["break_minutes"]
    state["break_started_at"] = store.to_iso(started_at)
    state["break_minutes_at_start"] = break_minutes
    store.save_state(state)

    can_end_at = started_at + timedelta(minutes=break_minutes)
    return jsonify({
        "outdoor": True,
        "reason": result.get("reason"),
        "can_end_at": store.to_iso(can_end_at),
    })


@app.route("/break/end", methods=["POST"])
def break_end():
    state = store.load_state()
    started_at_str = state.get("break_started_at")
    if not started_at_str:
        return jsonify({"error": "No outdoor break in progress"}), 400

    break_minutes = state.get("break_minutes_at_start")
    started_at = store.from_iso(started_at_str)
    can_end_at = started_at + timedelta(minutes=break_minutes)
    now = store.now()

    if now < can_end_at:
        minutes_left = (can_end_at - now).total_seconds() / 60
        return jsonify({
            "error": "Too early to finish the outdoor break",
            "minutes_left": round(minutes_left, 1),
        }), 400

    photo = request.files.get("photo")
    if photo is None:
        return jsonify({"error": "No photo uploaded"}), 400

    try:
        result = ask_gemma(prepare_image_bytes(photo.read()))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    if not result.get("outdoor"):
        return jsonify({"outdoor": False, "reason": result.get("reason")})

    settings = store.resolve_settings()
    unlocked_until = now + timedelta(minutes=settings["unlock_minutes"])
    state["break_started_at"] = None
    state["break_minutes_at_start"] = None
    state["unlocked_until"] = store.to_iso(unlocked_until)
    store.save_state(state)

    return jsonify({
        "outdoor": True,
        "reason": result.get("reason"),
        "unlocked_until": store.to_iso(unlocked_until),
    })


@app.route("/break/status")
def break_status():
    state = store.load_state()
    started_at_str = state.get("break_started_at")
    if not started_at_str:
        return jsonify({"in_progress": False, "started_at": None, "can_end_at": None})

    break_minutes = state.get("break_minutes_at_start")
    started_at = store.from_iso(started_at_str)
    can_end_at = started_at + timedelta(minutes=break_minutes)
    return jsonify({
        "in_progress": True,
        "started_at": started_at_str,
        "can_end_at": store.to_iso(can_end_at),
    })


@app.route("/settings", methods=["GET"])
def get_settings():
    settings = store.resolve_settings()
    return jsonify({
        "break_minutes": settings["break_minutes"],
        "pending_break_minutes": settings.get("pending_break_minutes"),
        "pending_from": settings.get("pending_from"),
    })


@app.route("/settings", methods=["POST"])
def post_settings():
    data = request.get_json(silent=True) or {}
    value = data.get("break_minutes")

    if not isinstance(value, int) or isinstance(value, bool) or not (5 <= value <= 180):
        return jsonify({"error": "break_minutes must be a whole number between 5 and 180"}), 400

    settings = store.resolve_settings()
    tomorrow = store.now() + timedelta(days=1)
    settings["pending_break_minutes"] = value
    settings["pending_from"] = store.date_key(tomorrow)
    store.save_settings(settings)

    return jsonify({
        "break_minutes": settings["break_minutes"],
        "pending_break_minutes": settings["pending_break_minutes"],
        "pending_from": settings["pending_from"],
    })


@app.route("/emergency", methods=["POST"])
def emergency():
    data = request.get_json(silent=True) or {}
    password = data.get("password")
    if not password:
        return jsonify({"error": "Missing password"}), 400

    settings = store.resolve_settings()
    state = store.load_state()

    now = store.now()
    today = store.date_key(now)
    if state.get("emergency_date") != today:
        state["emergency_date"] = today
        state["emergency_used_today"] = 0

    used = state["emergency_used_today"]
    limit = settings["emergency_uses_per_day"]
    remaining = max(limit - used, 0)

    if remaining <= 0:
        store.save_state(state)
        return jsonify({
            "ok": False,
            "error": "No emergency unlocks left today",
            "remaining_today": 0,
        })

    password_hash = settings.get("password_hash")
    if not password_hash or not check_password_hash(password_hash, password):
        store.save_state(state)  # keep any date-rollover reset even on a wrong guess
        return jsonify({
            "ok": False,
            "error": "Wrong password",
            "remaining_today": remaining,
        })

    state["emergency_used_today"] = used + 1
    unlocked_until = now + timedelta(minutes=settings["emergency_minutes"])
    state["unlocked_until"] = store.to_iso(unlocked_until)
    store.save_state(state)

    return jsonify({
        "ok": True,
        "until": store.to_iso(unlocked_until),
        "remaining_today": limit - state["emergency_used_today"],
    })


@app.route("/status")
def status():
    state = store.load_state()
    unlocked_until_str = state.get("unlocked_until")
    unlocked = False
    until = None

    if unlocked_until_str:
        unlocked_until = store.from_iso(unlocked_until_str)
        if store.now() < unlocked_until:
            unlocked = True
            until = unlocked_until_str
        else:
            # Unlock window passed: clear it so state.json doesn't stay stale.
            state["unlocked_until"] = None
            store.save_state(state)

    return jsonify({
        "unlocked": unlocked,
        "until": until,
        "phone_url": f"http://{get_local_ip()}:5050",
    })


if __name__ == "__main__":
    print("Warming up Gemma...", flush=True)
    start = time.perf_counter()
    warm_up()
    print(f"Gemma loaded in {time.perf_counter() - start:.1f}s", flush=True)
    app.run(host="0.0.0.0", port=5050)
