"""Estilo do cabelo lido na foto frontal: comprimento, franja, volume, cacho e cor.

Sem rede neural: a cor do cabelo é amostrada logo acima da testa (pelos pontos do MediaPipe), o fundo vem das bordas
da foto e a pele é calibrada nas bochechas. Cabelo = pixel parecido com a cor da raiz, que não é pele nem fundo e está
ligado à raiz. Daí saem medidas simples, todas relativas à altura do rosto (testa ao queixo), para valer em qualquer
distância de câmera:
  length  : até onde o cabelo desce ao lado do rosto, a partir dos olhos (0,3 = acima do queixo, 1,0 = no queixo, 1,6+ = ombros)
  fringe  : 0 a 1, quanto da testa o cabelo cobre; fringeDepth: 1 = chega às sobrancelhas
  volume  : largura do cabelo no alto da cabeça dividida pela largura do rosto
  curl    : 0 (liso) a 1 (cacheado), pela desordem da direção dos fios e pelo volume
É uma estimativa por cor: cabelo da cor da parede, boné, lenço ou roupa da cor do cabelo podem enganar.
"""

from __future__ import annotations

import cv2
import numpy as np

# índices do MediaPipe Face Mesh
TOP, CHIN, CHEEK_L, CHEEK_R = 10, 152, 234, 454
EYE_L, EYE_R = 33, 263
BROW_L, BROW_R = 105, 334
SKIN_SAMPLES = (205, 425, 50, 280, 117, 346)  # bochechas

LAB_TOL = 24.0
SIDE_MARGIN = 0.04
MAX_LEN_RATIO = 1.9  # limite de análise: abaixo disso é roupa/ombro


def _lab(img):
    return cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)


def _dist(lab, ref, wl=0.45):
    d = lab - ref
    return np.sqrt((d[..., 0] * wl) ** 2 + d[..., 1] ** 2 + d[..., 2] ** 2)


def _hex(bgr) -> str:
    b, g, r = (int(np.clip(c, 0, 255)) for c in bgr)
    return f"#{r:02x}{g:02x}{b:02x}"


def skin_model(img, lm):
    h, w = img.shape[:2]
    ycc = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb).astype(np.float32)
    pts = [(int(np.clip(lm[i][0], 0, w - 1)), int(np.clip(lm[i][1], 0, h - 1))) for i in SKIN_SAMPLES]
    samp = np.array([ycc[y, x] for x, y in pts])
    med = np.median(samp, axis=0)
    skin = (np.abs(ycc[..., 1] - med[1]) < 15) & (np.abs(ycc[..., 2] - med[2]) < 15) & (ycc[..., 0] > 40)
    return skin


def detect_style(img: np.ndarray, lm: np.ndarray, debug: dict | None = None) -> dict:
    """img: foto frontal (BGR); lm: 478 pontos em pixels. Devolve o dicionário do estilo (sempre com as mesmas chaves)."""
    h, w = img.shape[:2]
    # reduz para acelerar sem mudar nada (as medidas são relativas)
    s = 640.0 / max(h, w) if max(h, w) > 640 else 1.0
    if s < 1.0:
        img = cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
        lm = lm * s
        h, w = img.shape[:2]
    P = lambda i: lm[i]  # noqa: E731
    H = float(P(CHIN)[1] - P(TOP)[1])
    W = float(P(CHEEK_R)[0] - P(CHEEK_L)[0])
    cx = float((P(CHEEK_R)[0] + P(CHEEK_L)[0]) / 2)
    xl, xr = sorted((float(P(CHEEK_L)[0]), float(P(CHEEK_R)[0])))
    W = xr - xl
    y_top = float(P(TOP)[1])
    y_eye = float((P(EYE_L)[1] + P(EYE_R)[1]) / 2)
    y_brow = float((P(BROW_L)[1] + P(BROW_R)[1]) / 2)
    y_chin = float(P(CHIN)[1])
    none = dict(hasHair=False, length=0.0, fringe=0.0, fringeDepth=0.0, fringeSide=0.0, volume=1.0, curl=0.0, color=None, coherence=1.0)
    if H < 20 or W < 20:
        return none

    lab = _lab(img)
    # fundo: bordas laterais da metade de cima da foto
    bw = max(2, int(0.04 * w))
    bg_px = np.concatenate([lab[: int(0.6 * h), :bw].reshape(-1, 3), lab[: int(0.6 * h), -bw:].reshape(-1, 3)])
    bg = np.median(bg_px, axis=0)
    far_bg = _dist(lab, bg) > 14
    skin = skin_model(img, lm)

    # semente: logo acima da testa
    y0, y1 = int(max(0, y_top - 0.25 * H)), int(max(1, y_top - 0.02 * H))
    x0, x1 = int(max(0, cx - 0.2 * W)), int(min(w, cx + 0.2 * W))
    box = (slice(y0, max(y1, y0 + 1)), slice(x0, max(x1, x0 + 1)))
    cand = far_bg[box] & ~skin[box]
    if cand.mean() < 0.25 or cand.sum() < 20:
        return none  # testa até o topo da foto, sem nada que pareça cabelo: raspado ou careca
    seed = np.median(lab[box][cand], axis=0)

    mask = (_dist(lab, seed) < LAB_TOL) & far_bg & ~skin
    mask[int(y_chin + MAX_LEN_RATIO * H) :] = False
    mask[:, : int(max(0, cx - 1.4 * W))] = False
    mask[:, int(min(w, cx + 1.4 * W)) :] = False
    m8 = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    m8 = cv2.morphologyEx(m8, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    n, lab_cc = cv2.connectedComponents(m8)
    seed_labels = lab_cc[box][cand & (m8[box] > 0)]
    seed_labels = seed_labels[seed_labels > 0]
    if len(seed_labels) == 0:
        return none
    keep = np.bincount(seed_labels).argmax()
    hair = lab_cc == keep
    if debug is not None:
        debug["img"], debug["hair"] = img, hair
    if hair.sum() < 0.01 * H * W:
        return none

    # comprimento: até onde há cabelo nas colunas fora do rosto, dos olhos para baixo
    side_cols = np.ones(w, bool)
    side_cols[int(max(0, xl + SIDE_MARGIN * W)) : int(min(w, xr - SIDE_MARGIN * W))] = False
    bottom = y_eye
    ys = np.arange(int(y_eye), min(h, int(y_chin + MAX_LEN_RATIO * H)))
    for y in ys:
        if hair[y][side_cols].sum() >= 0.05 * W:
            bottom = float(y)
    length = float(np.clip((bottom - y_eye) / H, 0, MAX_LEN_RATIO))

    # franja: cabelo sobre a testa, entre a raiz e as sobrancelhas, na LARGURA toda do rosto (uma franja de lado cobre
    # só um dos lados, e a faixa central a perdia). O lado mais coberto diz para onde ela é jogada.
    fy0, fy1 = int(y_top), int(max(y_top + 2, y_brow))
    fx0, fx1 = int(cx - 0.5 * W), int(cx + 0.5 * W)
    fr = hair[fy0:fy1, fx0:fx1]
    cov = float(fr.mean()) if fr.size else 0.0
    fringe = float(np.clip((cov - 0.06) / 0.3, 0, 1))
    depth = 0.0
    side = 0.0  # +1: a franja pesa no lado ESQUERDO da imagem; -1: no direito
    if fringe > 0 and fr.size:
        half = fr.shape[1] // 2
        cl, cr = float(fr[:, :half].mean()), float(fr[:, half:].mean())
        if fringe > 0.15:
            side = float(np.clip((cl - cr) / (cl + cr + 1e-6), -1, 1))
        # profundidade: onde o cabelo chega nas colunas que têm cabelo (1 = nas sobrancelhas)
        strip = hair[fy0 : int(y_brow + 0.1 * H), fx0:fx1]
        lows = [np.nonzero(strip[:, c])[0].max() for c in range(strip.shape[1]) if strip[:, c].any()]
        if lows:
            depth = float(np.clip((np.percentile(lows, 80) + 1) / max(y_brow - y_top, 1.0), 0, 1.3))

    # volume: largura do cabelo no alto da cabeça
    widths = []
    for y in range(int(max(0, y_top - 0.2 * H)), int(y_top + 0.1 * H)):
        xs = np.nonzero(hair[y])[0]
        if len(xs) > 10:
            widths.append(np.percentile(xs, 98) - np.percentile(xs, 2))
    volume = float(max(widths) / W) if widths else 1.0

    # desordem da direção dos fios (tensor de estrutura) dentro do cabelo
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    k = max(3, int(0.03 * H) | 1)
    jxx, jyy, jxy = (cv2.GaussianBlur(a, (k, k), 0) for a in (gx * gx, gy * gy, gx * gy))
    coh = np.sqrt((jxx - jyy) ** 2 + 4 * jxy**2) / (jxx + jyy + 1e-6)
    inner = cv2.erode(hair.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    coherence = float(coh[inner].mean()) if inner.sum() > 100 else 0.5
    curl = float(np.clip((0.5 - coherence) / 0.3, 0, 1) * 0.6 + np.clip((volume - 1.35) / 0.6, 0, 1) * 0.4)

    # cor: mediana do cabelo (sem os pixels de brilho)
    px = img[inner] if inner.sum() > 100 else img[hair]
    lum = px.mean(axis=1)
    px = px[lum <= np.percentile(lum, 90)]
    color = _hex(np.median(px, axis=0))
    return dict(
        hasHair=True,
        length=round(length, 3),
        fringe=round(fringe, 3),
        fringeDepth=round(depth, 3),
        fringeSide=round(side, 3),
        volume=round(volume, 3),
        curl=round(curl, 3),
        color=color,
        coherence=round(coherence, 3),
    )
