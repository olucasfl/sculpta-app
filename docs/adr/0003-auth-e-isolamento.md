# 0003 — Autenticação, papéis e isolamento por clínica

- Status: aceito
- Data: 2026-11-18

## Decisão
- Access token JWT (HS256, 15 min) só na memória do front. Refresh token aleatório em cookie httpOnly `SameSite=Strict`, `path=/api/auth`, guardado como hash SHA-256 e rotacionado a cada uso. Reusar um token já trocado revoga a família inteira.
- Senhas com argon2id (parâmetros OWASP). Login limitado a 5 tentativas/min por IP.
- A cada requisição o guard relê papel, clínica e situação do usuário no banco: desativar ou rebaixar vale na hora.
- `clinicId` sai sempre do token. Todo acesso a paciente passa por `PatientsService.findOwned(clinicId, id)`, e recurso de outra clínica responde 404 (não 403, para não confirmar que existe).
- Permissões por papel ficam em `@sim/contracts` (`PERMISSIONS`), usadas pelo guard da API e pelo front.
- Testes e2e tentam ler, editar, excluir e assinar termo em dados de outra clínica.

## Consequências
- Uma consulta extra por requisição (usuário por id); aceitável no MVP.
- Isolamento explícito por serviço, sem middleware mágico do Prisma: mais fácil de revisar, mas exige disciplina e os testes de isolamento a cada novo módulo.
