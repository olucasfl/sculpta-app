from __future__ import annotations

import json
import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.pipeline import glb_vertex_count
from app.security import sign, verify

SECRET = "segredo-do-worker-com-pelo-menos-32-caracteres"
TEMPLATE = Path(__file__).resolve().parent.parent / "assets" / "template-head.glb"
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 256
ANGLES = ["FRONT", "LEFT_45", "RIGHT_45", "LEFT_90", "RIGHT_90"]


class FakeStorage:
    """Storage falso atendendo as URLs pré-assinadas do job."""

    def __init__(self, photo: bytes = JPEG) -> None:
        self.photo = photo
        self.uploaded: bytes | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, content=self.photo)
        if request.method == "PUT":
            self.uploaded = request.content
            return httpx.Response(200)
        return httpx.Response(405)


def make(storage: FakeStorage, reconstructor: str = "mock") -> TestClient:
    settings = Settings(worker_secret=SECRET, reconstructor=reconstructor, template_path=TEMPLATE)
    client = httpx.Client(transport=httpx.MockTransport(storage.handler))
    return TestClient(create_app(settings, client))


def job() -> bytes:
    return json.dumps(
        {
            "jobId": "rec_1",
            "photos": [{"angle": a, "url": f"http://storage.test/{a}.jpg"} for a in ANGLES],
            "output": {"meshUploadUrl": "http://storage.test/out.glb"},
        }
    ).encode()


def post(client: TestClient, body: bytes, secret: str = SECRET, ts: int | None = None) -> httpx.Response:
    t = ts if ts is not None else int(time.time())
    return client.post(
        "/v1/reconstruct",
        content=body,
        headers={
            "Content-Type": "application/json",
            "x-worker-timestamp": str(t),
            "x-worker-signature": sign(secret, t, body),
        },
    )


def test_hmac() -> None:
    body = b'{"a":1}'
    t = int(time.time())
    s = sign(SECRET, t, body)
    assert verify(SECRET, str(t), s, body)
    assert not verify(SECRET, str(t), s, body + b" ")
    assert not verify("outro-segredo-com-mais-de-trinta-e-dois", str(t), s, body)
    assert not verify(SECRET, str(t - 1000), sign(SECRET, t - 1000, body), body)


@pytest.mark.skipif(not TEMPLATE.exists(), reason="rode `pnpm --filter @sim/face-assets build` antes")
def test_mock_reconstruct_uploads_template() -> None:
    storage = FakeStorage()
    r = post(make(storage), job())
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "DONE"
    assert data["source"] == "TEMPLATE"
    assert data["metrics"]["vertices"] == glb_vertex_count(TEMPLATE.read_bytes())
    assert storage.uploaded is not None and storage.uploaded[:4] == b"glTF"


def test_rejects_bad_signature_and_replay() -> None:
    client = make(FakeStorage())
    assert post(client, job(), secret="segredo-errado-com-mais-de-trinta-e-dois").status_code == 401
    assert post(client, job(), ts=int(time.time()) - 3600).status_code == 401
    assert client.post("/v1/reconstruct", content=job()).status_code == 401


def test_non_jpeg_is_input_error() -> None:
    r = post(make(FakeStorage(photo=b"<html>")), job())
    expected = {"jobId": "rec_1", "status": "FAILED", "code": "LOW_QUALITY", "detail": "Foto FRONT não é JPEG"}
    assert r.json() == expected


def test_vggtface_not_installed_is_reported() -> None:
    r = post(make(FakeStorage(), reconstructor="vggtface"), job())
    body = r.json()
    assert body["status"] == "FAILED"
    assert body["code"] == "INTERNAL"
    assert "não instalado" in body["detail"]


def test_health() -> None:
    assert make(FakeStorage()).get("/health").json()["status"] == "ok"
