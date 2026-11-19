"""Reconstrutor por ajuste do FLAME 2023 Open (caminho B, em CPU): fotos -> .glb com textura e sliders.

Fonte reportada: FALLBACK_FIT (ajuste de um modelo de rosto às fotos). NÃO é uma varredura 3D:
a forma vem de 105 pontos por foto sobre um modelo estatístico, e a textura é projetada das fotos.
"""

from __future__ import annotations

import threading

import cv2
import numpy as np

from .. import pipeline
from . import bases, fit, glb, hair, silhouette, texture

# A silhueta de perfil melhora o erro de borda em ~1,5 mm, mas muda o formato do rosto em relação à primeira versão com
# textura (a que ficou parecida com a pessoa). Desligada por padrão: o rosto fica como estava.
REFINE_SILHOUETTE = False
# O contorno da mandíbula e das bochechas (MediaPipe) corrige a largura: sem ele o modelo saía ~17 px (7% da altura do
# rosto) mais largo e quadrado que a pessoa. Ligado.
REFINE_OVAL = True

# O ajuste só mede a consistência dos pontos nas fotos, não a semelhança com o rosto real.
# Sem validação contra um escaneamento, a confiança nunca passa de "média".
QUALITY_CAP = 0.79
# Erro mediano de reprojeção (fração da altura do rosto) que dá nota 1 e nota 0.
ERR_BEST, ERR_WORST = 0.006, 0.036


def quality_score(
    errors: dict[str, tuple[float, float]], views: int, coverage: float, sil: dict[str, float | None] | None = None
) -> float:
    med = float(np.mean([e[0] for e in errors.values()]))
    sil_vals = [x for x in (sil or {}).values() if x is not None]
    if sil_vals:  # a borda do perfil é mais exigente que os pontos: entra com o mesmo peso
        med = 0.5 * med + 0.5 * float(np.mean(sil_vals))
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

        V, beta, mirror, errors = fit.fit_views(views, self.fl, log=lambda *_: None)
        info: dict = {}
        if REFINE_SILHOUETTE or REFINE_OVAL:
            V, beta, info = silhouette.refine(
                views, self.fl, self.masks, beta, mirror, profile=REFINE_SILHOUETTE, oval=REFINE_OVAL
            )
        sil = info.get("after")
        score = quality_score(errors, len(views), 1.0, sil)
        if score < 0.2:
            raise pipeline.InputError("LOW_QUALITY", "Os pontos do rosto não ficaram coerentes entre as fotos.")

        r = texture.bake(V, texture.views_from_fit(views), self.fl["faces"], self.masks, mirror)
        score = quality_score(errors, len(views), r["coverage"], sil)
        b = bases.build_bases(r["V"], self.fl["faces"], self.masks)
        src = r["src"]
        n0 = r["n_original"]
        eye_ids = np.concatenate([np.asarray(self.masks[k], int) for k in ("left_eyeball", "right_eyeball")])
        off = head_offset(r["V"], self.masks)
        hair_w, hair_hex = hair.hair_weights(
            r["tex"], r["Ux"][:n0], r["V"], self.masks, texture.HEAD_V, float(r["V"][eye_ids][:, 1].mean())
        )
        # nível dos olhos e plano da frente do rosto, já no espaço do simulador (o modelo é transladado por `off`)
        eye_y = float(r["V"][eye_ids][:, 1].mean() + off[1])
        face_z = float(r["V"][eye_ids][:, 2].mean() + off[2])
        positions = r["Vx"] + off
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
            scalars={
                **{f"_REGION_{name.upper()}": b["weights"][src, k] for k, name in enumerate(bases.REGION_ORDER)},
                "_HAIR": hair_w[src],  # cobertura de cabelo por vértice (o simulador cresce fios onde > 0)
            },
            extras=dict(
                kind="RECONSTRUCTION",
                sliderSchemaVersion=bases.SLIDER_SCHEMA_VERSION,
                regions=[f"{k}:{bases.REGION_LABEL[k]}" for k in bases.REGION_ORDER],
                textured=True,
                hairColor=hair_hex,
                eyeY=eye_y,
                faceZ=face_z,
                notice="Modelo ajustado às fotos (FLAME). É uma estimativa visual, não uma medida do rosto.",
            ),
        )
        return pipeline.Result(glb=data, source="FALLBACK_FIT", vertices=len(r["Vx"]), quality_score=score)
