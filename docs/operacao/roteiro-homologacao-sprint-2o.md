# Sprint 2O — roteiro de homologação da conservação atômica

## Objetivo

Validar, sem ativar nenhuma conta, o executor transacional que substitui um
único grupo de faturas físicas duplicadas por uma fatura composta nova. A
operação conserva vínculos e metadados, não escolhe uma linha antiga como
vencedora e registra um snapshot de rollback antes da primeira mutação.

## Estado seguro por padrão

- a flag dedicada `atomic_card_statement_conservation_enabled` nasce ausente;
- `unset` e `disabled` recusam toda aplicação;
- o painel 2O é agregado, não possui botão de execução e sempre mostra
  `Elegível para escrita por este painel: não`;
- a flag da projeção atômica das Sprints anteriores não habilita a 2O;
- o rollback individual não depende da flag de aplicação, para que a
  recuperação continue disponível após um kill switch;
- a migration não altera nem corrige dados históricos por conta própria;
- cada chamada aceita exatamente uma conta, um cartão e uma competência;
- nenhum `insert`, `update` ou `delete` é feito em `transactions`.

## Artefatos

- migration:
  `supabase/migrations/20260822221118_sprint_2o_atomic_statement_conservation.sql`;
- rollback de schema para ambiente sem operações efetivas:
  `supabase/rollbacks/20260822221118_sprint_2o_atomic_statement_conservation_down.sql`;
- suíte SQL transacional:
  `supabase/tests/20260822221118_sprint_2o_atomic_statement_conservation_test.sql`;
- cenários de concorrência:
  `supabase/tests/20260822221118_sprint_2o_concurrency_*.sql`;
- relatório e contrato privado:
  `src/domain/credit-card/atomicRebuildStatementConservationExecution.ts`.

## Invariantes obrigatórias

1. A revisão persistida e o checksum da sombra devem coincidir com a auditoria
   imediatamente anterior.
2. Todas as faturas físicas da competência precisam estar identificadas e
   bloqueadas em ordem determinística.
3. Todas as linhas devem pertencer ao mesmo usuário, conta e cartão.
4. Itens do engine, itens legados e pagamentos devem ser bloqueados e
   fotografados antes da escrita.
5. As cardinalidades informadas pelo cliente devem ser recalculadas no banco.
6. Totais manuais, oficiais e calculados não podem ser ambíguos nem divergir do
   contrato.
7. A redução permitida é somente `N faturas físicas → 1 composta`; quantidades
   de itens e pagamentos permanecem idênticas.
8. Qualquer falha cancela snapshot, fatura composta, religações e remoções na
   mesma transação.
9. Uma segunda execução concorrente deve esperar o lock e então falhar por
   timeout ou revisão obsoleta, sem escrita parcial.
10. O rollback só pode ocorrer enquanto a revisão posterior e todos os vínculos
    ainda coincidirem exatamente com o snapshot.

## Validação automatizada local

### TypeScript e domínio

```powershell
npm.cmd run typecheck:baseline
npm.cmd test -- tests/credit-card/atomicRebuildStatementConservationExecution.spec.ts tests/credit-card/atomicRebuildStatementConservationPlan.spec.ts tests/credit-card/creditCardAtomicRebuildService.spec.ts
```

Confirmar contrato pronto, privacidade agregada, falha fechada por revisão,
checksum, identidades ou metadados inconsistentes, reauditoria obrigatória e
mapeamento exato do rollback.

### PostgreSQL 17 descartável

Carregar, nessa ordem, em banco sem dados reais:

1. `supabase/tests/fixtures/sprint_2c_minimal_schema.sql`;
2. `supabase/migrations/062_sprint_2c_atomic_card_projection_activation.sql`;
3. a migration 2O;
4. a suíte SQL 2O.

A suíte deve terminar em `ROLLBACK`. Ela cobre:

- flag dedicada desligada por padrão;
- revisão obsoleta;
- metadado protegido divergente;
- falha induzida depois da criação do snapshot;
- consolidação `2 → 1`;
- conservação de itens, pagamentos, lotes e transações;
- idempotência;
- isolamento entre usuários;
- recusa de rollback após mudança posterior;
- rollback exato das identidades e dos vínculos originais.

Executar também as duas sessões concorrentes. O resultado aprovado exige um
único snapshot ativo e uma única fatura composta; a sessão perdedora precisa
falhar sem deixar qualquer linha. Depois, executar o rollback vencedor e
confirmar as duas faturas e a revisão originais.

## Homologação no staging

### Migration

1. Confirmar explicitamente o `project_ref` do staging:
   `sxmmrnwbxntccscojmfh`.
2. Executar primeiro o dry-run da ferramenta de migrations.
3. Aplicar somente a migration 2O no staging.
4. Confirmar que o estado da flag para a conta de teste é `unset`.
5. Confirmar que usuário autenticado possui `SELECT`, mas não `INSERT`,
   `UPDATE` ou `DELETE`, na tabela de snapshots.
6. Não alterar `raw_app_meta_data` de nenhuma conta nesta etapa.

### Preview

1. Entrar com a conta principal do staging.
2. Anotar a quantidade de transações.
3. Abrir o histórico do cartão e executar a auditoria somente leitura.
4. Localizar `Sprint 2O — contrato transacional de conservação`.
5. Confirmar:

   - o painel não mostra IDs, nomes de arquivos, competência ou valores;
   - não existe botão de consolidar, reparar, excluir ou ativar;
   - operações reais são `0`;
   - escrita pelo painel permanece `não`;
   - se não houver duplicidades, o status é `nenhuma duplicidade exige
     consolidação`;
   - se houver exatamente um grupo íntegro, o status pode ser `contrato
     transacional preparado para homologação`, ainda sem executar nada;
   - a quantidade de transações antes e depois é idêntica.

6. Repetir a auditoria três vezes. Sem mudança de dados, status e contagens
   precisam ser determinísticos.

## Rollback

### Código/Preview

Retornar o deployment para o commit imediatamente anterior. Isso não requer
rollback de dados porque o painel não executa escrita.

### Migration ainda sem operações efetivas

Se a flag nunca foi habilitada e não existe snapshot, aplicar o script
`20260822221118_sprint_2o_atomic_statement_conservation_down.sql` no staging.

### Após qualquer operação efetiva futura

Não apagar a tabela de snapshots. Primeiro executar o rollback individual da
operação e conferir a revisão restaurada. A remoção de schema só poderá ser
avaliada depois de confirmar que não resta snapshot ativo e mediante aprovação
específica para o ambiente.

## Critérios de reprovação

- qualquer mudança em `transactions`;
- alteração de valor, data, competência ou quantidade financeira;
- duas sessões concorrentes conseguirem gravar;
- snapshot incompleto ou criado fora da mesma transação;
- execução com flag ausente/desligada;
- execução com revisão ou checksum obsoleto;
- perda de metadados manuais/oficiais;
- rollback que ignore alterações posteriores;
- aumento da baseline TypeScript, falha de testes ou falha de build.
