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
| `20261008115900_reconcile_investments_family_policy.sql` | staging (`sxmmrnwbxntccscojmfh`) | `20261008204400` | `reconcile_investments_family_policy` | `81f4d29f2caf4018344f9f02caab811123d48a826b759c8918a28ba73df85a79` |
| `20261008120000_investment_portfolios_holdings.sql` | staging (`sxmmrnwbxntccscojmfh`) | `20261008204541` | `investment_portfolios_holdings` | `dbf3e1c490525f8dc827b9c602919e21c9853caaf8e1ff19fa707b0867d4f9f3` |
| `20261012180000_family_members_authorization_hardening.sql` | staging (`sxmmrnwbxntccscojmfh`) | `20261012211308` | `family_members_authorization_hardening` | `d05334fb10579a998b06c8d1bd11364f42c6972bd7b2ece2b707ecc608c6264a` |
| `20261012180000_family_members_authorization_hardening.sql` | produção (`xotxxxohcmivyzswyjtm`) | `20261012220717` | `family_members_authorization_hardening` | `d05334fb10579a998b06c8d1bd11364f42c6972bd7b2ece2b707ecc608c6264a` |
| `20261012180100_family_members_member_can_leave.sql` | staging (`sxmmrnwbxntccscojmfh`) | `20261013013240` | `family_members_member_can_leave` | `a92c65fc082b9a42a9181be11ffced2aa7fd00a3b97c680d8e42a26d14592c3f` |
| `20261012180100_family_members_member_can_leave.sql` | produção (`xotxxxohcmivyzswyjtm`) | `20261013030956` | `family_members_member_can_leave` | `a92c65fc082b9a42a9181be11ffced2aa7fd00a3b97c680d8e42a26d14592c3f` |

Cada arquivo listado é byte a byte o texto aplicado nos ambientes indicados (sem `BEGIN`/`COMMIT` próprios: o
executor já envolve o arquivo numa única transação). Qualquer alteração futura nesses arquivos exige uma nova
migration, nunca a edição do arquivo existente.

## Recuperação
`supabase/rollbacks/20261012180000_family_members_authorization_hardening_recovery_a.sql` e `…_recovery_b.sql` são
degraus **fail-closed**: nenhum deles relaxa a autorização. Use A se apenas o vínculo recíproco precisar ser
isolado; use B para congelar criação e alteração de vínculos (revogar continua possível).

`supabase/rollbacks/20261012180100_family_members_member_can_leave_down.sql` remove somente a policy de saída do
membro: o `DELETE` volta a ser permitido apenas ao dono do vínculo. Também só reduz permissão.

## Investimentos V2-B1A (carteiras e holdings)
As duas migrations da V2-B1A estão aplicadas **somente no staging**; a produção ainda não as recebeu. A
reconciliação (`…115900`) não altera uma policy familiar equivalente já existente e aborta se ela divergir. O
rollback `supabase/rollbacks/20261008120000_investment_portfolios_holdings_down.sql` é destrutivo para
classificações e auditoria feitas depois da aplicação e não desfaz o hardening de privilégios de `investments`.
O staging também guarda duas entradas experimentais de sondagem do executor (`finelo_b1a_probe_success_…` e
`finelo_b1a_pm_…`, schemas privados próprios), que não correspondem a arquivos deste repositório.
