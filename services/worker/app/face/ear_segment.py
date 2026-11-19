"""Segmentação automática da orelha numa foto de perfil (sem detector de orelha treinado).

A malha da orelha do FLAME, já alinhada de forma aproximada, serve de semente:
  - miolo da malha (reduzido)        = orelha com certeza;
  - malha ampliada, mais para trás   = provavelmente orelha (a orelha real costuma ser maior que a do FLAME);
  - pixels bem escuros (cabelo)      = fundo com certeza;
  - mais perto do rosto que a borda da frente da malha = fundo (bochecha é pele e não dá para separar por cor).
GrabCut decide o resto. Depois, um ajuste afim leva a silhueta da malha até a máscara (IoU).
"""

from __future__ import annotations

import cv2
import numpy as np
from scipy.optimize import minimize


def segment_ear(img, outline, centroid, face_dir, size):
    """Devolve a máscara booleana da orelha (tamanho da imagem) e o retângulo da janela usada."""
    h, w = img.shape[:2]
    half = int(1.15 * size)
    x0, x1 = int(max(centroid[0] - half, 0)), int(min(centroid[0] + half, w))
    y0, y1 = int(max(centroid[1] - half, 0)), int(min(centroid[1] + half, h))
    crop = img[y0:y1, x0:x1]
    ch, cw = crop.shape[:2]
    off = np.array([x0, y0], np.float32)
    c = (centroid - off).astype(np.float32)
    fd = face_dir.astype(np.float32)
    perp = np.array([-fd[1], fd[0]], np.float32)

    rel = (outline - centroid).astype(np.float32)
    along, across = rel @ fd, rel @ perp

    def poly(front_k, back_k, side_k):
        a = np.where(along > 0, along * front_k, along * back_k)
        b = across * side_k
        pts = c + a[:, None] * fd[None, :] + b[:, None] * perp[None, :]
        return cv2.convexHull(pts.astype(np.int32))

    mask = np.full((ch, cw), cv2.GC_PR_BGD, np.uint8)
    cv2.fillConvexPoly(mask, poly(1.35, 1.55, 1.5), cv2.GC_PR_FGD)
    cv2.fillConvexPoly(mask, poly(0.55, 0.55, 0.55), cv2.GC_FGD)
    # a bochecha é pele: não deixa a orelha crescer para o lado do rosto além da borda da frente da malha
    yy, xx = np.mgrid[0:ch, 0:cw]
    d_front = (xx - c[0]) * fd[0] + (yy - c[1]) * fd[1]
    mask[d_front > along.max() + 0.17 * size] = cv2.GC_BGD
    # cabelo e sombra funda
    ycc = cv2.cvtColor(crop, cv2.COLOR_BGR2YCrCb)
    mask[(ycc[..., 0] < 36) & (mask != cv2.GC_FGD)] = cv2.GC_BGD
    try:
        cv2.setRNGSeed(0)  # resultado reproduzível
        cv2.grabCut(crop, mask, None, np.zeros((1, 65)), np.zeros((1, 65)), 6, cv2.GC_INIT_WITH_MASK)
    except cv2.error:
        pass
    fg = ((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(fg)
    if n > 1:
        # fica com o componente que contém o centro da orelha
        k = lab[int(np.clip(c[1], 0, ch - 1)), int(np.clip(c[0], 0, cw - 1))]
        if k == 0:
            k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        fg = (lab == k).astype(np.uint8)
    cnts, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    filled = np.zeros_like(fg)
    if cnts:
        cv2.drawContours(filled, [max(cnts, key=cv2.contourArea)], -1, 1, -1)
    full = np.zeros((h, w), bool)
    full[y0:y1, x0:x1] = filled > 0
    return full


def fit_affine_to_mask(outline, mask):
    """Afim 2D (A, t) que leva a silhueta (casco convexo dos pontos) para a máscara, maximizando o IoU."""
    ys, xs = np.nonzero(mask)
    if len(xs) < 50:
        return np.eye(2), np.zeros(2)
    mc = np.array([xs.mean(), ys.mean()])
    hull = cv2.convexHull(outline.astype(np.float32)).reshape(-1, 2)
    sc = hull.mean(0)
    x0, y0, bw, bh = cv2.boundingRect(np.stack([xs, ys], 1).astype(np.int32))
    pad = 40
    ox, oy = max(x0 - pad, 0), max(y0 - pad, 0)
    sub = mask[oy : y0 + bh + pad, ox : x0 + bw + pad].astype(np.uint8)

    def transform(p):
        a, b, c_, d, tx, ty = p
        A = np.array([[a, b], [c_, d]])
        return (hull - sc) @ A.T + sc + np.array([tx, ty])

    def neg_iou(p):
        poly = transform(p) - np.array([ox, oy])
        m = np.zeros_like(sub)
        cv2.fillPoly(m, [poly.astype(np.int32)], 1)
        inter = np.logical_and(m, sub).sum()
        union = np.logical_or(m, sub).sum()
        return -inter / max(union, 1)

    # início: momentos (centro e escala por eixo)
    shull = hull - sc
    cov_s = np.cov(shull.T)
    cov_m = np.cov(np.stack([xs, ys], 0))
    ws, vs = np.linalg.eigh(cov_s)
    wm, vm = np.linalg.eigh(cov_m)
    A0 = vm @ np.diag(np.sqrt(wm / np.maximum(ws, 1e-6))) @ vm.T @ np.eye(2)
    # A0 mapeia os eixos principais; mantém a orientação do mapa
    A0 = (vm @ np.diag(np.sqrt(wm)) @ vm.T) @ np.linalg.inv(vs @ np.diag(np.sqrt(ws)) @ vs.T)
    p0 = np.array([A0[0, 0], A0[0, 1], A0[1, 0], A0[1, 1], mc[0] - sc[0], mc[1] - sc[1]])
    best = minimize(neg_iou, p0, method="Nelder-Mead", options=dict(xatol=0.05, fatol=1e-4, maxiter=1500))
    p = best.x
    A = np.array([[p[0], p[1]], [p[2], p[3]]])
    t = np.array([p[4], p[5]])
    return A, t, sc, float(-best.fun)
