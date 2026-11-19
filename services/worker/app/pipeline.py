"""Pipeline de reconstrução (planejamento §8.1).

O worker é stateless: baixa as fotos por URL pré-assinada, processa em memória/temporário,
sobe o .glb por URL pré-assinada e não guarda nada.
"""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass
from typing import Protocol

import httpx

from .config import Settings

JPEG_MAGIC = b"\xff\xd8\xff"


class InputError(Exception):
    """Erro da captura (volta para o usuário refazer, sem nova tentativa)."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


class NotInstalledError(Exception):
    """Pipeline real indisponível neste worker."""


@dataclass
class Photo:
    angle: str
    data: bytes


@dataclass
class Result:
    glb: bytes
    source: str
    vertices: int
    quality_score: float | None


class Reconstructor(Protocol):
    def reconstruct(self, photos: list[Photo]) -> Result: ...


def glb_vertex_count(glb: bytes) -> int:
    magic, _version, _length = struct.unpack_from("<III", glb, 0)
    if magic != 0x46546C67:
        raise ValueError("não é um .glb")
    json_len = struct.unpack_from("<I", glb, 12)[0]
    doc = json.loads(glb[20 : 20 + json_len])
    pos = doc["meshes"][0]["primitives"][0]["attributes"]["POSITION"]
    return int(doc["accessors"][pos]["count"])


class MockReconstructor:
    """Devolve o template demonstrativo (com as bases dos sliders), marcado como TEMPLATE.

    Serve para desenvolver API e front sem GPU. NÃO é uma reconstrução: o selo no app
    deixa claro que o modelo é genérico.
    """

    def __init__(self, settings: Settings) -> None:
        self.glb = settings.template_path.read_bytes()

    def reconstruct(self, photos: list[Photo]) -> Result:
        return Result(glb=self.glb, source="TEMPLATE", vertices=glb_vertex_count(self.glb), quality_score=None)


class VGGTFaceReconstructor:
    """Ponto de integração do VGGTFace (Fases 0 e 4).

    Passos previstos: pré-processamento (rosto, EXIF, recorte) → VGGT + Pixel3DMM →
    bundle adjustment com topologia FLAME → textura por projeção → qualityScore →
    bases biharmônicas por slider (libigl) → .glb com morph targets.
    Depende de GPU, pesos e da confirmação de licença; por isso não está instalado aqui.
    """

    def reconstruct(self, photos: list[Photo]) -> Result:
        raise NotInstalledError(
            "Pipeline VGGTFace não instalado neste worker (requer GPU, pesos e licença). Use RECONSTRUCTOR=mock."
        )


def make_reconstructor(settings: Settings) -> Reconstructor:
    if settings.reconstructor == "flame":
        from .face.reconstructor import (
            FlameReconstructor,
        )  # importa só aqui: MediaPipe/OpenCV não são necessários no modo mock

        return FlameReconstructor()
    if settings.reconstructor == "vggtface":
        return VGGTFaceReconstructor()
    return MockReconstructor(settings)


def validate_photo(photo: Photo, max_bytes: int) -> None:
    if len(photo.data) > max_bytes:
        raise InputError("LOW_QUALITY", f"Foto {photo.angle} grande demais")
    if not photo.data.startswith(JPEG_MAGIC):
        raise InputError("LOW_QUALITY", f"Foto {photo.angle} não é JPEG")


def download_photos(client: httpx.Client, refs: list[tuple[str, str]], max_bytes: int) -> list[Photo]:
    photos = []
    for angle, url in refs:
        r = client.get(url)
        r.raise_for_status()
        photo = Photo(angle=angle, data=r.content)
        validate_photo(photo, max_bytes)
        photos.append(photo)
    return photos


def upload_mesh(client: httpx.Client, url: str, glb: bytes) -> None:
    r = client.put(url, content=glb, headers={"Content-Type": "model/gltf-binary"})
    r.raise_for_status()
