"""Mostra o estilo de cabelo lido na foto frontal de cada captura e salva uma imagem de conferência (máscara).

Uso: .venv/Scripts/python.exe scripts/hair_style.py [pasta-raiz ...]
"""

from __future__ import annotations

import glob
import os
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.face import fit, hairstyle  # noqa: E402


def main(roots):
    lm = fit.make_landmarker()
    for r in roots:
        for d in sorted(glob.glob(str(Path(r) / "*" / "captures" / "*"))):
            fronts = sorted(Path(d).glob("FRONT*.jpg"))
            if not fronts:
                continue
            img = cv2.imread(str(fronts[0]))
            if img is None:
                print(d, "imagem ilegível")
                continue
            pts = fit.detect(lm, img)
            if pts is None:
                print(d, "sem rosto")
                continue
            pts = pts[:, :2] * np.array([img.shape[1], img.shape[0]])
            print(Path(d).name, hairstyle.detect_style(img, pts))


if __name__ == "__main__":
    default = os.path.join(str(Path(__file__).resolve().parents[3]), "apps", "api", ".data", "storage", "clinics")
    main(sys.argv[1:] or [default])
