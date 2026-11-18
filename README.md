# Simulador Estético 3D

Plataforma para clínicas: cadastro de pacientes, termo de consentimento, captura guiada de 5 fotos, modelo 3D do rosto e simulação ilustrativa por região, com antes/depois, versões e exportação.

> **A simulação é ilustrativa e não garante resultado.** O sistema não recomenda procedimentos, não diagnostica e não sugere produto, dose, volume ou técnica.

Planejamento: [docs/PLANEJAMENTO.md](docs/PLANEJAMENTO.md) · Decisões: [docs/adr/](docs/adr/)

## O que funciona hoje

| Área | Estado |
|---|---|
| Login, papéis (admin, profissional, recepção), isolamento por clínica, auditoria | Pronto e testado |
| Pacientes (cadastro mínimo, busca, edição, exclusão com anonimização) | Pronto e testado |
| Termo digital com escopos separados, assinatura na tela, revogação que apaga biométricos | Pronto e testado |
| Captura guiada: 5 vistas, câmera ou arquivo, MediaPipe no navegador (ângulo, enquadramento, nitidez), validação manual sinalizada, JPEG ≤ 2048 px sem EXIF, upload direto por URL pré-assinada | Pronto; câmera ao vivo **não validada** (sem câmera no ambiente de teste) |
| Fila de reconstrução (Postgres), retry com backoff, worker por HTTP + HMAC | Pronto e testado |
| Worker Python com contrato completo e reconstrutor **mock** | Pronto; **VGGTFace não instalado** (exige GPU, pesos e licença) |
| Simulador 3D: 15 sliders por procedimento, clique na região, vistas frente/45°/perfil, cortina, lado a lado, alternar, wireframe, desfazer/refazer, versões com miniatura, exportação PNG com marca d'água | Pronto, sobre o **template demonstrativo** |
| Retenção (expurgo diário + manual), PWA instalável, Dockerfiles, compose, CI | Pronto; Docker/CI **não executados** nesta máquina |

### O que é demonstrativo (e aparece assim na tela)
- **Modelo 3D:** sem o VGGTFace, toda reconstrução termina como `TEMPLATE`: uma cabeça genérica procedural (ADR 0006), com o selo "Modelo demonstrativo" no simulador e na exportação. A foto do paciente nunca é aplicada sobre ela.
- **Deformações:** bases suaves por máscara, não biharmônicas. Faixas visuais sem unidade, a validar com um profissional.
- **Termo:** texto provisório, marcado na tela; validar com o jurídico.

## Rodar local (sem Docker)

Requisitos: Node 20.19+ (ou 22), pnpm 10 (`corepack enable` ou `npm i -g pnpm@10`), Python 3.11+ para o worker (opcional).

```bash
pnpm install                       # também copia o WASM do MediaPipe (o template 3D é gerado no dev/build)
cp apps/api/.env.example apps/api/.env
pnpm db:dev                        # terminal 1: Postgres embutido (PGlite) em :5433
pnpm db:setup                      # migrations + clínica de demonstração
pnpm dev                           # terminal 2: API :3000 e web http://localhost:5173
```

Usuários de demonstração (só desenvolvimento; senha = `SEED_PASSWORD` do `.env`): `admin@demo.local`, `profissional@demo.local`, `recepcao@demo.local`. Pacientes do seed são fictícios.

**Worker (opcional).** Sem ele, a reconstrução usa o template na hora. Com ele, o fluxo passa pelo contrato HTTP real:

```bash
cd services/worker
python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # Linux/mac: .venv/bin/pip
WORKER_SECRET=<32+ caracteres> .venv/Scripts/python -m uvicorn app.main:app_factory --factory --port 8000
```
e no `apps/api/.env`: `WORKER_URL=http://127.0.0.1:8000` e o mesmo `WORKER_SECRET`.

**Modelo do MediaPipe.** Por padrão o navegador baixa o `face_landmarker.task` oficial do Google (só o modelo; nenhuma foto sai do aparelho). Para servir localmente: `pnpm --filter @sim/web setup:model`.

## Com Docker

```bash
pnpm --filter @sim/face-assets build
docker compose -f infra/docker-compose.yml up -d --build     # web em http://localhost:8080
```
Postgres 16, MinIO (bucket privado), migrations, API, web (nginx com CSP) e worker mock.

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm check` | lint + typecheck + testes + build de tudo (igual ao CI) |
| `pnpm test` | contracts, face-assets, API e2e (Postgres em memória) e web |
| `cd services/worker && pytest && ruff check . && mypy app` | checagens do worker |
| `cd apps/api && node --env-file=.env scripts/smoke-flow.mjs` | fumaça do fluxo inteiro contra a API rodando (cria um paciente fictício) |
| `pnpm --filter @sim/api db:migrate:diff` | SQL da próxima migration |
| `pnpm --filter @sim/face-assets build` | regenera `template-head.glb` (web e worker) |

## Estrutura

```
apps/api              NestJS 12 + Prisma 7: auth, clinics, users, patients, consents, captures,
                      reconstructions (fila), simulations, retention, audit, storage
apps/web              React 19 + Vite + Tailwind + R3F + MediaPipe (PWA)
services/worker       FastAPI: /health, /v1/reconstruct (HMAC); reconstrutor mock | vggtface
packages/contracts    Zod: entidades, permissões, termo, regras de captura, sliders, contrato do worker
packages/face-assets  Template procedural, máscaras, bases dos sliders, escritor de .glb
infra/                docker-compose
docs/                 planejamento e ADRs 0001–0006
```

## Segurança e LGPD

- `clinicId` sempre do token; recurso de outra clínica responde 404. Testes e2e cobrem pacientes, termos, capturas, reconstruções, simulações, usuários e auditoria entre clínicas.
- Refresh token rotativo em cookie httpOnly `SameSite=Strict`; reuso derruba a família. Senhas argon2id; login limitado por IP; desativar usuário corta o acesso na hora.
- Captura bloqueada sem termo ativo. Revogar o termo, excluir o paciente ou vencer o prazo de retenção apaga fotos, malhas e simulações (arquivos e banco). Os registros de termo ficam como prova; **validar com o jurídico**.
- Fotos e malhas só por URL pré-assinada de curta duração; chaves sem dados pessoais; bucket privado.
- MediaPipe roda no navegador; fotos são reencodadas (sem EXIF) antes do envio.
- Exportação sem nome do paciente, com marca d'água e registro de auditoria. Recepção não exporta nem cria simulações.
- Service worker só guarda arquivos estáticos, nunca respostas da API.
- Storage `local` grava em disco sem criptografia: só para desenvolvimento.

## Pendências conhecidas
- Fase 0 (PoC VGGTFace e licenças) e o pipeline real do worker.
- Trocar o template procedural pelo FLAME 2023 Open (ADR 0006).
- Validar com câmera real o sinal do ângulo (`YAW_SIGN` em `apps/web/src/features/capture/vision/analysis.ts`) e a detecção em perfil.
- Ícones PNG para iOS (o manifesto usa SVG).
- Rodar o compose e o CI num ambiente com Docker/GitHub; deploy de staging.
