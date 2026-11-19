"""Alinha a orelha 3D à orelha real numa foto de perfil (similaridade 2D: deslocamento, escala, rotação).

A orelha do FLAME tem tamanho parecido mas cai deslocada. A borda de fora da orelha (contra o cabelo ou o fundo)
é uma borda forte na foto; procuramos a transformação que faz o contorno externo da malha cair nela.
"""

from __future__ import annotations

import cv2
import numpy as np
from scipy.ndimage import map_coordinates


def outline_points(F, ear_idx, pix, step_px=2.0):
    """Pontos ao longo da borda da malha da orelha (arestas que pertencem a um só triângulo)."""
    ear = set(int(i) for i in ear_idx)
    tris = [t for t in F if all(int(k) in ear for k in t)]
    count: dict[tuple[int, int], int] = {}
    for t in tris:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            k = (int(min(a, b)), int(max(a, b)))
            count[k] = count.get(k, 0) + 1
    pts = []
    for (a, b), c in count.items():
        if c != 1:
            continue
        pa, pb = pix[a], pix[b]
        n = max(1, int(np.linalg.norm(pb - pa) / step_px))
        for u in np.linspace(0, 1, n, endpoint=False):
            pts.append(pa * (1 - u) + pb * u)
    return np.array(pts)


def align_ear(img, outline, centroid, face_dir, size):
    """Devolve (dx, dy, escala, rot_graus). face_dir: vetor unitário do centro da orelha para o rosto."""
    ycc = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
    skin = (
        (ycc[..., 1] >= 133) & (ycc[..., 1] <= 180) & (ycc[..., 2] >= 75) & (ycc[..., 2] <= 128) & (ycc[..., 0] > 40)
    ).astype(np.float32)
    skin = cv2.GaussianBlur(skin, (0, 0), 2.0)
    gray = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32), (0, 0), 1.6)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    G = np.hypot(gx, gy)

    rel = outline - centroid
    outer = rel @ face_dir < -0.12 * size  # só a borda de fora (longe do rosto)
    rel_o = rel[outer]
    nrm = rel_o / (np.linalg.norm(rel_o, axis=1, keepdims=True) + 1e-9)
    if len(rel_o) < 20:
        return 0.0, 0.0, 1.0, 0.0

    def score(dx, dy, sc, rot):
        a = np.deg2rad(rot)
        Rm = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
        p = (rel_o @ Rm.T) * sc + centroid + np.array([dx, dy])
        nr = nrm @ Rm.T
        k = 0.07 * size
        pin, pout = p - nr * k, p + nr * k
        sin_ = map_coordinates(skin, [pin[:, 1], pin[:, 0]], order=1, mode="nearest")
        sout = map_coordinates(skin, [pout[:, 1], pout[:, 0]], order=1, mode="nearest")
        vals = map_coordinates(G, [p[:, 1], p[:, 0]], order=1, mode="nearest")
        contrast = float(sin_.mean() - sout.mean())
        reg = (dx * dx + dy * dy) / (0.40 * size) ** 2 * 0.35 + ((sc - 1.0) / 0.2) ** 2 * 0.25 + (rot / 18.0) ** 2 * 0.2
        return contrast + 0.25 * float(vals.mean()) / (G.mean() + 1e-6) - reg

    best = (-1e9, (0.0, 0.0, 1.0, 0.0))
    # grossa
    for sc in (0.9, 1.0, 1.1, 1.2):
        for rot in (-15, -8, 0, 8, 15):
            for dx in range(-int(0.45 * size), int(0.45 * size) + 1, 4):
                for dy in range(-int(0.45 * size), int(0.45 * size) + 1, 4):
                    s_ = score(dx, dy, sc, rot)
                    if s_ > best[0]:
                        best = (s_, (dx, dy, sc, rot))
    # fina
    dx0, dy0, sc0, rot0 = best[1]
    for _ in range(3):
        for sc in np.linspace(sc0 - 0.06, sc0 + 0.06, 5):
            for rot in np.linspace(rot0 - 5, rot0 + 5, 5):
                for dx in np.linspace(dx0 - 5, dx0 + 5, 6):
                    for dy in np.linspace(dy0 - 5, dy0 + 5, 6):
                        s_ = score(dx, dy, sc, rot)
                        if s_ > best[0]:
                            best = (s_, (dx, dy, sc, rot))
        dx0, dy0, sc0, rot0 = best[1]
    return best[1]


def apply_similarity(pts, centroid, dx, dy, sc, rot):
    a = np.deg2rad(rot)
    Rm = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    return ((pts - centroid) @ Rm.T) * sc + centroid + np.array([dx, dy])
