# Checklist de LGPD — Sculpta

> **Isto é um levantamento técnico, não parecer jurídico.** Fotos do rosto e modelos 3D são **dados biométricos** (dado pessoal sensível, LGPD art. 5º, II e art. 11). Antes de atender pacientes reais, a clínica e o operador precisam de **validação com assessoria jurídica**, inclusive do texto do termo, hoje provisório e marcado como rascunho na tela. Estado em 18/11/2026.

Legenda: **Feito** = existe no código e é testado · **Parcial** · **Falta**.

## Base legal e consentimento
| Item | Estado | Como |
|---|---|---|
| Consentimento específico e destacado para imagens e simulação | Feito | Termo digital com escopos separados, versão do termo guardada, assinatura na tela, quem colheu |
| Captura bloqueada sem termo ativo | Feito | API recusa (`CONSENT_REQUIRED`), testado |
| Revogação a qualquer momento | Feito | Revogar apaga fotos, modelos e simulações; o registro do termo fica como comprovação |
| Texto do termo validado por jurídico | **Falta** | Texto provisório; depende da clínica |
| Menores de idade e responsável legal | Parcial | Há a relação do signatário (responsável), sem checagem de idade |

## Minimização e retenção
| Item | Estado | Como |
|---|---|---|
| Cadastro mínimo | Feito | Só o nome é obrigatório |
| Prazo de retenção por clínica | Feito | Expurgo diário apaga fotos/modelos/simulações de pacientes sem atividade no prazo; o cadastro fica |
| Exclusão do paciente | Feito | Apaga biométricos e anonimiza o cadastro e as anotações |
| Exclusão da clínica | Feito | Expurgo agendado com prazo e cancelamento (console da plataforma) |
| Vídeo | Feito | O vídeo nunca é enviado nem guardado; só os quadros escolhidos |
| Metadados das fotos | Feito | JPEG recodificado, sem EXIF/localização |

## Segurança
| Item | Estado | Como |
|---|---|---|
| Isolamento entre clínicas | Feito | Checagem em toda rota (testada) e RLS no banco (políticas testadas) |
| RLS efetiva na API | **Parcial** | A API ainda conecta como dono das tabelas e ignora a RLS; a troca para o papel restrito é um passo futuro |
| Armazenamento privado de fotos | Feito | URLs pré-assinadas de curta duração; bucket sem acesso público |
| Senhas | Feito | Argon2; limite de tentativas |
| Papéis e permissões | Feito | 6 papéis; recepção não vê fotos nem modelos; matriz testada contra o documento |
| Administrador da plataforma | Feito | Modo suporte: somente leitura, com motivo e prazo, sem fotos nem 3D; tudo auditado |
| Auditoria de acesso | Feito | Quem viu/baixou fotos, modelo, termo, relatório; login e falhas |
| Verificação de e-mail e recuperação de senha | **Falta** | Decisão de simplificar; **obrigatório antes de qualquer acesso público** |
| 2FA | **Falta** | Não implementado |
| HTTPS, cookies seguros, CSP | Parcial | Cookies seguros por variável; CSP no nginx do compose; staging não foi montado |
| Backup e restauração testados | **Falta** | Ver [OPERACAO.md](OPERACAO.md) |

## Localização dos dados e terceiros
| Item | Estado | Observação |
|---|---|---|
| Região do banco | **Risco** | Supabase em Ohio (EUA): transferência internacional de dado sensível. Migrar para São Paulo antes de pacientes reais (R9) |
| Armazenamento das fotos | Parcial | Em desenvolvimento, disco local; em produção, S3/MinIO a definir **na mesma região** |
| Modelo do MediaPipe | Feito | Roda no navegador; só o arquivo do modelo é baixado do Google; nenhuma foto sai do aparelho |
| Worker de reconstrução | Falta | Quando existir (E6), precisa de contrato de operador, região e política de "nenhuma foto persiste" verificada |
| Provedor de e-mail | Falta | Não há e-mail real |

## Direitos do titular
| Item | Estado |
|---|---|
| Acesso e cópia dos dados do paciente | **Falta** (exportação dos dados do paciente não existe) |
| Correção | Feito (edição do cadastro) |
| Eliminação | Feito |
| Revogação do consentimento | Feito |
| Relatório de impacto (RIPD) e encarregado (DPO) | **Falta** (responsabilidade da clínica/operador) |

## Transparência de produto
- A simulação traz a ressalva "ilustrativa, sem garantia de resultado" na tela, na exportação e no PDF.
- O modelo demonstrativo é identificado como tal; a foto do paciente nunca é aplicada nele.
- Não há recomendação de procedimento, dose ou volume: os controles não têm unidade clínica.

## Pendências antes de pacientes reais (resumo)
1. Validação jurídica do termo e do fluxo.
2. Banco e armazenamento em São Paulo; trocar a senha do banco.
3. Verificação de e-mail, recuperação de senha (e idealmente 2FA).
4. Ligar a API ao papel restrito do banco (RLS efetiva).
5. Backup e restauração testados; HTTPS em staging.
6. Exportação dos dados do paciente (direito de acesso).
