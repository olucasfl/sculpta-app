# Etapa 9: Simulador por procedimento (planejamento, rascunho v0.1)

Estado: **planejamento para decidir junto com o dono do produto. Nada disto foi implementado.** Data: 23/11/2026.

## 1. Diagnóstico da tela de hoje

O que o usuário relatou, e o que o código mostra:

| Queixa | Causa no código |
|---|---|
| "Empurrar está puxando e puxar está empurrando" | `push` soma o deslocamento ao longo da **normal da superfície, que aponta para fora** (`sculpt.ts`: `sign = push ? 1 : -1`). Então "Empurrar" faz a pele **subir** (adiciona volume) e "Puxar" **afunda**. Em linguagem comum "empurrar" é ir para dentro. O rótulo está certo para um escultor ("inflar") e errado para quem pensa em procedimento. |
| "Sem controle, desordenado" | O pincel é livre: age em qualquer vértice, o efeito **acumula a cada evento do mouse** (quanto mais devagar, mais empurra), o raio é em unidades do modelo (não em mm), não há teto por região e não há leitura do quanto já mudou. |
| "Muita informação na tela" | Seis blocos competem: regiões, pincel, cabelo, sliders da região, vistas, comparação, exportação. Tudo aberto ao mesmo tempo. |
| "Não vejo a área que estou mexendo" | O anel do pincel só aparece sob o cursor; não há destaque da zona do procedimento nem mapa do que já foi alterado. |
| Comparar é espalhado | Cortina, alternar e lado a lado estão na barra inferior misturados com vistas e zoom. |

## 2. O que a pesquisa mostra

**Procedimentos mais feitos (ASPS/ISAPS)**: toxina botulínica (7,9 milhões em 2024) e ácido hialurônico (6,3 milhões) lideram; aumento labial está entre os principais. A perda de volume e de colágeno se concentra em olhos, boca, bochechas, linha da mandíbula, sobrancelha e nariz. Toxina dura 3 a 6 meses; preenchedor, de 6 meses a 2 anos.

**Como as ferramentas profissionais organizam isso (Crisalix, Canfield VECTRA Face Sculptor)**
- Um **menu de procedimentos** (não de pincéis): lábios, nariz, queixo, malar, injetáveis, lifting. Um **ponto azul** marca o que já foi editado.
- Cada procedimento tem **presets** (formas de lábio, catálogo de tipos de nariz) e um **slider de intensidade**; a documentação avisa que os sliders são muito sensíveis ("não passe da primeira metade").
- **Linhas de refinamento** arrastáveis para ajustar o contorno de cada procedimento.
- A comparação antes/depois fica à parte, com o modelo "depois" girável.
- A VECTRA usa sliders por procedimento (rinoplastia, mentoplastia, injetáveis, lábios) para decidir junto com o paciente.

**Padrões de interface para telas de "selecionar para agir"**
- Barra contextual **curta (até ~8 ações)**, só com o que serve ao objeto selecionado; o resto em menus (SAP, Adobe, tldraw).
- **Divulgação progressiva**: o comum à vista, o avançado escondido mas achável.
- "Context bleed" (ações que não se aplicam ao que está selecionado) é o erro típico que torna o menu inútil.

**Ética e limites**: estudos mostram que simulação **não é previsão**: em aumento de mama, 28,6% das imagens simuladas pareciam melhores que o resultado real; em contorno facial só ~46% batiam com o resultado. A ASPS alerta que imagens idealizadas viram a expectativa do paciente. Recomendação da literatura: mostrar **faixas de resultado**, não um número único, e registrar o aviso.

**Volumes típicos de preenchedor (ordem de grandeza, não regra)**: lábios 0,5 a 1 mL; bochecha 1 a 2 mL por lado; têmpora 1 a 2 mL por lado; mento e mandíbula 2 a 6 mL no total; olheira 0,5 a 1 mL por lado. As fontes variam muito. **Estes limites precisam ser validados por um profissional habilitado antes de virarem travas.**

**Toxina não adiciona volume**: ela suaviza rugas dinâmicas (glabela, testa, "pés de galinha") e, no masseter, reduz a hipertrofia ao longo de semanas. O nosso modelo 3D não tem rugas; simular toxina fielmente exige uma camada de textura/relevo de rugas (fase posterior).

## 3. Princípio da nova tela

> **Da ferramenta ao procedimento.** O usuário escolhe *o que quer fazer* ("preencher lábio superior", "projetar queixo", "afinar mandíbula"); o sistema mostra a **zona** onde isso é possível, fornece o **controle** certo e o **teto** realista. O pincel livre continua existindo, mas **preso a uma zona** e com medida.

## 4. Estrutura da tela (proposta)

```
┌ cabeçalho: paciente · salvar · versões · exportar ────────────────────┐
│ PROCEDIMENTOS   │            VISTA 3D                │ AJUSTE         │
│ (esquerda)      │  zona destacada + contorno         │ (direita)      │
│  Lábios      ●  │  mapa de calor do que mudou        │ só o procedimento│
│  Malar          │  régua de mm                       │ selecionado:    │
│  Mento       ●  │                                    │  presets        │
│  Mandíbula      │                                    │  intensidade    │
│  Nariz          │                                    │  pontos/linhas  │
│  Olheiras       │                                    │  limite e aviso │
│  Sulco          │                                    │ "Modelagem fina"│
│  Têmpora        │                                    │  (avançado)     │
│  (Testa/Toxina) │                                    │                 │
├─────────────────┴────────────────────────────────────┴─────────────────┤
│ VISTAS (5 miniaturas clicáveis)  ·  COMPARAR: Cortina | Alternar | Lado │
│ a lado | Diferença   ·  zoom na zona                                     │
└─────────────────────────────────────────────────────────────────────────┘
```
- **Painel direito mostra só um procedimento por vez.** Aparência (pele, olhos, cabelo) sai para uma aba "Aparência" recolhida.
- **Comparar** vira um grupo único, com as vistas como miniaturas (não como botões soltos).
- Pontos azuis nos procedimentos já editados (padrão Crisalix) e contador "3 procedimentos alterados".

## 5. Como cada procedimento funciona (modelo de dados)

Cada procedimento é um registro:
- **Zona**: vértices da malha com peso (já temos regiões `_REGION_*`; serão refinadas e simétricas).
- **Direção anatômica**: normal da superfície ou eixo fixo (ex.: projeção do queixo = para frente; altura = para baixo).
- **Intensidade**: de 0 a 100% do **teto**; mostrada em **mm de deslocamento máximo** e, quando fizer sentido, em **volume aproximado (mL)** com aviso de que é estimativa.
- **Teto**: máximo permitido (a validar com profissional); ao chegar nele, o controle trava e avisa.
- **Presets**: 3 a 5 por procedimento (ex.: lábios: natural, definido, volumoso; nariz: dorso reto, ponta mais fina...).
- **Pontos de aplicação** (opcional): 2 a 5 pontos arrastáveis sobre a zona; o volume se distribui em torno deles (substitui o pincel solto).
- **Simetria** ligada por padrão, com opção de assimetria (rosto real é assimétrico).

### Catálogo da primeira versão (proposta, a decidir)

| Procedimento | O que muda no modelo | Controles |
|---|---|---|
| Lábios (preenchedor) | volume superior, inferior, contorno (arco de cupido), projeção | presets + 3 sliders |
| Malar / maçã do rosto | volume e projeção | preset + 2 sliders + pontos |
| Mento / queixo | projeção e altura | 2 sliders |
| Mandíbula / ângulo | definição da linha e largura do ângulo | 2 sliders + linha de contorno |
| Sulco nasolabial | preenchimento da dobra | 1 slider + pontos |
| Olheira / infraorbital | preenchimento do sulco lacrimal | 1 slider + pontos |
| Têmporas | volume | 1 slider |
| Nariz **não cirúrgico** (preenchedor) | dorso, ponta | presets + 2 sliders |
| Masseter (toxina) | afinamento do terço inferior | 1 slider (efeito em semanas) |
| Testa / glabela / pés de galinha (toxina) | **suavizar rugas**: fase posterior (precisa de relevo de rugas) | — |
| Cirurgias (rinoplastia, mentoplastia, blefaroplastia, lifting) | **decisão pendente** | — |

## 6. Modelagem fina (pincel guiado)

- Renomear ferramentas pelo efeito: **Adicionar volume** (hoje "Empurrar"), **Reduzir volume** (hoje "Puxar"), **Suavizar**, **Desfazer área**. Sem os verbos ambíguos.
- **Sempre preso a uma zona**: o pincel só age dentro da zona do procedimento selecionado (ou de uma região escolhida), nunca em qualquer ponto.
- **Aplicação por carimbo**: um toque aplica uma quantidade fixa e pequena (espaçamento entre carimbos), e **não** acumula pelo tempo parado. Força vira "mm por toque".
- **Escala em mm**: raio de 2 a 30 mm; passo mínimo de 0,1 mm; leitura do **deslocamento máximo atual** e barra até o teto.
- **Ver o que se mexe**: halo do pincel com a zona destacada, **mapa de calor** do que já foi alterado e seta mostrando a direção (para fora ou para dentro).
- **Zoom automático** na zona ao selecionar o procedimento.

## 7. Comparação reorganizada

Um painel "Comparar" com: **Cortina**, **Alternar** (segurar para ver o antes), **Lado a lado** e **Mapa de diferença** (mm, em cores). As 5 vistas viram miniaturas clicáveis; o ângulo escolhido vale para todos os modos. "Compartilhar" gera as 5 vistas antes/depois para o relatório.

## 8. Ordem de entrega (cada etapa verificada na tela e commitada)

1. **Correção rápida**: rótulos e direção corretos, carimbo com espaçamento e teto por vértice, raio em mm. Resolve "empurra ao contrário" e "sem controle" já.
2. **Zonas e catálogo**: dados dos procedimentos, seleção que destaca a zona e dá zoom.
3. **Painel por procedimento**: presets, intensidade em mm/mL, teto e aviso, usando os 15 morph targets atuais e novos alvos (têmpora, sulco, masseter...).
4. **Pontos de aplicação** e **mapa de calor**.
5. **Modelagem fina** presa à zona.
6. **Comparar** reorganizado, com miniaturas das vistas.
7. **Limpeza da tela** (aparência recolhida, barra inferior enxuta, tablet primeiro) e **relatório PDF** com procedimentos e intensidades.

## 9. Riscos e limites que a tela deve mostrar

- Simulação ilustrativa, **não previsão**; mostrar **faixa** (ex.: "efeito típico entre X e Y") e manter o aviso fixo.
- Tetos e volumes **só viram regra depois de validados por profissional habilitado** (o texto da tela diz "ilustrativo").
- Toxina não tem simulação fiel sem rugas; se entrar, entra como "suavização de textura", rotulada como aproximada.
- O modelo vem de 105 pontos e uma malha estatística; a profundidade é estimada. Mudanças de 1 a 2 mm estão **abaixo da precisão** do modelo: a tela deve dizer isso.

## 10. Decisões tomadas (23/11/2026)

- **Quem usa:** profissional da clínica com a paciente ao lado (tablet ou tela grande). Controles grandes, poucos por vez, comparação bem visível.
- **Edição:** por procedimento, com o pincel de modelagem fina **preso à zona** do procedimento e com teto.
- **Primeira versão:** lábios, malar, queixo, mandíbula, sulco nasolabial, olheiras, têmporas, nariz não cirúrgico e toxina (masseter, testa e glabela; as rugas dependem de uma camada de textura de rugas, então entram como aproximação rotulada ou ficam para depois do masseter).
- **Cirurgias:** fora por enquanto.

## 11. Perguntas ainda em aberto

1. **Quem valida os tetos e os volumes** (em mm e em mL) de cada procedimento? Sem um profissional habilitado revisando, a tela mostra os limites como "ilustrativos".
2. **Unidade na tela:** mm de deslocamento, mL aproximado, ou só uma barra de 0 a 100% com aviso? (mL não é linear com mm e depende do produto e da técnica.)
3. **Linguagem dos procedimentos:** usar os nomes de consultório (preenchimento labial, bigode chinês, projeção de mento) ou nomes simples para a paciente?
4. **Rugas da toxina:** vale criar a camada de rugas agora (mais trabalho e mais risco de parecer falso) ou entregar só o masseter primeiro?
5. **Relatório:** o PDF deve listar cada procedimento simulado com a intensidade e a faixa de resultado?

## 12. Etapa 1 entregue (23/11/2026): pincel com sentido e controle

- **Nomes e direção:** "Empurrar/Puxar" viraram **Adicionar volume** (a pele sobe, para fora, como um preenchimento) e **Reduzir volume** (afunda, para dentro). O anel do pincel muda de cor: verde-azulado adiciona, âmbar reduz, azul suaviza, cinza apaga.
- **Teto por traço:** cada traço desloca a pele **no máximo** o valor de "Quanto por traço" (de 0,1 a 3 mm no centro do pincel), por mais que o mouse demore ou pare. Antes, parar o mouse empilhava toques e o efeito saía exagerado. Para mais, passa-se de novo (cada traço soma ao anterior, cada um com o seu teto). Desfazer continua por traço.
- **Medidas em mm:** tamanho do pincel de 4 a 40 mm; "Quanto por traço" em mm; leitura "Maior alteração na pele: X de 8 mm", com barra que fica âmbar perto do limite. O limite por ponto caiu de 12 para 8 mm.
- **Padrão mais fino:** pincel de 12 mm e 0,9 mm por traço.
- Quatro testes novos (direção, teto por traço, soma entre traços, força mínima); e2e do pincel passou.

**Limites:** o pincel ainda age em qualquer ponto do rosto; a trava por zona e os procedimentos entram nas etapas 2 a 5. Os 8 mm e os 3 mm por traço são valores de interface, não regra clínica; precisam de validação por profissional.

## 13. Etapa 2 entregue (23/11/2026): procedimento escolhido, zona destacada e câmera na zona

- **Catálogo:** a lista da esquerda agora separa **Olheiras** e **Sulco nasolabial** (antes juntos em "Infraorbital e sulco"), além de Lábios, Malar, Mento, Mandíbula e Nariz. Os procedimentos que ainda não têm região no modelo (têmporas, masseter, testa e glabela) ficam para a Etapa 3, quando ganham região e alvo de deformação.
- **Zona destacada:** ao escolher um procedimento, a região dele fica com um tom verde-água claro sobre a pele (antes o tom era escuro e quase não aparecia na textura das fotos). Os pesos vêm da própria malha (`_REGION_*`), então vale para qualquer rosto reconstruído.
- **Câmera na zona:** a câmera se aproxima da zona mantendo o ângulo atual (`zone.ts`: centro e tamanho da região, distância para enquadrar com folga a 30 graus de campo). Os botões de vista e "Recentralizar" voltam ao rosto todo. A distância mínima da câmera caiu de 35 para 22 cm.
- Três testes novos (`zone.test.ts`); e2e do simulador passou. Conferido na tela com o modelo real: lábios, queixo e malar (as duas áreas simétricas) ficaram destacados e enquadrados.

**Limites:** o pincel ainda não fica preso à zona (Etapa 5); o destaque é um tom sobre a textura, não um mapa do que já foi alterado (Etapa 4); a região malar do modelo atual cobre sobretudo a área logo abaixo dos olhos, o que deve ser revisto junto com os alvos de deformação.

## 14. Etapa 3 entregue (23/11/2026): painel por procedimento

- **Painel de um procedimento por vez** (`ProcedurePanel.tsx`): formatos prontos, um controle por ajuste, resumo "Maior alteração" e a limitação (recolhida).
- **Formatos prontos** (`procedureShapes.ts`): lábios (Natural, Definido, Volumoso), malar, mento, mandíbula, olheiras, sulco, têmporas e masseter (Sutil, Moderado, Marcado), nariz não cirúrgico (Dorso mais alto, Ponta mais projetada, Ponta levantada). Cada chip mostra "até X mm". São configuração de interface (fração do limite visual), não indicação clínica.
- **Milímetros reais:** o worker mede, para cada rosto, o deslocamento máximo real de cada slider e grava em `sliderMaxMm` no `.glb`. O controle mostra o valor em mm, o limite da simulação no fim da barra ("3,2 mm (limite)") e avisa "perto do limite" a partir de 85%. Modelos sem essa medida usam uma tabela de rosto médio (`SLIDER_MAX_MM`, no contrato).
- **Dois procedimentos novos** (a lista agora tem 9): **Têmporas** (reposição de volume) e **Masseter (toxina)** (afina o terço inferior do rosto, só a forma; o efeito real leva semanas). Região, alvo de deformação e destaque em três lugares que precisam andar juntos: contrato (`sliders.ts`, esquema versão 2), template (`face-assets`) e worker (`bases.py`). O worker passou a gerar 17 controles.
- **Modelos antigos:** um modelo reconstruído antes desta versão não tem os controles novos; o procedimento aparece esmaecido na lista e o painel diz para refazer a reconstrução. A reconstrução da pessoa 2 foi refeita e já tem os 17 controles e os mm.
- Testes novos: `procedureShapes.test.ts` (formatos usam só os sliders do procedimento, nenhum nasce no limite, mm), worker (17 alvos, mm entre 0,3 e 20), face-assets. e2e do simulador passou.

**Limites:** a toxina no masseter mostra só a forma final (sem a evolução em semanas); testa, glabela e pés de galinha continuam fora (precisam de rugas); os mm são do modelo (um rosto estimado por 105 pontos) e valores de 1 a 2 mm ficam perto da precisão; a captura da pessoa 1 ainda é o modelo demonstrativo (não tem os procedimentos novos até ser refeita); os formatos prontos ainda não foram revistos por um profissional.
