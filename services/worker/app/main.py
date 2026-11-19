"""Worker HTTP: /health e /v1/reconstruct (planejamento §4, decisões 1–3).

/v1/deform do documento técnico v0.1 não existe: a deformação roda no navegador com
bases pré-calculadas (ADR 0002).
"""

import time
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import ValidationError

from . import pipeline
from .config import Settings
from .schemas import Metrics, ReconstructDone, ReconstructFailed, ReconstructRequest
from .security import verify


def create_app(settings: Settings | None = None, http: httpx.Client | None = None) -> FastAPI:
    cfg = settings or Settings.from_env()
    reconstructor = pipeline.make_reconstructor(cfg)
    client = http or httpx.Client(timeout=cfg.http_timeout_s)
    app = FastAPI(title="sim-worker", docs_url=None, redoc_url=None)

    async def signed_body(
        request: Request,
        x_worker_timestamp: Annotated[str | None, Header()] = None,
        x_worker_signature: Annotated[str | None, Header()] = None,
    ) -> bytes:
        body = await request.body()
        if not verify(cfg.worker_secret, x_worker_timestamp, x_worker_signature, body):
            raise HTTPException(status_code=401, detail="assinatura inválida")
        return body

    @app.get("/health")
    def health() -> dict[str, object]:
        return {
            "status": "ok",
            "reconstructor": cfg.reconstructor,
            "modelsLoaded": cfg.reconstructor in ("mock", "flame"),
        }

    @app.post("/v1/reconstruct", response_model=ReconstructDone | ReconstructFailed)
    def reconstruct(body: Annotated[bytes, Depends(signed_body)]) -> ReconstructDone | ReconstructFailed:
        try:
            req = ReconstructRequest.model_validate_json(body)
        except ValidationError as e:
            raise HTTPException(status_code=422, detail="requisição inválida") from e
        started = time.monotonic()
        try:
            photos = pipeline.download_photos(client, [(p.angle, str(p.url)) for p in req.photos], cfg.max_photo_bytes)
            result = reconstructor.reconstruct(photos)
            pipeline.upload_mesh(client, str(req.output.meshUploadUrl), result.glb)
        except pipeline.InputError as e:
            return ReconstructFailed(jobId=req.jobId, code=e.code, detail=e.detail)  # type: ignore[arg-type]
        except pipeline.NotInstalledError as e:
            return ReconstructFailed(jobId=req.jobId, code="INTERNAL", detail=str(e))
        except httpx.TimeoutException:
            return ReconstructFailed(jobId=req.jobId, code="TIMEOUT", detail="tempo esgotado no storage")
        except httpx.HTTPError as e:
            return ReconstructFailed(jobId=req.jobId, code="INTERNAL", detail=f"storage: {type(e).__name__}")
        return ReconstructDone(
            jobId=req.jobId,
            source=result.source,  # type: ignore[arg-type]
            metrics=Metrics(
                durationMs=int((time.monotonic() - started) * 1000),
                vertices=result.vertices,
                qualityScore=result.quality_score,
            ),
        )

    return app


def app_factory() -> FastAPI:
    return create_app()
