import { createHmac, timingSafeEqual } from 'node:crypto';
import { WORKER_MAX_SKEW_SECONDS } from '@sim/contracts';

/** HMAC-SHA256 de `${timestamp}.${body}` em hex (mesmo algoritmo do worker Python). */
export function signWorkerBody(secret: string, timestamp: number, body: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function verifyWorkerBody(secret: string, timestamp: string | undefined, signature: string | undefined, body: string, now = Date.now()) {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > WORKER_MAX_SKEW_SECONDS) return false;
  const expected = Buffer.from(signWorkerBody(secret, ts, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
