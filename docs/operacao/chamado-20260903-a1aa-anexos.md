# Chamado 20260903-A1AA — anexos de suporte

## Causa confirmada

O fluxo anterior enviava o arquivo ao bucket público `images` e convertia qualquer
falha do upload em `null`. Em seguida, a criação do chamado ou da mensagem
continuava sem anexo e exibia sucesso. Por isso `attachment_url` permanecia nulo
sem que o usuário soubesse que o arquivo não havia sido persistido.

Não há base técnica para reconstruir anexos antigos sem objeto e sem referência.
Esta correção não faz backfill nem altera registros históricos.

## Contrato novo

- bucket privado dedicado: `support-attachments`;
- limite único no cliente e no Storage: 10 MiB;
- MIME allowlist: JPEG, PNG, PDF, DOC e DOCX;
- referência persistida: somente `attachment_path`;
- `attachment_url` permanece apenas como fallback de leitura legado;
- objeto nomeado com UUIDs: `<uploader>/<tickets|messages>/<registro>/<objeto>.<ext>`;
- URL assinada criada somente ao abrir o anexo, com validade de 300 segundos;
- falha de upload interrompe a inserção e preserva o formulário;
- falha de inserção após upload tenta remover o objeto, sem esconder o erro original.

## Autorização

As policies usam os contratos existentes do FinElo:

- `anon`: nenhum acesso aos objetos;
- `authenticated`: upload somente no próprio namespace UUID;
- proprietário: leitura de objetos próprios e dos anexos ligados aos próprios chamados;
- administrador existente (`cassiomq@gmail.com` no JWT validado pelo Supabase): leitura para atendimento;
- outro usuário autenticado: acesso negado;
- não existe policy pública nem `UPDATE` de objetos.

Policies restritivas em `support_tickets` e `support_messages` impedem persistir a
referência de outro usuário e vinculam o path ao UUID do próprio registro. A policy
de `DELETE` existe somente para compensação de upload não referenciado.

## Migration e rollback

- migration: `20260913135022_secure_support_attachments.sql`;
- SHA-256 da migration: `77b7e29e71f57d4c37a57469f215afaa1bba8717c0e2e83056f498c580921544`;
- rollback: `20260913135022_secure_support_attachments_down.sql`;
- SHA-256 do rollback: `4940e55e35b6db1b5e643b7e5ddb3ae7c2707b003db6b14a1859030fe78059fb`.

O rollback é fail-closed: recusa a reversão se houver qualquer `attachment_path`
persistido ou objeto no bucket. Quando o bucket está vazio, remove somente suas
policies e configuração. As colunas permanecem para nunca descartar referências.

## Gate futuro de staging

1. Confirmar o projeto de staging e capturar schema/policies/buckets existentes.
2. Confirmar ausência de bucket homônimo com configuração incompatível.
3. Aplicar somente a migration acima e registrar o checksum conferido.
4. Validar colunas, índices, bucket privado, limite, MIME e cinco policies.
5. Repetir a migration para validar idempotência de instalação.
6. Com contas técnicas isoladas, testar upload/leitura como proprietário e admin e
   negação para outro usuário e `anon`.
7. Testar falha de upload e falha de insert com cleanup, sem criar falso sucesso.
8. Validar que registros antigos nulos e `attachment_url` legado continuam legíveis.
9. Não executar rollback se qualquer anexo tiver sido persistido.

Nenhuma etapa de staging ou produção faz parte desta implementação local.
