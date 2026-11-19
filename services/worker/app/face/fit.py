"""Prova de conceito do caminho B (CPU): ajusta o FLAME 2023 Open aos pontos do MediaPipe de várias fotos.

Uso:
  .venv/Scripts/python.exe scripts/fit_poc.py <pasta com as fotos ANGULO-xxxx.jpg> [pasta de saída]

Método (tudo em numpy/scipy, sem GPU):
  1. MediaPipe acha 478 pontos por foto; 105 deles têm correspondência no FLAME (embedding baricêntrica).
  2. Projeção ortográfica ponderada por vista: s * R * X + t. O modelo é linear nos coeficientes de forma,
     então alternamos: (a) pose de cada vista por mínimos quadrados; (b) forma por mínimos quadrados com prior.
  3. Cor por vértice amostrada das fotos (só para conferir visualmente; a textura de verdade é outra etapa).
Nada daqui é enviado para fora da máquina.
"""

from __future__ import annotations

import os
import pickle
import sys
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation as Rot

ROOT = Path(__file__).resolve().parents[2]
# Modelos fora do Git (licença própria): pasta com flame2023_Open.pkl, FLAME_masks.pkl e mediapipe_landmark_embedding.npz
FLAME_DIR = Path(os.environ.get("FLAME_DIR", ROOT / "assets" / "flame" / "x"))
MODEL = Path(os.environ.get("LANDMARKER_MODEL", ROOT / "assets" / "face_landmarker.task"))

K_SHAPE = 100  # componentes de forma usados (de 300)
SIGMA_PX = 0.012  # ruído esperado do ponto, em fração da altura do rosto
NOMINAL_YAW = {
    "FRONT": 0,
    "LEFT_20": 20,
    "LEFT_45": 45,
    "LEFT_90": 90,
    "RIGHT_20": -20,
    "RIGHT_45": -45,
    "RIGHT_90": -90,
    "CHIN_UP": 0,
    "CHIN_DOWN": 0,
}
NOMINAL_PITCH = {"CHIN_UP": 20, "CHIN_DOWN": -20}


class _Dummy:
    def __init__(self, *a, **k):
        pass

    def __setstate__(self, s):
        self.__dict__.update(s if isinstance(s, dict) else {"state": s})


class _Unpickler(pickle.Unpickler):
    def find_class(self, module, name):
        try:
            return super().find_class(module, name)
        except Exception:
            return _Dummy


def load_flame():
    with open(FLAME_DIR / "flame2023_Open.pkl", "rb") as f:
        d = _Unpickler(f, encoding="latin1").load()
    emb = np.load(FLAME_DIR / "mediapipe_landmark_embedding.npz")
    v0 = np.asarray(d["v_template"], dtype=np.float64)
    sd = np.asarray(d["shapedirs"], dtype=np.float64)[:, :, :K_SHAPE]
    faces = np.asarray(d["f"], dtype=np.int64)
    tri = faces[emb["lmk_face_idx"]]
    b = emb["lmk_b_coords"].astype(np.float64)
    L0 = np.einsum("lc,lcd->ld", b, v0[tri])
    LD = np.einsum("lc,lcdk->ldk", b, sd[tri])
    return dict(
        v0=v0,
        sd=sd,
        faces=faces,
        tri=tri,
        b=b,
        L0=L0,
        LD=LD,
        idx=emb["landmark_indices"].astype(int),
        lface=emb["lmk_face_idx"].astype(int),
    )


def vertex_normals(V, F):
    n = np.zeros_like(V)
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    for i in range(3):
        np.add.at(n, F[:, i], fn)
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)


def detect(landmarker, img_bgr):
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    res = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    if not res.face_landmarks:
        return None
    return np.array([[p.x, p.y, p.z] for p in res.face_landmarks[0]])


def rotmat(rot_deg):
    return Rot.from_euler("YXZ", rot_deg, degrees=True).as_matrix()


def project(P, s, t, mirror):
    """P já rotacionado (N,3) -> (N,2) em unidades de altura do rosto; y da imagem cresce para baixo."""
    return np.stack([mirror * s * P[:, 0] + t[0], -s * P[:, 1] + t[1]], axis=1)


class View:
    def __init__(self, name, img, obs_px, path=""):
        self.path = str(path)
        self.name = name
        self.img = img
        h, w = img.shape[:2]
        self.H = max(1.0, float(np.ptp(obs_px[:, 1])))
        self.obs = obs_px / self.H
        self.w_img = (w, h)
        self.rot = np.array([NOMINAL_YAW[name.split("-")[0]], NOMINAL_PITCH.get(name, 0), 0.0], dtype=float)
        self.s = 5.0
        self.t = np.zeros(2)
        self.weight = np.ones(len(obs_px))
        self.err = None


def fit_view(view, fl, beta, mirror, flip_yaw=False, iters=1, fix_yaw=None):
    L = fl["L0"] + fl["LD"] @ beta
    nrm = vertex_normals(fl["v0"] + np.einsum("vdk,k->vd", fl["sd"], beta), fl["faces"])
    ln = np.einsum("lc,lcd->ld", fl["b"], nrm[fl["tri"]])
    x0 = np.concatenate([view.rot.copy(), [np.log(view.s)], view.t])
    if flip_yaw:
        x0[0] = -view.rot[0]

    def vis_weights(R):
        nz = (ln @ R.T)[:, 2]
        return 0.08 + 0.92 * np.clip((nz - 0.05) / 0.35, 0, 1)

    def res(x):
        R = rotmat(x[:3])
        p = project(L @ R.T, np.exp(x[3]), x[4:6], mirror)
        w = vis_weights(R) * view.weight
        return ((p - view.obs) * w[:, None]).ravel()

    # escala/translação iniciais pela comparação das caixas
    R0 = rotmat(x0[:3])
    p0 = project(L @ R0.T, 1.0, np.zeros(2), mirror)
    sc = max(np.ptp(view.obs[:, 1]) / max(np.ptp(p0[:, 1]), 1e-6), 1e-3)
    x0[3] = np.log(sc)
    p0 = project(L @ R0.T, sc, np.zeros(2), mirror)
    x0[4:6] = view.obs.mean(0) - p0.mean(0)
    lo = np.array([-135, -45, -25, -np.inf, -np.inf, -np.inf])
    hi = np.array([135, 45, 25, np.inf, np.inf, np.inf])
    if fix_yaw is not None:  # giro fixado (ex.: vindo da silhueta); os demais parâmetros se ajustam
        lo[0], hi[0] = fix_yaw - 1e-3, fix_yaw + 1e-3
        x0[0] = fix_yaw
    x0[:3] = np.clip(x0[:3], lo[:3] + 1e-6, hi[:3] - 1e-6)
    sol = least_squares(
        res, x0, method="trf", bounds=(lo, hi), x_scale=np.array([10, 10, 10, 0.1, 0.1, 0.1]), max_nfev=60
    )
    return sol.x, float(np.sqrt(np.mean(sol.fun**2)))


def solve_shape(views, fl, mirror, prior=1.0, extra=None):
    """Forma por mínimos quadrados com prior. `extra`: lista de (A, b) já ponderados (ex.: restrições de silhueta)."""
    rows, rhs = [], []
    for v in views:
        R = rotmat(v.rot)
        R0, R1 = R[0], R[1]
        nrm = vertex_normals(fl["v0"], fl["faces"])
        ln = np.einsum("lc,lcd->ld", fl["b"], nrm[fl["tri"]]) @ R.T
        w = (0.08 + 0.92 * np.clip((ln[:, 2] - 0.05) / 0.35, 0, 1)) * v.weight / SIGMA_PX
        ax = mirror * v.s * np.einsum("d,ldk->lk", R0, fl["LD"])
        ay = -v.s * np.einsum("d,ldk->lk", R1, fl["LD"])
        cx = mirror * v.s * (fl["L0"] @ R0) + v.t[0]
        cy = -v.s * (fl["L0"] @ R1) + v.t[1]
        rows += [ax * w[:, None], ay * w[:, None]]
        rhs += [(v.obs[:, 0] - cx) * w, (v.obs[:, 1] - cy) * w]
    for xa, xb in extra or []:
        rows.append(xa)
        rhs.append(xb)
    A = np.vstack(rows + [np.sqrt(prior) * np.eye(K_SHAPE)])
    b = np.concatenate(rhs + [np.zeros(K_SHAPE)])
    return np.linalg.lstsq(A, b, rcond=None)[0]


def make_landmarker():
    opts = vision.FaceLandmarkerOptions(
        base_options=mpt.BaseOptions(model_asset_path=str(MODEL)),
        num_faces=1,
        running_mode=vision.RunningMode.IMAGE,
    )
    return vision.FaceLandmarker.create_from_options(opts)


def make_view(landmarker, fl, name, img, path=""):
    """Detecta o rosto e devolve a vista (ou None se o MediaPipe não achar rosto)."""
    lm = detect(landmarker, img)
    if lm is None:
        return None
    h, w = img.shape[:2]
    return View(name, img, lm[fl["idx"], :2] * np.array([w, h]), path)


def fit_views(views, fl, log=print):
    """Ajusta o FLAME a várias vistas. Devolve (V, beta, mirror, erros); erros[nome] = (mediana, p90) em fração da altura do rosto."""
    beta = np.zeros(K_SHAPE)
    # FLAME olha para +z e a esquerda do sujeito é +x (verificado nas máscaras do próprio modelo)
    mirror = 1
    for v in views:
        cands = []
        for flip in (False, True):  # sinal do giro decidido por menor erro
            x, e = fit_view(v, fl, beta, mirror, flip_yaw=flip)
            cands.append((e, x))
        e, x = min(cands, key=lambda c: c[0])
        v.rot, v.s, v.t = x[:3], float(np.exp(x[3])), x[4:6]
    for it in range(10):  # alterna forma <-> pose
        beta = solve_shape(views, fl, mirror)
        errs = []
        for v in views:
            x, e = fit_view(v, fl, beta, mirror)
            v.rot, v.s, v.t, v.err = x[:3], float(np.exp(x[3])), x[4:6], e
            errs.append(e)
        log(f"iter {it:2d}  erro médio {np.mean(errs):.4f}  |beta| {np.linalg.norm(beta):.2f}")
    L = fl["L0"] + fl["LD"] @ beta
    errors = {}
    for v in views:
        R = rotmat(v.rot)
        d = np.linalg.norm(project(L @ R.T, v.s, v.t, mirror) - v.obs, axis=1)  # erro bruto, sem pesos de visibilidade
        errors[v.name] = (float(np.median(d)), float(np.percentile(d, 90)))
    V = fl["v0"] + np.einsum("vdk,k->vd", fl["sd"], beta)
    return V, beta, mirror, errors


def run(photos_dir: Path, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    fl = load_flame()
    landmarker = make_landmarker()
    views: list[View] = []
    for p in sorted(photos_dir.glob("*.jpg")):
        name = p.stem.split("-")[0]
        if name not in NOMINAL_YAW:
            continue
        v = make_view(landmarker, fl, name, cv2.imread(str(p)), p)
        if v is None:
            print(f"[aviso] sem rosto detectado: {name}")
            continue
        views.append(v)
        print(f"{name:10s} rosto detectado")
    if len(views) < 3:
        sys.exit("poucas vistas com rosto detectado")
    V, beta, mirror, errors = fit_views(views, fl)
    print("\nErro de reprojeção por vista (em % da altura do rosto, ponto a ponto):")
    for v in views:
        med, p90 = errors[v.name]
        print(
            f"  {v.name:10s} yaw {v.rot[0]:+6.1f}  pitch {v.rot[1]:+6.1f}  mediana {med * 100:4.1f}%  p90 {p90 * 100:4.1f}%"
        )
    colors = sample_colors(V, fl["faces"], views, mirror)
    np.savez(
        out_dir / "fit.npz",
        beta=beta,
        V=V,
        mirror=mirror,
        colors=colors,
        views=[v.name for v in views],
        rots=np.array([v.rot for v in views]),
        ss=np.array([v.s for v in views]),
        ts=np.array([v.t for v in views]),
        Hs=np.array([v.H for v in views]),
        paths=[v.path for v in views],
    )
    write_obj(out_dir / "fit.obj", V, fl["faces"], colors)
    render_montage(out_dir / "montagem.png", V, fl["faces"], colors, mirror)
    print(f"\nSaída em {out_dir}")


def sample_colors(V, F, views, mirror):
    nrm = vertex_normals(V, F)
    acc = np.zeros((len(V), 3))
    wsum = np.zeros(len(V))
    for v in views:
        R = rotmat(v.rot)
        P = V @ R.T
        pn = project(P, v.s, v.t, mirror) * v.H
        nz = (nrm @ R.T)[:, 2]
        w = np.clip(nz, 0, 1) ** 4
        h, w_img = v.img.shape[:2]
        mapx = pn[:, 0].astype(np.float32).reshape(-1, 1)
        mapy = pn[:, 1].astype(np.float32).reshape(-1, 1)
        inside = (mapx[:, 0] >= 0) & (mapx[:, 0] < w_img - 1) & (mapy[:, 0] >= 0) & (mapy[:, 0] < h - 1)
        samp = cv2.remap(v.img, mapx, mapy, cv2.INTER_LINEAR).reshape(-1, 3).astype(np.float64)
        w = w * inside
        acc += samp * w[:, None]
        wsum += w
    col = np.where(wsum[:, None] > 1e-3, acc / np.maximum(wsum[:, None], 1e-9), np.array([170, 170, 170.0]))
    return col[:, ::-1] / 255.0  # BGR -> RGB


def write_obj(path, V, F, colors):
    with open(path, "w") as f:
        for p, c in zip(V, colors):
            f.write(f"v {p[0]:.5f} {p[1]:.5f} {p[2]:.5f} {c[0]:.3f} {c[1]:.3f} {c[2]:.3f}\n")
        for t in F:
            f.write(f"f {t[0] + 1} {t[1] + 1} {t[2] + 1}\n")


def render(V, F, colors, yaw, mirror, size=520):
    R = rotmat([yaw, 0, 0])
    P = V @ R.T
    nrm = vertex_normals(V, F) @ R.T
    sc = size / (np.ptp(P[:, 1]) * 1.12)
    cx, cy = P[:, 0].mean(), P[:, 1].mean()
    X = mirror * (P[:, 0] - cx) * sc + size / 2
    Y = -(P[:, 1] - cy) * sc + size / 2
    img = np.full((size, size, 3), 235, np.uint8)
    order = np.argsort(P[F].mean(axis=1)[:, 2])
    for ti in order:
        tri = F[ti]
        n = nrm[tri].mean(0)
        if n[2] < -0.05:
            continue
        shade = 0.55 + 0.45 * max(0.0, n[2])
        c = (colors[tri].mean(0)[::-1] * 255 * shade).astype(np.uint8)
        pts = np.stack([X[tri], Y[tri]], 1).astype(np.int32)
        cv2.fillConvexPoly(img, pts, tuple(int(x) for x in c))
    return img


def render_montage(path, V, F, colors, mirror):
    tiles = [render(V, F, colors, y, mirror) for y in (-90, -45, 0, 45, 90)]
    cv2.imwrite(str(path), np.hstack(tiles))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    run(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / ".out" / "fit")
