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

## 15. Etapa 4 entregue (23/11/2026): mapa de alterações e pontos de aplicação

- **Mapa de alterações** (botão na barra de baixo, com legenda sobre o rosto): tira a textura e pinta cada ponto da pele pelo quanto saiu do lugar, somando sliders, pincel e pontos. Cinza = não mudou (abaixo de 0,05 mm); azul-claro, verde, amarelo e vermelho = de pouco até 8 mm. Acompanha "antes/depois", o cabelo some enquanto está ligado e as exportações (PNG e PDF) saem com a textura normal.
- **Pontos de aplicação** (no painel de cada procedimento): "Adicionar ponto" e toque na área destacada; fora da zona, o sistema avisa. Cada ponto tem **quantidade** (0,1 a 3 mm no centro) e **alcance** (4 a 20 mm) e, nos procedimentos dos dois lados (malar, mandíbula, olheiras, sulco, têmpora, masseter), **espelha** no outro lado. A bolinha se **arrasta** sobre o rosto e o efeito acompanha; o efeito só existe dentro da zona do procedimento (os pesos da região multiplicam o volume). O teto de 8 mm por ponto da pele continua valendo.
- **Camada própria no motor** (`sculptRuntime.setLayer`): os pontos ficam numa camada somada ao pincel, fora do desfazer do pincel. O que vai para a tela, o mapa e o cabelo (que acompanha a cabeça) é a soma. Ao **salvar a versão**, `encode()` grava a soma: os pontos viram parte da modelagem salva e **deixam de ser editáveis** ao reabrir a versão (ao carregar uma versão, os pontos da tela são zerados para não somar duas vezes). "Restaurar tudo" e "Restaurar" do procedimento removem os pontos.
- Testes novos: pontos (centro maior que a borda, preso à zona, espelho, soma, tetos) e mapa (cinza sem mudança, vermelho no limite, cor por mm). e2e do simulador passou.

**Verificado na tela** (modelo real da pessoa 2, página de teste): colocar o ponto no lábio sem a câmera girar, arrastar a bolinha (o ponto e o relevo no mapa seguiram) e o mapa com legenda. **Não verificado:** a tela completa do simulador (pede login); os controles do painel dos pontos foram montados e tipados, mas não vistos funcionando juntos.

**Limites:** os pontos só sobem a pele (não há ponto de "reduzir"); a posição de toque usa a malha original (um ponto sobre uma área muito deformada pode cair um pouco fora); os pontos não são editáveis depois de salvar a versão; o alcance e a quantidade são valores de interface, não dose.

## 16. Etapa 5 entregue (23/11/2026): modelagem fina presa à zona

- **O pincel agora é o "Modelagem fina" do procedimento escolhido:** só adiciona, reduz ou suaviza dentro da zona do procedimento (os pesos `_REGION_*` multiplicam o efeito, então a borda da zona é suave). Fora dela nada muda. A **borracha** continua valendo em qualquer lugar, para sempre ser possível desfazer.
- **Ver a zona enquanto modela:** a zona fica destacada durante o pincel e o **anel do pincel fica cinza e apagado** fora dela. O painel traz o nome do procedimento ("Modelagem fina · Lábios") e diz isso em uma frase.
- **Traço fora da zona não conta:** não cria entrada no desfazer nem marca "Não salvo".
- Modelos sem as regiões continuam com o pincel livre (fallback), com os mesmos tetos de mm da Etapa 1.
- Testes: dois novos (preso à zona e borracha livre); o e2e do pincel agora escolhe o Nariz, confirma que um traço longe da zona não muda nada e depois um traço sobre a zona funciona, desfaz, salva e recarrega.
- Verificado na tela com o modelo real: um traço longo sobre a boca e as bochechas pintou só a zona dos lábios no mapa de alterações.

**Limites:** o pincel não tem mais "livre" por escolha (decisão do plano); a zona é a região do modelo e não um recorte anatômico (a região malar, por exemplo, cobre sobretudo a área logo abaixo dos olhos); a posição do toque usa a malha original (em áreas muito deformadas o toque pode cair um pouco fora).

## 17. Etapa 6 entregue (23/11/2026): comparação em um lugar só

- **Botão "Comparar" na barra de baixo** (mostra o modo ativo, por exemplo "Comparar · Cortina"). A barra ficou com: modo (Pincel, Regiões, Girar), Comparar e quatro ícones (regiões, malha, recentralizar, tela cheia). Saíram da barra os cinco botões de vista, os quatro de comparação e o botão do mapa.
- **Painel Comparar** (abre acima da barra): 
  - **Modo:** Simulação, Cortina, Alternar, Lado a lado e **Diferença** (o mapa de alterações, em mm, vira um modo de comparação). Cada modo tem uma frase de ajuda.
  - **Vistas em miniatura:** as 5 vistas aparecem como miniaturas da simulação atual (geradas só com o painel aberto e depois de uma pausa nas mudanças); a vista escolhida vale para todos os modos.
  - **Zoom na zona:** "Zoom na zona: {procedimento}" e "Rosto todo".
- Os modos trocam entre si sem sobrar o anterior (escolher Diferença desliga a cortina e vice-versa).
- O e2e da aparência agora abre o painel Comparar para trocar de vista. 80 testes e o e2e do simulador passam.
- Verificado na tela com o modelo real: painel com os cinco modos e as cinco miniaturas (perfil direito, 45° direito, frente, 45° esquerdo, perfil esquerdo).

**Limites:** as miniaturas mostram a simulação (não o antes); a cortina e o lado a lado continuam usando a vista atual do rosto (as miniaturas servem para escolher a vista); as miniaturas são geradas na tela do navegador e em computador sem placa de vídeo podem demorar alguns segundos; não vi o painel dentro da tela completa do simulador (pede login).

## 18. Etapa 7 entregue (23/11/2026): tela mais limpa, tablet e relatório

- **Painel da direita em abas:** **Procedimento** (formatos prontos, ajustes em mm, pontos de aplicação e, no modo pincel, a modelagem fina logo abaixo) e **Aparência** (pele, olhos e cabelo, recolhidos fora da vista). O painel pode ser **recolhido** (botão no canto) para ver o rosto inteiro, e volta pelo botão "Painel".
- **Alvos de toque de 44 px** na lista de procedimentos, na barra de baixo (modo, Comparar e ícones) e nas abas, para uso no tablet com o profissional operando.
- **Relatório em PDF por procedimento:** um bloco por procedimento, com cada ajuste, a barra, a intensidade em **% do limite da simulação** e em **mm aproximados** (rosto médio), a limitação do procedimento, o aviso de simulação ilustrativa em todas as páginas e uma seção "Como ler". Abre outra página se não couber. **Não traz faixa de resultado:** ela só entra depois de validada por um profissional habilitado (o PDF diz isso). Testes novos de geração do PDF (sem ajustes, todos os procedimentos, valores negativos).
- **Defeito encontrado e corrigido na verificação (importante):** os **sliders não tinham efeito** em nenhum modelo. O visualizador copiava os nomes dos sliders para a malha e logo em seguida `updateMorphTargets()` os trocava por números ("0", "1"...), então nenhum valor de slider chegava ao modelo e o painel dizia "este modelo foi reconstruído antes deste procedimento existir". Os nomes agora entram por último (`morph.ts`, com teste). Conferido na tela: com chin, ponta do nariz e lábio em 100%, a ponta do nariz e o queixo avançam no perfil; o painel do Nariz mostra os 5 ajustes e os formatos. Ou seja, os procedimentos das etapas 3 a 6 só passam a funcionar com este conserto.
- 81 testes do web, 12 da API (relatório e produto) e o e2e do simulador passam; o e2e passou a usar as abas.

**Limites:** o PDF usa mm de um rosto médio (a medida real de cada rosto está no modelo, mas a API não a lê); a aba Aparência do modelo reconstruído só tem o cabelo (pele e olhos vêm das fotos); em tablet na vertical o painel ocupa a parte de baixo e pode ser recolhido, mas não testei num tablet de verdade; testa, glabela e pés de galinha seguem fora; a faixa de resultado no PDF depende de validação clínica.

## 19. Revisão final das 7 etapas (24/11/2026)

**Suítes:** API 92 testes, web 81, worker 15, contratos 14, face-assets 8; e2e do simulador no desktop (4), tablet em pé, tablet deitado e iPhone (teste novo de layout).

**O que a revisão achou e corrigiu**
- **Telas estreitas:** em tablet em pé (768 px) a lista de procedimentos e o painel cobriam a barra de ações, e no celular o painel e o painel Comparar ficavam atrás da barra de baixo (o botão "Painel" ficava inclicável). Agora, abaixo de 1024 px: barra de ações só com ícones, procedimentos em faixa horizontal no alto, painel embaixo (recolhível) acima da barra de ferramentas, painel Comparar acima da barra, e **o zoom na zona sobe a zona na tela** para não ficar atrás do painel. Entre 1024 e 1280 px as colunas começam mais abaixo porque a barra de ações quebra em duas linhas.
- Valores dos controles ("sem alteração", "3,5 mm") não quebram mais em duas linhas; o painel Comparar não cobre mais a barra de baixo no desktop.
- **Teste novo** (`simulador em tablet e celular`): sem rolagem lateral, alvo de toque de pelo menos 40 px, abas, painel Comparar dentro da largura, recolher e mostrar o painel; capturas em `e2e/screenshots/<viewport>/40` a `43`.

**Não verificado (a registrar):** nenhum teste num tablet ou celular de verdade (só emulação do navegador, com 3D por software); modelo reconstruído real na tela completa do simulador (as capturas completas são do modelo demonstrativo, que o seed do e2e usa; o modelo real foi visto em páginas de teste); o pincel com o mouse sobre o rosto real; o PDF renderizado (só gerado e testado); a pessoa 1 continua com o modelo demonstrativo até a captura ser refeita.
**Dependem de profissional habilitado:** tetos em mm, formatos prontos, procedimentos de toxina e a faixa de resultado do relatório.
**Achado fora do escopo:** no modelo demonstrativo a cor de olhos escolhida (azul) não aparece no olho (esfera branca com anel cinza); não investigado.

## 20. Conferência com o modelo real na tela completa (24/11/2026)

Spec opcional `apps/web/e2e/real-model.spec.ts` (roda só com `REAL_GLB` apontando para um `.glb` reconstruído): sobe a pilha de teste isolada, entra com a conta de teste e **substitui o modelo demonstrativo pelo modelo real da pessoa 1**, no simulador completo. Capturas em `e2e/screenshots/desktop-1440x900/50` a `58`.

**Visto funcionando com o rosto real:** cabelo automático (curto, castanho, acompanhando a cabeça; no perfil, atrás da orelha), painel dos Lábios com limites reais em mm (3,0 / 3,2 / 0,5), formato "Volumoso" (2,1 e 2,6 mm; o ponto de alterado aparece na lista), modo **Diferença** com a legenda e os lábios em verde e azul, **Nariz** com "Ponta mais projetada" (+2,0 mm; o nariz avança no perfil), troca para "Longo ondulado com franja" e volta ao automático, painel Comparar com as 5 miniaturas do rosto real.

**Ajustes feitos por causa do que apareceu:** alguns fios ainda cruzavam o alto da orelha no perfil (a zona da orelha foi ampliada; conferido na tela: o perfil ficou limpo); o destaque verde da zona do procedimento ficava na tela quando se abria a aba Aparência (agora some).

**O que se vê e não está bom (para decidir):**
- O cabelo automático segue o comprimento lido (curto) mas **não reproduz a franja de lado** que a pessoa tem na foto: a leitura deu "sem franja" porque a franja é fina e o limite de cor não a pega. O cabelo fica mais alto na testa do que na foto.
- O cabelo "Longo ondulado com franja" aparece como fios finos de 1 px: parece uma peruca, com alguns fios soltos longe da cabeça.
- Nuca e pescoço têm uma mancha escura e uma ponta preta no ombro (textura do pescoço), problema antigo, sem relação com o cabelo.
- Dá para ver fios finos pretos soltos nas têmporas quando a câmera chega perto (zoom nos lábios).

## 21. Franja do cabelo automático (24/11/2026)

**Problema (visto na tela com o rosto real):** a pessoa 1 tem franja de lado (cai sobre o lado esquerdo da testa, a direita fica livre), e o automático saía sem franja.

**Causa:** a leitura olhava só a faixa central da testa (60% da largura), onde a franja de lado quase não aparece (cobertura de 0,7%); toda a testa dava 20%.

**Correção:**
- **Worker (`hairstyle.py`):** a franja agora é lida na **largura toda** da testa (da raiz até as sobrancelhas). Além da quantidade (`fringe`), grava **para que lado ela pesa** (`fringeSide`: +1 = lado esquerdo da foto) e **até onde desce** (`fringeDepth`). Pessoa 1: franja 0,47, lado +0,69, chega às sobrancelhas; pessoa 2: sem franja.
- **Simulador:** o lado da foto vira o lado −x do modelo visto de frente. Os fios da franja caem **só no lado em que ela pesa** (no outro lado o cabelo fica penteado para cima/trás), atravessam a testa na diagonal para esse lado, têm comprimento próprio (`fringeLen`, até as sobrancelhas) e a risca fica do lado oposto. Vale também para cabelo médio e comprido lidos da foto. O painel diz "com franja de lado" quando o lado é claro.
- Testes: worker (franja de lado pesa no lado certo, espelhada inverte, testa limpa não tem franja) e web (sentido do `sweep` e da risca, franja central sem lado, fios da franja indo para o lado). 16 do worker e 84 do web passam.
- Verificado na tela com o rosto real da pessoa 1: o lado esquerdo da testa fica com o cabelo caindo até perto da sobrancelha e o direito fica livre, como na foto. As duas capturas foram reconstruídas de novo no Supabase com o worker novo.

**Limites:** o lado depende de a foto frontal não estar espelhada em relação ao modelo (confere com a pessoa 1; não há como saber de outra forma); franjas muito finas ou da cor da pele do fundo podem não ser lidas; só duas pessoas foram usadas (uma com franja de lado, uma sem franja).
