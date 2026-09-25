import time

import pytest
from fastapi.testclient import TestClient

from captionlive.main import create_app
from captionlive.mt.mock import MockTranslator

from .conftest import chunks, tone

AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture
def client(settings):
    app = create_app(settings, translator=MockTranslator())
    with TestClient(app) as c:
        yield c


def create(client, **kw):
    body = {
        "id": "main",
        "title": "Keynote",
        "source_lang": "en",
        "target_langs": ["es", "pt"],
        "glossary": ["Kubernetes"],
        **kw,
    }
    r = client.post("/api/admin/sessions", json=body, headers=AUTH)
    assert r.status_code == 200, r.text
    return r.json()


def stream_audio(client, sid, key, seconds=6.0, rate=16000):
    with client.websocket_connect(f"/ws/ingest/{sid}?key={key}&rate={rate}") as ws:
        assert ws.receive_json()["type"] == "ready"
        for c in chunks(tone(seconds, rate=rate), rate=rate):
            ws.send_bytes(c)


def wait_history(client, sid, lang, n=1, timeout=5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        items = client.get(f"/api/sessions/{sid}/history", params={"lang": lang}).json()
        if len(items) >= n:
            return items
        time.sleep(0.05)
    raise AssertionError(f"no history for {lang}")


def test_pages_and_health(client):
    for path in [
        "/",
        "/stage",
        "/admin",
        "/overlay",
        "/static/js/common.js",
        "/static/css/app.css",
    ]:
        assert client.get(path).status_code == 200, path
    h = client.get("/api/health").json()
    assert h["ok"] and h["asr"] == "mock"
    assert "es" in client.get("/api/config").json()["languages"]
    assert client.get("/metrics").status_code == 200


def test_admin_requires_token(client):
    assert client.get("/api/admin/sessions").status_code == 401
    assert (
        client.get("/api/admin/sessions", headers={"Authorization": "Bearer nope"}).status_code
        == 401
    )
    assert client.get("/api/admin/sessions?token=test-token").status_code == 200


def test_session_crud_and_validation(client):
    s = create(client)
    assert len(s["ingest_key"]) > 10
    public = client.get("/api/sessions/main").json()
    assert "ingest_key" not in public
    assert [l["code"] for l in public["languages"]] == ["source", "es", "pt"]
    assert public["status"]["live"] is False
    # update keeps the key
    s2 = create(client, title="Nuevo")
    assert s2["ingest_key"] == s["ingest_key"] and s2["title"] == "Nuevo"
    # rotate key
    s3 = client.post("/api/admin/sessions/main/rotate-key", headers=AUTH).json()
    assert s3["ingest_key"] != s["ingest_key"]
    # validation
    bad = client.post("/api/admin/sessions", json={"id": "Bad Id!"}, headers=AUTH)
    assert bad.status_code == 422
    bad = client.post("/api/admin/sessions", json={"id": "x", "target_langs": ["xx"]}, headers=AUTH)
    assert bad.status_code == 422
    assert client.get("/api/sessions/nope").status_code == 404
    assert client.delete("/api/admin/sessions/main", headers=AUTH).status_code == 200
    assert client.get("/api/sessions").json() == []


def test_ingest_rejects_bad_key(client):
    create(client)
    with client.websocket_connect("/ws/ingest/main?key=wrong") as ws:
        msg = ws.receive()
        assert msg["type"] == "websocket.close" and msg["code"] == 4401


def test_ingest_to_captions_exports(client):
    s = create(client)
    stream_audio(client, "main", s["ingest_key"], seconds=8, rate=48000)  # resampled server-side
    src = wait_history(client, "main", "source", 3)
    es = wait_history(client, "main", "es", 3)
    assert src[0]["text"].startswith("Welcome to Nerdearla")
    assert es[0]["text"] == "[es] " + src[0]["text"]
    assert client.get("/api/sessions/main/history?lang=en").json() == src  # source alias
    assert client.get("/api/sessions/main/history?lang=fr").status_code == 400

    srt = client.get("/api/sessions/main/transcript.srt?lang=es")
    assert srt.status_code == 200 and "-->" in srt.text and "[es]" in srt.text
    assert "attachment" in srt.headers["content-disposition"]
    assert client.get("/api/sessions/main/transcript.vtt").text.startswith("WEBVTT")
    assert client.get("/api/sessions/main/transcript.pdf").status_code == 404

    now = client.get("/api/sessions/main/now.txt?lang=pt&lines=1")
    assert now.text.startswith("[pt] ") and "\n" not in now.text
    assert client.get("/api/sessions/main/now.json?lang=es").json()["seq"] >= 3

    assert client.get("/api/sessions/main/qr.svg").text.startswith("<svg")
    summary = client.post("/api/sessions/main/summary?lang=es").json()
    assert summary["summary"] and summary["segments"] >= 3

    client.post("/api/admin/sessions/main/clear", headers=AUTH)
    assert client.get("/api/sessions/main/history").json() == []


def test_second_ingest_is_rejected_unless_takeover(client):
    s = create(client)
    key = s["ingest_key"]
    with client.websocket_connect(f"/ws/ingest/main?key={key}") as first:
        assert first.receive_json()["type"] == "ready"
        with client.websocket_connect(f"/ws/ingest/main?key={key}") as second:
            msg = second.receive()
            assert msg["type"] == "websocket.close" and msg["code"] == 4409
        with client.websocket_connect(f"/ws/ingest/main?key={key}&takeover=1") as third:
            assert third.receive_json()["type"] == "ready"


def test_ingest_keys_are_stable_across_restarts(settings):
    keys = []
    for _ in range(2):  # two independent servers (e.g. Cloud Run instance restarts)
        with TestClient(create_app(settings, translator=MockTranslator())) as c:
            keys.append(create(c)["ingest_key"])
            rotated = c.post("/api/admin/sessions/main/rotate-key", headers=AUTH).json()
            assert rotated["ingest_key"] != keys[-1]
    assert keys[0] == keys[1]
    settings.ingest_secret = "other"
    with TestClient(create_app(settings, translator=MockTranslator())) as c:
        assert create(c)["ingest_key"] != keys[0]


def test_audience_url_for_qr():
    from captionlive.main import audience_url

    assert audience_url("", "https://x.run.app/", "main") == "https://x.run.app/?session=main"
    assert (
        audience_url("https://ferwinred.github.io/CaptionLive/", "https://x.run.app/", "main", "es")
        == "https://ferwinred.github.io/CaptionLive/?session=main&lang=es&api=https%3A%2F%2Fx.run.app"
    )
