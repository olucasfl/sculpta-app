# Etapa 6 — Rosto real do paciente: o que está pronto e o que falta

**Estado (19/11/2026): prova de conceito do caminho B (FLAME 2023 Open, em CPU) funcionando nas fotos de uma pessoa; ainda NÃO integrada à API nem ao simulador.** O app continua mostrando o **template genérico** com o selo "Modelo demonstrativo". Os scripts estão em `services/worker/scripts` (`fit_poc.py`, `bake_texture.py`, `ear_align.py`, `ear_segment.py`, `compare_fits.py`). Não houve GPU: o ajuste leva ~5 s e a textura ~35 s numa CPU comum (uma pessoa, sem medir memória).

## 0. O que a prova de conceito mostrou

- **Vistas e geometria (uma pessoa, suas 9 fotos):** trocar 9 vistas por 5 muda a forma em ~1,0 mm (rosto); por 3 vistas (frente e 45°), ~1,1 mm. Isso mede **estabilidade**, não exatidão: hoje o ajuste usa só 105 pontos por foto e é dominado pelo modelo FLAME e pela frontal. As vistas extras ajudam mais a **textura** do que a forma; só um refinamento por imagem (silhueta/cor) deve fazê-las pesar na geometria.
- **Silhueta de perfil (Fase 3):** a borda do rosto na foto de perfil (pele contra o fundo, por cor de croma) entra como restrição linear na forma. Com o recorte por GrabCut o ajuste NÃO melhorava: ele pega retângulos de fundo nas fotos de perfil (e a textura usa o mesmo recorte; ainda a melhorar). Com a máscara de pele, o erro de silhueta do perfil cai de 2,6% para 1,4% e de 3,7% para 2,4% da altura do rosto, sem piorar os pontos; a forma muda ~1,5 mm no rosto. **Teto do método:** em rosto sintético com pontos exatos, o erro médio da forma é ~4,8 mm (4,56 mm com a silhueta): 105 pontos por foto não fixam a forma toda. Em fotos reais é pior. O giro de perfil que o ajuste acha (~65–70°) bate com o mínimo do erro de silhueta, então o perfil real é cerca de 70°, não 90°.
- **Tempo:** ~65 s em CPU para 9 fotos (meta do guia: menos de 1 minuto; ainda não otimizado).
- **Orelha:** a do FLAME cai deslocada e é pequena; a orelha real é segmentada na foto de perfil (GrabCut com a malha como semente) e a malha é deformada até ela (IoU 0,86 e 0,92). Só testado em uma pessoa.
- **Não validado:** outras pessoas, outros tons de pele, cabelo sobre a orelha, óculos, fundos claros. Precisa de pelo menos 3 pessoas com termo assinado.
- **Licença:** FLAME 2023 Open é CC BY 4.0 (exige crédito); a textura oficial do FLAME é não comercial e **não é usada** (UV e textura próprios).

## 1. O que já está pronto no app

| Item | Onde | Estado |
|---|---|---|
| Contrato API → worker | `packages/contracts/src/worker.ts` | Pronto: de **5 a 10** vistas, assinatura HMAC com janela de 5 min, resposta `DONE` (com `qualityScore`) ou `FAILED` (`FACE_NOT_FOUND`, `LOW_QUALITY`, `TIMEOUT`, `INTERNAL`) |
| Vistas | `ANGLE_RULES` em `captures.ts` | 9 vistas (frente, 20°, 45°, perfil de cada lado, queixo para cima e para baixo); 5 obrigatórias |
| Fila com tentativas e retorno de erro | `apps/api/src/reconstructions` | Pronta e testada com um worker simulado (`worker-queue.test.ts`) |
| Worker simulado | `services/worker` (FastAPI) | Aceita 5 a 10 vistas e devolve o template; **não foi executado nesta máquina** (sem Python) |
| Confiança do modelo | `modelConfidence` | Pronta: `DEMO` para template; alta/média/baixa a partir do `qualityScore`; baixa **não libera** o simulador |
| Aparência (pele, olhos, cabelo) | Etapa 3 | Pronta para o template; para o rosto real a cor viria da foto (já implementado) |
| Descarte das fotos no worker | contrato | O worker recebe URLs pré-assinadas de curta duração e grava só o `.glb` no destino; **a regra "nada persiste no worker" precisa ser verificada no worker real** |

## 2. O que falta, e por que não dá para fazer daqui

1. **Fase 0, prova de conceito (precisa de GPU).** Rodar a reconstrução com 5, 9 e 16 quadros e medir tempo, memória de vídeo e qualidade. Sem isso, **não sei quantas vistas realmente importam**, e a qualidade com poucas fotos é desconhecida.
2. **Licenças (precisa de você).**
   - VGGTFace/Pixel3DMM: licença **CC BY-NC** (não comercial). Para uso comercial é preciso falar com os autores.
   - VGGT-1B-Commercial: formulário da Meta.
   - **Sem resposta, o uso comercial não é permitido.** Alternativas: outro estimador, ou outra via de reconstrução. A decisão é sua.
3. **Worker real**: pré-processamento, reconstrução, textura (projeção das fotos, mistura por ângulo, remoção de sombra), `.glb` texturizado, `qualityScore` de verdade (erro de reprojeção, cobertura de textura, nitidez).
4. **FLAME 2023 Open** (CC BY): exige crédito na tela "Sobre" (a tela ainda não existe).
5. **Hospedagem da GPU** (RunPod/Modal ou própria) e o custo por reconstrução.

## 3. Roteiro sugerido da Fase 0 (quando houver GPU)

1. Capturar 3 pessoas (com termo) com o app: 9 fotos e um vídeo de 20 s cada.
2. Rodar a reconstrução com 5 vistas, com 9 vistas e com 16 quadros do vídeo.
3. Registrar por execução: tempo total, pico de memória de vídeo, `qualityScore` e uma nota visual de 1 a 5 de quem foi fotografado ("me reconheço?").
4. Decidir o conjunto mínimo de vistas e se o vídeo entra como caminho principal.
5. Só então implementar o worker real contra o contrato da seção 1 (não é preciso mudar a API).

## 4. Critérios de aceite da etapa (do guia)

- A pessoa fotografada se reconhece no modelo.
- Reconstrução em menos de 1 minuto.
- `LOW_QUALITY` e `FACE_NOT_FOUND` chegam ao usuário com instrução clara (as mensagens já existem em `RECONSTRUCTION_ERRORS`).
- Nenhuma foto persiste no worker.

## 5. Riscos

- É a etapa que decide o produto.
- Em perfil de 90° o detector do navegador costuma falhar; o modelo pode ficar sem esse lado, o que o worker precisa tolerar (5 a 10 vistas, perfil opcional na prática).
- O banco do Supabase está na região de Ohio (EUA); fotos e modelos 3D são dados biométricos. **Migrar para São Paulo antes de pacientes reais** (risco R9).

## 6. Como rodar o worker com o rosto reconstruído (FLAME, CPU)

Já funciona de ponta a ponta no seu computador (captura → API → worker → simulador), com uma pessoa. Não foi testado em Docker nem no CI com os modelos.

1. Modelos (licença própria, fora do Git) em `services/worker/assets/flame/x/` (`flame2023_Open.pkl`, `FLAME_masks.pkl`, `mediapipe_landmark_embedding.npz`) e `services/worker/assets/face_landmarker.task`. Outra pasta: variáveis `FLAME_DIR` e `LANDMARKER_MODEL`.
2. Dependências: `pip install -r requirements-face.txt` (dentro do `.venv` do worker).
3. Worker: `RECONSTRUCTOR=flame WORKER_SECRET=<32+ caracteres> python -m uvicorn app.main:app_factory --factory --port 8000`.
4. API: `WORKER_URL=http://127.0.0.1:8000`, o mesmo `WORKER_SECRET`, `QUEUE_ENABLED=true` e `WORKER_TIMEOUT_MS=240000` (a reconstrução leva ~1 min em CPU).
5. Teste de fumaça com fotos reais (locais): `SMOKE_PHOTOS_DIR=<pasta> SMOKE_WAIT_S=240 node --env-file=.env scripts/smoke-flow.mjs` em `apps/api`.
6. Só o worker, sem a API: `python scripts/run_pipeline.py <pasta com as fotos> saida.glb`.

**O que o simulador faz com esse modelo:** usa a textura das fotos (a pele, os olhos e o cabelo do painel "Aparência" valem só para o modelo demonstrativo), mostra o selo "Reconstrução aproximada" com a qualidade e a confiança (no máximo **média**: o `qualityScore` mede só a coerência dos pontos entre as fotos, e não há validação contra um escaneamento), e aplica os 15 sliders e o pincel na malha nova.

**Limites conhecidos:** testado só em uma pessoa; cabelo, pescoço e nuca são aproximações; a orelha depende de uma segmentação clássica (GrabCut); os sliders reaproveitam as fórmulas do template sobre âncoras do rosto e ainda não foram validados com um profissional.
