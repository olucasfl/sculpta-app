"""Roda o reconstrutor completo (mesmo caminho do worker) numa pasta de fotos ANGULO-xxxx.jpg e grava o .glb.

Uso: .venv/Scripts/python.exe scripts/run_pipeline.py <pasta com as fotos> [saida.glb]
As fotos nunca saem da máquina; a saída em `.out/` fica fora do Git.
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.face.reconstructor import FlameReconstructor  # noqa: E402
from app.pipeline import Photo  # noqa: E402


def main(folder: Path, out: Path) -> None:
    photos = [Photo(angle=p.stem.split("-")[0], data=p.read_bytes()) for p in sorted(folder.glob("*.jpg"))]
    t0 = time.monotonic()
    rec = FlameReconstructor()
    t1 = time.monotonic()
    res = rec.reconstruct(photos)
    t2 = time.monotonic()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(res.glb)
    print(f"fotos: {len(photos)} | modelos carregados em {t1 - t0:.1f}s | reconstrução em {t2 - t1:.1f}s")
    print(
        f"fonte {res.source} | vértices {res.vertices} | qualityScore {res.quality_score} | {len(res.glb) / 1e6:.2f} MB -> {out}"
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) > 2 else Path(".out/rosto_final.glb"))
