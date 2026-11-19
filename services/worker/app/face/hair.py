"""Cobertura de cabelo por vértice, medida na textura baked das fotos.

O simulador faz crescer fios só onde há cabelo (e com a cor dele); a testa, o rosto e a barba ficam de fora.
Cabelo = pixel escuro que não tem a cor da pele. É uma estimativa por cor: cabelo claro/grisalho ou sobrancelha e
barba escuras fora da faixa de altura podem enganar; por isso só vale acima da altura dos olhos e fora de orelhas/olhos.
"""

from __future__ import annotations

import cv2
import numpy as np

HAIR_Y_MAX = 100  # luminância (Y) abaixo da qual um pixel que não é pele conta como cabelo


def hair_mask(tex: np.ndarray) -> np.ndarray:
    """Máscara suave (0-1) de cabelo no mapa de textura (BGR)."""
    ycc = cv2.cvtColor(tex, cv2.COLOR_BGR2YCrCb)
    skin = (ycc[..., 1] >= 134) & (ycc[..., 1] <= 178) & (ycc[..., 2] >= 78) & (ycc[..., 2] <= 126) & (ycc[..., 0] > 70)
    hair = ((ycc[..., 0] < HAIR_Y_MAX) & ~skin & (ycc[..., 0] > 0)).astype(np.float32)
    return cv2.GaussianBlur(hair, (0, 0), 5)


def smoothstep(a: float, b: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def hair_weights(tex, uv, positions, masks, head_rows: float, y_eye: float):
    """Peso de cabelo (n,) para cada vértice original e a cor média do cabelo (hex).

    uv: (n,2) coordenadas de cada vértice (as primeiras n linhas da malha expandida são os vértices originais);
    positions: (n,3) em metros; head_rows: fração do mapa que é cabeça cilíndrica (o resto é olhos e orelhas)."""
    size = tex.shape[0]
    m = hair_mask(tex)
    u = np.clip((np.asarray(uv)[:, 0] % 1.0) * (size - 1), 0, size - 1).astype(int)
    v = np.clip(np.asarray(uv)[:, 1] * (size - 1), 0, size - 1).astype(int)
    w = m[v, u].astype(np.float64)
    P = np.asarray(positions)
    # Sobrancelhas e sombra da testa também são escuras e não têm cor de pele: na frente do rosto só conta a testa alta
    # (acima do topo da sobrancelha); nas têmporas e laterais o cabelo desce até a altura dos olhos.
    front = P[:, 2] > P[:, 2].mean() + 0.02
    temple = np.abs(P[:, 0]) > 0.062
    low = np.where(front & ~temple, y_eye + 0.05, y_eye - 0.01)
    w *= smoothstep(0.0, 0.02, P[:, 1] - low)  # nada abaixo disso (barba, pescoço, sobrancelha)
    skip = np.concatenate(
        [np.asarray(masks[k], int) for k in ("left_ear", "right_ear", "left_eyeball", "right_eyeball", "neck")]
    )
    w[skip] = 0.0
    w[np.asarray(uv)[:, 1] >= head_rows] = 0.0  # ilhas de olhos e orelhas
    w = np.clip((w - 0.25) / 0.5, 0, 1)  # limiar suave: só cobertura clara vira fio

    rows = int(head_rows * size)
    pix = tex[:rows]
    sel = (m[:rows] > 0.6) & (pix.sum(axis=2) > 0)
    color = np.median(pix[sel], axis=0) if sel.sum() > 200 else np.array([20, 20, 25.0])
    b, g, r = (int(np.clip(c, 0, 255)) for c in color)
    return w.astype(np.float32), f"#{r:02x}{g:02x}{b:02x}"
