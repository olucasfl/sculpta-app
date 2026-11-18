"""HMAC entre API e worker (mesmo algoritmo de apps/api/src/reconstructions/worker-signature.ts).

Assinatura = hex(HMAC-SHA256(WORKER_SECRET, f"{timestamp}.{body}")), timestamp em segundos,
janela de 5 minutos contra replay.
"""

from __future__ import annotations

import hashlib
import hmac
import time

MAX_SKEW_SECONDS = 300


def sign(secret: str, timestamp: int, body: bytes) -> str:
    return hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()


def verify(secret: str, timestamp: str | None, signature: str | None, body: bytes, now: float | None = None) -> bool:
    if not timestamp or not signature:
        return False
    try:
        ts = int(timestamp)
    except ValueError:
        return False
    if abs((now if now is not None else time.time()) - ts) > MAX_SKEW_SECONDS:
        return False
    return hmac.compare_digest(sign(secret, ts, body), signature)
