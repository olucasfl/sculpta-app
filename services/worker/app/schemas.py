"""Contrato HTTP (espelho de packages/contracts/src/worker.ts)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

Angle = Literal["FRONT", "LEFT_45", "RIGHT_45", "LEFT_90", "RIGHT_90", "LEFT_20", "RIGHT_20", "CHIN_UP", "CHIN_DOWN"]
Source = Literal["VGGTFACE", "TEMPLATE", "FALLBACK_FIT"]
ErrorCode = Literal["FACE_NOT_FOUND", "LOW_QUALITY", "TIMEOUT", "INTERNAL"]


class PhotoRef(BaseModel):
    angle: Angle
    url: HttpUrl


class Output(BaseModel):
    meshUploadUrl: HttpUrl  # noqa: N815 (nome do contrato)


class ReconstructRequest(BaseModel):
    jobId: str  # noqa: N815
    photos: list[PhotoRef] = Field(min_length=5, max_length=10)
    output: Output


class Metrics(BaseModel):
    durationMs: int  # noqa: N815
    vertices: int
    qualityScore: float | None  # noqa: N815


class ReconstructDone(BaseModel):
    jobId: str  # noqa: N815
    status: Literal["DONE"] = "DONE"
    source: Source
    metrics: Metrics


class ReconstructFailed(BaseModel):
    jobId: str  # noqa: N815
    status: Literal["FAILED"] = "FAILED"
    code: ErrorCode
    detail: str | None = None
