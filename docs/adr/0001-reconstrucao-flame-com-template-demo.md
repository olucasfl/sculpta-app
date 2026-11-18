# 0001 — Topologia FLAME em todo lugar, com o template como modo demonstrativo

- Status: aceito (depende do go/no-go da Fase 0)
- Data: 2026-11-18

## Contexto
A reconstrução real (VGGTFace) ainda não foi validada com 5 fotos e tem licenças a confirmar. O produto precisa avançar sem esperar a IA, e não pode fingir uma reconstrução que não aconteceu.

## Decisão
Template e reconstrução compartilham a topologia FLAME 2023 Open. As máscaras de região e os sliders são definidos uma vez sobre o template e valem para qualquer paciente. Sem reconstrução disponível, o simulador abre o template com o selo "Modelo demonstrativo" e nunca aplica a foto do paciente sobre ele.

## Consequências
- Front e API (Fases 1–3) evoluem em paralelo à PoC.
- Se o VGGTFace falhar, troca-se só o worker (plano B: ajuste de FLAME por landmarks).
- FLAME exige cadastro para download e atribuição (CC-BY-4.0).
