from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    worker_secret: str
    reconstructor: str  # "mock" | "vggtface"
    template_path: Path
    max_photo_bytes: int = 15 * 1024 * 1024
    http_timeout_s: float = 60.0

    @staticmethod
    def from_env() -> Settings:
        secret = os.environ.get("WORKER_SECRET", "")
        if len(secret) < 32:
            raise RuntimeError("WORKER_SECRET precisa de ao menos 32 caracteres")
        return Settings(
            worker_secret=secret,
            reconstructor=os.environ.get("RECONSTRUCTOR", "mock"),
            template_path=Path(os.environ.get("TEMPLATE_PATH", ROOT / "assets" / "template-head.glb")),
        )
