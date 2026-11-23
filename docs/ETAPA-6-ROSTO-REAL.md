# Etapa 6 — Rosto real do paciente: o que está pronto e o que falta

**Estado (19/11/2026): prova de conceito do caminho B (FLAME 2023 Open, em CPU) funcionando nas fotos de uma pessoa; ainda NÃO integrada à API nem ao simulador.** O app continua mostrando o **template genérico** com o selo "Modelo demonstrativo". Os scripts estão em `services/worker/scripts` (`fit_poc.py`, `bake_texture.py`, `ear_align.py`, `ear_segment.py`, `compare_fits.py`). Não houve GPU: o ajuste leva ~5 s e a textura ~35 s numa CPU comum (uma pessoa, sem medir memória).

## 0. O que a prova de conceito mostrou

- **Vistas e geometria (uma pessoa, suas 9 fotos):** trocar 9 vistas por 5 muda a forma em ~1,0 mm (rosto); por 3 vistas (frente e 45°), ~1,1 mm. Isso mede **estabilidade**, não exatidão: hoje o ajuste usa só 105 pontos por foto e é dominado pelo modelo FLAME e pela frontal. As vistas extras ajudam mais a **textura** do que a forma; só um refinamento por imagem (silhueta/cor) deve fazê-las pesar na geometria.
- **Silhueta de perfil (Fase 3):** a borda do rosto na foto de perfil (pele contra o fundo, por cor de croma) entra como restrição linear na forma. Com o recorte por GrabCut o ajuste NÃO melhorava: ele pega retângulos de fundo nas fotos de perfil (e a textura usa o mesmo recorte; ainda a melhorar). Com a máscara de pele, o erro de silhueta do perfil cai de 2,6% para 1,4% e de 3,7% para 2,4% da altura do rosto, sem piorar os pontos; a forma muda ~1,5 mm no rosto. **Teto do método:** em rosto sintético com pontos exatos, o erro médio da forma é ~4,8 mm (4,56 mm com a silhueta): 105 pontos por foto não fixam a forma toda. Em fotos reais é pior. O giro de perfil que o ajuste acha (~65–70°) bate com o mínimo do erro de silhueta, então o perfil real é cerca de 70°, não 90°.
- **Tempo:** ~48 s em CPU para 9 fotos (meta do guia: menos de 1 minuto), depois de reduzir a busca de alinhamento da orelha e a resolução do GrabCut; o gargalo que sobra é a rasterização em Python (~12 s). Uma pessoa, uma máquina; não medido sob carga nem em outro hardware.
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

## 7. Cabelo em fios (E8, parte de software; experimental)

No modelo reconstruído o cabelo já vem pintado na textura das fotos. Por cima dele, o simulador pode desenhar **fios** (opção "Cabelo em fios", com comprimento e densidade):

- O worker mede, na própria textura, onde há cabelo (pixel escuro sem cor de pele) e grava a cobertura por vértice (`_HAIR`) e a cor média do cabelo (`hairColor`), além da altura dos olhos e do plano da frente do rosto (`eyeY`, `faceZ`). Sobrancelhas e a testa baixa ficam de fora (também são escuras); nas têmporas o cabelo desce até a altura dos olhos.
- O simulador faz crescer os fios só ali: cada fio sai da superfície, sobe um pouco e cai com a gravidade, em fluxo radial a partir da coroa; os da frente terminam acima da sobrancelha e os das laterais e da nuca são mais curtos.
- **É visual**: linhas de 1 px (sem espessura, sem iluminação própria, sem física, sem penteado ou corte reais). O primeiro resultado cobria os olhos e a testa (sobrancelhas contadas como cabelo; franja comprida); isso foi corrigido e verificado no navegador, em uma pessoa.
- Cabelo claro ou grisalho (pouco contraste com a pele) e barba acima da altura dos olhos podem enganar a medição por cor.

**Não feito: app iOS com TrueDepth.** Não há Mac nesta máquina (não compila iOS) e o código não poderia ser testado; fica para quando houver um Mac ou serviço de build.

## 8. Fidelidade do rosto: o que mudou entre as versões e por quê (branch `rosto-fiel`)

A primeira versão com textura das fotos ficou muito parecida com a pessoa; as versões seguintes ficaram mais "limpas" e menos parecidas. Comparando a foto frontal com cada variante (mesmo enquadramento), as causas foram:

- **Olhos procedurais** (esclera, íris e pupila desenhadas): ficavam arregalados e brancos; a pessoa tem o olhar entreaberto e a íris escura sob a pálpebra. **Voltaram a ser amostrados da foto** (`OPTS["procedural_eyes"] = False`).
- **Limpeza de pele** (chroma suavizado, realces comprimidos e luz achatada): tirava as sombras e a barba, que carregam a semelhança; mesmo na versão leve, a pele ficava mais clara e lisa. **Desligada** (`OPTS["clean_skin"] = False`).
- **Silhueta de perfil**: mudava a forma do rosto em ~1,5 mm. **Desligada por padrão** (`REFINE_SILHOUETTE = False`); continua disponível.
- **Mistura em bandas e recorte da pessoa**: deixam a pele mais limpa, mas mudavam o aspecto do rosto. **Só valem fora do rosto** (pescoço, cabelo, orelhas, fundo).

**Como está agora:** dentro do rosto (testa, olhos, nariz, lábios, bochechas) a textura usa a mistura da primeira versão (as 2 melhores fotos por ponto, peso `nz^6`, ganho de brilho global por vista, sem recorte), com os pesos suavizados no mapa para a cor passar de uma foto à outra sem degrau (o detalhe de cada foto não é borrado). Fora do rosto seguem as melhorias novas: pescoço em degradê, cabelo com a cor real, orelhas segmentadas e fundo sem vazamento. Tempo: ~38 s em CPU; `qualityScore` 0,72.

**Como foi verificado:** só olhando a foto frontal ao lado do render (uma pessoa). Não há medida numérica de semelhança, e a primeira versão não foi guardada em arquivo para comparar pixel a pixel.

## 9. Tentativa descartada: contorno da mandíbula como restrição de forma

Medido na foto frontal, o modelo estava mais largo que o contorno da mandíbula e das bochechas detectado pelo MediaPipe (~17 px de 223). Usar esse contorno como restrição linear na forma (e voltar à mistura em duas bandas) fechou essa diferença para ~−2 px sem piorar os pontos, **mas o rosto resultante ficou magro e deformado na avaliação visual** (queixo alongado e estreito; mesmo sem os pontos da base do queixo). A medida mais "certa" não deu o rosto mais parecido: o contorno de pontos do MediaPipe fica dentro da pele (não é a borda do rosto), então forçar o modelo sobre ele estreita demais. O código foi **revertido** (`git revert` do commit `7b3fbfa`); o estado do rosto é o do commit `7e32faa`. Quem retomar isso deve comparar com a foto, e não só com os pontos.

## 10. Emendas, arcos no pescoço e mancha atrás da cabeça (branch `melhorias-rosto`)

Sobre o rosto de hoje (mesma geometria, mesmo formato; o ajuste de contorno da seção 9 segue descartado), três defeitos visíveis foram atacados, cada um medido por comparação visual de variantes lado a lado:

- **Emendas e manchas de cor no rosto:** dentro do rosto voltou a mistura em duas bandas (`OPTS["legacy_face"] = False`): a cor de baixa frequência vem de todas as fotos e o detalhe das duas melhores. Sumiram as linhas de emenda nas bochechas e na testa; olhos da foto e sem limpeza de pele (como já estava).
- **Arcos de pele ao lado do pescoço e atrás da mandíbula:** a pele fora do rosto, entre a altura do queixo e a dos olhos, passa a ter só a cor suave (borrão largo, 16 px) da própria pele (`OPTS["side_smooth"]`). Não toca o rosto, o cabelo nem as orelhas.
- **Mancha clara atrás da cabeça (parede):** o GrabCut sorteia a inicialização, então o recorte da pessoa (e a textura) **mudava a cada execução**, e às vezes deixava entrar parede. Agora a semente é fixa (duas execuções dão a mesma textura, 0 pixels de diferença) e pixels claros e neutros (parede) nunca contam como pessoa.

Verificação: imagens (frente ao lado da foto e 5 ângulos), 11 testes do worker, ~41 s em CPU, `qualityScore` 0,72. Uma pessoa; sem medida numérica de semelhança.

## 11. Olhos, orelha e cabelo simples (branch `melhorias-rosto`)

- **Olhos:** desenhados DENTRO da abertura real do olho na foto frontal (contorno e íris do MediaPipe, 478 pontos): esclera e íris com a cor medida na foto, tamanho e posição da íris da foto, sombra das pálpebras e um pequeno reflexo. Fora da abertura fica a pele da pálpebra, também da foto. Os olhos procedurais antigos eram arregalados; os amostrados direto da foto vinham com a sombra da pálpebra pintada no globo. Resultado: olhar entreaberto como o da pessoa. Cor castanha escolhida sobre as bordas do que a foto mostra; a cor exata depende da foto.
- **Orelha:** o halo escuro e borrado atrás dela vinha de preencher uma esfera de 4 cm; agora é uma elipse do tamanho da orelha (a orelha 3D, já alinhada e ampliada à real, cobre o resto). O cabelo que ficava dentro da área da orelha (a máscara pegava uma margem) é refeito só com pele: o critério é "não tem cor de pele", não "é escuro", então a concha, mesmo sombreada, fica intacta. O preenchimento deixou de usar a margem de fora como fonte (puxava cabelo).
- **Cabelo simples:** a casca de cabelo do simulador passa a nascer exatamente onde a textura das fotos mostra cabelo (`_HAIR`), com a cor medida e a borda suavizada entre vértices vizinhos (a malha tem ~5 mil vértices: sem isso a borda saía em degraus). Não cobre olhos nem sobrancelhas. Os fios finos continuam como opção experimental, desligada por padrão.
- **Tela:** o teste do pincel estourava os 60 s (3D em software, ~1 min); o teto desse teste subiu para 150 s.

**Limites:** a linha do cabelo ainda tem uma leve irregularidade nas têmporas (resolução da malha); o cabelo é uma casca de cor uniforme, sem fios, sem mecha, e o fundo da cabeça é preenchimento. A orelha 3D segue sendo a do FLAME deformada; o contorno interno dela é o da foto. Uma pessoa, conferido a olho no simulador (frente, 45° e perfis).

## 12. Defeito encontrado com a segunda pessoa: perfil "virando" (corrigido)

Com as fotos de uma pessoa nova, a reconstrução foi recusada (`LOW_QUALITY`: "os pontos do rosto não ficaram coerentes"). As 7 vistas de frente e 20°/45° se ajustaram bem (1,1% a 1,8% da altura do rosto), mas as duas de perfil de 90° saíram com giro de ±135° e erro de 28%: o detector de rosto erra em perfil e o ajuste caía num mínimo ruim, testando também o sinal invertido.

**Correção:** o sentido do giro já foi validado com a câmera real (esquerda = positivo), então cada vista tem uma faixa (`yaw_bounds_for`): LEFT em 0° a 110°, RIGHT em −110° a 0°, frente e queixo em ±30°. O ajuste parte de vários giros iniciais (50%, 75% e 100% do nominal) e fica com o de menor erro. Resultado na pessoa nova: perfis em +59° e −61°, todas as vistas entre 1,1% e 1,8%, `qualityScore` 0,72. Na primeira pessoa os números não mudaram (perfis +64,6° e −68,0°). Dois testes novos cobrem isso (inclui um perfil com pontos ruidosos).

**Limite:** é a segunda pessoa testada; o perfil continua sendo a vista mais frágil do detector. Se o MediaPipe não achar rosto no perfil, a vista é descartada e vale o mínimo de 3 vistas (com a frontal obrigatória).

## 13. Fidelidade para qualquer pessoa: o que é automático e o que ainda não é (23/11/2026)

**Princípio:** o sistema não pode depender de eu olhar as fotos de cada pessoa e ajustar. Tudo tem que ser decidido pelo próprio pipeline, com critério mensurável por pessoa, e o que não for confiável tem que cair num resultado seguro, não num resultado quebrado.

**O que já é automático (vale para qualquer pessoa)**
- **Giro de cada vista:** faixa por vista (esquerda 0° a 110°, direita −110° a 0°, frente e queixo ±30°) e vários giros iniciais; evita o ajuste "virar" o rosto por erro do detector em perfil.
- **Rosto sem detecção:** vista sem rosto é descartada; a frontal é obrigatória e há mínimo de 3 vistas; senão `FACE_NOT_FOUND`.
- **Qualidade:** erro de reprojeção por vista vira `qualityScore` (teto 0,79); abaixo de 0,2 a reconstrução é recusada com `LOW_QUALITY` e instrução ao usuário.
- **Orelhas:** trava de plausibilidade (deslocamento, IoU e área). Se a marcação na foto não fizer sentido, a orelha do modelo não é deformada e fica com tom de pele liso.
- **Cor da íris, esclera e abertura dos olhos, cor do cabelo:** medidas na foto de cada pessoa, sem valor fixo.

**Ferramenta de verificação por pessoa:** `services/worker/scripts/evaluate.py` roda o ajuste em todas as capturas reais do ambiente e imprime, por pessoa, o erro de cada vista, o giro estimado (e se bateu no limite da faixa), e o estado de cada orelha. Sai com código 1 se alguma pessoa tiver problema. Foi ela que reproduziu sozinha o defeito da orelha da pessoa nova.

**O que NÃO está garantido (honesto)**
- Só há **2 pessoas distintas** para testar. Um critério que funciona em duas pessoas não prova que funciona em qualquer pessoa: é preciso um conjunto maior (tons de pele, cabelo e barba diferentes, óculos, cabelo na orelha, fundos claros e escuros) rodado por `evaluate.py` a cada mudança.
- **A orelha da pessoa nova ainda cai na trava** (o alinhamento escorrega para o pescoço quando o pescoço é da cor da pele). O resultado é seguro (orelha lisa), mas não é a orelha da pessoa. Falta um alinhamento que não dependa só de cor de pele.
- A forma vem do ajuste de um modelo estatístico (FLAME) a 105 pontos por foto: o contorno do modelo bate com o da pele na foto (largura 259 px contra 256 px), mas a profundidade (nariz, queixo de perfil) é estimada, não medida. A fidelidade de um escaneamento só vem de um sensor de profundidade (app iOS, Etapa 8).
- Mancha oval no pescoço de uma das vistas e o topo da cabeça um pouco mais claro que o cabelo real: ainda sem causa tratada.

## 14. Cabelo em fios por padrão, lido da foto, com modelos para trocar (23/11/2026)

**Pedido:** o cabelo vir por padrão parecido com o da pessoa (cor, comprimento, franja, cacho) e, se não ficar bom, poder escolher entre 5 modelos masculinos e 5 femininos, mudar o tamanho e a cor.

**Pesquisa:** direção dos fios por tensor de estrutura/Gabor (clássico; o HairStep, CVPR 2023, mostra que ele só dá o eixo, não o sentido), brilho por Kajiya-Kay (Scheuermann, GDC 2004), segmentação de cabelo do MediaPipe (não usada: exigiria baixar modelo; a leitura por cor já resolve o caso comum). Não há código aberto pronto para três.js de fios a partir de foto, então a implementação é própria.

**Worker (`app/face/hairstyle.py`):** na foto frontal, a cor do cabelo é amostrada logo acima da testa (pontos do MediaPipe), o fundo vem das bordas e a pele é calibrada nas bochechas; cabelo = pixel parecido com a raiz, que não é pele nem fundo e está ligado a ela. Saem, relativos à altura do rosto: `length` (até onde desce ao lado do rosto), `fringe`/`fringeDepth`, `volume`, `curl` (desordem da direção dos fios + volume), `color`. Vão em `extras.hairStyle` do `.glb`. Cabelo claro agora também entra na cobertura `_HAIR` (antes só o escuro).
Script de conferência: `scripts/hair_style.py` (imprime o estilo de cada captura).

**Simulador:**
- Fios ligados por padrão em modelos com textura, no modo "Automático (da foto)": comprimentos por zona (alto, lateral, nuca), franja, cacho, volume, risca/penteado para trás, direção lida da textura das fotos e cor por fio.
- Painel "Cabelo": automático, sem fios, 5 modelos masculinos e 5 femininos, tamanho (40% a 200%), quantidade de fios e cor (da foto, amostras, seletor).
- Fios não entram na cabeça (elipsoide + cilindros do maxilar e do pescoço) e não caem na frente do rosto; a franja só cobre a testa.

**Limites:** é uma representação visual de fios (linhas finas), não o penteado real; cacheado e comprido são aproximações; não há ombros, então cabelo muito comprido cai reto atrás do pescoço; só 2 pessoas (ambas de cabelo curto e escuro) foram usadas na calibração do detector; cabelo da cor da parede, boné ou roupa da cor do cabelo podem enganar a leitura (por isso existem os modelos para trocar). Reconstruções antigas não têm `hairStyle`; é preciso refazer a captura (ou reprocessar) para ler o cabelo.
