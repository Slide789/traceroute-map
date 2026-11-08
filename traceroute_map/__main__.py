"""Start the local server and open the map in the default browser."""

from __future__ import annotations

import socket
import threading
import webbrowser

from .server import create_app

HOST = "127.0.0.1"
DEFAULT_PORT = 8765
LAST_PORT = 8775


def find_free_port() -> int:
    for port in range(DEFAULT_PORT, LAST_PORT + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((HOST, port))
                return port
            except OSError:
                continue
    raise SystemExit(f"No free port between {DEFAULT_PORT} and {LAST_PORT}")


def main() -> None:
    port = find_free_port()
    url = f"http://{HOST}:{port}"
    print(f"Traceroute Map running at {url}  (Ctrl+C to stop)")
    threading.Timer(1.0, webbrowser.open, args=(url,)).start()
    create_app().run(host=HOST, port=port, threaded=True)


if __name__ == "__main__":
    main()
