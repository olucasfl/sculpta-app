"""Compara duas malhas ajustadas (mesmo espaço do FLAME): distância por vértice, por região.

Uso: .venv/Scripts/python.exe scripts/compare_fits.py <fit_referencia.npz> <fit_outro.npz> [...]

Mede ESTABILIDADE (quanto a forma muda ao trocar o conjunto de fotos), não exatidão contra o rosto real.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import fit_poc as fp  # noqa: E402


def main(ref_path: str, others: list[str]):
    masks = fp._Unpickler(open(fp.FLAME_DIR / "FLAME_masks.pkl", "rb"), encoding="latin1").load()
    regions = {k: np.asarray(masks[k], int) for k in ("face", "nose", "lips", "forehead", "eye_region")}
    ref = np.load(ref_path)["V"]
    for p in others:
        V = np.load(p)["V"]
        d = np.linalg.norm(V - ref, axis=1) * 1000
        parts = " | ".join(f"{k}: {d[i].mean():.2f} mm" for k, i in regions.items())
        print(
            f"{p}: {parts} | cabeça toda: {d.mean():.2f} mm (p95 rosto {np.percentile(d[regions['face']], 95):.2f} mm)"
        )


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2:])
