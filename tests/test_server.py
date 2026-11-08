import pytest

from traceroute_map.server import create_app


def fake_events(target, geo_lookup=None):
    assert callable(geo_lookup)
    yield {"type": "start", "target": target, "ip": "1.1.1.1"}
    yield {"type": "hop", "target": target, "hop": {"index": 1}}
    yield {"type": "done", "target": target, "reached": True}


@pytest.fixture
def client():
    return create_app(events_fn=fake_events).test_client()


def test_index_served(client):
    r = client.get("/")
    assert r.status_code == 200
    assert b"<html" in r.data


def test_missing_target_400(client):
    r = client.get("/api/trace")
    assert r.status_code == 400
    assert r.get_json() == {"error": "target is required"}


def test_sse_stream(client):
    r = client.get("/api/trace?target=google.com")
    assert r.mimetype == "text/event-stream"
    assert r.headers["Cache-Control"] == "no-cache"
    body = r.get_data(as_text=True)
    assert body.count("data: ") == 3
    assert '"type": "done"' in body


def test_foreign_host_header_rejected(client):
    assert client.get("/api/trace?target=x", headers={"Host": "evil.example"}).status_code == 403
    assert client.get("/", headers={"Host": "evil.example:8765"}).status_code == 403


def test_cross_site_request_rejected(client):
    r = client.get("/api/trace?target=x", headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403


def test_localhost_with_port_allowed(client):
    assert client.get("/", headers={"Host": "127.0.0.1:8765"}).status_code == 200
