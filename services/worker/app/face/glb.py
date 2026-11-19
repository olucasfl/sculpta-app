"""Escritor de .glb do rosto reconstruído, no mesmo formato do template (ADR 0002):

- malha com UV e textura (PNG) embutida;
- 15 morph targets ESPARSOS, um por slider, nomeados em `mesh.extras.targetNames`;
- pesos de região por vértice em `_REGION_<NOME>` (bytes normalizados);
- metadados em `mesh.extras` (kind, aviso, versão do esquema dos sliders).
"""

from __future__ import annotations

import json
import struct

import numpy as np

FLOAT, UINT32, UBYTE = 5126, 5125, 5121
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963


class _Bin:
    def __init__(self) -> None:
        self.data = bytearray()
        self.views: list[dict] = []

    def add(self, raw: bytes, target: int | None = None) -> int:
        self.data += b"\x00" * ((4 - len(self.data) % 4) % 4)
        view = {"buffer": 0, "byteOffset": len(self.data), "byteLength": len(raw)}
        if target:
            view["target"] = target
        self.views.append(view)
        self.data += raw
        return len(self.views) - 1


def _minmax(a: np.ndarray) -> dict:
    return {"min": a.min(axis=0).astype(float).tolist(), "max": a.max(axis=0).astype(float).tolist()}


def write_glb(
    *, positions, normals, uvs, indices, texture: bytes, targets, scalars, extras, mime="image/jpeg"
) -> bytes:
    """positions/normals (n,3) float; uvs (n,2); indices (m,3) int; targets: lista de dicts(id, positions, normals);
    scalars: {nome: (n,) 0-1}; extras: dict (vai em mesh.extras junto com targetNames)."""
    pos = np.ascontiguousarray(positions, np.float32)
    nrm = np.ascontiguousarray(normals, np.float32)
    uv = np.ascontiguousarray(uvs, np.float32)
    idx = np.ascontiguousarray(indices, np.uint32).reshape(-1)
    n = len(pos)
    b = _Bin()
    acc: list[dict] = []

    def accessor(a: dict) -> int:
        acc.append(a)
        return len(acc) - 1

    a_pos = accessor(
        {
            "bufferView": b.add(pos.tobytes(), ARRAY_BUFFER),
            "componentType": FLOAT,
            "count": n,
            "type": "VEC3",
            **_minmax(pos),
        }
    )
    a_nrm = accessor(
        {"bufferView": b.add(nrm.tobytes(), ARRAY_BUFFER), "componentType": FLOAT, "count": n, "type": "VEC3"}
    )
    a_uv = accessor(
        {"bufferView": b.add(uv.tobytes(), ARRAY_BUFFER), "componentType": FLOAT, "count": n, "type": "VEC2"}
    )
    a_idx = accessor(
        {
            "bufferView": b.add(idx.tobytes(), ELEMENT_ARRAY_BUFFER),
            "componentType": UINT32,
            "count": int(idx.size),
            "type": "SCALAR",
        }
    )
    attributes = {"POSITION": a_pos, "NORMAL": a_nrm, "TEXCOORD_0": a_uv}
    for name, values in scalars.items():
        q = np.round(np.clip(np.asarray(values, np.float32), 0, 1) * 255).astype(np.uint8)
        attributes[name] = accessor(
            {
                "bufferView": b.add(q.tobytes(), ARRAY_BUFFER),
                "componentType": UBYTE,
                "normalized": True,
                "count": n,
                "type": "SCALAR",
            }
        )

    def sparse(values: np.ndarray, is_position: bool) -> int:
        v = np.ascontiguousarray(values, np.float32)
        moved = np.nonzero(np.abs(v).sum(axis=1) > 1e-7)[0]
        a: dict = {"componentType": FLOAT, "count": n, "type": "VEC3"}
        if is_position:
            a.update(_minmax(v[moved]) if len(moved) else {"min": [0, 0, 0], "max": [0, 0, 0]})
        if len(moved):
            a["sparse"] = {
                "count": int(len(moved)),
                "indices": {"bufferView": b.add(moved.astype(np.uint32).tobytes()), "componentType": UINT32},
                "values": {"bufferView": b.add(np.ascontiguousarray(v[moved]).tobytes())},
            }
        return accessor(a)

    morphs = [{"POSITION": sparse(t["positions"], True), "NORMAL": sparse(t["normals"], False)} for t in targets]
    img_view = b.add(texture)
    binary = bytes(b.data) + b"\x00" * ((4 - len(b.data) % 4) % 4)

    doc = {
        "asset": {"version": "2.0", "generator": "sim-worker (FLAME)"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "FaceMesh", "mesh": 0}],
        "meshes": [
            {
                "name": "FaceMesh",
                "primitives": [
                    {"attributes": attributes, "indices": a_idx, "mode": 4, "material": 0, "targets": morphs}
                ],
                "weights": [0] * len(targets),
                "extras": {"targetNames": [t["id"] for t in targets], **extras},
            }
        ],
        "materials": [
            {
                "name": "Pele",
                "doubleSided": True,
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": 0},
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.65,
                },
            }
        ],
        "textures": [{"source": 0, "sampler": 0}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 33071}],
        "images": [{"bufferView": img_view, "mimeType": mime}],
        "accessors": acc,
        "bufferViews": b.views,
        "buffers": [{"byteLength": len(binary)}],
    }
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    out = bytearray(struct.pack("<III", 0x46546C67, 2, total))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(binary), 0x004E4942) + binary
    return bytes(out)
