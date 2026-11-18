# 0006 — Template procedural enquanto o FLAME não é baixado

- Status: aceito (provisório)
- Data: 2026-11-18

## Contexto
O ADR 0001 prevê o template FLAME 2023 Open como modelo demonstrativo. O download do FLAME exige cadastro e aceite de licença no site oficial, o que não pode ser feito automaticamente durante o desenvolvimento.

## Decisão
`packages/face-assets` gera uma cabeça genérica procedural (≈37 mil vértices, sem identidade), as máscaras de região com pesos suaves e uma base de deformação por slider, e grava tudo num `.glb` com morph targets esparsos — exatamente o formato que o worker real deve entregar (ADR 0002). O simulador não sabe a diferença entre template e reconstrução: lê `targetNames`, os atributos `_REGION_*` e o selo em `mesh.extras.kind`.

## Consequências
- O fluxo completo funciona sem GPU e sem licenças pendentes.
- As bases do template são deslocamentos suaves ponderados por máscara, não deformação biharmônica. A qualidade visual é de demonstração.
- Para trocar pelo FLAME: pintar as máscaras sobre a topologia FLAME (planejamento §6), gerar as bases no worker (libigl) e substituir `template-head.glb`. Front e API não mudam.
