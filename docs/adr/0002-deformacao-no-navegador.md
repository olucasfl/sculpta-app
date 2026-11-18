# 0002 — Deformação no navegador com bases pré-calculadas

- Status: aceito
- Data: 2026-11-18

## Contexto
O documento técnico v0.1 previa chamar o worker (`/v1/deform`) a cada ajuste de slider no MVP. Isso traz latência perceptível, custo de GPU por ajuste e depende de rede estável no tablet.

## Decisão
O worker calcula uma vez, por reconstrução, um morph target por slider (deformação biharmônica com âncoras, libigl) e entrega tudo no `.glb`. O navegador só ajusta `morphTargetInfluences`. A simulação guarda os parâmetros (contrato `SimulationParams`), e a malha final é opcional.

## Consequências
- Sliders em tempo real e sem custo de GPU por ajuste.
- O resultado é determinístico: as bases são fixas para aquela reconstrução.
- Combinar sliders é soma linear de deltas; interações não lineares fortes entre regiões vizinhas ficam como limitação conhecida.
