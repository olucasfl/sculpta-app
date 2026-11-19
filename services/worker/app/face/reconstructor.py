"""Reconstrutor por ajuste do FLAME 2023 Open (caminho B, em CPU): fotos -> .glb com textura e sliders.

Fonte reportada: FALLBACK_FIT (ajuste de um modelo de rosto às fotos). NÃO é uma varredura 3D:
a forma vem de 105 pontos por foto sobre um modelo estatístico, e a textura é projetada das fotos.
"""

from __future__ import annotations

import threading

import cv2
import numpy as np

from .. import pipeline
from . import bases, fit, glb, texture

# O ajuste só mede a consistência dos pontos nas fotos, não a semelhança com o rosto real.
# Sem validação contra um escaneamento, a confiança nunca passa de "média".
QUALITY_CAP = 0.79
# Erro mediano de reprojeção (fração da altura do rosto) que dá nota 1 e nota 0.
ERR_BEST, ERR_WORST = 0.006, 0.036


def quality_score(errors: dict[str, tuple[float, float]], views: int, coverage: float) -> float:
    med = float(np.mean([e[0] for e in errors.values()]))
    geo = float(np.clip(1 - (med - ERR_BEST) / (ERR_WORST - ERR_BEST), 0, 1))
    views_f = 1.0 if views >= 5 else 0.9 if views >= 4 else 0.8
    cover_f = float(np.clip(0.55 + 0.45 * (coverage / 0.75), 0.55, 1.0))
    return round(min(QUALITY_CAP, geo * views_f * cover_f), 3)


# Centro da cabeça no espaço do simulador (câmera orbita em torno de (0, -0,02, 0,02); a cabeça fica em y=0).
HEAD_CENTER = np.array([0.0, 0.0, 0.02])


def head_offset(V, masks) -> np.ndarray:
    """Translação que leva o centro da caixa da cabeça (sem o pescoço) ao centro usado pelo visualizador."""
    neck = np.zeros(len(V), bool)
    neck[np.asarray(masks["neck"], int)] = True
    head = V[~neck]
    return HEAD_CENTER - (head.min(axis=0) + head.max(axis=0)) / 2


class FlameReconstructor:
    def __init__(self, jpeg_quality: int = 92) -> None:
        texture._verbose = False
        self.fl = fit.load_flame()
        self.masks = texture.load_masks()
        self.landmarker = fit.make_landmarker()
        self.jpeg_quality = jpeg_quality
        self._lock = threading.Lock()  # o detector do MediaPipe não é thread-safe

    def reconstruct(self, photos: list[pipeline.Photo]) -> pipeline.Result:
        with self._lock:
            return self._reconstruct(photos)

    def _reconstruct(self, photos: list[pipeline.Photo]) -> pipeline.Result:
        views = []
        for p in photos:
            img = cv2.imdecode(np.frombuffer(p.data, np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                raise pipeline.InputError("LOW_QUALITY", f"Foto {p.angle} ilegível")
            v = fit.make_view(self.landmarker, self.fl, p.angle, img)
            if v is not None:
                views.append(v)
        found = {v.name for v in views}
        if "FRONT" not in found:
            raise pipeline.InputError("FACE_NOT_FOUND", "Rosto não encontrado na foto frontal.")
        if len(views) < 3:
            raise pipeline.InputError(
                "FACE_NOT_FOUND", "Rosto encontrado em poucas fotos. Refaça a captura com mais luz."
            )

        V, _beta, mirror, errors = fit.fit_views(views, self.fl, log=lambda *_: None)
        score = quality_score(errors, len(views), 1.0)
        if score < 0.2:
            raise pipeline.InputError("LOW_QUALITY", "Os pontos do rosto não ficaram coerentes entre as fotos.")

        r = texture.bake(V, texture.views_from_fit(views), self.fl["faces"], self.masks, mirror)
        score = quality_score(errors, len(views), r["coverage"])
        b = bases.build_bases(r["V"], self.fl["faces"], self.masks)
        src = r["src"]
        positions = r["Vx"] + head_offset(r["V"], self.masks)
        ok, jpg = cv2.imencode(".jpg", r["tex"], [cv2.IMWRITE_JPEG_QUALITY, self.jpeg_quality])
        if not ok:
            raise pipeline.InputError("LOW_QUALITY", "Falha ao codificar a textura")
        data = glb.write_glb(
            positions=positions,
            normals=r["Nx"],
            uvs=r["Ux"],
            indices=r["Fx"],
            texture=jpg.tobytes(),
            targets=[dict(id=t["id"], positions=t["positions"][src], normals=t["normals"][src]) for t in b["targets"]],
            scalars={f"_REGION_{name.upper()}": b["weights"][src, k] for k, name in enumerate(bases.REGION_ORDER)},
            extras=dict(
                kind="RECONSTRUCTION",
                sliderSchemaVersion=bases.SLIDER_SCHEMA_VERSION,
                regions=[f"{k}:{bases.REGION_LABEL[k]}" for k in bases.REGION_ORDER],
                textured=True,
                notice="Modelo ajustado às fotos (FLAME). É uma estimativa visual, não uma medida do rosto.",
            ),
        )
        return pipeline.Result(glb=data, source="FALLBACK_FIT", vertices=len(r["Vx"]), quality_score=score)
