# 0005 — Fila de reconstrução no próprio Postgres (sem Redis/BullMQ no MVP)

- Status: aceito
- Data: 2026-11-18

## Contexto
O documento técnico previa Redis + BullMQ. O volume esperado é baixo (dezenas de reconstruções por dia por clínica), o job já tem uma linha própria (`reconstructions`) e manter Redis traz mais uma peça para operar, proteger e monitorar.

## Decisão
A tabela `reconstructions` é a fila. O processador (na API) pega o próximo job com `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, então dois processos nunca pegam o mesmo job. Retry só para `TIMEOUT`/`INTERNAL`, com até 3 tentativas e backoff exponencial (`next_run_at`). Job travado em `PROCESSING` além de 2× o timeout volta para a fila. Erros de entrada (`FACE_NOT_FOUND`, `LOW_QUALITY`) falham direto. Sem `WORKER_URL`, o job termina como `TEMPLATE`.

## Consequências
- Menos infraestrutura: Postgres + storage + worker.
- O comportamento está coberto por testes e2e com um worker falso (HMAC, retries, recuperação de job travado).
- Se o volume crescer muito, trocar por BullMQ é local: só o `ReconstructionQueue` muda.
