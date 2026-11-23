"""Bases de deformação (os 15 sliders) sobre a malha do FLAME.

Porta de `packages/face-assets/src/bases.ts` e `regions.ts`: as MESMAS fórmulas do template, aplicadas num
espaço "de template" para o qual os vértices do FLAME são levados por âncoras do rosto (olhos, ponta do nariz,
boca, queixo). Assim cada slider se comporta como no template. As faixas são VISUAIS, sem unidade clínica.
"""

from __future__ import annotations

import numpy as np

from .fit import vertex_normals

SLIDER_SCHEMA_VERSION = 2

REGION_ORDER = ["nose", "lips", "chin", "jaw", "malar", "infraorbital", "nasolabial", "temple", "masseter"]
REGION_LABEL = {
    "nose": "Nariz",
    "lips": "Lábios",
    "chin": "Mento",
    "jaw": "Mandíbula",
    "malar": "Malar",
    "infraorbital": "Infraorbital",
    "nasolabial": "Sulco nasolabial",
    "temple": "Têmpora",
    "masseter": "Masseter",
}

# (id, região) na mesma ordem de packages/contracts/src/sliders.ts
SLIDERS = [
    ("nose.bridgeWidth", "nose"),
    ("nose.dorsumHeight", "nose"),
    ("nose.tipProjection", "nose"),
    ("nose.tipRotation", "nose"),
    ("nose.alarWidth", "nose"),
    ("lips.upperVolume", "lips"),
    ("lips.lowerVolume", "lips"),
    ("lips.contour", "lips"),
    ("chin.projection", "chin"),
    ("chin.height", "chin"),
    ("jaw.width", "jaw"),
    ("malar.volume", "malar"),
    ("malar.projection", "malar"),
    ("infraorbital.volume", "infraorbital"),
    ("nasolabial.volume", "nasolabial"),
    ("temple.volume", "temple"),
    ("masseter.reduction", "masseter"),
]

# Deslocamento máximo (slider = 1) em unidades u do template; é VISUAL, não milímetro.
SLIDER_MAX = {
    "nose.bridgeWidth": 0.35,
    "nose.dorsumHeight": 0.035,
    "nose.tipProjection": 0.05,
    "nose.tipRotation": 0.035,
    "nose.alarWidth": 0.45,
    "lips.upperVolume": 0.03,
    "lips.lowerVolume": 0.032,
    "lips.contour": 0.012,
    "chin.projection": 0.07,
    "chin.height": 0.06,
    "jaw.width": 0.05,
    "malar.volume": 0.035,
    "malar.projection": 0.04,
    "infraorbital.volume": 0.016,
    "nasolabial.volume": 0.02,
    "temple.volume": 0.03,
    "masseter.reduction": 0.03,
}

# Âncoras do template (y em u): olhos, ponta do nariz, linha da boca, base do queixo.
TEMPLATE_Y = np.array([0.17, -0.20, -0.475, -0.94])
TEMPLATE_EYE_HALF = 0.3


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def falloff(d2):
    t = 1 - np.minimum(d2, 1)
    return np.where(d2 >= 1, 0.0, t * t)


def ellipse(x, y, cx, cy, rx, ry):
    return falloff(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)


def segment_d2(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1)
    dx, dy = px - (ax + t * vx), py - (ay + t * vy)
    return dx * dx + dy * dy


def region_weights(x, y, front):
    """Pesos 0-1 de cada região por vértice (x, y no espaço de template; `front` zera a nuca e as costas)."""
    ax = np.abs(x)
    f = front
    w = {
        "nose": ellipse(x, y, 0, -0.02, 0.15, 0.28) * f,
        "lips": ellipse(x, y, 0, -0.47, 0.24, 0.11) * f,
        "chin": ellipse(x, y, 0, -0.77, 0.21, 0.17) * f,
        "jaw": ellipse(ax, y, 0.55, -0.66, 0.22, 0.22) * np.minimum(1, f * 3 + 0.2),
        "malar": ellipse(ax, y, 0.4, -0.02, 0.17, 0.14) * f,
        "infraorbital": ellipse(ax, y, 0.24, 0.05, 0.14, 0.07) * f,
        "nasolabial": falloff(segment_d2(ax, y, 0.12, -0.26, 0.22, -0.52) / 0.06**2) * f,
        # laterais: a têmpora fica acima e atrás do olho; o masseter, no ângulo da mandíbula e na bochecha baixa
        "temple": ellipse(ax, y, 0.58, 0.3, 0.14, 0.15) * np.minimum(1, f * 3 + 0.2),
        "masseter": ellipse(ax, y, 0.6, -0.55, 0.16, 0.2) * np.minimum(1, f * 3 + 0.2),
    }
    sub = {
        "dorsum": ellipse(x, y, 0, 0.03, 0.09, 0.2) * f,
        "tip": ellipse(x, y, 0, -0.2, 0.1, 0.09) * f,
        "alar": ellipse(ax, y, 0.1, -0.22, 0.075, 0.06) * f,
        "upperLip": ellipse(x, y, 0, -0.43, 0.2, 0.055) * f,
        "lowerLip": ellipse(x, y, 0, -0.515, 0.18, 0.06) * f,
        "vermilion": (np.exp(-((y + 0.4) ** 2) / (2 * 0.012**2)) + np.exp(-((y + 0.55) ** 2) / (2 * 0.012**2)))
        * ellipse(x, y, 0, -0.475, 0.2, 0.12)
        * f,
        "chinLower": w["chin"] * np.clip((-0.62 - y) / 0.2, 0, 1),
    }
    return w, sub


def template_frame(V, masks):
    """Leva os vértices do FLAME ao espaço do template. Devolve (x_t, y_t, metros_por_u)."""
    left, right = np.asarray(masks["left_eyeball"], int), np.asarray(masks["right_eyeball"], int)
    cl, cr = V[left].mean(0), V[right].mean(0)
    half = abs(cl[0] - cr[0]) / 2
    s = half / TEMPLATE_EYE_HALF  # metros por u
    face = np.asarray(masks["face"], int)
    nose = np.asarray(masks["nose"], int)
    lips = np.asarray(masks["lips"], int)
    anchors = np.array(
        [(cl[1] + cr[1]) / 2, V[nose[np.argmax(V[nose][:, 2])]][1], V[lips][:, 1].mean(), V[face][:, 1].min()]
    )
    if not np.all(np.diff(anchors) < 0):  # malha fora do esperado: escala linear só pelos olhos e queixo
        anchors = np.linspace(anchors[0], anchors[-1], 4)
    # estende acima dos olhos e abaixo do queixo com a inclinação do trecho vizinho (np.interp não extrapola)
    ys_f = np.concatenate([[anchors[0] + (anchors[0] - anchors[1]) * 3], anchors, [anchors[-1] - 0.12]])
    ys_t = np.concatenate(
        [[TEMPLATE_Y[0] + (TEMPLATE_Y[0] - TEMPLATE_Y[1]) * 3], TEMPLATE_Y, [TEMPLATE_Y[-1] - 0.12 / s]]
    )
    y_t = np.interp(-V[:, 1], -ys_f, -ys_t) * -1
    x_t = (V[:, 0] - (cl[0] + cr[0]) / 2) / s
    return x_t, y_t, s


def build_bases(V, F, masks):
    """Bases de todos os sliders. Devolve dict com `targets` (id, região, deltas de posição e normal em metros) e `weights` (n, 7)."""
    V = np.asarray(V, np.float64)
    n = len(V)
    N = vertex_normals(V, F)
    x, y, s = template_frame(V, masks)
    front = smoothstep(0.15, 0.6, N[:, 2])
    w, sub = region_weights(x, y, front)
    eyes = np.concatenate([np.asarray(masks["left_eyeball"], int), np.asarray(masks["right_eyeball"], int)])
    alive = np.ones(n)
    alive[eyes] = 0.0  # os olhos não acompanham a escultura da pele
    sx = np.sign(x)
    zero = np.zeros(n)

    def along(weight):
        return N * (weight * alive)[:, None]

    def vec(dx, dy, dz):
        return np.stack([dx, dy, dz], axis=1) * alive[:, None]

    d = {
        "nose.bridgeWidth": vec(x * sub["dorsum"], zero, zero),
        "nose.dorsumHeight": vec(zero, zero, sub["dorsum"] * w["nose"]),
        "nose.tipProjection": vec(zero, zero, sub["tip"]),
        "nose.tipRotation": vec(zero, sub["tip"], zero),
        "nose.alarWidth": vec(x * sub["alar"], zero, zero),
        "lips.upperVolume": along(sub["upperLip"] * (1 - 0.35 * np.minimum(1, (x / 0.2) ** 2))),
        "lips.lowerVolume": along(sub["lowerLip"] * (1 - 0.35 * np.minimum(1, (x / 0.18) ** 2))),
        "lips.contour": vec(zero, zero, np.minimum(1, sub["vermilion"])),
        "chin.projection": vec(zero, -0.15 * w["chin"], w["chin"]),
        "chin.height": vec(zero, -sub["chinLower"], 0.2 * sub["chinLower"]),
        "jaw.width": vec(sx * w["jaw"], zero, 0.2 * w["jaw"]),
        "malar.volume": along(w["malar"]),
        "malar.projection": vec(sx * 0.35 * w["malar"], 0.35 * w["malar"], 0.87 * w["malar"]),
        "infraorbital.volume": along(w["infraorbital"]),
        "nasolabial.volume": along(w["nasolabial"]),
        "temple.volume": along(w["temple"]),
        "masseter.reduction": vec(-sx * w["masseter"], zero, -0.1 * w["masseter"]),
    }
    targets = []
    for sid, region in SLIDERS:
        dp = d[sid] * SLIDER_MAX[sid] * s  # u -> metros
        dn = vertex_normals(V + dp, F) - N
        dn[np.abs(dn) < 1e-5] = 0.0
        max_mm = float(np.linalg.norm(dp, axis=1).max() * 1000)  # deslocamento máximo real deste slider, em mm
        targets.append(
            dict(id=sid, region=region, positions=dp.astype(np.float32), normals=dn.astype(np.float32), max_mm=max_mm)
        )
    weights = np.stack([w[r] * alive for r in REGION_ORDER], axis=1).astype(np.float32)
    return dict(targets=targets, weights=weights, metres_per_unit=float(s), normals=N)
