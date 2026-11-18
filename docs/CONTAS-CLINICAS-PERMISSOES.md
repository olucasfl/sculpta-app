# Sculpta — Contas, clínicas e permissões (multi-clínica)

> Versão 0.1 · 18/11/2026 · Status: **planejamento aprovado para detalhar; nada implementado ainda**
> Parte do [guia de reformulação](GUIA-REFORMULACAO.md) (etapa 1B). Este documento é a especificação; o guia diz **quando** cada parte entra.

## Sumário

1. [O que foi pedido](#1-o-que-foi-pedido)
2. [Modelo mental](#2-modelo-mental)
3. [Papéis e permissões](#3-papéis-e-permissões)
4. [Fluxos](#4-fluxos)
5. [Modelo de dados](#5-modelo-de-dados)
6. [API](#6-api)
7. [Telas](#7-telas)
8. [Segurança e LGPD](#8-segurança-e-lgpd)
9. [Supabase: banco real, autenticação e arquivos](#9-supabase-banco-real-autenticação-e-arquivos)
10. [Testes obrigatórios](#10-testes-obrigatórios)
11. [Sub-etapas de implementação](#11-sub-etapas-de-implementação)
12. [Decisões e perguntas em aberto](#12-decisões-e-perguntas-em-aberto)

---

## 1. O que foi pedido

| # | Pedido | Onde está atendido |
|---|---|---|
| 1 | Usar o banco real (Supabase) por variáveis de ambiente | Já feito (seção 9.1) |
| 2 | Fase de **criar conta** e **login** | Seção 4.4 e 4.5 |
| 3 | Divisão de permissões; **você** cria a primeira conta como admin | Seções 3 e 4.1 |
| 4 | O admin cria uma **clínica** e adiciona pessoas **pelo e-mail**, com permissões | Seções 4.2 e 4.3 |
| 5 | Quando a pessoa criar a conta, o e-mail dela já está liberado na clínica | Seção 4.4 |
| 6 | Pessoa em **mais de uma clínica** vê todas e escolhe em qual entrar | Seção 4.5 |
| 7 | **Admin do app (você)** vê tudo e cria/apaga clínicas | Seções 3.1, 4.7 e 4.8 |
| 8 | **Dona da clínica** com permissão total na clínica dela | Seção 3.2 |
| 9 | **Funcionários** com permissões diferentes | Seção 3.2 |
| 10 | Telas de gerência | Seção 7 |
| 11 | Cada clínica tem seus pacientes (isolamento) | Seções 2, 8 e 10 |

---

## 2. Modelo mental

Três coisas **separadas**:

- **Conta** (pessoa): um e-mail verificado e uma senha. Existe uma vez só, independente de clínica.
- **Clínica**: o "inquilino". Tem pacientes, capturas, simulações, configurações.
- **Vínculo**: liga uma conta a uma clínica **com um papel** (ex.: "Maria é PROFISSIONAL na Clínica A e RECEPCAO na Clínica B"). Todo acesso a dados de clínica passa por um vínculo ativo.

Regra de ouro: **os dados de um paciente pertencem a uma clínica, nunca a uma pessoa.** Quem sai da clínica perde o acesso na hora; o paciente continua na clínica.

```
 Conta ──< Vínculo >── Clínica ──< Paciente ──< Capturas / Simulações
 (e-mail)   (papel)    (inquilino)
```

A clínica ativa em cada requisição vem de um cabeçalho (`X-Clinic-Id`) que a API **valida a cada chamada** contra o vínculo no banco. Nunca se confia no corpo da requisição nem no front.

---

## 3. Papéis e permissões

### 3.1 Nível da plataforma (o app inteiro)

| Papel | Quem | Pode |
|---|---|---|
| **ADMIN DA PLATAFORMA** | Você (Lucas). Marcado por e-mail inicial no ambiente (seção 4.1) | Ver todas as clínicas, contas, vínculos, auditoria e métricas; criar, suspender e apagar clínicas; convidar donas; redefinir acessos; **entrar em uma clínica em "modo suporte"** (seção 4.8) |
| *(futuro)* SUPORTE | Pessoa de suporte do app | Só ver e ajudar, sem criar/apagar clínicas |

> **Ponto de atenção (LGPD).** Você pediu para "ver tudo". Tecnicamente é possível, mas as fotos, os modelos 3D e os dados de pacientes são dado **pessoal sensível**, e a clínica é quem decide sobre eles. Por padrão, o admin da plataforma vê **tudo que é do sistema** (clínicas, contas, vínculos, contagens, auditoria, saúde da fila) e entra nos **dados de pacientes só em "modo suporte"**: com motivo escrito, por tempo limitado, registrado na auditoria e **visível para a clínica**. Dá para afrouxar isso depois, mas é decisão com consequência jurídica: ver a seção 12.

### 3.2 Nível da clínica (papéis do vínculo)

| Papel | Quem | Resumo |
|---|---|---|
| **DONA** (`OWNER`) | Dona/dono da clínica | **Tudo** na clínica, incluindo equipe, configurações, auditoria, exclusão de dados e transferência de titularidade. Sempre há **pelo menos uma** |
| **GERENTE** | Gerência/administração | Equipe (exceto donas), configurações, auditoria, relatórios. Não apaga a clínica nem muda a dona |
| **PROFISSIONAL** | Médico, biomédico, dentista | Pacientes, termos, capturas, simulações, exportação, relatórios |
| **AUXILIAR** | Esteticista, técnica | Pacientes (ler/editar), capturas; vê simulações; **não** exporta nem revoga termo |
| **RECEPÇÃO** | Recepção | Cadastro de pacientes e termo de consentimento; **não** vê fotos nem modelos 3D |
| **VISUALIZADOR** | Consultoria, treinamento | Somente leitura de pacientes e simulações; sem exportar |

### 3.3 Matriz de permissões (clínica)

✅ pode · ➖ não pode · 👁 só leitura

| Permissão | Dona | Gerente | Profissional | Auxiliar | Recepção | Visualizador |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver pacientes | ✅ | ✅ | ✅ | ✅ | ✅ | 👁 |
| Cadastrar/editar pacientes | ✅ | ✅ | ✅ | ✅ | ✅ | ➖ |
| Excluir paciente (apaga biométricos) | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ |
| Registrar termo | ✅ | ✅ | ✅ | ✅ | ✅ | ➖ |
| Revogar termo | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ |
| Fazer captura facial | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ |
| Ver fotos e modelo 3D | ✅ | ✅ | ✅ | ✅ | ➖ | 👁 |
| Criar/editar simulações | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ |
| Exportar imagens / gerar relatório PDF | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ |
| Ver equipe | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ |
| Convidar / mudar papel / remover (exceto donas) | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ |
| Convidar / remover **dona**, transferir titularidade | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Configurações e identidade da clínica (nome, logo) | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ |
| Retenção e exclusão de dados da clínica | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Ver auditoria da clínica | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ |

Regras que valem sempre:

- **Fonte única:** a matriz vive em `packages/contracts` (já existe `PERMISSIONS`); API e front usam a mesma. A API é quem garante; o front só esconde o que falharia.
- **Ninguém promove a si mesmo** nem remove a última dona.
- **Gerente não mexe em dona** e não cria outro gerente com permissão maior que a dele.
- Mudar papel, suspender ou remover vale **imediatamente** (a API relê o vínculo a cada chamada).

---

## 4. Fluxos

### 4.1 Primeiro admin da plataforma (você)

1. No ambiente da API, `BOOTSTRAP_ADMIN_EMAIL=<seu e-mail>`.
2. Você **cria a conta** normalmente (4.4) com esse e-mail e **verifica o e-mail**.
3. Se **ainda não existe** admin da plataforma **e** o e-mail verificado bate com `BOOTSTRAP_ADMIN_EMAIL`, a conta vira admin da plataforma.
4. Depois do primeiro admin, a variável **deixa de ter efeito** (um segundo admin só é criado por um admin existente).
5. Recomendado: **autenticação em dois fatores obrigatória** para admin da plataforma e para donas.

> Segurança: sem a verificação de e-mail, qualquer um poderia criar uma conta com o seu e-mail antes de você. Por isso o bootstrap exige e-mail **verificado**.

### 4.2 Criar uma clínica (admin da plataforma)

1. Console da plataforma → **Nova clínica**: nome, CNPJ (opcional), e-mail da **dona**.
2. A API cria a clínica (`ATIVA`) e um **convite** `DONA` para aquele e-mail (validade de 7 dias).
3. A dona recebe o e-mail. Se já tem conta, o vínculo é ativado ao entrar; se não tem, cria a conta com esse e-mail (4.4) e já cai na clínica.

### 4.3 Adicionar equipe (dona ou gerente)

1. Tela **Equipe** → **Convidar**: e-mail, papel.
2. Cria um **convite pendente** (validade de 7 dias, um por e-mail/clínica). O e-mail é só informativo: **o que libera é o e-mail verificado coincidir** com o do convite.
3. A pessoa cria a conta (ou entra) e, no primeiro login com o e-mail verificado, o convite vira **vínculo ativo** automaticamente. Aparece um aviso: "Você foi adicionado à Clínica X como Profissional".
4. A dona/gerente pode **reenviar, revogar** convites e **mudar o papel** ou **remover** quem já está.

### 4.4 Criar conta

1. Tela **Criar conta**: nome, e-mail, senha (política de senha forte).
2. A API responde **sempre igual** ("se o e-mail puder ser usado, enviamos um link"), para **não revelar** se o e-mail já existe.
3. A pessoa clica no link do e-mail → **e-mail verificado**.
4. Se há convites pendentes para esse e-mail, viram vínculos ativos. Se não há nenhum, ela vê **"Aguardando convite"**: explica que um administrador de clínica precisa adicioná-la, e oferece sair.
5. Criar conta **não** dá acesso a nenhuma clínica por si só.

### 4.5 Login e escolha de clínica

1. E-mail + senha (+ código do 2FA, se ativado).
2. A resposta traz as **clínicas em que a pessoa tem vínculo ativo**:
   - **0 clínicas:** "Aguardando convite" (ou o console, se for admin da plataforma).
   - **1 clínica:** entra direto.
   - **2 ou mais:** tela **"Escolha a clínica"**, com o nome e o papel em cada uma; a última usada vem selecionada.
3. No app, o **seletor de clínica** no menu troca de clínica sem novo login. Cada troca é validada pela API e **auditada**.
4. Admin da plataforma entra no **console**; para ver dados de uma clínica usa o modo suporte (4.8).

### 4.6 Senha, sessões e 2FA

- **Esqueci a senha:** link por e-mail de uso único e validade curta; reaproveitar o link falha.
- **2FA opcional (TOTP)** para todos, **obrigatório** para admin da plataforma e donas; códigos de recuperação.
- **Sessões:** lista de aparelhos, com **encerrar** uma ou todas. Mudar senha encerra as demais.

### 4.7 Suspender e remover

- **Suspender vínculo:** a pessoa não entra naquela clínica; os dados dela (ex.: quem fez a captura) ficam.
- **Remover vínculo:** igual, mais permanente; aparece no histórico.
- **Suspender clínica** (admin da plataforma): ninguém da clínica entra; **dados preservados**. Usado por inadimplência ou investigação.

### 4.8 Modo suporte (admin da plataforma em uma clínica)

1. No console, **Entrar como suporte** exige **motivo** (texto obrigatório) e **duração** (ex.: 60 min).
2. Durante a janela, o admin age **com permissões de leitura** na clínica (e só ações explicitamente liberadas).
3. Tudo é gravado na auditoria **da clínica** (visível à dona): quem, quando, por quê.
4. A janela expira sozinha; há botão de **encerrar**.

### 4.9 Apagar clínica (admin da plataforma)

1. **Duas etapas:** (a) marcar para exclusão: a clínica fica **bloqueada** e a dona é avisada por e-mail; (b) após um **prazo de carência** (ex.: 30 dias), o expurgo apaga **fotos, malhas, simulações, vínculos e pacientes**, mantendo só o registro mínimo que a lei exige (termos e auditoria, a validar com o jurídico).
2. Confirmar digitando o **nome da clínica**.
3. Cancelar é possível durante a carência.

---

## 5. Modelo de dados

### 5.1 Alvo

```prisma
enum ClinicRole        { OWNER GERENTE PROFISSIONAL AUXILIAR RECEPCAO VISUALIZADOR }
enum ClinicStatus      { ACTIVE SUSPENDED PENDING_DELETION }
enum MembershipStatus  { ACTIVE SUSPENDED REMOVED }
enum InvitationStatus  { PENDING ACCEPTED REVOKED EXPIRED }

model User {                 // CONTA (global, sem clínica)
  id              String   @id @db.Uuid         // = id do usuário no Supabase Auth
  email           String   @unique              // sempre minúsculo
  name            String
  emailVerifiedAt DateTime?
  isPlatformAdmin Boolean  @default(false)
  active          Boolean  @default(true)
  lastLoginAt     DateTime?
  createdAt       DateTime @default(now())
  memberships     Membership[]
}

model Clinic {               // INQUILINO
  id            String       @id @default(uuid()) @db.Uuid
  name          String
  cnpj          String?      @unique
  status        ClinicStatus @default(ACTIVE)
  logoKey       String?
  retentionDays Int          @default(1825)
  deletionScheduledAt DateTime?
  createdById   String       @db.Uuid
  createdAt     DateTime     @default(now())
  memberships   Membership[]
  invitations   Invitation[]
  // patients, captures... continuam apontando para clinicId
}

model Membership {           // VÍNCULO (conta × clínica × papel)
  id          String           @id @default(uuid()) @db.Uuid
  userId      String           @db.Uuid
  clinicId    String           @db.Uuid
  role        ClinicRole
  status      MembershipStatus @default(ACTIVE)
  invitedById String?          @db.Uuid
  createdAt   DateTime         @default(now())
  @@unique([userId, clinicId])
  @@index([clinicId, status])
}

model Invitation {           // CONVITE POR E-MAIL
  id          String           @id @default(uuid()) @db.Uuid
  clinicId    String           @db.Uuid
  email       String                          // minúsculo
  role        ClinicRole
  status      InvitationStatus @default(PENDING)
  invitedById String           @db.Uuid
  expiresAt   DateTime
  acceptedAt  DateTime?
  acceptedById String?         @db.Uuid
  createdAt   DateTime         @default(now())
  // um convite PENDENTE por e-mail/clínica: índice único parcial (WHERE status = 'PENDING'), criado em SQL
  @@index([email, status])
}

model SupportAccess {        // MODO SUPORTE
  id          String    @id @default(uuid()) @db.Uuid
  adminId     String    @db.Uuid
  clinicId    String    @db.Uuid
  reason      String
  startedAt   DateTime  @default(now())
  expiresAt   DateTime
  endedAt     DateTime?
}
```

`AuditLog` ganha `actorUserId` (pode ser admin da plataforma), `clinicId` opcional (eventos da plataforma) e `supportAccessId` opcional.

### 5.2 Migração do modelo atual

Hoje `User` tem **uma** `clinicId` e **um** `role` (`ADMIN | PROFISSIONAL | RECEPCAO`). Migração em duas fases (*expand/contract*), sem derrubar nada:

1. **Expandir:** criar `Membership`, `Invitation`, `SupportAccess` e os novos campos; para cada usuário atual, criar um vínculo (`ADMIN → OWNER` para o primeiro admin da clínica e `GERENTE` para os demais; `PROFISSIONAL → PROFISSIONAL`; `RECEPCAO → RECEPCAO`). A API passa a **ler** de `Membership`.
2. **Contrair:** depois de os testes passarem, remover `users.clinic_id` e `users.role`.

O banco **Supabase está vazio** (0 tabelas, verificado em 18/11/2026), então lá o esquema novo nasce direto, sem migrar dados. A migração só importa para o banco local de demonstração.

### 5.3 Papéis no código

`packages/contracts/src/roles.ts` passa a ter `ClinicRole` (6 valores, com rótulos em português), `PERMISSIONS` indexada por esses papéis (matriz da seção 3.3) e `can(role, permission)`. `AuthContext` ganha `clinicId` (validada pelo vínculo), `role` (do vínculo) e `isPlatformAdmin`.

---

## 6. API

Prefixo `/api/v1`. `X-Clinic-Id` obrigatório nas rotas de clínica; `401` sem sessão, `403` sem vínculo/permissão, `404` para recurso de **outra** clínica (nunca revela que existe).

**Conta e sessão**

| Método | Rota | O que faz |
|---|---|---|
| POST | `/auth/signup` | Cria conta (resposta uniforme) e envia verificação |
| POST | `/auth/verify-email` | Confirma e-mail e ativa convites pendentes |
| POST | `/auth/login` | Senha (+ 2FA); devolve clínicas acessíveis |
| POST | `/auth/refresh` · `/auth/logout` | Renova e encerra sessão |
| GET | `/auth/me` | Conta, clínicas com papel, convites pendentes, `isPlatformAdmin` |
| POST | `/auth/forgot-password` · `/auth/reset-password` | Recuperação |
| POST | `/auth/mfa/enroll` · `/auth/mfa/verify` · `/auth/mfa/disable` | 2FA |
| GET/DELETE | `/auth/sessions[/:id]` | Listar e encerrar sessões |

**Clínica** (`X-Clinic-Id`)

| Método | Rota | Permissão |
|---|---|---|
| GET | `/clinic` · PATCH `/clinic` | Ver · editar identidade (logo, nome) |
| GET | `/clinic/members` | Ver equipe |
| PATCH/DELETE | `/clinic/members/:id` | Mudar papel · remover |
| GET/POST | `/clinic/invitations` | Listar · convidar |
| POST/DELETE | `/clinic/invitations/:id/resend` · `/:id` | Reenviar · revogar |
| GET | `/clinic/audit` | Auditoria da clínica |
| — | pacientes, termos, capturas, simulações, relatórios | Rotas atuais, agora sob vínculo |

**Plataforma** (somente admin da plataforma)

| Método | Rota | O que faz |
|---|---|---|
| GET/POST | `/platform/clinics` | Listar (com filtros e contagens) · criar clínica + convite da dona |
| GET/PATCH | `/platform/clinics/:id` | Detalhe · editar |
| POST | `/platform/clinics/:id/suspend` · `/reactivate` | Suspender · reativar |
| POST/DELETE | `/platform/clinics/:id/deletion` | Agendar exclusão · cancelar |
| GET | `/platform/users` · `/platform/users/:id` | Contas e vínculos |
| POST | `/platform/users/:id/suspend` | Suspender conta |
| POST | `/platform/support-access` · DELETE `/:id` | Abrir/encerrar modo suporte (motivo + duração) |
| GET | `/platform/audit` · `/platform/metrics` | Auditoria global · métricas |

---

## 7. Telas

**Públicas:** Criar conta · Entrar · Esqueci a senha · Redefinir senha · Verificar e-mail · **Escolha a clínica** · **Aguardando convite**.

**Dentro da clínica (menu "Gerência" para quem pode):**
- **Equipe:** lista de pessoas, papel, status, último acesso; convidar, mudar papel, suspender, remover; convites pendentes com reenviar/revogar.
- **Configurações da clínica:** nome, CNPJ, **logo**, retenção, termo.
- **Auditoria da clínica** (inclui acessos de suporte, destacados).
- **Seletor de clínica** no menu (e na barra superior do celular).

**Conta (qualquer pessoa):** Perfil · Senha · **2FA** · **Sessões** · Minhas clínicas.

**Console da plataforma (admin):**
- **Visão geral:** clínicas, contas, capturas do mês, reconstruções com falha, fila.
- **Clínicas:** tabela com status, dona, nº de usuários e pacientes; criar, suspender, **agendar exclusão**.
- **Detalhe da clínica:** equipe, convites, uso, auditoria; botão **Entrar como suporte** (motivo + duração).
- **Contas:** busca por e-mail; ver vínculos; suspender.
- **Auditoria global.**

Todas seguem o [`DESIGN.md`](../DESIGN.md): responsivas (tabela vira cartão no celular), acessíveis e com os mesmos estados `loading/empty/error/forbidden`.

---

## 8. Segurança e LGPD

| Tema | Medida |
|---|---|
| Isolamento | `clinicId` validado pelo vínculo a **cada** requisição; recurso de outra clínica = 404; testes e2e em **toda** rota (seção 10) |
| Defesa em profundidade | **RLS** (segurança por linha) no Postgres: a API abre cada transação com `set_config('app.clinic_id', …)` e as tabelas filtram por ela; usar um papel de banco **sem** `BYPASSRLS` para o tráfego normal. Hoje o isolamento é só da aplicação |
| E-mail | Sempre minúsculo; **verificação obrigatória** antes de qualquer convite valer; resposta uniforme em criar conta/esqueci a senha (anti-enumeração) |
| Convites | Aleatórios (≥ 128 bits), guardados como hash, validade de 7 dias, uso único, um pendente por e-mail/clínica; revogáveis |
| Bootstrap | Só com e-mail verificado e **somente se não houver** admin da plataforma |
| Admin da plataforma | 2FA obrigatório; modo suporte com motivo, prazo e auditoria visível à clínica; **sem** acesso a fotos por padrão |
| Sessões | Refresh em cookie `httpOnly` `SameSite=Strict`; revogar sessões; trocar senha encerra as outras; limite de tentativas por IP **e** por e-mail |
| Última dona | Não pode ser removida nem rebaixada; transferência exige confirmação |
| Auditoria | Criar/apagar clínica, convidar, mudar papel, remover, entrar em suporte, trocar de clínica, login, 2FA |
| Exclusão | Duas etapas com carência; expurgo apaga arquivos e banco; registro mínimo conforme jurídico |
| Segredos | Senha do banco **nunca** em arquivo versionado; só em `.env` (ignorado pelo git) ou no cofre do provedor. **A senha atual foi compartilhada em conversa e precisa ser trocada** |

---

## 9. Supabase: banco real, autenticação e arquivos

### 9.0 Situação em 18/11/2026

Só o **banco** existe no Supabase (sem URL de projeto, anon key ou service role). Por isso: login e contas são da nossa API; o Supabase é Postgres gerenciado, nada mais. As 4 migrações estão aplicadas lá, com RLS ligada. O restante desta seção descreve a opção futura (Supabase Auth e Storage).

### 9.0b O que ficaria pendente com você, se um dia adotarmos Supabase Auth

Para a 1B.1 e a 1B.3, crie o projeto novo no Supabase com a região **South America (São Paulo)** e me passe, **pelo `.env` e não pelo chat** (ou, se for pelo chat, troque os segredos depois): a **URL do projeto**, a **anon key**, a **service role key**, o **JWT secret** (ou a URL do JWKS) e as **três strings de conexão** (pooler em modo sessão, em modo transação e direct). Em **Authentication → Providers → Email**, ative a confirmação de e-mail. As chaves `service_role` e a senha do banco **nunca** vão para o front nem para o git.

### 9.1 Banco (já configurado)

- Variáveis em `apps/api/.env` (arquivo **ignorado pelo git**): `SUPABASE_DB_SESSION_URL`, `SUPABASE_DB_TRANSACTION_URL`, `SUPABASE_DB_DIRECT_URL`, e a chave `DB_TARGET=local|supabase` que escolhe o banco. `.env.example` traz os nomes **sem** segredos.
- **Conexão testada em 18/11/2026** (somente leitura): o pooler em **modo sessão** (porta 5432) e em **modo transação** (6543) conectam (Postgres 17.12, banco `postgres`, **0 tabelas**). O host **direct** (`db.<ref>.supabase.co`) **não resolve** nesta rede: ele é só IPv6.
- **Decisão:** usar o **pooler em modo sessão** para a API **e** para migrações (aceita statements preparados e DDL). O modo transação fica reservado para funções serverless, se algum dia houver.
- **O seed de demonstração se recusa a rodar com `DB_TARGET=supabase`**, porque criaria usuários com senha conhecida num banco real.
- **Antes de migrar:** trocar a senha do banco (foi exposta em conversa) e decidir a região (9.4).

### 9.2 Autenticação: Supabase Auth ou própria (decisão D11)

| | **A · Supabase Auth via API (recomendado)** | B · Auth própria |
|---|---|---|
| Criar conta, verificar e-mail, recuperar senha, 2FA | Já existem no serviço; configura-se SMTP e modelos de e-mail | Construir tudo (e é fácil errar em segurança) |
| Sessão no navegador | A **API** conversa com o Supabase e mantém o refresh em cookie `httpOnly` (o navegador nunca guarda token de longa duração) | Já existe (argon2 + refresh rotativo) |
| Dependência | Mais uma peça externa (identidade fica no Supabase) | Menos dependência, mais código nosso |
| Esforço | Médio | Alto |
| Risco | Integração e limites de envio de e-mail | Falhas de segurança em recuperação de senha/2FA |

**Recomendação: A.** O Supabase cuida de identidade; **vínculos, papéis e clínicas continuam no nosso banco** (`User.id` = id do Supabase). A clínica ativa vem do cabeçalho `X-Clinic-Id` e é validada contra o vínculo, então não há clínica "dentro do token". Os recursos citados (verificação de e-mail, recuperação, TOTP) são do Supabase Auth; **confirmo os detalhes na documentação atual no início da sub-etapa 1B.3** antes de implementar.

### 9.3 Arquivos (fotos e malhas)

O Supabase Storage tem endpoint compatível com S3; a API já tem driver S3 (`STORAGE_DRIVER=s3`). **A validar** na sub-etapa 1B.1: URLs assinadas de curta duração, bucket **privado**, limites de tamanho. Alternativa: S3/R2 próprio.

### 9.4 Região e LGPD ⚠️

O endereço do pooler (`aws-0-us-east-2`) indica que o projeto está em **Ohio (EUA)**. Fotos de rosto e modelos 3D são dados biométricos de **pacientes brasileiros**, e guardá-los fora do Brasil é **transferência internacional** de dados, que a LGPD condiciona a bases e garantias específicas (a validar com o jurídico). **O banco está vazio**, então hoje é barato recriar o projeto em **São Paulo (`sa-east-1`)**; depois que houver dados, vira migração.

### 9.5 Outros pontos

- **Backups:** confirmar o plano do Supabase (retenção e PITR) e testar uma restauração antes de produção.
- **RLS:** a API conecta com um papel de banco; para a RLS valer, o tráfego normal deve usar um papel **sem** `BYPASSRLS` (ver seção 8).
- **Prisma:** o gerador atual e o adaptador `pg` funcionam com o pooler em modo sessão; migrações com `prisma migrate deploy`.

---

## 10. Testes obrigatórios

Cada item abaixo é um teste automatizado (e2e da API, com Postgres em memória e, na CI, também contra um Postgres real):

1. **Isolamento:** conta com vínculo na clínica A **nunca** lê, altera ou apaga nada da B, em **todas** as rotas (pacientes, termos, capturas, reconstruções, simulações, relatórios, equipe, auditoria).
2. **Cabeçalho forjado:** `X-Clinic-Id` de clínica sem vínculo → `403`; de clínica inexistente → `403` (mesma resposta, sem revelar).
3. **Matriz de permissões:** para cada papel e cada permissão, o resultado bate com a tabela da seção 3.3.
4. **Escalada:** ninguém promove a si mesmo; gerente não mexe em dona; a última dona não sai.
5. **Convite:** só vale com e-mail **verificado**; expira; uso único; revogado não vale; e-mail em caixa diferente bate.
6. **Anti-enumeração:** criar conta e esqueci a senha respondem igual para e-mail existente e inexistente.
7. **Bootstrap:** vira admin só com e-mail verificado e **somente** sem admin existente; depois não vale mais.
8. **Multi-clínica:** conta em duas clínicas lista as duas, troca entre elas e vê dados **só** da ativa.
9. **Suspensão/remoção:** vale na próxima requisição, sem esperar o token expirar.
10. **Modo suporte:** exige motivo; expira; fica na auditoria **da clínica**; fora da janela, admin **não** lê pacientes.
11. **Exclusão de clínica:** carência respeitada; cancelar restaura; expurgo apaga arquivos e banco.
12. **Migração:** subir do zero e a partir do banco antigo gera os mesmos vínculos esperados.
13. **RLS:** com o papel restrito, uma consulta sem `app.clinic_id` retorna **zero** linhas.

---

## 11. Sub-etapas de implementação

Entram na **Etapa 1B** do guia, depois do design system (etapa 1) e antes do simulador (etapa 2), porque login, convites e o seletor de clínica mudam o shell do app.

| Sub-etapa | Entrega | Pronto quando |
|---|---|---|
| **1B.0 Preparação** | ~~Decidir região e Auth~~ (decidido). **Você:** criar o projeto em **São Paulo**, trocar a senha do banco, definir o provedor de e-mail | Projeto Supabase definitivo, segredos fora do repositório |
| **1B.1 Banco real** | Migrar o esquema atual para o Supabase; teste de conexão e de backup; storage S3 validado | `pnpm db:setup`-equivalente contra o Supabase sem seed; API sobe com `DB_TARGET=supabase` |
| **1B.2 Modelo ✅** | `User`/`Clinic`/`Membership`/`Invitation`/`SupportAccess`; migração *expand* (a fase *contract* fica para depois); papéis e matriz no contrato; guards novos (`X-Clinic-Id`) | Testes 1, 2, 3, 4, 9 e 12 verdes. **Feito em 18/11/2026**: 55 testes da API, 13 do contrato e 19 do web passam. A fase *contract* (remover `users.clinic_id` e `users.role`) ainda não foi feita |
| **1B.3 Contas ✅ (simples)** | Criar conta (sem verificação de e-mail), login, trocar senha, comando `admin:create`. **Adiado:** verificação, recuperação por e-mail, sessões, 2FA | Teste 7 substituído pelo comando `admin:create` (não há "primeiro e-mail verificado" sem e-mail). Testes 6 e 7 originais voltam quando houver e-mail |
| **1B.4 Convites e vínculos ✅** | Convidar por e-mail, ativar ao criar a conta/no login, mudar papel, suspender; multi-clínica | Testes 5 (convite) e 8 (multi-clínica) verdes. Sem e-mail verificado, o convite vale para quem usar o e-mail |
| **1B.5 Console da plataforma ✅ (parcial)** | Criar/suspender/agendar exclusão de clínica; contas; métricas | Fluxos 4.2 e 4.7 completos; 4.9 só até o **agendamento** (o expurgo automático ainda não existe); falta a auditoria global |
| **1B.6 Gerência da clínica** | Telas de Equipe, Configurações, Auditoria, Conta; seletor de clínica no shell | Fluxos 4.3, 4.5 e 4.6 completos |
| **1B.7 Suporte e auditoria** | Modo suporte com motivo/prazo; auditoria visível à clínica | Teste 10 verde |
| **1B.8 RLS** | Políticas por `clinic_id` + papel de banco restrito | Teste 13 verde |

---

## 12. Decisões e perguntas em aberto

| # | Decisão / pergunta | Padrão adotado |
|---|---|---|
| D11 ⏸ | **Auth:** em 18/11/2026 só o **banco** é Supabase; o login é **próprio** (opção B). Supabase Auth fica adiado, sem URL nem chaves de projeto. | **B por enquanto**, com o *mailer* imprimindo links no log até haver provedor de e-mail |
| D12 ⚠️ | **Região do Supabase:** o banco em uso está em **Ohio**. | Tabelas criadas lá em 18/11/2026; **migrar para São Paulo antes de ter paciente real** |
| D13 ⚠️ | **Admin da plataforma e dados de pacientes:** só modo suporte (recomendado) ou acesso total direto? | Modo suporte; acesso total exigiria base legal e contrato com as clínicas |
| D14 | Papéis da clínica: Dona, Gerente, Profissional, Auxiliar, Recepção, Visualizador | Como na seção 3; ajustar se faltar algum |
| D15 | Convite vira vínculo **automaticamente** no primeiro login verificado | Sim, com aviso; a pessoa pode sair da clínica depois |
| D16 | 2FA obrigatório para admin da plataforma e donas | Sim |
| D17 | Provedor de e-mail transacional (SMTP próprio, Resend, etc.) | A definir na 1B.0 |
| D18 | Prazo de carência para apagar clínica | 30 dias |
| D19 | Admin da plataforma pode ser mais de uma pessoa? | Sim, criado por outro admin |
| D20 | Uma clínica pode ter **filiais**? | Fora do escopo agora; hoje 1 clínica = 1 inquilino |
