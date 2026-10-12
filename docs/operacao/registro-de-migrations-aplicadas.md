# Registro de migrations aplicadas fora do `db push`

Os bancos do FinElo recebem migrations pelo `apply_migration`, que grava a **versão do momento da aplicação** em
`supabase_migrations.schema_migrations`. Essa versão difere do prefixo do arquivo em `supabase/migrations/`.
Por isso o histórico remoto **não** é comparável arquivo a arquivo com o repositório, e `supabase db push` não é
usado neste projeto: ele listaria como pendentes migrations que já estão aplicadas. Nenhum workflow do
repositório aplica migrations; o merge só dispara o deploy do frontend.

Cada entrada abaixo registra o que foi aplicado em cada ambiente. As migrations listadas são idempotentes
(`CREATE OR REPLACE`, `DROP … IF EXISTS`), então uma reaplicação acidental é segura, mas **não deve ser feita**.

| Arquivo | Ambiente | Versão gravada | Nome gravado | SHA-256 do texto aplicado (`statements`, LF) |
|---|---|---|---|---|
| `20261012180000_family_members_authorization_hardening.sql` | staging (`sxmmrnwbxntccscojmfh`) | `20261012211308` | `family_members_authorization_hardening` | `d05334fb10579a998b06c8d1bd11364f42c6972bd7b2ece2b707ecc608c6264a` |
| `20261012180000_family_members_authorization_hardening.sql` | produção (`xotxxxohcmivyzswyjtm`) | `20261012220717` | `family_members_authorization_hardening` | `d05334fb10579a998b06c8d1bd11364f42c6972bd7b2ece2b707ecc608c6264a` |

O arquivo do repositório é byte a byte o texto aplicado nos dois ambientes (sem `BEGIN`/`COMMIT` próprios: o
executor já envolve o arquivo numa única transação). Qualquer alteração futura nesse arquivo exige uma nova
migration, nunca a edição do arquivo existente.

## Recuperação
`supabase/rollbacks/20261012180000_family_members_authorization_hardening_recovery_a.sql` e `…_recovery_b.sql` são
degraus **fail-closed**: nenhum deles relaxa a autorização. Use A se apenas o vínculo recíproco precisar ser
isolado; use B para congelar criação e alteração de vínculos (revogar continua possível).
