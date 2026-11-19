"""Refino da forma pela silhueta de perfil.

Os 105 pontos do MediaPipe dizem pouco sobre o nariz, os lábios e o queixo de perfil (profundidade). A borda do
rosto na foto de perfil, porém, é bem visível: a pessoa contra o fundo. Aqui, para cada linha da imagem entre as
sobrancelhas e o queixo, o vértice mais à frente da malha deve cair na borda da máscara da pessoa. Cada par vira uma
equação linear nos coeficientes de forma, resolvida junto com os pontos.

Só entram vistas de perfil (|giro| acima de ~50 graus) e correspondências plausíveis (descarta as que divergem muito,
por exemplo quando o recorte pega cabelo ou objeto no lugar do rosto).
"""

from __future__ import annotations

import cv2
import numpy as np

from . import fit

PROFILE_MIN_YAW = 50.0
SIGMA_SIL = 0.010  # confiança da borda (fração da altura do rosto), mais frouxa que os pontos
MAX_JUMP = 0.12  # diferença máxima aceita entre a borda da malha e a da máscara (fração da altura do rosto)
ROW_STEP_PX = 4


SKIN_TOL = 12.0  # tolerância de croma (Cr, Cb) em torno da mediana da pele; a parede/fundo é neutro e fica fora


def skin_mask(view, fl, V, mirror, masks):
    """Máscara de pele da foto, calibrada nos vértices do rosto que a câmera vê de frente.
    Serve para achar a borda do rosto de perfil (pele contra o fundo); o GrabCut inclui retângulos de fundo."""
    face = np.asarray(masks["face"], int)
    R = fit.rotmat(view.rot)
    pix = fit.project(V @ R.T, view.s, view.t, mirror) * view.H
    nz = (fit.vertex_normals(V, fl["faces"]) @ R.T)[:, 2]
    sel = face[nz[face] > 0.4]
    ycc = cv2.cvtColor(view.img, cv2.COLOR_BGR2YCrCb).astype(np.float32)
    h, w = view.img.shape[:2]
    ix = np.clip(pix[sel, 0], 0, w - 1).astype(int)
    iy = np.clip(pix[sel, 1], 0, h - 1).astype(int)
    med = np.median(ycc[iy, ix], axis=0)
    skin = (np.abs(ycc[..., 1] - med[1]) < SKIN_TOL) & (np.abs(ycc[..., 2] - med[2]) < SKIN_TOL) & (ycc[..., 0] > 30)
    skin = cv2.morphologyEx(skin.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    return cv2.morphologyEx(skin, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0


def _facing(pix, nose, head):
    """+1 se o rosto aponta para a direita da imagem, -1 se para a esquerda."""
    return 1.0 if pix[nose][:, 0].mean() > pix[head][:, 0].mean() else -1.0


def constraints_for_view(view, fl, beta, mirror, masks, mask):
    """Devolve (A, b, antes, depois_estimado) para uma vista de perfil, ou None se não houver correspondências boas.
    antes = erro médio de silhueta atual (fração da altura do rosto)."""
    V = fl["v0"] + np.einsum("vdk,k->vd", fl["sd"], beta)
    R = fit.rotmat(view.rot)
    pix = fit.project(V @ R.T, view.s, view.t, mirror) * view.H
    face = np.unique(np.concatenate([np.asarray(masks[k], int) for k in ("face", "nose", "lips")]))
    nose = np.asarray(masks["nose"], int)
    head = np.unique(fl["faces"].ravel())
    sgn = _facing(pix, nose, head)
    # faixa vertical do rosto: das sobrancelhas ao queixo
    brow_y = pix[np.asarray(masks["forehead"], int)][:, 1].max()  # base da testa na imagem
    chin_y = pix[face][:, 1].max()
    h, w = mask.shape
    A_rows, b_rows, errs = [], [], []
    SD, V0 = fl["sd"], fl["v0"]
    R0 = R[0]
    for y in np.arange(brow_y, chin_y, ROW_STEP_PX):
        near = face[np.abs(pix[face][:, 1] - y) < ROW_STEP_PX / 2 + 0.5]
        if len(near) == 0 or not (0 <= int(y) < h):
            continue
        i = near[np.argmax(pix[near][:, 0] * sgn)]  # vértice mais à frente (lado do rosto) nesta linha
        xm = pix[i, 0]
        row = mask[int(y)]
        lo, hi = int(max(xm - MAX_JUMP * view.H, 0)), int(min(xm + MAX_JUMP * view.H, w - 1))
        seg = np.nonzero(row[lo : hi + 1])[0]
        if len(seg) == 0:
            continue
        xt = lo + (seg.max() if sgn > 0 else seg.min())  # borda da pessoa do lado do rosto
        errs.append(abs(xt - xm) / view.H)
        if abs(xt - xm) > MAX_JUMP * view.H:
            continue
        a = mirror * view.s * (R0 @ SD[i])  # (K,)
        c = mirror * view.s * (R0 @ V0[i]) + view.t[0]
        A_rows.append(a / SIGMA_SIL)
        b_rows.append((xt / view.H - c) / SIGMA_SIL)
    if len(A_rows) < 8:
        return None
    return np.array(A_rows), np.array(b_rows), float(np.mean(errs))


def silhouette_error(view, fl, beta, mirror, masks, mask):
    out = constraints_for_view(view, fl, beta, mirror, masks, mask)
    return None if out is None else out[2]


def refine(views, fl, masks, beta, mirror, log=lambda *_: None, rounds=3):
    """Refina `beta` com a silhueta das vistas de perfil. Devolve (V, beta, info). Sem perfil utilizável, devolve igual."""
    profiles = [v for v in views if abs(v.rot[0]) >= PROFILE_MIN_YAW]
    if not profiles:
        return fl["v0"] + np.einsum("vdk,k->vd", fl["sd"], beta), beta, {"used": 0}
    cache = {}
    V_now = fl["v0"] + np.einsum("vdk,k->vd", fl["sd"], beta)
    for v in profiles:  # a máscara de pele não muda; as correspondências sim, a cada rodada
        cache[v.name] = skin_mask(v, fl, V_now, mirror, masks)
    before = {v.name: silhouette_error(v, fl, beta, mirror, masks, cache[v.name]) for v in profiles}
    for _ in range(rounds):
        extra = []
        for v in profiles:
            c = constraints_for_view(v, fl, beta, mirror, masks, cache[v.name])
            if c is not None:
                extra.append((c[0], c[1]))
        if not extra:
            break
        beta = fit.solve_shape(views, fl, mirror, extra=extra)
        for v in views:  # a pose de cada vista acompanha a nova forma
            x, e = fit.fit_view(v, fl, beta, mirror)
            v.rot, v.s, v.t, v.err = x[:3], float(np.exp(x[3])), x[4:6], e
    after = {v.name: silhouette_error(v, fl, beta, mirror, masks, cache[v.name]) for v in profiles}
    log(f"silhueta (erro médio, fração da altura do rosto): antes {before} depois {after}")
    V = fl["v0"] + np.einsum("vdk,k->vd", fl["sd"], beta)
    return V, beta, {"used": len(profiles), "before": before, "after": after}
