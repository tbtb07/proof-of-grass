"""One-time setup: sets the emergency unlock password.

Run from the repo root:
    python3 server/set_password.py
"""

import getpass

from werkzeug.security import generate_password_hash

import store


def main():
    password = getpass.getpass("New emergency password: ")
    if not password:
        print("Password can't be empty. Nothing saved.")
        return

    confirm = getpass.getpass("Confirm password: ")
    if password != confirm:
        print("Passwords didn't match. Nothing saved.")
        return

    settings = store.load_settings()
    settings["password_hash"] = generate_password_hash(password)
    store.save_settings(settings)
    print("Emergency password saved.")


if __name__ == "__main__":
    main()
