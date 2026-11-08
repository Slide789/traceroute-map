"""Local Flask app: serves the map page and streams traces as Server-Sent Events."""

from __future__ import annotations

import json
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

from .geo import GeoLookup
from .service import trace_events

STATIC_DIR = Path(__file__).parent / "static"


def create_app(events_fn=trace_events) -> Flask:
    app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
    geo = GeoLookup()

    @app.get("/")
    def index():
        return send_from_directory(STATIC_DIR, "index.html")

    @app.get("/api/trace")
    def trace():
        target = request.args.get("target", "").strip()
        if not target:
            return jsonify({"error": "target is required"}), 400

        def stream():
            for event in events_fn(target, geo_lookup=geo.lookup):
                yield f"data: {json.dumps(event)}\n\n"

        return Response(
            stream(),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app
