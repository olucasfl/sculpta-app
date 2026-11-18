# Sculpta

Plataforma para clínicas de estética: cadastro de pacientes, termo de consentimento, captura guiada do rosto, modelo 3D e simulação ilustrativa (com caneta, mouse, toque ou controles), com antes/depois, versões, exportação e relatório em PDF.

> **A simulação é ilustrativa e não garante resultado.** O sistema não recomenda procedimentos, não diagnostica e não sugere produto, dose, volume ou técnica.

Guia da reformulação (etapas, decisões, riscos): [docs/GUIA-REFORMULACAO.md](docs/GUIA-REFORMULACAO.md) · Contas e permissões: [docs/CONTAS-CLINICAS-PERMISSOES.md](docs/CONTAS-CLINICAS-PERMISSOES.md) · LGPD: [docs/LGPD-CHECKLIST.md](docs/LGPD-CHECKLIST.md) · Operação: [docs/OPERACAO.md](docs/OPERACAO.md) · Rosto real: [docs/ETAPA-6-ROSTO-REAL.md](docs/ETAPA-6-ROSTO-REAL.md) · Design: [DESIGN.md](DESIGN.md)

## O que funciona hoje

| Área | Estado |
|---|---|
| Contas próprias (cadastro com senha dupla, login), várias clínicas por pessoa, 6 papéis, convites, console da plataforma e modo suporte (somente leitura, com motivo e prazo) | Pronto e testado. **Sem e-mail real**: convite é por link copiado; sem verificação de e-mail nem recuperação de senha |
| Pacientes (cadastro mínimo, filtros por período e profissional, anotações, linha do tempo, exclusão com anonimização) | Pronto e testado |
| Termo digital com escopos, assinatura na tela, revogação que apaga biométricos | Pronto e testado. **Texto provisório** (validar com o jurídico) |
| Captura guiada: 9 vistas (5 obrigatórias), foto automática, câmera, arquivo ou **vídeo** (escolhe o melhor quadro de cada vista), MediaPipe no navegador | Pronto; **câmera ao vivo e sinais dos ângulos não validados** (sem câmera no ambiente de teste) |
| Simulador 3D em tela cheia: pincel de escultura (caneta com pressão, mouse, toque), 15 controles por região, antes/depois, versões com a escultura, confiança do modelo | Pronto sobre o **template**; caneta e toque reais não testados em hardware |
| Aparência: pele com poros, olhos em camadas, sobrancelhas, cílios, cabelo (molde), cores tiradas da foto | Pronto; cabelo é um molde, não fios; cores da foto só testadas com imagens sintéticas |
| Painel, relatório em PDF com a marca da clínica, auditoria | Pronto e testado |
| Retenção (expurgo por prazo), RLS no banco, PWA, Dockerfiles, compose, CI | Pronto; **Docker não foi executado** nesta máquina |
| **Rosto real do paciente** (reconstrução a partir das fotos) | **Não existe ainda.** Depende de GPU e de licença ([ETAPA-6](docs/ETAPA-6-ROSTO-REAL.md)) |

### O que é demonstrativo (e aparece assim na tela)
- **Modelo 3D:** sem a reconstrução real, todo modelo é o **template genérico** (cabeça procedural, ADR 0006), com o selo "Modelo demonstrativo" no simulador e na exportação. A foto do paciente nunca é aplicada sobre ele.
- **Deformações:** faixas visuais sem unidade, a validar com um profissional.

## Rodar local (sem Docker)

Requisitos: Node 20.19+ (ou 22), pnpm 10 (`corepack enable`), Python 3.11+ só para o worker (opcional).

```bash
pnpm install                       # também copia o WASM do MediaPipe (o template 3D é gerado no dev/build)
cp apps/api/.env.example apps/api/.env
pnpm db:dev                        # terminal 1: Postgres embutido (PGlite) em :5433
pnpm db:setup                      # migrações + clínica de demonstração
pnpm dev                           # terminal 2: API :3000 e web http://localhost:5173
```

Usuários de demonstração (só desenvolvimento; senha = `SEED_PASSWORD` do `.env`): `admin@demo.local`, `gerente@demo.local`, `profissional@demo.local`, `recepcao@demo.local` e `plataforma@demo.local` (administrador da plataforma). Os pacientes do seed são fictícios.

### Variáveis de ambiente principais (`apps/api/.env`)

| Variável | Para quê |
|---|---|
| `DB_TARGET` | `local` (PGlite/compose, usa `DATABASE_URL`) ou `supabase` (banco real) |
| `DATABASE_URL`, `SUPABASE_DB_SESSION_URL` | Conexão com o banco. O pooler do Supabase em modo sessão (porta 5432) aceita migrações |
| `JWT_SECRET` | 32+ caracteres; **troque em staging e produção** |
| `COOKIE_SECURE` | `true` em HTTPS |
| `STORAGE_DRIVER` | `local` (disco) ou `s3` (MinIO/S3/R2); fotos e modelos ficam em armazenamento privado |
| `WORKER_URL`, `WORKER_SECRET` | Worker de reconstrução. Sem eles, o modelo é o template |
| `RETENTION_ENABLED` | Expurgo diário por prazo (o prazo é por clínica, em Configurações) |
| `SEED_PASSWORD` | Senha dos usuários de demonstração (o seed **não roda** no banco real) |

Lista completa e comentada em `apps/api/.env.example`. **Nunca** coloque a senha do banco real em arquivo versionado.

## Banco real (Supabase) e primeiro administrador

`apps/api/.env` (ignorado pelo git) guarda as strings do Supabase; `DB_TARGET=supabase` aponta a API para o banco real. Migrações: `pnpm --filter @sim/api exec prisma migrate deploy` (com `DB_TARGET=supabase`). RLS ligada em todas as tabelas; hoje a API conecta como dono das tabelas (ignora a RLS), e trocar para o papel restrito é um passo futuro.

> **Antes de pacientes reais:** o banco do projeto está na região de Ohio (EUA). Fotos e modelos são dados biométricos: migrar para São Paulo (risco R9 no guia). Troque também a senha do banco.

Para criar a conta de administrador da plataforma (a senha é pedida sem aparecer):

```bash
pnpm --filter @sim/api admin:create -- --email voce@exemplo.com --name "Seu Nome"
```

## Docker (ambiente completo)

```bash
pnpm --filter @sim/face-assets build
docker compose -f infra/docker-compose.yml up -d --build
# web http://localhost:8080 · MinIO http://localhost:9001
```

## Testes e qualidade

```bash
pnpm check                          # lint, tipos, testes e build de tudo
pnpm --filter @sim/web e2e          # testes de tela (Playwright, 5 tamanhos, acessibilidade axe) em pilha isolada
```

Os testes de tela sobem um banco temporário e **nunca tocam o Supabase**. O 3D roda em WebGL por software, então os testes do simulador são lentos: rode um projeto por vez (`--project=desktop-1440x900`). CI em `.github/workflows/ci.yml`.

## Roteiro de demonstração (10 minutos)

1. **Entrar:** `profissional@demo.local`. Na primeira vez aparece o popup de boas-vindas.
2. **Paciente:** Pacientes → Novo paciente (só o nome é obrigatório). Veja os filtros por período e profissional.
3. **Termo:** na ficha, "Assinar termo". Marque os escopos e assine na tela. Sem termo ativo a captura fica bloqueada.
4. **Captura:** Captura → Iniciar captura. Mostre as 9 vistas (5 obrigatórias), a foto automática (anel de contagem) e a aba **Vídeo**. Sem câmera, use "Enviar arquivo".
5. **Modelo 3D:** Concluir e gerar modelo. Hoje é o **template** (selo "Modelo demonstrativo"): diga isso na demonstração.
6. **Simulação:** abra a simulação de demonstração. Modele com o pincel, use um procedimento, mude a aparência (pele, olhos, cabelo), compare com "Cortina" e salve uma versão.
7. **Relatório:** botão "Relatório PDF" (marca da clínica, ajustes sem unidade, ressalva).
8. **Equipe e auditoria:** Configurações → Usuários (convites, papéis) e auditoria. Entre como `plataforma@demo.local` para ver o console e o modo suporte (somente leitura).
9. **Privacidade:** revogue o termo e mostre que os biométricos são apagados.

## Estrutura

```
apps/web/            React 19 + Vite + Tailwind v4 + R3F (PWA)
apps/api/            NestJS 12 + Prisma 7 (Postgres)
services/worker/     FastAPI (reconstrutor mock; o real depende de GPU e licença)
packages/contracts/  Zod: entidades, API, papéis (compilar com `pnpm build` após editar)
packages/face-assets/ template da cabeça, máscaras e deformações
infra/               docker-compose
docs/                guia, contas e permissões, LGPD, operação, decisões (adr/)
```
