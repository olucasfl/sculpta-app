# Simulador Estético 3D — Planejamento consolidado

> Versão 0.2 · 18/11/2026
> Junta o **Prompt Mestre** (A: produto, UX, ética, MVP honesto no navegador) com o **Documento Técnico v0.1** (B: reconstrução real com VGGTFace/FLAME, backend, LGPD, roadmap guiado por risco).
> Itens **[Fase 0]** dependem da prova de conceito do VGGTFace.

---

## 1. O que cada documento faz melhor

| Tema | A — Prompt Mestre | B — Documento Técnico | Decisão |
|---|---|---|---|
| Reconstrução 3D | Não tem. Usa template genérico como *fallback* honesto | VGGTFace → malha fiel com topologia FLAME | **B** como objetivo, **A** como modo demo/contingência |
| Malha de demonstração | Template genérico qualquer | — | **Template FLAME 2023 Open**: mesma topologia da malha real, então as máscaras de região servem para os dois |
| Deformação | Morph targets no navegador (fluido) | MVP chama o worker a cada slider (`/v1/deform`); morph targets só "depois" | **Híbrido**: o worker calcula uma vez as bases biharmônicas por slider e as entrega como morph targets no `.glb`. Sliders 100% no navegador desde o MVP |
| Regiões e sliders | Regiões amplas + controles genéricos (intensidade/volume/projeção/contorno), inclui infraorbital e nasolabial | 10 sliders nomeados e anatômicos, faixa -1..1, contrato Zod | Sliders nomeados de **B** + regiões extras de **A** (infraorbital, nasolabial) |
| Rugas / botox | "Quando compatível" | Fora do MVP (é textura e expressão, não volume) | **B**: fora do MVP |
| Captura | UX: upload como alternativa, erros de câmera, checklist, overlay de landmarks | Liberação por yaw, enquadramento 40–70%, nitidez (Laplaciano), JPEG 2048, sem EXIF | **Os dois**, mais um fallback manual para perfil (ver §5) |
| Backend | Supabase + modo demo local | NestJS + Prisma + Postgres + BullMQ + MinIO | **B** (fila de GPU, multi-clínica, auditoria). Supabase sai para não manter dois backends |
| Multi-clínica / papéis | Não tem | `clinicId` em tudo, RBAC, AuditLog | **B** |
| Consentimento | Separa simulação de marketing/pesquisa; nunca treinar modelos | Versão do termo, assinatura, IP, revogação que apaga os biométricos | **Os dois** |
| Versões de simulação | `SimulationVersion` com nome e descrição | Só `Simulation` | **A** |
| Ética / honestidade | Forte: sem promessa, sem dosagem, sem recomendação, avisos | Princípio "ilustrativa" e marca d'água | **A** como regra de produto, aplicada também à malha real |
| Qualidade e entrega | Critérios de aceite, a11y, estados vazio/erro/loading | CI, Conventional Commits, ADRs, roadmap por risco | **Os dois** |
| PWA para tablet | Não | Sim | **B** |

### Lacunas que nenhum dos dois cobre bem

1. **MediaPipe falha em perfil 90°.** O Face Landmarker costuma perder o rosto perto do perfil completo, e a regra de B ("perfil = 80°–100°") pode travar a captura. Para perfil, usar a última estimativa válida + guia de silhueta, com liberação manual sinalizada.
2. **5 fotos vs 16 vistas.** O VGGTFace foi demonstrado com 16 vistas. Planejar desde já um modo "vídeo curto girando a cabeça" com extração de quadros, caso 5 fotos não bastem.
3. **Licenças.** VGGT, Pixel3DMM e VGGTFace precisam de confirmação para uso comercial **antes** de investir no worker. FLAME 2023 Open (CC-BY-4.0) exige cadastro para baixar e atribuição.
4. **Plano B da reconstrução.** Se o VGGTFace não passar na Fase 0, avaliar ajuste de FLAME por landmarks multi-vista (mais simples, menos fiel). A topologia FLAME continua, então o resto do sistema não muda.
5. **Escala.** Sliders **sem unidade** no MVP ("-1 a 1", rótulos visuais). Milímetros só depois de calibrar, e nunca como dose ou volume de produto.
6. **Desempenho em tablet.** SSAO, HDRI e `MeshPhysicalMaterial` com sheen pesam. Ter um preset de qualidade "tablet" com pós-processamento desligado.

---

## 2. Princípios do produto (não negociáveis)

- A simulação é **ilustrativa**: aviso discreto no simulador, marca d'água nas exportações e cláusula no termo.
- O sistema **não** recomenda procedimento, não diagnostica e não sugere dose, volume de produto ou técnica.
- Nunca chamar o template de "reconstrução". Nunca aplicar a foto do paciente sobre a malha genérica.
- O selo de qualidade aparece sempre no viewer: `Modelo demonstrativo (template)` · `Reconstrução — qualidade 0,87` · `Reconstrução — baixa qualidade`.
- Fotos e malhas são dados biométricos: bucket privado, URLs de 5 min, chaves sem nome do paciente.
- Imagens de pacientes não são usadas para treinar modelos.

---

## 3. Escopo do MVP

**Dentro**
- Clínicas, usuários (admin, profissional, recepção), pacientes com o mínimo de dados (nome; telefone e data de nascimento opcionais; código interno).
- Termo digital: consentimento obrigatório para captura/simulação e opcional, separado, para marketing e pesquisa. Assinatura, versão, IP e revogação.
- Captura guiada de 5 vistas, câmera ou upload.
- Reconstrução em GPU serverless, com o modo template como contingência e para demonstração.
- Simulador 3D com sliders por região, antes/depois (cortina e lado a lado com câmera sincronizada), desfazer/refazer, versões nomeadas.
- Exportar frente / 45° / perfil, antes e depois, com marca d'água e sem nome do paciente por padrão.
- Histórico por paciente, exclusão real de biométricos, AuditLog.
- PWA instalável no tablet.

**Fora**: rugas e botox, simulação cirúrgica, medidas certificadas, app nativo, prontuário e agenda.

---

## 4. Arquitetura

O diagrama de B continua valendo, com uma mudança: **o `/v1/deform` por slider sai do caminho crítico.**

```
Tablet (PWA: React + R3F + MediaPipe)
   │ REST/JWT                    │ upload/download (URL pré-assinada)
   ▼                             ▼
API NestJS ── Postgres        Storage S3/MinIO (fotos, .glb)
   │  └─ BullMQ/Redis              ▲
   └── HTTP + HMAC ──► Worker GPU (FastAPI: VGGTFace + textura + bases de deformação)
```

Decisões (cada uma vira um ADR em `docs/adr/`):

1. **Worker stateless, só HTTP, URLs pré-assinadas** (B).
2. **A fila fica na API** (B).
3. **Arquivos nunca passam pela API** (B).
4. **Deformação no navegador desde o MVP** (novo). O worker devolve um `.glb` com malha base, UV, textura e **um morph target por slider**, calculado por deformação biharmônica (libigl) com âncoras e transição. O front só ajusta `morphTargetInfluences`: resposta imediata, sem custo de GPU por ajuste, e o resultado é igual em qualquer dispositivo porque as bases são fixas. A `Simulation` guarda só os parâmetros; o `.glb` final é opcional.
5. **Topologia FLAME em todo lugar** (B + A). Template e reconstrução compartilham vértices, máscaras e sliders, e o modo demo usa o mesmo código do modo real.
6. **Multi-clínica desde o início** (B): `clinicId` vem do token e é filtrado em toda query, com testes de isolamento.
7. **Contratos Zod compartilhados** (B) em `packages/contracts`, incluindo os nomes dos sliders, que também são lidos pelo worker.
8. **Camada de dados abstraída no front** (A): `ApiRepository` (real) e `LocalRepository` (IndexedDB, demo e offline de desenvolvimento), com o aviso de que o modo local não serve para dados clínicos reais.

---

## 5. Fluxos

### 5.1 Captura → reconstrução
1. Paciente sem termo válido → captura bloqueada, com link para o termo.
2. `POST /patients/:id/captures` → sessão + 5 URLs de upload.
3. Para cada vista: câmera com silhueta e checklist (luz frontal, cabelo preso, sem óculos, expressão neutra).
   - Liberação automática quando todos estiverem ok: yaw na faixa (frente ±5°, 45° = 35–55°), rosto com 40–70% da altura, nitidez acima do limiar.
   - **Perfil**: se o rosto não for detectado, permitir captura manual com aviso "validação automática indisponível nesta vista".
   - Alternativa: upload de arquivo, com a mesma validação.
   - Erros claros: permissão negada, câmera ocupada, sem rosto, imagem borrada.
4. No navegador: JPEG com lado maior de 2048 px, sem EXIF, salvando yaw, score de nitidez e landmarks da frontal como metadados.
5. `POST /captures/:id/complete` → `Reconstruction QUEUED`. Front consulta o status a cada 2 s.
6. Worker: pré-processamento → VGGTFace → textura → qualityScore → bases de deformação → `.glb`.
7. `DONE` abre o simulador. `FAILED` mostra o motivo (`FACE_NOT_FOUND`, `LOW_QUALITY`, `TIMEOUT`, `INTERNAL`) e a ação ("refazer vista perfil direito"). Retry automático só para `TIMEOUT`/`INTERNAL`.
8. **Sem worker configurado** (dev/demo): a sessão abre o simulador com o template FLAME e o selo "Modelo demonstrativo".

### 5.2 Simulação
1. Carregar o `.glb` (real ou template).
2. Escolher por **procedimento** (preset de interface) ou por **região** (lista ou clique no modelo, com destaque da máscara).
3. Ajustar sliders: atualização em tempo real; o histórico registra ao soltar.
4. Antes/depois: cortina arrastável, lado a lado com câmera sincronizada ou alternância.
5. Salvar versão com nome e descrição. Versões ficam no histórico do paciente.
6. Exportar 3 vistas × antes/depois com marca d'água. Código interno do paciente só se o usuário marcar.

---

## 6. Regiões e sliders (contrato v1)

Todos sem unidade, de **-1 a 1**, com deslocamento máximo definido em `sliders.json` e validado com um profissional.

| Parâmetro | Região | Efeito visual | Base de deformação |
|---|---|---|---|
| `nose.bridgeWidth` | Dorso nasal | Afina/alarga | Escala lateral local |
| `nose.dorsumHeight` | Dorso nasal | Suaviza/eleva o perfil | Normal |
| `nose.tipProjection` | Ponta nasal | Projeta/retrai | Eixo frontal |
| `nose.tipRotation` | Ponta nasal | Eleva/abaixa | Eixo vertical |
| `nose.alarWidth` | Asas nasais | Estreita/alarga | Escala lateral |
| `lips.upperVolume` | Lábio superior | Volume | Normal, peso maior no centro |
| `lips.lowerVolume` | Lábio inferior | Volume | Normal |
| `lips.contour` | Contorno labial | Definição da borda | Faixa do vermelhão, para fora |
| `chin.projection` | Mento | Projeção | Frontal |
| `chin.height` | Mento | Alonga/encurta | Vertical |
| `jaw.width` | Ângulo mandibular | Define/afina | Escala lateral |
| `malar.volume` | Malar | Volume | Normal |
| `malar.projection` | Malar | Projeção | Diagonal frontal-superior |
| `infraorbital.volume` | Infraorbital | Suaviza a depressão | Normal |
| `nasolabial.volume` | Sulco nasolabial | Suaviza o sulco | Normal (depende da qualidade da malha) |

- Regiões bilaterais são simétricas por padrão; ajuste por lado pode vir na v2.
- **Presets são só configuração de interface** (quais sliders aparecem e com que rótulo), nunca valores iniciais ou plano clínico. Ex.: "Preenchimento labial" mostra `lips.*`; "Rinomodelação" mostra `nose.*` com o aviso de que procedimento não cirúrgico não reproduz mudança estrutural.
- Máscaras FLAME: `nose`, `lips`, `forehead`, `face` vêm prontas. Queixo, mandíbula, malar, infraorbital e nasolabial são pintadas uma vez no Blender sobre o template e salvas em `assets/regions/`, com pesos suaves (0–1), não só índices.

---

## 7. Modelo de dados

O schema Prisma de B, com estes ajustes:

- `Patient`: `internalCode` (identificador da clínica), `notes`; `birthDate` e `phone` opcionais (minimização); `deletedAt` para exclusão lógica do cadastro e exclusão **real** dos biométricos.
- `Consent`: `scopes` (`SIMULATION` obrigatório, `MARKETING` e `RESEARCH` opcionais), `termVersion`, `signatureKey`, `ip`, `signedAt`, `revokedAt`. Revogar `SIMULATION` dispara a exclusão de fotos, malhas e simulações.
- `Photo`: `yawDeg`, `sharpness`, `faceDetected`, `validation` (`AUTO` | `MANUAL`), `landmarks` (JSON, só a frontal), `width`, `height`.
- `Reconstruction`: `source` (`VGGTFACE` | `TEMPLATE` | `FALLBACK_FIT`), `qualityScore`, `meshKey`, `sliderSchemaVersion`.
- `Simulation` (pertence a uma `Reconstruction`) → várias `SimulationVersion` (`name`, `description`, `params` JSON validado pelo contrato, `thumbnailKey`, `createdById`).
- `AuditLog`: como em B. Registra visualização de paciente, download de malha, exportação, exclusão e revogação.
- Chaves no storage: `clinics/{clinicId}/captures/{captureId}/{ANGLE}.jpg` e `.../reconstructions/{id}.glb`, nunca com nome.

---

## 8. Repositório

O monorepo de B, com dois acréscimos:

```
simulador-3d/
├── apps/web/           # React 19 + Vite + TS + R3F + Tailwind + shadcn/ui (PWA)
├── apps/api/           # NestJS + Prisma
├── services/worker/    # FastAPI + VGGTFace + libigl + trimesh
│   └── app/mock.py     # devolve o template FLAME com bases (sem GPU)
├── packages/contracts/ # Zod: entidades, API, sliders
├── packages/face-assets/   # NOVO: template FLAME + máscaras + sliders.json (fonte única p/ web e worker)
├── infra/              # docker-compose (postgres, redis, minio, worker-mock)
└── docs/adr/
```

`apps/web/src/features/simulator/engine/` isola a lógica de região/peso/morph (testável sem React), como pede A.

---

## 9. Roadmap (sprints de 2 semanas)

Duas trilhas em paralelo a partir da Fase 0: **risco técnico** (worker) e **produto** (front + API). O produto não espera a IA porque roda sobre o template FLAME.

| Fase | Trilha | Entrega | Pronto quando |
|---|---|---|---|
| **0 — PoC + licenças** | IA | VGGTFace em GPU alugada: 5 fotos vs 8 e 16 quadros de vídeo; parecer de licença de VGGT/Pixel3DMM/VGGTFace | Go/no-go documentado em ADR, com o número de vistas necessário |
| **1 — Fundação** | Produto | Monorepo, contracts, compose, Prisma, auth + RBAC, clínicas, pacientes, termo, CI | Login → cadastrar paciente → assinar termo, local |
| **2 — Captura** | Produto | Captura guiada (MediaPipe, yaw, enquadramento, nitidez, perfil manual, upload), compressão, upload pré-assinado | 5 vistas salvas no MinIO com metadados |
| **3 — Simulador sobre o template** | Produto | Template FLAME + máscaras + bases calculadas offline; viewer, iluminação, sliders, antes/depois, versões, exportação | Fluxo completo com o selo "demonstrativo", sliders a 60 fps no tablet |
| **4 — Worker real** | IA | `/v1/reconstruct` + textura + qualityScore + bases no `.glb`; fila, retry e polling | Fotos → `.glb` texturizado com morph targets em < 1 min |
| **5 — Integração** | Ambas | Simulador abre a reconstrução real; métricas de qualidade na tela | Mesmo fluxo da Fase 3 com o rosto real |
| **6 — Endurecimento** | Ambas | LGPD (retenção, exclusão real, auditoria), testes de isolamento, PWA, staging, revisão jurídica do termo | Clínica piloto |

Se a Fase 0 falhar, as Fases 1–3 continuam valendo; muda só a Fase 4 (plano B de reconstrução, §1).

---

## 10. Critérios de aceite do MVP

- Build, lint, typecheck e testes passam no CI (web, api, contracts, worker).
- Pacientes: criar, editar, buscar e excluir, com exclusão real dos biométricos.
- Captura bloqueada sem termo; termo com escopos separados e revogável.
- 5 vistas por câmera ou upload, revisáveis e refazíveis, com validação automática ou manual sinalizada.
- Reconstrução com estados visíveis; contingência para o template com selo claro.
- Viewer interativo: orbitar, zoom limitado, vistas frente/45°/perfil, wireframe, destaque de região.
- Sliders reversíveis, desfazer/refazer, reset por região e geral.
- Antes/depois em cortina e lado a lado com câmera sincronizada.
- Versões salvas e listadas no histórico; exportação com marca d'água.
- Isolamento por clínica coberto por testes; AuditLog gravando as ações sensíveis.
- Estados vazio, carregando, erro e sucesso; navegação por teclado e foco visível.
- README de cada app com como rodar local em até 5 comandos; ADRs das decisões da §4.
- Nenhuma tela afirma reconstrução, precisão ou medida que não tenha sido implementada.

---

## 11. Questões em aberto

- [ ] Qualidade com 5 fotos; precisa de vídeo? **[Fase 0]**
- [ ] Licença comercial de VGGT, Pixel3DMM e VGGTFace **[Fase 0, bloqueante]**
- [ ] VRAM e tempo por reconstrução **[Fase 0]**
- [ ] Formato de entrada e saída do VGGTFace **[Fase 0]**
- [ ] Emendas da textura com 5 vistas **[Fase 0]**
- [ ] Faixas máximas dos sliders: validar com um profissional
- [ ] Texto do termo e prazo de retenção: validar com o jurídico
- [ ] O MediaPipe detecta perfil 90° nas condições da clínica? (define se o perfil é manual)

---

## 12. Status de implementação (18/11/2026)

| Fase | Status | Observações |
|---|---|---|
| 0 — PoC + licenças | **Não iniciada** | Exige GPU, pesos do VGGTFace e parecer jurídico. Fora do alcance do ambiente de desenvolvimento. |
| 1 — Fundação | Concluída | Auth, papéis, clínicas, pacientes, termo, auditoria, CI. |
| 2 — Captura | Concluída | MediaPipe no navegador, upload direto pré-assinado. Câmera ao vivo não validada (sem câmera no teste). |
| 3 — Simulador sobre o template | Concluída | Template **procedural** no lugar do FLAME (ADR 0006); bases suaves, não biharmônicas. |
| 4 — Worker | Parcial | Contrato, HMAC, fila, retries e reconstrutor mock prontos; pipeline VGGTFace ausente. Fila no Postgres em vez de Redis/BullMQ (ADR 0005). |
| 5 — Integração | Concluída com o mock | Captura → fila → worker → `.glb` no storage → simulador, validado no navegador. |
| 6 — Endurecimento | Parcial | Retenção, auditoria, PWA, Dockerfiles, compose e CSP prontos. Faltam: staging, revisão jurídica, ícones iOS e rodar Docker/CI. |
