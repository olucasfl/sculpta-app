# Etapa 6 — Rosto real do paciente: o que está pronto e o que falta

**Estado (18/11/2026): preparada, não executada.** O que depende de GPU e de licença não foi feito, e nada aqui afirma que o rosto real funciona. Hoje o app mostra o **template genérico** com o selo "Modelo demonstrativo".

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
