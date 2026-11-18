# Sculpta — Sistema de design

> Versão 0.2 · 18/11/2026 · Status: **marca e fonte aprovadas**; tokens em aplicação na etapa 1. Já aplicados no app: tokens, fonte Jost, cores, logo, ícones PWA e a navegação responsiva. O restante é a etapa 1 do [guia de reformulação](docs/GUIA-REFORMULACAO.md).

Sculpta é uma ferramenta de trabalho de clínicas estéticas. O visual precisa transmitir **confiança, calma e precisão**, não novidade. Quem usa está atendendo uma pessoa; a interface deve sair da frente.

---

## 1. Princípios

1. **Sóbrio antes de bonito.** Hierarquia clara, muito espaço em branco, uma única cor de destaque. Sem gradientes decorativos, sem sombras pesadas, sem animação que chame atenção.
2. **Dado em primeiro lugar.** Números, nomes e status são o conteúdo; a moldura (bordas, cards) é discreta.
3. **A imagem 3D é a estrela.** No simulador a interface vira uma película transparente sobre o rosto (seção 10). Em todas as outras telas, o estilo é de produto corporativo.
4. **Honestidade visual.** Modelo demonstrativo, validação manual, confiança baixa: tudo isso aparece com selo e cor semântica, nunca escondido.
5. **Toque e mouse com a mesma dignidade.** Alvos de 44 px, gestos óbvios, nada que dependa de hover.

---

## 2. Marca

**Marca escolhida:** símbolo **Faceta** (cubo isométrico em três facetas, o volume de uma escultura) + wordmark **SCULPTA** em **Jost 400**, caixa-alta, espaçamento de letras +20%. A mesma família Jost é usada no texto do app (seção 4).

| Arquivo (em [`docs/brand/`](docs/brand/)) | Uso |
|---|---|
| `sculpta-logo.svg` | Versão colorida (padrão), símbolo + wordmark |
| `sculpta-logo-light.svg` | Para fundo escuro ou petróleo |
| `sculpta-logo-mono.svg` | Uma cor só (impressão, carimbo, relatório em P&B) |
| `sculpta-symbol.svg` | Só o símbolo (favicon, ícone do app, avatar) |
| `decisao-de-fonte.html` | Registro da comparação de fontes (Fraunces, Bricolage Grotesque e Jost) |

O texto do wordmark está **convertido em curvas**: o arquivo não depende de a fonte estar instalada. Foram avaliados 3 conceitos de símbolo (Faceta, Perfil e S com volume) e 2 rodadas de fonte; a Faceta ganhou por funcionar em 16 px e em uma cor só, e a Jost por ser a mais sóbria e a mais diferente das demais.

Regras de uso:

- **Área de respeito:** metade da altura do símbolo em todos os lados.
- **Tamanho mínimo:** símbolo 16 px; símbolo + wordmark 112 px de largura.
- **Versões:** colorida (padrão), monocromática (escura) e clara (para fundo petróleo ou foto).
- **Proibido:** distorcer, aplicar sombra, trocar a cor do símbolo fora da paleta, usar sobre fundo com contraste abaixo de 3:1, redesenhar o wordmark em outra fonte.
- **PWA:** ícones 512 e 192 (símbolo claro sobre fundo `primary-600`), variante *maskable* com margem de segurança de 20%, `favicon.svg` e `apple-touch-icon` 180 px em PNG (iOS não aceita SVG para esse ícone).

---

## 3. Cor

Cor primária: **verde-petróleo**, herdada do protótipo (`#0f6e6a`), agora com escala completa. Neutros levemente quentes, para não ficar frio demais.

### 3.1 Escala primária

| Token | Hex | Uso típico |
|---|---|---|
| `primary-50` | `#eef7f6` | Fundo de item selecionado, badge suave |
| `primary-100` | `#d5ecea` | Fundo de destaque |
| `primary-200` | `#aad8d4` | Bordas de foco suave, gráficos |
| `primary-300` | `#78bfba` | Texto de destaque no **modo escuro** |
| `primary-400` | `#44a29c` | Ícones no modo escuro |
| `primary-500` | `#1f857f` | Gráficos, estados hover de ícones (**não** para texto branco: 4,45:1) |
| `primary-600` | `#0f6e6a` | **Ação principal** (botões, links, foco) |
| `primary-700` | `#0b5955` | Hover do botão principal |
| `primary-800` | `#0a4643` | Texto sobre `primary-50/100` |
| `primary-900` | `#07322f` | Texto de alto contraste |
| `primary-950` | `#031f1d` | Fundo escuro de marca |

### 3.2 Neutros e superfícies

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `canvas` | `#f6f6f3` | `#0e1416` | Fundo da página |
| `surface` | `#ffffff` | `#151d20` | Cards, tabelas, painéis |
| `subtle` | `#f0f0ec` | `#1b2529` | Fundo de campos, linhas alternadas |
| `line` | `#e2e3de` | `#26323a` | Bordas |
| `line-strong` | `#c9cbc4` | `#3a4850` | Bordas de campo, divisores fortes |
| `ink` | `#1d2327` | `#e8edef` | Texto principal |
| `muted` | `#5b6670` | `#9aa7ae` | Texto secundário |
| `faint` | `#626d76` | `#7f8c94` | Dicas, placeholders (ver nota) |
| `field` | `#7f8991` | `#6b7a83` | **Borda de campos e controles** (mínimo 3:1, WCAG 1.4.11) |

> **Correções sobre o protótipo.**
> - O `faint` atual (`#8a949c`) tem contraste **3,09:1** sobre branco, abaixo do AA (4,5:1) para texto. Passa a ser `#626d76`, que fica acima de 4,5:1 também sobre `canvas` (4,89) e `subtle` (4,63). (A primeira correção que cogitei, `#6b7780`, ainda falhava sobre `canvas` e `subtle`.)
> - As bordas `line` e `line-strong` servem para separar áreas, mas **não** para delimitar campos: `line-strong` tem só 1,64:1 sobre branco. Campos, caixas de seleção e controles usam o token `field` (3,12:1 ou mais em qualquer fundo claro).

### 3.3 Semânticas

| Papel | Texto/ícone | Fundo suave | Contraste (texto sobre branco) |
|---|---|---|---|
| Sucesso | `#067647` | `#e7f5ee` | 5,69:1 |
| Alerta | `#a15c07` | `#fdf3e3` | 5,19:1 |
| Erro | `#b42318` | `#fdecea` | 6,57:1 |
| Informação | `#175cd3` | `#eaf1fe` | 5,99:1 |

No modo escuro, as semânticas usam o mesmo matiz mais claro (`ok #4cc38a`, `warn #f0b259`, `danger #f4877c`, `info #7aa7f5`) sobre fundos de 12% de opacidade. **Cor nunca é o único sinal:** todo status leva ícone e texto.

### 3.4 Contrastes verificados

Medidos com a fórmula WCAG 2.x (não por inspeção visual):

| Par | Razão | Resultado |
|---|---|---|
| `ink` sobre `canvas` | 14,67 | AAA |
| `muted` sobre `canvas` | 5,42 | AA |
| Branco sobre `primary-600` | 6,07 | AA |
| `primary-700` sobre `primary-50` | 7,49 | AAA |
| `primary-300` sobre superfície escura | 8,11 | AAA |
| `primary-400` sobre superfície escura | 5,61 | AA |
| `muted` escuro sobre superfície escura | 6,93 | AA |
| `faint` sobre `canvas` / `subtle` | 4,89 / 4,63 | AA |
| `field` sobre branco / `canvas` / `subtle` | 3,57 / 3,29 / 3,12 | AA (componentes de interface, 3:1) |
| `field` escuro sobre superfície / `subtle` | 3,86 / 3,53 | AA (componentes de interface) |
| `ok` / `warn` / `danger` / `info` escuros sobre superfície escura | 7,72 / 9,13 / 7,00 / 7,06 | AAA |
| Branco sobre `primary-500` | 4,45 | **Falha** em texto normal: não usar |

---

## 4. Tipografia

- **Família única: Jost** (variável, código aberto, licença OFL), a mesma da logo. **Hospedada no próprio app** (pacote `@fontsource-variable/jost`). Nada de Google Fonts: evita enviar o IP do usuário a terceiros (LGPD) e funciona com a CSP restrita do nginx.
- **Pesos usados:** 400 (texto), 500 (rótulos e botões), 600 (títulos).
- **Números:** `font-variant-numeric: tabular-nums` em tabelas, KPIs e valores de slider (a Jost tem a característica `tnum`; verificado no arquivo da fonte).
- **A Jost é pequena para o tamanho nominal.** Sua altura de letra minúscula é ~0,46 em (Inter: ~0,55). Por isso os tamanhos abaixo são **maiores** do que num sistema com Inter: **corpo mínimo de 16 px em qualquer tela, nada abaixo de 13 px**.
- **Ambiguidade `I` / `l`:** na Jost, o "I" maiúsculo e o "l" minúsculo são quase idênticos (hastes retas; só a altura difere um pouco). Códigos, IDs e tokens (ex.: código interno do paciente) usam fonte monoespaçada do sistema (`ui-monospace`).

| Estilo | Tamanho / linha | Peso | Uso |
|---|---|---|---|
| `display` | 36/44 | 500 | Título da visão geral (só ≥1024) |
| `h1` | 26/32 (celular 24/30) | 600 | Título de página |
| `h2` | 20/28 | 600 | Título de seção/card |
| `h3` | 16/24 | 600 | Subtítulo, rótulos de grupo |
| `body` | 16/24 | 400 | Texto corrido |
| `small` | 14/20 | 400 | Apoio, metadados |
| `caption` | 13/16 | 500 | Selos, legendas (nunca abaixo de 13) |
| `kpi` | 32/36 | 600, tabular | Números grandes |

Todo tamanho é em `rem`, para escalar até 200% sem quebrar o layout.

---

## 5. Espaço, raios, bordas e sombras

- **Grade de espaço:** múltiplos de 4 px (`1`=4, `2`=8, `3`=12, `4`=16, `6`=24, `8`=32, `12`=48).
- **Gutters:** 16 px no celular, 24 px no tablet, 32 px no desktop. Largura máxima de conteúdo: 1280 px (1440 em tabelas largas).
- **Raios:** `sm` 6 (selos, tags), `md` 10 (campos, botões), `lg` 14 (cards), `xl` 20 (painéis flutuantes do simulador), `full` (avatares, pílulas).
- **Bordas:** 1 px `line` em tudo; a sombra é auxiliar, não estrutural.
- **Sombras:** `card` (`0 1px 2px / 0 1px 3px`, 4–6% de opacidade) e `pop` (`0 12px 32px`, 14%) só para menus, diálogos e painéis flutuantes. No modo escuro, sombra some e a separação vem da borda.

---

## 6. Movimento

- Durações: 120 ms (hover/foco), 200 ms (abrir menu), 280 ms (drawer, diálogo). Curva `cubic-bezier(0.2, 0, 0, 1)`.
- Só `opacity` e `transform`. Nada de animar largura/altura de lista longa.
- **`prefers-reduced-motion`:** transições viram trocas imediatas; o anel de progresso da captura continua mostrando estado, sem animar.
- Feedback tátil de elementos clicáveis: `:active` reduz a escala para 0,98 (apenas em botões e cards clicáveis).

---

## 7. Layout e breakpoints

Mobile-first. Cada breakpoint tem uma **decisão** de layout, não só uma largura.

| Nome | Largura | Navegação | Conteúdo |
|---|---|---|---|
| `xs` | 360 | Barra inferior (4 itens + "Mais") | 1 coluna; tabelas viram cards |
| `sm` | 390 | idem | idem (iPhone 14/15 e Android comuns) |
| `md` | 768 | **Drawer** (menu lateral recolhível) | 2 colunas em formulários; tabela com colunas essenciais |
| `lg` | 1024 | Sidebar fixa **recolhida** (ícones + tooltip) | Tabela completa; painéis laterais |
| `xl` | 1280 | Sidebar fixa expandida (240 px) | Largura máxima de 1280 |
| `2xl` | 1536 | idem | Conteúdo centralizado; margens crescem, não o texto |

Regras:

- **Altura:** usar `100dvh`, nunca `100vh` (barra de endereço do Android e do Safari).
- **iPhone:** `padding-bottom: env(safe-area-inset-bottom)` na barra inferior e em rodapés fixos; `env(safe-area-inset-top/left/right)` no simulador em tela cheia; `viewport-fit=cover` no `<meta viewport>`.
- **Teclado virtual:** formulários e a assinatura não podem ficar atrás do teclado; o campo focado rola para a vista.
- **Tablet:** testar retrato (768×1024) e paisagem (1024×768); no paisagem do simulador os painéis ficam nas laterais, no retrato empilham embaixo.
- **Tabela → card** abaixo de 768 px: cada linha vira um card com nome, status e a ação principal; as demais colunas vão para "ver mais".

---

## 8. Componentes

Biblioteca própria sobre Tailwind v4 + `lucide-react` (já no projeto). Sem importar uma biblioteca de UI inteira: o produto é pequeno e o controle de acessibilidade é nosso.

| Componente | Regras |
|---|---|
| **Button** | Altura 44 (celular) / 40 (desktop). Variantes: `primary`, `secondary`, `ghost`, `danger`. Estado `loading` preserva a largura. Ícone + texto; só ícone exige `aria-label`. |
| **Campo de texto/senha/busca** | Rótulo sempre visível (nunca só placeholder), erro abaixo em texto + ícone, `autocomplete` correto, `inputmode` apropriado. |
| **Select / Combobox** | Nativo no celular; no desktop, versão estilizada com teclado completo. |
| **Tabela de dados** | Cabeçalho fixo, ordenação clicável com `aria-sort`, paginação, seleção por linha, estado vazio explicativo, esqueleto de carregamento. Vira cards abaixo de `md`. |
| **Card / KPI** | Título pequeno, número grande tabular, variação com ícone e texto, nunca só cor. |
| **Badge de status** | Termo ativo / sem termo / revogado; modelo demonstrativo / processando / pronto / falhou. Ícone + texto + cor. |
| **Navegação** | Sidebar (xl), recolhida (lg), drawer (md), bottom nav (xs/sm). Item ativo com `aria-current="page"`. |
| **Diálogo / drawer / sheet** | `<dialog>` nativo, foco preso, Esc fecha, foco volta ao disparador. No celular, diálogos viram *bottom sheet*. |
| **Toast** | `aria-live="polite"`, some em 5 s, nunca o único aviso de erro importante. |
| **Estados** | Todo componente de dados define `loading` (esqueleto), `empty`, `error` (com tentar de novo) e `forbidden`. |
| **Assinatura** | Área ≥ 280 px de altura no celular, `touch-action: none`, limpar/refazer visível. |
| **Linha do tempo** | Itens com data, autor, ícone por tipo; no celular, coluna única. |

---

## 9. Acessibilidade (obrigatório)

- **Contraste WCAG 2.2 AA:** texto ≥ 4,5:1, texto grande e ícones/bordas de controle ≥ 3:1 (medição na seção 3.4; repetir ao mudar tokens).
- **Foco visível:** anel de 2 px `primary-600` com 2 px de afastamento, em todo elemento interativo; no modo escuro, `primary-300`. Nunca `outline: none` sem substituto.
- **Alvos de toque ≥ 44×44 px**, com 8 px de espaço entre eles.
- **Texto até 200%:** layout em `rem`, sem altura fixa em texto, sem corte; testar com zoom de 200% e fonte maior do sistema.
- **Teclado:** toda função tem caminho por teclado, inclusive o simulador (setas ajustam o slider da região selecionada; `Esc` sai do modo modelar).
- **Leitor de tela:** landmarks (`header`, `nav`, `main`), `aria-live` em status de processamento e captura, rótulos em todo ícone.
- **Movimento reduzido** e **alto contraste do sistema** (`forced-colors`) respeitados.
- **Auditoria:** axe automatizado no Playwright em todas as telas; revisão manual de teclado a cada etapa.

---

## 10. Simulador imersivo (exceção ao estilo sóbrio)

O modelo 3D ocupa a tela inteira; a interface é uma película:

- **Painéis flutuantes:** fundo `surface` a 85% de opacidade com `backdrop-filter: blur(12px)`, raio `xl`, borda `line`, sombra `pop`. Sem blur se `prefers-reduced-transparency`/`forced-colors`.
- **Três zonas:** barra superior (paciente, versão, desfazer/refazer, salvar, exportar), faixa de regiões à esquerda, controles da região à direita, barra de modo/vistas/comparação embaixo.
- **Celular:** painel de controles vira *sheet* inferior arrastável; regiões viram carrossel horizontal; tudo ao alcance do polegar; botão de tela cheia real (`requestFullscreen` onde existir; iOS usa o modo imersivo do PWA).
- **Modo modelar/girar:** sobre o rosto o toque modela, fora do rosto gira. Cursor muda (cruz/mãozinha). Valor ao vivo ao lado do cursor, com `aria-live`.
- **Fallback sem WebGL:** mensagem clara + foto da captura + sliders desativados (nunca tela em branco).
- **Selo permanente:** "Simulação ilustrativa" sempre visível, mais "Modelo demonstrativo" quando aplicável.

---

## 11. Tokens em código

Aplicação prevista em `apps/web/src/index.css` (Tailwind v4, `@theme`). Os nomes antigos (`accent`, `ink`, `muted`…) continuam como aliases até o fim da etapa 1 para não quebrar telas.

```css
@theme {
  --font-sans: 'Jost Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  --color-primary-50: #eef7f6;  --color-primary-100: #d5ecea; --color-primary-200: #aad8d4;
  --color-primary-300: #78bfba; --color-primary-400: #44a29c; --color-primary-500: #1f857f;
  --color-primary-600: #0f6e6a; --color-primary-700: #0b5955; --color-primary-800: #0a4643;
  --color-primary-900: #07322f; --color-primary-950: #031f1d;

  --color-canvas: #f6f6f3;  --color-surface: #ffffff; --color-subtle: #f0f0ec;
  --color-line: #e2e3de;    --color-line-strong: #c9cbc4;
  --color-ink: #1d2327;     --color-muted: #5b6670;    --color-faint: #626d76;  --color-field: #7f8991;

  --color-ok: #067647;      --color-ok-soft: #e7f5ee;
  --color-warn: #a15c07;    --color-warn-soft: #fdf3e3;
  --color-danger: #b42318;  --color-danger-soft: #fdecea;
  --color-info: #175cd3;    --color-info-soft: #eaf1fe;

  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px; --radius-xl: 20px;
  --shadow-card: 0 1px 2px rgb(29 35 39 / 0.04), 0 1px 3px rgb(29 35 39 / 0.06);
  --shadow-pop: 0 12px 32px rgb(29 35 39 / 0.14);

  --breakpoint-xs: 22.5rem;  /* 360 */
  --breakpoint-sm: 24.375rem; /* 390 */
  --breakpoint-md: 48rem;    /* 768 */
  --breakpoint-lg: 64rem;    /* 1024 */
  --breakpoint-xl: 80rem;    /* 1280 */
  --breakpoint-2xl: 96rem;   /* 1536 */
}

/* Modo escuro: segue o sistema e pode ser forçado por [data-theme]. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --color-canvas: #0e1416;  --color-surface: #151d20; --color-subtle: #1b2529;
    --color-line: #26323a;    --color-line-strong: #3a4850;
    --color-ink: #e8edef;     --color-muted: #9aa7ae;    --color-faint: #7f8c94;  --color-field: #6b7a83;
    --color-ok: #4cc38a;      --color-warn: #f0b259;
    --color-danger: #f4877c;  --color-info: #7aa7f5;
  }
}
:root[data-theme='dark'] { /* mesmos valores do bloco acima */ }

@layer base {
  :focus-visible { outline: 2px solid var(--color-primary-600); outline-offset: 2px; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme='light']) :focus-visible { outline-color: var(--color-primary-300); } }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; } }
}
```

---

## 12. Decisões registradas

| # | Decisão | Motivo |
|---|---|---|
| D-1 | Cor primária continua verde-petróleo `#0f6e6a`, agora com escala de 11 tons | É a identidade do protótipo e passa AA com texto branco |
| D-2 | **Jost** variável hospedada localmente, na logo e no texto | Escolha do dono do produto entre 6 candidatas; LGPD (sem requisição a terceiros) e CSP restrita |
| D-3 | Biblioteca de componentes própria sobre Tailwind v4 | Produto pequeno; controle de acessibilidade; sem peso extra |
| D-4 | Modo escuro incluído, seguindo o sistema | Pedido no escopo; também ajuda em sala de atendimento com luz baixa |
| D-5 | **Logo: Faceta + SCULPTA em Jost** (escolhido) | Funciona em 16 px e em uma cor só; ver seção 2 |
| D-6 | `faint` corrigido para `#626d76` e novo token `field` para bordas de campo | O `faint` atual falha AA (3,09:1) e as bordas de campo atuais ficam em 1,64:1 |
| D-7 | Simulador tem estilo próprio (película translúcida) | A imagem 3D precisa de toda a área; é a única exceção ao estilo sóbrio |
| D-8 | As skills de design citadas no briefing (impeccable, taste-skill, hallmark, ui-ux-pro-max-skill, make-interfaces-feel-better) **não estão disponíveis** neste ambiente | Usei o guia de UI e acessibilidade que está instalado (`frontend-ui-engineering`) e as referências do próprio briefing como critério |
| D-9 | Mobbin, Banani, Dribbble e Linear **não foram consultados nesta etapa** | Os padrões de navegação e tabelas vêm das práticas descritas nas seções 7 e 8; as referências visuais ficam como insumo para a revisão das capturas de tela da etapa 1 |
