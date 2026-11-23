"""Avalia o ajuste do rosto em TODAS as capturas reais que existirem (uma pasta com fotos ANGULO-xxxx.jpg por captura).

Uso: .venv/Scripts/python.exe scripts/evaluate.py [pasta-raiz ...]
Sem argumentos, procura em ../../apps/api/.data/storage/clinics/*/captures/*.

Para cada pessoa mostra, sem olhar imagem por imagem, o que está bom e o que não está:
  - vistas com rosto detectado e o erro dos pontos de cada uma;
  - giro estimado dos perfis (tem que cair na faixa da vista);
  - orelhas: a marcação passou na trava de plausibilidade ou caiu para o tom de pele liso;
  - cor da íris medida e a esclera.
Termina com um resumo e sai com código 1 se alguma pessoa tiver um problema (serve de teste de regressão ao rodar
com as capturas do ambiente). Nada sai da máquina.
"""

from __future__ import annotations

import glob
import os
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.face import ear_align as ea  # noqa: E402
from app.face import ear_segment as es  # noqa: E402
from app.face import fit, texture  # noqa: E402

ERR_MAX = 0.03  # erro mediano máximo aceitável por vista (fração da altura do rosto)
NEEDED = ("FRONT",)


def find_captures(roots: list[str]) -> list[Path]:
    found: list[Path] = []
    for r in roots:
        for d in glob.glob(str(Path(r) / "*" / "captures" / "*")) + glob.glob(str(Path(r) / "*")):
            p = Path(d)
            if p.is_dir() and len(list(p.glob("*.jpg"))) >= 3 and p not in found:
                found.append(p)
    return sorted(found)


def ear_status(views, V, fl, masks, mirror) -> list[str]:
    """Reproduz a trava de plausibilidade da orelha e devolve uma linha por orelha."""
    out = []
    names = [v.name for v in views]
    yaws = np.array([v.rot[0] for v in views])
    nose = np.asarray(masks["nose"], int)
    for key, pick in (("left_ear", np.argmin), ("right_ear", np.argmax)):
        i = int(pick(yaws))
        v = views[i]
        if abs(v.rot[0]) < 40:
            out.append(f"{key}: sem vista de perfil (a orelha fica com tom de pele liso)")
            continue
        R = fit.rotmat(v.rot)
        pix = fit.project(V @ R.T, v.s, v.t, mirror) * v.H
        e = np.asarray(masks[key], int)
        cen = pix[e].mean(0)
        fd = pix[nose].mean(0) - cen
        fd /= np.linalg.norm(fd) + 1e-9
        size = float(np.ptp(pix[e], axis=0).max())
        outline = ea.outline_points(fl["faces"], e, pix)
        dx, dy, scl, rot = ea.align_ear(v.img, outline, cen, fd, size)
        out_a = ea.apply_similarity(outline, cen, dx, dy, scl, rot)
        mask = es.segment_ear(v.img, out_a, cen + np.array([dx, dy]), fd, size)
        _A, _t, _c, iou = es.fit_affine_to_mask(out_a, mask)
        ratio = mask.sum() / max(cv2.contourArea(cv2.convexHull(out_a.astype(np.float32))), 1.0)
        shift = float(np.hypot(dx, dy)) / max(size, 1.0)
        ok = shift <= 0.35 and iou >= 0.75 and 0.6 < ratio < 2.4
        out.append(
            f"{key} ({names[i]}): deslocamento {shift:.2f}x, IoU {iou:.2f}, área {ratio:.2f}x -> "
            + ("usa a orelha da foto" if ok else "TRAVA: tom de pele liso")
        )
    return out


def evaluate(folder: Path, fl, masks, landmarker) -> list[str]:
    problems: list[str] = []
    views = []
    print(f"\n=== {folder} ===")
    for p in sorted(folder.glob("*.jpg")):
        name = p.stem.split("-")[0]
        if name not in fit.NOMINAL_YAW:
            continue
        img = cv2.imread(str(p))
        if img is None:
            print(f"  {name:10s} IMAGEM ILEGÍVEL")
            problems.append(f"{folder.name}: imagem ilegível na vista {name}")
            continue
        v = fit.make_view(landmarker, fl, name, img, p)
        print(f"  {name:10s} {'rosto detectado' if v else 'SEM ROSTO'}")
        if v is None:
            if name in NEEDED:
                problems.append(f"{folder.name}: sem rosto na vista {name}")
            continue
        views.append(v)
    if not any(v.name == "FRONT" for v in views) or len(views) < 3:
        problems.append(f"{folder.name}: vistas insuficientes ({len(views)})")
        return problems
    V, _beta, mirror, errors = fit.fit_views(views, fl, log=lambda *_: None)
    print("  erro dos pontos (mediana, % da altura do rosto) e giro estimado:")
    for v in views:
        med, p90 = errors[v.name]
        lo, hi = v.yaw_bounds
        edge = abs(v.rot[0] - lo) < 1.0 or abs(v.rot[0] - hi) < 1.0
        flag = ""
        if med > ERR_MAX:
            flag = "  <-- ERRO ALTO"
            problems.append(f"{folder.name}: {v.name} com erro {med * 100:.1f}%")
        elif edge and abs(v.rot[0]) > 20:
            flag = "  <-- giro no limite da faixa"
            problems.append(f"{folder.name}: {v.name} com giro no limite ({v.rot[0]:+.0f}°)")
        print(f"    {v.name:10s} {med * 100:5.2f}%  p90 {p90 * 100:5.2f}%   giro {v.rot[0]:+6.1f}°{flag}")
    print("  orelhas:")
    for line in ear_status(views, V, fl, masks, mirror):
        print("    " + line)
        if "TRAVA" in line:
            problems.append(f"{folder.name}: {line.split(':')[0]} caiu na trava")
    return problems


def main(roots: list[str]) -> int:
    folders = find_captures(roots)
    if not folders:
        print("nenhuma captura encontrada")
        return 0
    fl = fit.load_flame()
    masks = texture.load_masks()
    landmarker = fit.make_landmarker()
    problems: list[str] = []
    for f in folders:
        problems += evaluate(f, fl, masks, landmarker)
    print(f"\n--- resumo: {len(folders)} captura(s), {len(problems)} problema(s) ---")
    for p in problems:
        print("  - " + p)
    return 1 if problems else 0


if __name__ == "__main__":
    default = [os.path.join(str(Path(__file__).resolve().parents[3]), "apps", "api", ".data", "storage", "clinics")]
    sys.exit(main(sys.argv[1:] or default))
