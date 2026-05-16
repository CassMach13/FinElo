# Cartão V2 - PRD Técnico e Plano de Implantação

## 1) Contexto

O módulo atual de cartão depende de heurísticas de `Origem`, categoria e sinal de valor para inferir ciclo de fatura. Isso gerou inconsistências em produção.

No caso XP, a **data de fechamento varia mês a mês** e a data de vencimento é fixa. Portanto, o cálculo não pode depender de fechamento fixo no cadastro da conta.

Objetivo do Cartão V2: tornar o cálculo de fatura e limite robusto, auditável e seguro para usuários pagos.

---

## 2) Objetivos de produto

- Mostrar com confiabilidade:
  - fatura atual;
  - limite utilizado;
  - limite disponível;
  - histórico de faturas por ciclo;
  - lançamentos por fatura.
- Ter fluxo de correção operacional sem SQL manual para o time.
- Reduzir risco de regressões com rollout controlado e rollback simples.

### Não objetivos (nesta fase)

- movimentação financeira (pagamentos reais);
- integração bancária automática complexa;
- reescrever todo o fluxo de transações existente.

---

## 3) Requisitos funcionais

1. Cada importação de fatura cria/atualiza um ciclo explícito de fatura.
2. Faturas devem aceitar fechamento variável por mês.
3. Pagamento da fatura deve baixar a fatura correta (normalmente a anterior).
4. Usuário consegue ver histórico por fatura (não por aproximação mensal).
5. Ferramentas administrativas para:
   - reatribuir conta de uma importação;
   - reprocessar fatura;
   - reconstruir faturas de um cartão em janela de tempo.

---

## 4) Regras de negócio (núcleo)

### 4.1 Ciclo de fatura

- Fatura é uma entidade própria (ciclo explícito).
- Fonte principal do ciclo: arquivo de fatura importado.
- `close_date` pode variar entre ciclos e deve ser salvo por fatura.

### 4.2 Vencimento

- `due_date` é fixa por cartão (dia de vencimento da conta), mas também pode ser salva por fatura para auditoria.

### 4.3 Pagamentos

- Lançamento tipo "Pagamento de fatura" (manual ou importado) deve apontar para a fatura-alvo.
- "Pagamentos Validos Normais" do XP são tratados como baixa de fatura anterior ao ciclo do arquivo que contém o pagamento.

### 4.4 Estornos

- Estorno reduz total da fatura do ciclo ao qual pertence.
- Estorno não pode ser classificado como pagamento de fatura.

### 4.5 Limite

- Limite utilizado = soma dos saldos em aberto das faturas não quitadas.
- Limite disponível = limite total - limite utilizado.

---

## 5) Modelo de dados proposto

> Observação: nomes podem ser ajustados ao padrão atual da base.

### 5.1 Tabela `credit_card_statements`

- `id` (uuid, pk)
- `user_id` (uuid, fk)
- `account_id` (uuid, fk `contas.id`, tipo cartão)
- `reference_label` (text, ex.: `2026-05`)
- `close_date` (date, nullable)
- `due_date` (date, nullable)
- `total_charges` (numeric)
- `total_credits` (numeric) - estornos/créditos na fatura
- `total_payments` (numeric)
- `open_amount` (numeric)
- `source_origin` (text) - origem principal do ciclo
- `status` (text: `open`, `closed`, `paid`, `partial`)
- `created_at`, `updated_at`

Índices:

- `(user_id, account_id, reference_label)` unique
- `(account_id, due_date desc)`

### 5.2 Tabela `credit_card_statement_items`

- `id` (uuid, pk)
- `statement_id` (uuid, fk)
- `transaction_id` (uuid, fk `transactions.ID_Transacao`)
- `item_type` (text: `charge`, `refund`, `payment`)
- `amount` (numeric)
- `posted_date` (date)
- `created_at`

Índices:

- `(statement_id)`
- `(transaction_id)` unique

### 5.3 Tabela `credit_card_reprocess_jobs` (opcional, auditoria)

- `id`, `user_id`, `account_id`, `started_at`, `finished_at`, `status`, `summary_json`

---

## 6) Serviços e contratos (aplicação)

### 6.1 Service: `creditCardStatementService`

Operações:

- `upsertStatementFromImport(importLogId)`
- `attachTransactionsToStatement(statementId, transactionIds[])`
- `applyPayments(accountId, fromDate, toDate)`
- `rebuildStatements(accountId, fromDate, toDate)`
- `getCurrentStatement(accountId)`
- `getStatementHistory(accountId, limit)`

### 6.2 Regras de integração com `import_logs`

- Ao concluir importação de fatura:
  - identificar conta associada;
  - criar/atualizar ciclo;
  - vincular itens importados ao ciclo;
  - recalcular totais e status.

---

## 7) UX/Interface (escopo v1)

No card de cartão:

- Fatura atual (valor e status)
- Limite utilizado / disponível
- Histórico de faturas (lista simples, sem heurística)
- Ação de abrir detalhes por fatura

Na tela de detalhes da fatura:

- Cabeçalho: referência, fechamento, vencimento, status
- Totais: compras, créditos, pagamentos, saldo aberto
- Lista de lançamentos da fatura

Em Configurações > Histórico de importações:

- manter "Conta escolhida"
- manter "Corrigir Conta"
- adicionar "Reprocessar Fatura"

---

## 8) Segurança e integridade

- Toda mutação em lote protegida por transação SQL (`BEGIN/COMMIT`).
- Filtros por `user_id` obrigatórios em updates.
- Sem SQL destrutivo sem backup manual (ver playbook de produção).
- Feature flag para habilitar Cartão V2 por usuário/ambiente.

---

## 9) Testes

### 9.1 Unitários

- classificação de item: compra x estorno x pagamento
- associação de pagamento na fatura anterior (caso XP)
- cálculo de open_amount e status

### 9.2 Integração

- importação de 3 meses seguidos (com pagamento e estorno)
- reprocessamento após correção de conta
- reconstrução total de período

### 9.3 Regressão funcional

- comparar Cartão V1 x V2 em modo sombra
- tolerância de divergência definida (0 para casos validados)

---

## 10) Plano de implantação (seguro)

## Fase 0 - Preparação (1 dia)

- [ ] criar migration das novas tabelas
- [ ] criar service sem impacto em UI
- [ ] criar feature flag `card_v2_enabled`

Saída:

- infraestrutura pronta, sem alterar experiência do usuário.

## Fase 1 - Modo sombra (2 a 4 dias)

- [ ] processar importações novas no V2 em paralelo ao V1
- [ ] dashboard interno de divergências
- [ ] corrigir regras até divergência aceitável

Saída:

- confiança no cálculo V2 antes da troca visual.

## Fase 2 - Ferramentas operacionais (1 a 2 dias)

- [ ] "Reprocessar Fatura" por importação
- [ ] "Reconstruir Cartão" por período
- [ ] logs de auditoria de reprocessamento

Saída:

- operação independente de SQL manual.

## Fase 3 - UI V2 limitada (1 a 2 dias)

- [ ] card usa V2 para fatura atual + limites
- [ ] histórico simples por fatura (sem widgets avançados)
- [ ] habilitar por feature flag para grupo interno

Saída:

- validação real sem expor todos os usuários.

## Fase 4 - Rollout gradual (1 a 3 dias)

- [ ] liberar para 10% dos usuários
- [ ] monitorar divergências e suporte
- [ ] liberar 50%
- [ ] liberar 100%

---

## 11) Rollback plan

### Aplicação

- desativar `card_v2_enabled` -> volta para V1 imediatamente.

### Dados

- tabelas V2 são aditivas; rollback não exige apagar dados antigos.
- em incidente crítico: manter writes pausados no V2 e reprocessar após correção.

---

## 12) Critérios de aceite

- fatura atual do cartão bate com valor esperado dos arquivos validados.
- pagamento de fatura baixa ciclo correto.
- limite utilizado/disponível consistente em cenários reais.
- zero updates cross-user em validação.
- operação consegue corrigir conta e reprocessar sem SQL manual.

---

## 13) Próximo passo imediato (execução)

1. Criar migration das tabelas V2.
2. Implementar `creditCardStatementService` com testes unitários.
3. Habilitar modo sombra no ambiente local.
4. Rodar com seus dados XP de Jan-Mai/2026 e comparar resultados.
