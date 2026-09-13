# Aposentadoria do fluxo estrutural legado

Estado deste documento: implementação local. **Não executar em staging ou produção sem autorização específica.**

## Limites

- Não executar o rollback do snapshot estrutural.
- Não modificar `transactions`, `credit_card_entries`, `credit_card_payments`,
  `credit_card_statements`, competências, datas ou valores.
- Não apagar snapshots, resoluções, reversões ou logs.
- Não usar a interface comum para aposentar snapshots.
- Não reintroduzir migrations auxiliares 2U/2V ausentes do `main`.

## Desenho de privilégios

O legado fica fechado em três camadas:

1. O cliente não contém chamada de apply, rollback ou leitura de kill switch.
2. As RPCs antigas permanecem com os mesmos nomes para clientes desatualizados,
   mas não possuem `EXECUTE` externo e seus corpos recusam toda chamada com
   SQLSTATE `0A000`.
3. Um trigger privado torna os snapshots históricos imutáveis, inclusive contra
   concessões futuras acidentais.

A única mutação nova é uma linha na tabela privada
`finelo_structural_internal.credit_card_entry_reconciliation_retirements`.
Ela referencia o snapshot sem alterá-lo e registra decisão, motivo, executor,
subject, data/hora, revisão, quantidade e chave de idempotência.

`finelo_structural_retirement_executor` é `NOLOGIN`, `NOINHERIT` e
`NOBYPASSRLS`. A implementação privada é `SECURITY DEFINER`, tem
`search_path = ''`, RLS forçada e apenas `SELECT` no snapshot e
`SELECT/INSERT` na decisão. O wrapper público é `SECURITY INVOKER` e somente
`service_role` recebe `EXECUTE`. A própria implementação também valida a claim
`role=service_role`; app metadata e flags do JWT não autorizam a operação.

No PostgreSQL 17, `postgres` mantém memberships canônicas em gateway, executor
e retirement executor com `ADMIN TRUE`, `INHERIT FALSE` e `SET FALSE`. A
migration altera temporariamente somente `SET` para executar os blocos de cada
owner, retorna imediatamente a `postgres` e restaura o grantor e os três bits
originais antes do commit. Qualquer divergência aborta a transação inteira.

## Plano controlado de staging

### 1. Preflight somente leitura

Antes de aplicar a migration, registrar:

- migration atual e versão do PostgreSQL;
- exatamente um snapshot não revertido no cartão-alvo;
- zero ou uma decisão de aposentadoria para esse snapshot;
- `id`, `user_id`, `account_id`, `card_id`, `after_revision`, `entry_count`;
- SHA-256/MD5 determinístico do snapshot completo;
- hashes e contagens de `transactions`, `credit_card_entries`,
  `credit_card_payments`, `credit_card_statements`, resoluções e reversões;
- resultado do residual canônico nas superfícies cartão, histórico, modal e
  diagnóstico.

Se houver mais de um snapshot não revertido no mesmo cartão, parar. A migration
também falhará ao criar o índice parcial de cardinalidade.

### 2. Aplicar somente a migration

Aplicar:

`20260912224658_retire_structural_legacy_flow.sql`

Validar na mesma etapa:

- `apply_enabled=false` e `rollback_enabled=false` no estado privado;
- RPCs antigas sem `EXECUTE` para `anon`, `authenticated` e `service_role`;
- RPC administrativa somente para `service_role`;
- wrapper público `SECURITY INVOKER`;
- implementação privada `SECURITY DEFINER`, owner
  `finelo_structural_retirement_executor`, `search_path=''`;
- role dedicado sem login, inherit ou bypass RLS, com membership canônica de
  `postgres` em `ADMIN TRUE`, `INHERIT FALSE`, `SET FALSE`;
- RLS habilitada e forçada nas tabelas privadas;
- advisors de segurança e desempenho sem alerta novo atribuível à migration.

### 3. Chamada administrativa exata

Usar a chave de serviço apenas no executor administrativo, nunca no navegador.
Gerar uma UUID nova para `p_idempotency_key` e executar uma única vez:

```sql
select public.retire_credit_card_structural_snapshot_v1(
  p_snapshot_id := '<snapshot-id-validado>'::uuid,
  p_account_id := '<account-id-validado>'::uuid,
  p_card_id := '<card-id-validado>'::uuid,
  p_expected_after_revision := '<after-revision-validada>',
  p_expected_entry_count := <entry-count-validado>,
  p_reason := 'Decisão aprovada: aposentar o fluxo estrutural legado sem executar rollback.',
  p_idempotency_key := '<uuid-da-intencao>'::uuid
);
```

Resultado obrigatório:

- `decision=retired_without_rollback`;
- `idempotent_replay=false` na primeira chamada;
- `financial_records_changed=0`;
- `structural_rows_changed=0`.

Repetir com exatamente os mesmos parâmetros. O resultado deve trazer
`idempotent_replay=true` e continuar existindo uma única decisão.

### 4. Concorrência

Em duas sessões administrativas, disparar simultaneamente a chamada acima com
os mesmos parâmetros e a mesma chave. Uma sessão pode criar a decisão e a outra
deve receber replay; ao final deve existir exatamente uma linha. Repetir com
duas chaves diferentes para o mesmo snapshot e mesmo motivo: continua existindo
uma única decisão. Motivo ou precondições divergentes devem ser recusados.

### 5. Invariantes após a aposentadoria

Comparar os hashes e contagens do preflight. Todos devem ser idênticos para:

- transações físicas;
- pagamentos físicos;
- lançamentos, incluindo `transaction_id`, `statement_id`, datas, valores e
  competências;
- faturas;
- resoluções e reversões do modelo de dois livros;
- snapshot legado completo, incluindo `before_rows`, `after_rows`, revisões e
  `rolled_back_at`.

Também confirmar:

- apply e rollback legados são recusados;
- snapshot aposentado é recusado por ambos;
- snapshot de outra conta não pode ser aposentado com os parâmetros do alvo;
- recarregar a aplicação mantém apenas a mensagem de aposentadoria;
- a auditoria e a reconciliação explícita de dois livros continuam operando;
- o residual canônico é o mesmo nas quatro superfícies.

## Rollback de schema

O arquivo `20260912224658_retire_structural_legacy_flow_down.sql` é
deliberadamente fail-closed. Ele recusa execução se existir qualquer snapshot
ativo ou aposentado. Em ambiente vazio, remove somente a capacidade
administrativa de registrar aposentadoria; não restaura funções, grants nem
escrita do legado. Qualquer reabertura exigiria outra migration, revisão de
segurança e autorização manual explícita.
