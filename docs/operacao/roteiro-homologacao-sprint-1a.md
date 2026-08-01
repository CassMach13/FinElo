# Sprint 1A — roteiro de homologação em staging

## Limites desta etapa

- Branch: `codex/sprint-1a-integrity`.
- Banco permitido: somente o Supabase de staging `sxmmrnwbxntccscojmfh`.
- Produção `xotxxxohcmivyzswyjtm` não recebe migration, flag ou escrita.
- Nenhum dado histórico é corrigido, apagado ou reclassificado automaticamente.
- A flag `VITE_ATOMIC_IMPORTS_ENABLED` fica desligada por padrão e só deve ser `true` no Preview/Staging desta branch.

## Evidências automáticas já exigidas

Antes da homologação manual, devem estar verdes:

1. `npm run typecheck:baseline` — nenhum diagnóstico TypeScript novo.
2. `npm test` — suíte completa.
3. `npm run build` com `VITE_ATOMIC_IMPORTS_ENABLED=true`.
4. `supabase/tests/056_sprint_1a_integrity_guardrails_test.sql` em PostgreSQL 17 descartável.
5. Aplicação e remoção de `supabase/rollbacks/056_sprint_1a_integrity_guardrails_down.sql`, comprovando que `transactions` e `import_logs` permanecem.

## Preparação da conta de teste

1. Entrar na conta principal de staging.
2. Em `Transações`, abrir os filtros e selecionar `Período → Tudo`. Anotar o total exibido somente depois disso, pois o padrão `Este mês` oculta lançamentos de outros meses sem apagá-los.
3. Anotar também a quantidade de logs de importação.
4. Usar somente contas e cartões com prefixo `STG-QA`.
5. Se os lotes abaixo já existirem, excluir apenas esses lotes pelo histórico de importação antes de começar.
6. Não usar e-mail, arquivo ou dado de cliente de produção.

Arquivos já versionados para o teste:

- `docs/homologacao/staging-2026-07-30/arquivos/01_nubank_conta_base_julho_2026.csv`
- `docs/homologacao/staging-2026-07-30/arquivos/02_nubank_conta_mesmos_valores_agosto_2026.csv`
- `docs/homologacao/staging-2026-07-30/arquivos/03_nubank_conta_base_julho_2026_RENOMEADO.csv`
- `docs/homologacao/staging-2026-07-30/arquivos/10_xp_cartao_fatura_julho_2026.csv`
- `docs/homologacao/staging-2026-07-30/arquivos/11_xp_cartao_fatura_agosto_2026.csv`
- `docs/homologacao/staging-2026-07-30/arquivos/90_nubank_conta_stress_1000_linhas.csv`
- `docs/homologacao/staging-2026-07-30/arquivos/91_nubank_conta_linhas_invalidas.csv`

## Teste A — idempotência por conteúdo

1. Importar `01_nubank_conta_base_julho_2026.csv` na conta `STG-QA Conta`.
2. Voltar a `Transações`, manter `Período → Tudo` e confirmar `10 novas transações, 0 ignoradas` e o aumento exato de 10 no total geral. Em `Este mês` (agosto/2026), o contador não muda porque este arquivo contém datas de julho/2026.
3. Importar `03_nubank_conta_base_julho_2026_RENOMEADO.csv` na mesma conta.

Resultado obrigatório:

- a segunda tentativa é bloqueada como o mesmo conteúdo;
- renomear não cria novo lote;
- o total de transações e de logs não aumenta na segunda tentativa.

## Teste B — valores iguais não são falsos duplicados

1. No histórico de importações, pesquisar `02_nubank_conta_mesmos_valores_agosto_2026.csv`. Se já existir um lote legado, não iniciar o teste até removê-lo com a exclusão exata da Sprint 1A.
2. Importar `02_nubank_conta_mesmos_valores_agosto_2026.csv` na mesma conta.
3. Conferir cada data, descrição e valor.

Resultado obrigatório:

- o lote de agosto é aceito;
- todas as linhas legítimas são gravadas, mesmo contendo valores/descrições iguais aos de julho;
- não há ignorados por regra aproximada.

Se dois logs tiverem o mesmo nome, excluir um deles deve remover somente os IDs presentes no `imported_details` daquele log. Exclusão ampla por `Origem` reprova imediatamente a Sprint.

## Teste C — falha sem gravação parcial

1. Anotar os totais de transações e logs.
2. No DevTools do navegador, ativar `Network > Offline` antes de confirmar uma importação nova.
3. Confirmar a importação e aguardar o erro de rede.
4. Voltar para `Online`, atualizar a tela e conferir os totais.
5. Repetir o mesmo arquivo online.

Resultado obrigatório:

- a tentativa offline não cria transações nem log;
- a tentativa online cria exatamente um lote completo;
- não existe cenário com transações sem o respectivo log.

## Teste D — projeções do cartão

1. Importar `10_xp_cartao_fatura_julho_2026.csv` no cartão `STG-QA Cartão XP`.
2. Importar `11_xp_cartao_fatura_agosto_2026.csv` no mesmo cartão.
3. Conferir faturas, pagamentos, totais e lançamentos de julho/agosto.
4. Renomear uma cópia exata de um dos arquivos e tentar importar novamente.

Resultado obrigatório:

- uma transação primária produz no máximo uma projeção no motor;
- a cópia renomeada é bloqueada antes de criar novo lote;
- valores iguais pertencentes a IDs diferentes continuam visíveis;
- nenhuma fatura histórica é recalculada fora dos lotes de teste.

## Teste E — transações sem conta

1. Caso a conta de staging já possua lançamentos sem conta, abrir `Transações`.
2. Confirmar o aviso agregado `lançamentos sem conta`.
3. Clicar em `Ver lançamentos`.
4. Exportar CSV e conferir a coluna `Conta`.

Resultado obrigatório:

- o clique abre todo o histórico filtrado somente por `Sem conta`;
- os registros aparecem sem qualquer correção automática;
- a exportação identifica `Sem conta`;
- os saldos das contas permanecem inalterados.

Se staging não tiver nenhum registro sem conta, este teste deve ser marcado como `não aplicável`; não criar dado artificial diretamente no banco apenas para forçar o cenário.

## Teste F — carga e exclusão controlada

1. Anotar o total inicial.
2. Importar `90_nubank_conta_stress_1000_linhas.csv`.
3. Confirmar aumento exato de 1.000 registros e um único log.
4. Excluir somente esse lote pelo histórico de importação.
5. Confirmar retorno ao total inicial.
6. Importar `91_nubank_conta_linhas_invalidas.csv` e validar as contagens de importados/ignorados.

## Critérios de reprovação imediata

- qualquer escrita no projeto de produção;
- diferença entre `imported_count`, `imported_details` e transações persistidas;
- criação de transações sem log ou de log sem transações na mesma tentativa;
- nova projeção duplicada por `transaction_id`;
- alteração de data, valor ou competência fora do lote de teste;
- saldo, fatura ou histórico diferente após excluir o lote de stress;
- erro sem mensagem clara ou necessidade de corrigir dados manualmente no SQL.

## Rollback do staging

Ordem obrigatória se a Sprint 1A for recusada:

1. Desligar `VITE_ATOMIC_IMPORTS_ENABLED` no Preview/Staging e redeployar.
2. Excluir pela interface somente os lotes de teste criados neste roteiro.
3. Reverter o commit da Sprint 1A na branch ou promover novamente o último Preview aprovado.
4. Executar `supabase/rollbacks/056_sprint_1a_integrity_guardrails_down.sql` somente no projeto `sxmmrnwbxntccscojmfh`.
5. Confirmar que `transactions` e `import_logs` continuam presentes e com as mesmas contagens.
6. Rodar login, dashboard, transações, importação legada com a flag desligada e cartão.

O rollback SQL não apaga transações nem logs. Ele remove apenas `import_batches`, as duas funções da Sprint 1A, o índice/trigger de guarda e o relatório agregado.
