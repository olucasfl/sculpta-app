"""Textura do rosto ajustado (caminho B, CPU).

Uso de depuração: .venv/Scripts/python.exe -m app.face.texture [pasta .out/fit]

1. UV próprio, por canto de triângulo: cabeça cilíndrica; olhos e orelhas em ilhas separadas na faixa de baixo
   (as duas faces da orelha não se sobrepõem). Não usa a textura oficial do FLAME (não comercial).
2. Recorta a pessoa de cada foto (GrabCut), para o fundo não vazar para a cabeça.
3. Para cada pixel do mapa: posição 3D -> projeta em cada foto, testa oclusão (z-buffer da malha), corrige o brilho
   de cada vista por um mapa suave em relação ao consenso, e mistura as 2 melhores fotos.
4. Preenche buracos, exporta .glb (vértices originais mantêm o índice; duplicatas só são acrescentadas ao final).
Nada sai da máquina.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

from . import ear_align as ea
from . import ear_segment as es
from . import fit as fp

_verbose = True
# Etapas de acabamento que podem ser desligadas (ablação: medir quais ajudam a semelhança com a pessoa).
# Padrão: rosto fiel à foto (olhos amostrados da foto, pele com o relevo e as sombras originais); os olhos procedurais
# ficavam arregalados e a limpeza de pele (mesmo leve) suavizava barba e contraste (comparado com a foto frontal).
OPTS = {
    "clean_skin": False,
    "procedural_eyes": False,
    "neck": True,
    "legacy_face": False,
    "side_smooth": True,
    "calibrated_eyes": True,
}


def log(*args):
    if _verbose:
        print(*args)


TEX = 2048
HEAD_V = 0.85  # fração de cima do mapa para a cabeça; a faixa de baixo é de olhos e orelhas
STRIP_V0, STRIP_VH = 0.87, 0.12
ISLANDS = {"left_eyeball": 0.02, "right_eyeball": 0.26, "left_ear": 0.52, "right_ear": 0.78}
ISLAND_W = 0.20


def sample(img, px, py):
    """remap em blocos (o OpenCV limita as dimensões do mapa)."""
    n = len(px)
    w = 1024
    rows = -(-n // w)
    mx = np.zeros(rows * w, np.float32)
    my = np.zeros(rows * w, np.float32)
    mx[:n] = px
    my[:n] = py
    out = cv2.remap(img, mx.reshape(rows, w), my.reshape(rows, w), cv2.INTER_LINEAR)
    return out.reshape(-1, out.shape[-1] if out.ndim == 3 else 1)[:n]


def rasterize(T, Dz, tri_map, w, h):
    """Rasteriza triângulos (M,3,2) em pixels com z-buffer (maior = mais perto). Devolve id, bary, z."""
    tri_id = np.full((h, w), -1, np.int32)
    z = np.full((h, w), -np.inf, np.float32)
    bary = np.zeros((h, w, 3), np.float32)
    for m in range(len(T)):
        a, b, c = T[m]
        minx = max(int(np.floor(min(a[0], b[0], c[0]))), 0)
        maxx = min(int(np.ceil(max(a[0], b[0], c[0]))), w - 1)
        miny = max(int(np.floor(min(a[1], b[1], c[1]))), 0)
        maxy = min(int(np.ceil(max(a[1], b[1], c[1]))), h - 1)
        if minx > maxx or miny > maxy:
            continue
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-9:
            continue
        xs, ys = np.meshgrid(np.arange(minx, maxx + 1) + 0.5, np.arange(miny, maxy + 1) + 0.5)
        l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
        l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        l3 = 1 - l1 - l2
        inside = (l1 >= -1e-3) & (l2 >= -1e-3) & (l3 >= -1e-3)
        if not inside.any():
            continue
        zz = l1 * Dz[m][0] + l2 * Dz[m][1] + l3 * Dz[m][2]
        sz = z[miny : maxy + 1, minx : maxx + 1]
        upd = inside & (zz > sz)
        if not upd.any():
            continue
        sz[upd] = zz[upd]
        tri_id[miny : maxy + 1, minx : maxx + 1][upd] = tri_map[m]
        bary[miny : maxy + 1, minx : maxx + 1][upd] = np.stack([l1, l2, l3], -1)[upd]
    return tri_id, bary, z


# ---------------------------------------------------------------- UV por canto de triângulo
def build_mesh(V, N, F, masks):
    """Malha expandida (Vx, Nx, Ux, Fx, depth): os vértices originais mantêm o índice; duplicatas vão ao final."""
    head = np.unique(F.ravel())
    cz = float(V[head][:, 2].mean())
    ang = np.arctan2(V[:, 0], V[:, 2] - cz)
    ymin, ymax = V[:, 1].min(), V[:, 1].max()
    cyl = np.stack([ang / (2 * np.pi) + 0.5, HEAD_V * (1 - (V[:, 1] - ymin) / (ymax - ymin))], 1)
    cyl_depth = np.hypot(V[:, 0], V[:, 2] - cz)

    sets, uv_isl, dep_isl = {}, {}, {}
    for key, u0 in ISLANDS.items():
        idx = np.asarray(masks[key], dtype=int)
        sets[key] = set(idx.tolist())
        P = V[idx]
        if "eye" in key:
            ax, ay = 0, 1  # olho: plano frontal (x,y); a frente (z maior) vence
            depth = P[:, 2]
        else:
            ax, ay = 2, 1  # orelha: plano lateral (z,y); o lado de fora (|x| maior) vence
            depth = np.abs(P[:, 0])
        span_a, span_y = np.ptp(P[:, ax]), np.ptp(P[:, ay])
        sc = min(ISLAND_W / max(span_a, 1e-9), STRIP_VH / max(span_y, 1e-9)) * 0.95
        ua = (P[:, ax] - P[:, ax].min()) * sc
        if key == "right_ear":
            ua = span_a * sc - ua
        vv = STRIP_V0 + STRIP_VH - (P[:, ay] - P[:, ay].min()) * sc
        uv_isl[key] = dict(zip(idx.tolist(), zip(u0 + ua, vv)))
        dep_isl[key] = dict(zip(idx.tolist(), depth))

    eyes = sets["left_eyeball"] | sets["right_eyeball"]
    verts, nrm, uvs, depth_l = list(V), list(N), [tuple(c) for c in cyl], list(cyl_depth)
    src = list(range(len(V)))  # vértice original de cada vértice da malha expandida
    for key in ("left_eyeball", "right_eyeball"):  # malhas separadas: o vértice original usa a ilha do olho
        for i, (u, v) in uv_isl[key].items():
            uvs[i] = (u, v)
            depth_l[i] = dep_isl[key][i]
    dup: dict[tuple, int] = {}
    Fx = F.copy()
    for ti, f in enumerate(F):
        key = next((k for k in ("left_ear", "right_ear") if all(int(i) in sets[k] for i in f)), None)
        cu = cyl[f][:, 0]
        seam = key is None and (cu.max() - cu.min() > 0.5)
        for k in range(3):
            j = int(f[k])
            if j in eyes:
                continue
            if key is not None:
                (u, v), d = uv_isl[key][j], dep_isl[key][j]
            elif seam and cyl[j, 0] < 0.5:
                u, v, d = cyl[j, 0] + 1.0, cyl[j, 1], cyl_depth[j]
            else:
                continue
            kk = (j, round(float(u), 5), round(float(v), 5))
            if kk not in dup:
                dup[kk] = len(verts)
                verts.append(V[j])
                nrm.append(N[j])
                uvs.append((u, v))
                depth_l.append(d)
                src.append(j)
            Fx[ti, k] = dup[kk]
    return (
        np.array(verts, np.float32),
        np.array(nrm, np.float32),
        np.array(uvs, np.float64),
        Fx.astype(np.int64),
        np.array(depth_l),
        np.array(src, np.int64),
    )


def uv_triangles(Ux, Dx, Fx, tex):
    T, Dz, tri_map = [], [], []
    for ti, f in enumerate(Fx):
        c = Ux[f]
        variants = [c]
        if c[:, 0].max() > 1.0:
            variants.append(c - np.array([1.0, 0.0]))
        for cv in variants:
            T.append(cv * tex)
            Dz.append(Dx[f])
            tri_map.append(ti)
    return np.array(T), np.array(Dz), np.array(tri_map)


# ---------------------------------------------------------------- recorte da pessoa
def person_mask(img, face_px, head_px):
    """GrabCut com sementes: rosto = pessoa certa, silhueta da cabeça = provável, bordas = fundo certo."""
    h, w = img.shape[:2]
    scale = 480 / max(h, w)
    small = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    sh, sw = small.shape[:2]
    m = np.full((sh, sw), cv2.GC_PR_BGD, np.uint8)
    hp = (head_px * scale).astype(np.int32)
    fpx = (face_px * scale).astype(np.int32)
    big = np.zeros((sh, sw), np.uint8)
    cv2.fillConvexPoly(big, cv2.convexHull(hp), 255)
    k = int(0.06 * sw) | 1
    big = cv2.dilate(big, np.ones((k, k), np.uint8))
    m[big > 0] = cv2.GC_PR_FGD
    cv2.fillConvexPoly(m, cv2.convexHull(fpx), cv2.GC_FGD)
    b = max(2, int(0.03 * sw))
    m[:, :b] = cv2.GC_BGD
    m[:, -b:] = cv2.GC_BGD
    m[:b, :] = cv2.GC_BGD
    try:
        cv2.setRNGSeed(
            0
        )  # o GrabCut sorteia a inicialização: sem a semente, o recorte (e a textura) mudava a cada execução
        cv2.grabCut(small, m, None, np.zeros((1, 65)), np.zeros((1, 65)), 4, cv2.GC_INIT_WITH_MASK)
    except cv2.error:
        pass
    fg = ((m == cv2.GC_FGD) | (m == cv2.GC_PR_FGD)).astype(np.uint8) * 255
    # parede e fundo claros e neutros nunca são a pessoa (o GrabCut às vezes inclui pedaços de parede)
    ycc = cv2.cvtColor(small, cv2.COLOR_BGR2YCrCb)
    wall = (
        (ycc[..., 0] > 165) & (np.abs(ycc[..., 1].astype(int) - 128) < 9) & (np.abs(ycc[..., 2].astype(int) - 128) < 9)
    )
    fg[wall] = 0
    fg = cv2.erode(fg, np.ones((5, 5), np.uint8))
    return cv2.resize(fg, (w, h), interpolation=cv2.INTER_NEAREST) > 0


def smooth_ratio(base_num, base_den, view_num, view_den, ys, xs):
    """Mapa suave (consenso / vista) em baixa resolução, amostrado nos pixels (ys, xs) do mapa."""
    r, sig = 256, 14

    def blur(a):
        return cv2.GaussianBlur(cv2.resize(a, (r, r), interpolation=cv2.INTER_AREA), (0, 0), sig)

    bn, bd, vn, vd = blur(base_num), blur(base_den), blur(view_num), blur(view_den)
    ok = (bd > 1e-4) & (vd > 1e-4)
    base = bn / np.maximum(bd[..., None], 1e-6)
    view = vn / np.maximum(vd[..., None], 1e-6)
    ratio = np.where(ok[..., None], base / np.maximum(view, 1.0), 1.0)
    ratio = np.clip(ratio, 0.8, 1.25).astype(np.float32)
    return cv2.resize(ratio, (TEX, TEX), interpolation=cv2.INTER_LINEAR)[ys, xs]


def fit_sphere(P):
    """Esfera por mínimos quadrados (centro e raio) numa nuvem de pontos."""
    A = np.c_[2 * P, np.ones(len(P))]
    b = (P**2).sum(1)
    sol = np.linalg.lstsq(A, b, rcond=None)[0]
    c = sol[:3]
    return c, float(np.sqrt(max(sol[3] + c @ c, 1e-12)))


def iris_color_from_photo(fv, c, R, mirror):
    """Cor da íris: mediana dos pixels do miolo da íris na foto frontal, sem a pupila escura nem o reflexo claro."""
    center3 = c + np.array([0.0, 0.0, R])
    px = fp.project((center3 @ fv["R"].T)[None, :], fv["s"], fv["t"], mirror)[0] * fv["H"]
    rad = max(3.0, fv["s"] * fv["H"] * 0.0034)
    img = fv["img"]
    h, w = img.shape[:2]
    x0, x1 = int(max(px[0] - rad, 0)), int(min(px[0] + rad, w - 1))
    y0, y1 = int(max(px[1] - rad, 0)), int(min(px[1] + rad, h - 1))
    patch = img[y0 : y1 + 1, x0 : x1 + 1].reshape(-1, 3).astype(np.float32)
    if len(patch) < 30:
        return np.array([45.0, 75.0, 110.0], np.float32)
    lum = patch @ np.array([0.114, 0.587, 0.299], np.float32)
    keep = (lum > 35) & (lum < 175)
    if keep.sum() < 20:
        return np.array([45.0, 75.0, 110.0], np.float32)
    col = np.median(patch[keep], axis=0)
    return np.clip(col, 25, 200).astype(np.float32)


def procedural_eye(P, c, R, iris_bgr):
    """Textura do globo ocular por posição na esfera: olhando para +z, íris de 5,9 mm de raio, esclera, veias e sombra."""
    d = (P - c) / max(R, 1e-6)
    theta = np.arccos(np.clip(d[:, 2], -1, 1))
    phi = np.arctan2(d[:, 1], d[:, 0])
    th_i = np.arcsin(min(0.95, 0.0059 / max(R, 1e-6)))
    t = theta / th_i

    def sstep(a, b, x):
        u = np.clip((x - a) / (b - a), 0, 1)
        return u * u * (3 - 2 * u)

    sclera = np.array([226, 231, 237], np.float32)  # BGR: branco levemente quente
    vein = np.clip(np.sin(23 * phi + 7 * np.sin(5 * phi + 3 * t)), 0, 1) * sstep(1.25, 2.1, t)
    sc = sclera[None, :] * (1 - 0.07 * vein[:, None] * np.array([0.3, 0.6, 1.0])[None, :])
    sc *= (1 - 0.30 * sstep(1.6, 3.1, t))[:, None]  # sombra nos cantos
    fiber = 0.5 + 0.5 * np.sin(54 * phi + 3.2 * np.sin(11 * phi + 5 * t))
    ir = iris_bgr[None, :] * (0.60 + 0.75 * fiber * (1 - 0.35 * t))[:, None]
    ir *= (1 + 0.20 * np.exp(-(((t - 0.46) / 0.10) ** 2)))[:, None]  # colarete
    ir *= (1 - 0.60 * sstep(0.78, 0.97, t))[:, None]  # anel límbico escuro
    ir *= sstep(0.30, 0.42, t)[:, None]  # pupila
    mix = sstep(0.98, 1.07, t)[:, None]
    return np.clip(ir * (1 - mix) + sc * mix, 0, 255).astype(np.uint8)


def clean_skin(tex, skin, highlight=0.5, flatten=0.0):
    """Pele limpa: chroma suavizado (preserva lábios por ser bilateral), realces comprimidos e luz de baixa frequência achatada."""
    ycc = cv2.cvtColor(tex, cv2.COLOR_BGR2YCrCb).astype(np.float32)
    Y, Cr, Cb = cv2.split(ycc)
    m = skin.astype(np.float32)

    def nconv(a, sg):
        return cv2.GaussianBlur(a * m, (0, 0), sg) / np.maximum(cv2.GaussianBlur(m, (0, 0), sg), 1e-3)

    for ch in (Cr, Cb):
        f = cv2.bilateralFilter(ch, 15, 10, 18)
        ch[skin] = f[skin]
    Yb, Yl = nconv(Y, 18), nconv(Y, 60)
    Yn = Y - highlight * np.maximum(0, Y - Yb * 1.08)  # só comprime realces de brilho
    if flatten:  # achatar a luz de baixa frequência tira as sombras do rosto: desligado por padrão
        Yn = Yn - flatten * (Yl - float(Yl[skin].mean()))
    Y[skin] = np.clip(Yn[skin], 0, 255)
    out = cv2.cvtColor(cv2.merge([Y, Cr, Cb]).clip(0, 255).astype(np.uint8), cv2.COLOR_YCrCb2BGR)
    soft = cv2.GaussianBlur(skin.astype(np.float32), (0, 0), 8)[..., None]
    return np.clip(tex * (1 - soft) + out.astype(np.float32) * soft, 0, 255).astype(np.uint8)


FACE_MASKS = (
    "face",
    "forehead",
    "nose",
    "lips",
    "eye_region",
    "left_eye_region",
    "right_eye_region",
    "left_eyeball",
    "right_eyeball",
)


def face_weight_map(tid, Fx, src, masks, ys, xs, shape, sigma=6):
    """Mapa (0-1) de onde fica o rosto no mapa de textura: triângulos cujos 3 cantos estão nas máscaras do rosto."""
    orig = np.zeros(int(Fx.max()) + 1, bool)
    for k in FACE_MASKS:
        orig[np.asarray(masks[k], int)] = True
    tri_in = orig[src[Fx]].all(axis=1)
    fw = np.zeros(shape, np.float32)
    fw[ys, xs] = tri_in[tid[ys, xs]].astype(np.float32)
    return cv2.GaussianBlur(fw, (0, 0), sigma)


def apply_legacy_face(tex, have, samples, weights, views, valid, tid, Fx, src, masks, ys, xs):
    """Rosto igual à primeira versão com textura das fotos (a que ficou parecida com a pessoa):
    cada ponto usa as 2 melhores fotos (peso nz^6, sem recorte da pessoa) com um ganho de brilho global por vista.
    Vale só dentro do rosto (testa, olhos, nariz, lábios, bochechas), com borda suave; o resto do mapa
    (pescoço, cabelo, orelhas, fundo) segue com as melhorias novas."""
    W = np.stack(weights, 1)
    ref = next(i for i, v in enumerate(views) if v["name"] == "FRONT")
    gains = []
    for i in range(len(views)):
        both = (W[:, ref] > 0.15) & (W[:, i] > 0.15)
        if i == ref or both.sum() < 500:
            gains.append(np.ones(3, np.float32))
            continue
        g = np.median(samples[ref][both], axis=0) / np.maximum(np.median(samples[i][both], axis=0), 1.0)
        gains.append(np.clip(g, 0.7, 1.45).astype(np.float32))
    keep = np.argsort(-W, axis=1)[:, :2]
    top2 = np.zeros_like(W, bool)
    np.put_along_axis(top2, keep, True, axis=1)
    # Cada pixel usa as cores de cada foto SEM borrar (o detalhe é o da foto); só os PESOS são suavizados no mapa,
    # para a cor passar de uma foto à outra sem degrau (as faixas de tom nas bochechas e na testa).
    acc2 = np.zeros(have.shape + (3,), np.float32)
    den2 = np.zeros(have.shape, np.float32)
    for i in range(len(views)):
        wi = np.where(top2[:, i], W[:, i], 0).astype(np.float32)
        col2d = np.zeros(have.shape + (3,), np.float32)
        w2d = np.zeros(have.shape, np.float32)
        col2d[ys, xs] = samples[i] * gains[i]
        w2d[ys, xs] = wi
        w2d = cv2.GaussianBlur(w2d, (0, 0), 7)
        acc2 += col2d * w2d[..., None]
        den2 += w2d
    legacy = np.zeros_like(tex)
    have_l = valid & (den2 > 0.02)
    legacy[have_l] = np.clip(acc2[have_l] / den2[have_l][:, None], 0, 255).astype(np.uint8)

    # região do rosto no mapa: triângulos cujos 3 cantos estão nas máscaras do rosto
    fw = face_weight_map(tid, Fx, src, masks, ys, xs, have.shape)
    use = (fw > 0.001) & have_l
    wmix = np.where(use, fw, 0.0)[..., None]
    out = np.clip(tex.astype(np.float32) * (1 - wmix) + legacy.astype(np.float32) * wmix, 0, 255).astype(np.uint8)
    new_have = have.copy()
    new_have[use & (fw > 0.5)] = 255
    log(f"  rosto como na primeira versão com textura: {int((fw > 0.5).sum() / max(valid.sum(), 1) * 100)}% do mapa")
    return out, new_have


def deform_ears(V, F, masks, views, mirror):
    """Leva cada orelha 3D até a orelha real: segmenta a orelha na foto de perfil e deforma os vértices (afim no plano da imagem).
    Devolve V novo e, por orelha, o índice da vista usada."""
    V = V.copy()
    names = [v["name"] for v in views]
    yaws = np.array([v["rot"][0] for v in views])
    nose = np.asarray(masks["nose"], int)
    used = {}
    fallback: set[str] = set()
    for key, pick in (
        ("left_ear", np.argmin),
        ("right_ear", np.argmax),
    ):  # esquerda do rosto aparece quando ele vira à direita
        i = int(pick(yaws))
        img = views[i]["img"]
        R, s_, t_, H_ = views[i]["R"], views[i]["s"], views[i]["t"], views[i]["H"]
        cam = V @ R.T
        pix = fp.project(cam, s_, t_, mirror) * H_
        e = np.asarray(masks[key], int)
        cen = pix[e].mean(0)
        fdir = pix[nose].mean(0) - cen
        fdir /= np.linalg.norm(fdir) + 1e-9
        size = float(np.ptp(pix[e], axis=0).max())
        outline = ea.outline_points(F, e, pix)
        dx, dy, scl, rot = ea.align_ear(img, outline, cen, fdir, size)
        out_a = ea.apply_similarity(outline, cen, dx, dy, scl, rot)
        mask = es.segment_ear(img, out_a, cen + np.array([dx, dy]), fdir, size)
        A, tt, sc0, iou = es.fit_affine_to_mask(out_a, mask)
        hull_area = cv2.contourArea(cv2.convexHull(out_a.astype(np.float32)))
        ratio = mask.sum() / max(hull_area, 1.0)
        shift = float(np.hypot(dx, dy)) / max(size, 1.0)
        log(f"  orelha {key}: vista {names[i]}, IoU {iou:.2f}, máscara/malha {ratio:.2f}x, deslocamento {shift:.2f}x")
        # Trava de plausibilidade: o alinhamento não pode sair do lugar da orelha (numa pessoa real escorregou 0,5x para o
        # pescoço e a marcação pegou orelha mais pescoço, 3,5x a área) e a marcação tem que ser do tamanho de uma orelha.
        # Se não fizer sentido, a orelha NÃO é deformada nem recebe cor da foto: fica de tom de pele liso (nunca "quebrada").
        if shift > 0.35 or iou < 0.75 or not 0.6 < ratio < 2.4:
            log("    orelha duvidosa: mantém a orelha do modelo, com tom de pele liso")
            fallback.add(key)
            used[key] = i
            continue
        p1 = ea.apply_similarity(pix[e], cen, dx, dy, scl, rot)
        p1 = (p1 - sc0) @ A.T + sc0 + tt
        x = (p1[:, 0] / H_ - t_[0]) / (mirror * s_)
        y = -(p1[:, 1] / H_ - t_[1]) / s_
        newcam = cam[e].copy()
        newcam[:, 0], newcam[:, 1] = x, y
        V[e] = newcam @ R
        used[key] = i
    return V, used, fallback


def load_masks():
    with open(fp.FLAME_DIR / "FLAME_masks.pkl", "rb") as f:
        return fp._Unpickler(f, encoding="latin1").load()


# Contorno da abertura do olho e íris no MediaPipe (esquerdo = esquerdo da pessoa, que fica à direita da imagem).
LEFT_EYE_RING = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466]
RIGHT_EYE_RING = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
LEFT_IRIS, RIGHT_IRIS = (473, [474, 475, 476, 477]), (468, [469, 470, 471, 472])


def _sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def calibrated_eyes(tex, have, fv, Pv, ys, xs, mirror):
    """Olhos desenhados DENTRO da abertura real do olho na foto frontal (contorno e íris do MediaPipe): esclera e íris
    limpas, com a cor da pessoa e o tamanho e a posição da íris da foto; fora da abertura fica a pele da pálpebra, também
    da foto. Assim o olhar fica entreaberto como o da pessoa, sem o olho arregalado dos olhos procedurais e sem a sombra
    de pálpebra pintada sobre o globo dos olhos amostrados direto da foto."""
    lm, img = fv.get("lm"), fv["img"]
    if lm is None or len(lm) < 478:
        return tex, have
    h, w = img.shape[:2]
    lum = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    eye_px = (ys >= HEAD_V * TEX) & (xs < 0.5 * TEX)
    for side, ring_idx, (ci, iris_idx) in (
        (xs < 0.24 * TEX, LEFT_EYE_RING, LEFT_IRIS),
        (xs >= 0.24 * TEX, RIGHT_EYE_RING, RIGHT_IRIS),
    ):
        sel = eye_px & side
        if not sel.any():
            continue
        ring = lm[ring_idx].astype(np.float32)
        mid = ring.mean(axis=0)
        ring = mid + (ring - mid) * np.array(
            [0.97, 0.85], np.float32
        )  # as pálpebras cobrem um pouco mais que o contorno
        c = lm[ci].astype(np.float32)
        r = float(np.mean(np.linalg.norm(lm[iris_idx] - c, axis=1)))
        opening = np.zeros((h, w), np.uint8)
        cv2.fillPoly(opening, [ring.astype(np.int32)], 255)
        sd = cv2.distanceTransform(opening, cv2.DIST_L2, 3) - cv2.distanceTransform(255 - opening, cv2.DIST_L2, 3)
        yy, xx = np.mgrid[0:h, 0:w]
        dist = np.hypot(xx - c[0], yy - c[1])
        # cores da pessoa: íris = miolo do disco sem a pupila escura nem o reflexo; esclera = parte clara da abertura
        disc = (dist < 0.6 * r) & (dist > 0.28 * r) & (lum > 20)
        if disc.sum() > 20:
            # a íris na foto mistura reflexo da janela e esclera nas bordas (tudo acinzentado): vale o miolo mais escuro,
            # a cor própria da íris sob a pálpebra
            lim = np.percentile(lum[disc], 55)
            iris = np.median(img[disc & (lum <= lim)], axis=0)
        else:
            iris = np.array([45.0, 70.0, 100.0])
        bright = (sd > 1) & (dist > 1.15 * r)
        if bright.sum() > 15:
            cut = np.percentile(lum[bright], 60)
            sclera = np.median(img[bright & (lum >= cut)], axis=0)
            sclera = (
                np.maximum(sclera, 120.0) * 0.92
            )  # a esclera na foto fica na sombra das pálpebras: não é branca pura
        else:
            sclera = np.array([224.0, 229.0, 235.0])
        pp = fp.project(Pv[sel] @ fv["R"].T, fv["s"], fv["t"], mirror) * fv["H"]
        ix = np.clip(pp[:, 0], 0, w - 1.001).astype(np.float32)
        iy = np.clip(pp[:, 1], 0, h - 1.001).astype(np.float32)
        photo = sample(img, ix, iy).astype(np.float32)
        sdv = sample(sd.astype(np.float32), ix, iy).astype(np.float32).reshape(-1)
        d = np.hypot(pp[:, 0] - c[0], pp[:, 1] - c[1]) / max(r, 1e-6)
        phi = np.arctan2(pp[:, 1] - c[1], pp[:, 0] - c[0])
        fiber = 0.5 + 0.5 * np.sin(52 * phi + 3.0 * np.sin(11 * phi + 5 * d))
        iris_col = 0.68 * iris[None, :] * (0.62 + 0.7 * fiber * (1 - 0.3 * d))[:, None]
        iris_col *= (1 + 0.18 * np.exp(-(((d - 0.46) / 0.1) ** 2)))[:, None]  # colarete
        iris_col *= (1 - 0.55 * _sstep(0.78, 0.97, d))[:, None]  # anel límbico escuro
        iris_col *= _sstep(0.32, 0.46, d)[:, None]  # pupila
        scl = sclera[None, :] * (1 - 0.22 * _sstep(1.1, 2.6, d))[:, None]
        proc = iris_col * (1 - _sstep(0.97, 1.06, d))[:, None] + scl * _sstep(0.97, 1.06, d)[:, None]
        proc *= (0.5 + 0.5 * _sstep(0.0, 0.4 * r, sdv))[:, None]  # sombra da pálpebra superior e inferior
        glint = np.exp(-((np.hypot(pp[:, 0] - (c[0] - 0.32 * r), pp[:, 1] - (c[1] - 0.34 * r)) / (0.13 * r)) ** 2))
        proc = proc * (1 - 0.85 * glint)[:, None] + np.array([238.0, 238.0, 242.0])[None, :] * (0.85 * glint)[:, None]
        alpha = _sstep(-1.5, 1.5, sdv)[:, None]
        out = alpha * proc + (1 - alpha) * photo
        tex[ys[sel], xs[sel]] = np.clip(out, 0, 255).astype(np.uint8)
        have[ys[sel], xs[sel]] = 255
    return tex, have


def views_from_fit(fit_views):
    """Vistas do ajuste (fit.View) -> dicionários usados pela textura."""
    return [
        dict(
            name=v.name,
            img=v.img,
            lm=v.landmarks,
            rot=np.asarray(v.rot, float),
            R=fp.rotmat(v.rot),
            s=float(v.s),
            t=np.asarray(v.t),
            H=float(v.H),
        )
        for v in fit_views
    ]


def bake(V, views, F, masks, mirror, out_dir=None):
    """Textura e malha final. Devolve dict(tex, Vx, Nx, Ux, Fx, V, ear_view). `out_dir` só liga arquivos de depuração."""
    V, ear_view, ear_fallback = deform_ears(V, F, masks, views, mirror)
    N = fp.vertex_normals(V, F)

    Vx, Nx, Ux, Fx, Dx, src = build_mesh(V, N, F, masks)
    log(f"malha expandida: {len(V)} -> {len(Vx)} vértices")
    log("rasterizando o mapa de textura...")
    T, Dz, tri_map = uv_triangles(Ux, Dx, Fx, TEX)
    tid, bary, _ = rasterize(T, Dz, tri_map, TEX, TEX)
    valid = tid >= 0
    tri = Fx[np.where(valid, tid, 0)]
    P = np.einsum("hwc,hwcd->hwd", bary, Vx[tri])
    Nn = np.einsum("hwc,hwcd->hwd", bary, Nx[tri])
    Nn /= np.linalg.norm(Nn, axis=-1, keepdims=True) + 1e-9
    log(f"  cobertura do mapa: {valid.mean() * 100:.1f}% dos pixels")
    ys, xs = np.nonzero(valid)
    Pv, Nv = P[valid], Nn[valid]

    face_idx = np.asarray(masks["face"], int)
    head_idx = np.unique(F.ravel())

    samples, weights, weights_legacy = [], [], []
    for v in views:
        h, w = v["img"].shape[:2]
        pc = V @ v["R"].T
        pix_v = fp.project(pc, v["s"], v["t"], mirror) * v["H"]
        mask = person_mask(v["img"], pix_v[face_idx], pix_v[head_idx])
        _, _, zbuf = rasterize(pix_v[F], pc[F][:, :, 2], np.arange(len(F)), w, h)
        pt = Pv @ v["R"].T
        pp = fp.project(pt, v["s"], v["t"], mirror) * v["H"]
        nz = (Nv @ v["R"].T)[:, 2]
        ix = np.clip(pp[:, 0], 0, w - 1).astype(int)
        iy = np.clip(pp[:, 1], 0, h - 1).astype(int)
        inside = (pp[:, 0] > 2) & (pp[:, 0] < w - 3) & (pp[:, 1] > 2) & (pp[:, 1] < h - 3)
        visible = pt[:, 2] >= zbuf[iy, ix] - 0.006
        person = mask[iy, ix]
        col = sample(v["img"], np.clip(pp[:, 0], 0, w - 1.001), np.clip(pp[:, 1], 0, h - 1.001)).astype(np.float32)
        wgt = np.clip(nz, 0, 1) ** 3 * inside * visible * person
        samples.append(col)
        weights.append(wgt.astype(np.float32))
        weights_legacy.append((np.clip(nz, 0, 1) ** 6 * inside * visible).astype(np.float32))
        if out_dir is not None:
            cv2.imwrite(str(out_dir / f"mascara_{v['name']}.png"), mask.astype(np.uint8) * 255)
        log(
            f"  {v['name']:10s} cobre {np.mean(wgt > 0.1) * 100:4.1f}% do mapa  (pessoa em {person[inside].mean() * 100:4.1f}% das amostras)"
        )

    # ---- mistura em duas bandas (ideia de multiband/Laplacian blending):
    #   baixa frequência (cor e luz) = média suave de TODAS as fotos que veem o ponto -> sem manchas nem emendas;
    #   alta frequência (detalhe) = só das 2 melhores fotos -> sem "fantasmas" por desalinhamento.
    W = np.stack(weights, 1)
    keep2 = np.argsort(-W, axis=1)[:, :2]
    sharp = np.zeros_like(W, bool)
    np.put_along_axis(sharp, keep2, True, axis=1)
    broad = W > 0.0
    # orelhas: UMA foto só (a que vê melhor). Misturar fotos desenha o contorno duas vezes, porque a orelha do FLAME não é a sua.
    ear_px = (ys >= HEAD_V * TEX) & (xs >= 0.5 * TEX)
    ear_best = {}
    for name, side in (("esquerda", xs < 0.76 * TEX), ("direita", xs >= 0.76 * TEX)):
        sel = ear_px & side
        if not sel.any():
            continue
        best_view = ear_view["left_ear" if name == "esquerda" else "right_ear"]
        W[sel, best_view] = np.maximum(
            W[sel, best_view], 0.6
        )  # sem teste de oclusão: a concha fica atrás da hélice na foto
        for m in (sharp, broad):
            m[sel] = False
            m[sel, best_view] = True
        ear_best[name] = (best_view, sel)
        log(f"  orelha {name} usa só a foto {views[best_view]['name']}")

    LOW_SIGMA, FEATHER = 22, 18

    def blur(a, sg):
        return cv2.GaussianBlur(a, (0, 0), sg)

    acc_low = np.zeros((TEX, TEX, 3), np.float32)
    den_low = np.zeros((TEX, TEX), np.float32)
    acc_high = np.zeros((TEX, TEX, 3), np.float32)
    den_high = np.zeros((TEX, TEX), np.float32)
    for i in range(len(views)):
        col2d = np.zeros((TEX, TEX, 3), np.float32)
        support = np.zeros((TEX, TEX), np.float32)
        col2d[ys, xs] = samples[i]
        support[ys, xs] = (W[:, i] > 0.02).astype(np.float32)
        low = blur(col2d * support[..., None], LOW_SIGMA) / np.maximum(blur(support, LOW_SIGMA), 1e-3)[..., None]
        high = (col2d - low) * support[..., None]
        wl = np.zeros((TEX, TEX), np.float32)
        wh = np.zeros((TEX, TEX), np.float32)
        wl[ys, xs] = np.where(broad[:, i], W[:, i], 0)
        wh[ys, xs] = np.where(sharp[:, i], W[:, i], 0)
        wl = blur(wl, FEATHER)  # transição suave entre fotos
        acc_low += low * wl[..., None]
        den_low += wl
        acc_high += high * wh[..., None]
        den_high += wh
        del col2d, support, low, high
    low_t = acc_low / np.maximum(den_low, 1e-4)[..., None]
    high_t = acc_high / np.maximum(den_high, 1e-4)[..., None]
    mixed_tex = np.clip(low_t + np.where(den_high[..., None] > 0.02, high_t, 0), 0, 255)
    del acc_low, acc_high
    tex = np.zeros((TEX, TEX, 3), np.uint8)
    covered = valid & (den_low > 0.02)
    tex[covered] = mixed_tex[covered].astype(np.uint8)
    have = np.zeros((TEX, TEX), np.uint8)
    have[covered] = 255
    del low_t, high_t, mixed_tex
    log(f"  pixels com foto: {(have > 0).sum() / valid.sum() * 100:.1f}% do mapa válido")

    if OPTS["legacy_face"]:
        tex, have = apply_legacy_face(tex, have, samples, weights_legacy, views, valid, tid, Fx, src, masks, ys, xs)

    # ---- topo/fundo da cabeça e pescoço: a geometria ou as fotos não cobrem; usa cores reais, sem inventar detalhe
    Y2 = np.full((TEX, TEX), np.nan, np.float32)
    Y2[ys, xs] = Pv[:, 1]
    row = np.arange(TEX)[:, None] * np.ones((1, TEX))
    in_head_map = row < HEAD_V * TEX  # só a cabeça cilíndrica (não olhos/orelhas)
    eye_idx = np.concatenate([np.asarray(masks["left_eyeball"], int), np.asarray(masks["right_eyeball"], int)])
    y_eye = float(V[eye_idx][:, 1].mean())
    y_chin = float(V[face_idx][:, 1].min())
    rng = np.random.default_rng(0)
    noise = cv2.GaussianBlur(rng.normal(0, 1, (TEX, TEX)).astype(np.float32), (0, 0), 10)
    noise /= noise.std() + 1e-6

    X2 = np.full((TEX, TEX), np.nan, np.float32)
    Z2 = np.full((TEX, TEX), np.nan, np.float32)
    X2[ys, xs] = Pv[:, 0]
    Z2[ys, xs] = Pv[:, 2]
    cz_head = float(V[head_idx][:, 2].mean())
    skin_zone = (
        valid
        & (have > 0)
        & in_head_map
        & (Y2 >= y_chin)
        & (Y2 <= y_eye + 0.075)
        & (Z2 > cz_head - 0.01)
        & (np.abs(X2) < 0.075)
    )
    ycc0 = cv2.cvtColor(tex, cv2.COLOR_BGR2YCrCb)
    is_skin = (
        (ycc0[..., 1] >= 134)
        & (ycc0[..., 1] <= 178)
        & (ycc0[..., 2] >= 78)
        & (ycc0[..., 2] <= 126)
        & (ycc0[..., 0] > 70)
    )
    skin_zone = skin_zone & cv2.erode(is_skin.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    if OPTS["clean_skin"]:
        tex = clean_skin(tex, skin_zone)
    log(f"  pele limpa em {skin_zone.sum() / valid.sum() * 100:.1f}% do mapa")

    hair_seen = valid & (have > 0) & in_head_map & (Y2 > y_eye + 0.09)
    if hair_seen.sum() > 500:
        hair_col = np.median(tex[hair_seen], axis=0)
        hole_hair = valid & (have == 0) & in_head_map & (Y2 > y_eye + 0.02)
        tex[hole_hair] = np.clip(hair_col[None, :] * (1 + 0.07 * noise[hole_hair][:, None]), 0, 255).astype(np.uint8)
        have[hole_hair] = 255
        log(f"  cabelo preenchido com a cor real em {hole_hair.sum() / valid.sum() * 100:.1f}% do mapa")

    front_i = next(i for i, v in enumerate(views) if v["name"] == "FRONT")
    fv = views[front_i]
    neck_low = np.asarray(masks["neck"], int)
    neck_low = neck_low[V[neck_low][:, 1] < y_chin - 0.035]
    chin_zone = valid & (have > 0) & in_head_map & (Y2 >= y_chin) & (Y2 < y_chin + 0.03)
    log(f"  pescoço: {len(neck_low)} vértices baixos, {int(chin_zone.sum())} pixels na zona do queixo")
    if OPTS["neck"] and len(neck_low) > 20 and chin_zone.sum() > 200:
        pxn = fp.project(V[neck_low] @ fv["R"].T, fv["s"], fv["t"], mirror) * fv["H"]
        hh, ww = fv["img"].shape[:2]
        okp = (pxn[:, 0] > 2) & (pxn[:, 0] < ww - 3) & (pxn[:, 1] > 2) & (pxn[:, 1] < hh - 3)
        shirt = np.median(sample(fv["img"], pxn[okp, 0], pxn[okp, 1]).astype(np.float32), axis=0)
        skin = np.median(tex[chin_zone], axis=0).astype(np.float32)
        neck_zone = valid & in_head_map & (Y2 < y_chin + 0.005)
        t = np.clip((y_chin + 0.005 - Y2) / 0.055, 0, 1)
        t = (t * t * (3 - 2 * t))[..., None]
        blend = skin[None, None, :] * (1 - t) + shirt[None, None, :] * t
        blend = blend * (1 + 0.04 * noise[..., None])
        # pele do pescoço: só a baixa frequência das fotos (sem os arcos de fotos desalinhadas) + grão fino de pele
        ycc1 = cv2.cvtColor(tex, cv2.COLOR_BGR2YCrCb)
        skin_like = (
            valid
            & in_head_map
            & (ycc1[..., 1] >= 128)
            & (ycc1[..., 1] <= 185)
            & (ycc1[..., 0] > 60)
            & (Y2 > y_chin - 0.08)
        )
        ml = skin_like.astype(np.float32)
        smooth_skin = (
            cv2.GaussianBlur(tex.astype(np.float32) * ml[..., None], (0, 0), 26)
            / np.maximum(cv2.GaussianBlur(ml, (0, 0), 26), 1e-3)[..., None]
        )
        has_ref = cv2.GaussianBlur(ml, (0, 0), 26) > 0.02
        base = np.where((neck_zone & has_ref)[..., None], smooth_skin, tex.astype(np.float32))
        grain = cv2.GaussianBlur(rng.normal(0, 1, (TEX, TEX)).astype(np.float32), (0, 0), 1.1)
        grain /= grain.std() + 1e-6
        base = base * (1 + 0.035 * grain[..., None])
        mixed = base * (1 - t) + blend * t
        tex[neck_zone] = np.clip(mixed[neck_zone], 0, 255).astype(np.uint8)
        have[neck_zone] = 255
        log(f"  pescoço suavizado: pele {skin.astype(int).tolist()} -> camiseta {shirt.astype(int).tolist()}")

    # ---- pele ao lado do pescoço e atrás da mandíbula (fora do rosto): as emendas entre fotos desenhavam arcos;
    # aqui só vale a cor suave da própria pele (borrão largo), sem tocar no rosto nem no cabelo.
    if OPTS["side_smooth"]:
        fw_side = face_weight_map(tid, Fx, src, masks, ys, xs, have.shape, sigma=4)
        ycs = cv2.cvtColor(tex, cv2.COLOR_BGR2YCrCb)
        skin_s = (ycs[..., 1] >= 134) & (ycs[..., 1] <= 185) & (ycs[..., 0] > 60)
        zone = (valid & in_head_map & skin_s & (fw_side < 0.05) & (Y2 < y_eye) & (Y2 > y_chin - 0.10)).astype(
            np.float32
        )
        zb = cv2.GaussianBlur(zone, (0, 0), 16)
        smooth_side = (
            cv2.GaussianBlur(tex.astype(np.float32) * zone[..., None], (0, 0), 16) / np.maximum(zb, 1e-3)[..., None]
        )
        soft = (cv2.GaussianBlur(zone, (0, 0), 5) * (zb > 0.05))[..., None]
        tex = np.clip(tex.astype(np.float32) * (1 - soft) + smooth_side * soft, 0, 255).astype(np.uint8)
        log(f"  pele lateral suavizada em {int(zone.sum() / max(valid.sum(), 1) * 100)}% do mapa")

    if OPTS["calibrated_eyes"]:
        tex, have = calibrated_eyes(tex, have, fv, Pv, ys, xs, mirror)

    # orelhas em que a marcação na foto não fez sentido: tom de pele liso (mediana da pele do rosto) com leve variação
    if ear_fallback:
        zone = skin_zone if skin_zone.any() else valid
        skin_med = np.median(tex[zone & (have > 0)], axis=0)
        for name, key, side in (("esquerda", "left_ear", xs < 0.76 * TEX), ("direita", "right_ear", xs >= 0.76 * TEX)):
            if key not in ear_fallback:
                continue
            sel = (ys >= HEAD_V * TEX) & (xs >= 0.5 * TEX) & side
            shade = 1 + 0.05 * noise[ys[sel], xs[sel]]
            tex[ys[sel], xs[sel]] = np.clip(skin_med[None, :] * shade[:, None], 0, 255).astype(np.uint8)
            have[ys[sel], xs[sel]] = 255
            log(f"  orelha {name}: tom de pele liso (a marcação na foto não era confiável)")

    # ---- olhos procedurais (esclera, íris, anel límbico, pupila); a cor da íris vem da foto frontal
    eye_px = (ys >= HEAD_V * TEX) & (xs < 0.5 * TEX)
    for name, key, side in (
        ("esquerdo", "left_eyeball", xs < 0.24 * TEX),
        ("direito", "right_eyeball", xs >= 0.24 * TEX),
    ):
        if not OPTS["procedural_eyes"]:
            break
        sel = eye_px & side
        if not sel.any():
            continue
        idx = np.asarray(masks[key], int)
        c0 = V[idx].mean(0)
        front_half = V[idx][V[idx][:, 2] > c0[2]]  # o globo do FLAME tem uma parte que se estende para trás
        c, R = fit_sphere(front_half)
        iris = iris_color_from_photo(fv, c, R, mirror)
        tex[ys[sel], xs[sel]] = procedural_eye(Pv[sel], c, R, iris)
        have[ys[sel], xs[sel]] = 255
        log(f"  olho {name}: raio {R * 1000:.1f} mm, íris BGR {iris.astype(int).tolist()}")

    hole = (valid & (have == 0)).astype(np.uint8) * 255
    small = cv2.resize(tex, (1024, 1024), interpolation=cv2.INTER_AREA)
    small_hole = cv2.resize(hole, (1024, 1024), interpolation=cv2.INTER_NEAREST)
    filled = cv2.resize(cv2.inpaint(small, small_hole, 6, cv2.INPAINT_TELEA), (TEX, TEX), interpolation=cv2.INTER_CUBIC)
    tex[hole > 0] = filled[hole > 0]
    pad = cv2.dilate(valid.astype(np.uint8), np.ones((5, 5), np.uint8), iterations=6) & (~valid).astype(np.uint8)
    tex[pad > 0] = cv2.inpaint(tex, (pad * 255).astype(np.uint8), 5, cv2.INPAINT_TELEA)[pad > 0]
    # ---- orelha "pintada" no crânio: a foto também carrega a orelha real, e ela aparece atrás da orelha 3D (duas orelhas).
    ear_zone = np.zeros((TEX, TEX), bool)
    for key in ("left_ear", "right_ear"):
        eidx = np.asarray(masks[key], int)
        ec = V[eidx].mean(0)
        # elipse (lado a lado e altura) do tamanho da orelha, não uma esfera: uma esfera de 4 cm deixava um halo escuro e
        # borrado em volta da orelha. A orelha 3D (já alinhada e ampliada à real) cobre o resto.
        ext = np.ptp(V[eidx], axis=0)
        a_z, a_y = 0.58 * ext[2] + 0.004, 0.58 * ext[1] + 0.004
        ell = ((Pv[:, 2] - ec[2]) / a_z) ** 2 + ((Pv[:, 1] - ec[1]) / a_y) ** 2
        near = ell < 1.0
        black = (tex[ys, xs].sum(axis=1) == 0) & (ell < 2.2)  # vazios do mapa logo em volta também precisam de cor
        near = (near | black) & (ys < HEAD_V * TEX)
        ear_zone[ys[near], xs[near]] = True
    if ear_zone.any():
        ez = cv2.dilate(ear_zone.astype(np.uint8), np.ones((7, 7), np.uint8))
        small_t = cv2.resize(tex, (1024, 1024), interpolation=cv2.INTER_AREA)
        small_m = cv2.resize(ez * 255, (1024, 1024), interpolation=cv2.INTER_NEAREST)
        fixed = cv2.resize(
            cv2.inpaint(small_t, small_m, 9, cv2.INPAINT_TELEA), (TEX, TEX), interpolation=cv2.INTER_CUBIC
        )
        sel2 = (ez > 0) & valid
        tex[sel2] = fixed[sel2]
        log(f"  orelha pintada no crânio removida em {sel2.sum() / valid.sum() * 100:.1f}% do mapa")

    # borda escura nas orelhas = cabelo que passou pelo recorte; preenche com a pele vizinha
    r0, c0 = int(HEAD_V * TEX), int(0.5 * TEX)
    strip = tex[r0:, c0:].copy()
    ycs = cv2.cvtColor(strip, cv2.COLOR_BGR2YCrCb)
    vmask = valid[r0:, c0:]
    dark = (vmask & (ycs[..., 0] < 70)).astype(np.uint8)
    dark = cv2.dilate(dark, np.ones((5, 5), np.uint8))
    dark[~vmask] = 0
    # cobre o miolo de pele: só considera escuro o que está encostado na borda da ilha (até 40 px dela)
    edge = cv2.erode(vmask.astype(np.uint8), np.ones((81, 81), np.uint8)) == 0
    dark = dark & edge.astype(np.uint8)
    # faixa de cabelo mais larga (até ~60 px da borda da ilha): o que NÃO tem cor de pele é cabelo; a concha da orelha,
    # mesmo na sombra, tem cor de pele e não é tocada.
    wide = vmask & (cv2.erode(vmask.astype(np.uint8), np.ones((121, 121), np.uint8)) == 0)
    not_skin = ~((ycs[..., 1] >= 134) & (ycs[..., 1] <= 178) & (ycs[..., 2] >= 78) & (ycs[..., 2] <= 126))
    dark = dark | (wide & not_skin).astype(np.uint8)
    dark = cv2.dilate(dark, np.ones((5, 5), np.uint8))
    dark[~vmask] = 0
    if dark.any():
        # as cores de origem do preenchimento não podem incluir a margem de fora da ilha (também é cabelo): ela entra
        # na máscara e só a pele de dentro serve de fonte.
        src_mask = ((dark > 0) | ~vmask).astype(np.uint8) * 255
        fixed = cv2.inpaint(strip, src_mask, 7, cv2.INPAINT_TELEA)
        strip[dark > 0] = fixed[dark > 0]
        tex[r0:, c0:] = strip
        log(f"  borda escura da orelha corrigida: {int(dark.sum())} px")
    # a margem de textura em volta das orelhas (fora do mapa válido) foi preenchida ANTES da correção do anel escuro e
    # ficou com o cabelo: refaz a partir da pele já corrigida. É a margem que aparece como contorno escuro na borda.
    sub_v = valid[r0:, c0:]
    margin = (cv2.dilate(sub_v.astype(np.uint8), np.ones((5, 5), np.uint8), iterations=6) > 0) & ~sub_v
    if margin.any():
        strip2 = tex[r0:, c0:].copy()
        strip2[margin] = 0
        redo = cv2.inpaint(strip2, (margin * 255).astype(np.uint8), 5, cv2.INPAINT_TELEA)
        strip2[margin] = redo[margin]
        tex[r0:, c0:] = strip2
    return dict(
        tex=tex,
        Vx=Vx,
        Nx=Nx,
        Ux=Ux,
        Fx=Fx,
        src=src,
        V=V,
        ear_view=ear_view,
        n_original=len(V),
        coverage=float((have > 0).sum() / valid.sum()),
    )


def main(out_dir: Path):
    """CLI de depuração: lê fit.npz (de fit.py) e grava textura, .glb simples e montagem."""
    d = np.load(out_dir / "fit.npz", allow_pickle=True)
    fl = fp.load_flame()
    views = []
    for i, name in enumerate(d["views"]):
        views.append(
            dict(
                name=str(name),
                img=cv2.imread(str(d["paths"][i])),
                rot=np.asarray(d["rots"][i]),
                R=fp.rotmat(d["rots"][i]),
                s=float(d["ss"][i]),
                t=d["ts"][i],
                H=float(d["Hs"][i]),
            )
        )
    mirror = int(d["mirror"])
    r = bake(d["V"], views, fl["faces"], load_masks(), mirror, out_dir)
    cv2.imwrite(str(out_dir / "textura.png"), r["tex"])
    export_glb(out_dir / "rosto.glb", r["Vx"], r["Nx"], r["Ux"], r["Fx"], r["tex"])
    np.savez(out_dir / "malha_expandida.npz", V=r["Vx"], N=r["Nx"], UV=r["Ux"], F=r["Fx"], n_original=r["n_original"])
    preview(out_dir / "montagem_textura.png", r["Vx"], r["Nx"], r["Ux"], r["Fx"], r["tex"], mirror)
    print("Saída: " + str(out_dir / "rosto.glb") + " e montagem_textura.png")


def export_glb(path, Vx, Nx, Ux, Fx, tex):
    import pygltflib as g

    Vf, Nf, Uf, Ff = Vx.astype(np.float32), Nx.astype(np.float32), Ux.astype(np.float32), Fx.astype(np.uint32)
    _, png = cv2.imencode(".png", tex)
    blobs = [Vf.tobytes(), Nf.tobytes(), Uf.tobytes(), Ff.tobytes(), png.tobytes()]

    def pad(b):
        return b + b"\x00" * ((4 - len(b) % 4) % 4)

    data, views, off = b"", [], 0
    for b, tg in zip(blobs, [g.ARRAY_BUFFER, g.ARRAY_BUFFER, g.ARRAY_BUFFER, g.ELEMENT_ARRAY_BUFFER, None]):
        views.append(g.BufferView(buffer=0, byteOffset=off, byteLength=len(b), target=tg))
        data += pad(b)
        off += len(pad(b))
    gl = g.GLTF2(
        scene=0,
        scenes=[g.Scene(nodes=[0])],
        nodes=[g.Node(mesh=0)],
        meshes=[
            g.Mesh(
                primitives=[
                    g.Primitive(attributes=g.Attributes(POSITION=0, NORMAL=1, TEXCOORD_0=2), indices=3, material=0)
                ]
            )
        ],
        materials=[
            g.Material(
                pbrMetallicRoughness=g.PbrMetallicRoughness(
                    baseColorTexture=g.TextureInfo(index=0), metallicFactor=0.0, roughnessFactor=0.65
                ),
                doubleSided=True,
            )
        ],
        textures=[g.Texture(source=0, sampler=0)],
        samplers=[
            g.Sampler(magFilter=g.LINEAR, minFilter=g.LINEAR_MIPMAP_LINEAR, wrapS=g.REPEAT, wrapT=g.CLAMP_TO_EDGE)
        ],
        images=[g.Image(bufferView=4, mimeType="image/png")],
        accessors=[
            g.Accessor(
                bufferView=0,
                componentType=g.FLOAT,
                count=len(Vf),
                type=g.VEC3,
                min=Vf.min(0).tolist(),
                max=Vf.max(0).tolist(),
            ),
            g.Accessor(bufferView=1, componentType=g.FLOAT, count=len(Nf), type=g.VEC3),
            g.Accessor(bufferView=2, componentType=g.FLOAT, count=len(Uf), type=g.VEC2),
            g.Accessor(bufferView=3, componentType=g.UNSIGNED_INT, count=Ff.size, type=g.SCALAR),
        ],
        bufferViews=views,
        buffers=[g.Buffer(byteLength=len(data))],
    )
    gl.set_binary_blob(data)
    gl.save_binary(str(path))


def preview(path, Vx, Nx, Ux, Fx, tex, mirror, size=520):
    tiles = []
    for yaw in (-90, -45, 0, 45, 90):
        R = fp.rotmat([yaw, 0, 0])
        P = Vx @ R.T
        sc = size / (np.ptp(P[:, 1]) * 1.12)
        cxm, cym = P[:, 0].mean(), P[:, 1].mean()
        X = mirror * (P[:, 0] - cxm) * sc + size / 2
        Y = -(P[:, 1] - cym) * sc + size / 2
        tid, bary, _ = rasterize(np.stack([X, Y], 1)[Fx], P[Fx][:, :, 2], np.arange(len(Fx)), size, size)
        ok = tid >= 0
        tri = Fx[np.where(ok, tid, 0)]
        uvp = np.einsum("hwc,hwcd->hwd", bary, Ux[tri])
        nz = np.einsum("hwc,hwc->hw", bary, (Nx[tri] @ R.T)[..., 2])
        mapx = (uvp[..., 0] % 1.0 * (TEX - 1)).astype(np.float32)
        mapy = (np.clip(uvp[..., 1], 0, 1) * (TEX - 1)).astype(np.float32)
        col = cv2.remap(tex, mapx, mapy, cv2.INTER_LINEAR).astype(np.float32)
        shade = (0.62 + 0.38 * np.clip(nz, 0, 1))[..., None]
        img = np.full((size, size, 3), 235, np.float32)
        img[ok] = (col * shade)[ok]
        tiles.append(img.astype(np.uint8))
    cv2.imwrite(str(path), np.hstack(tiles))


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else fp.ROOT / ".out" / "fit")
