# Plano de Migração de Dados Históricos para o FinElo

> **Status:** planejamento (não implementado)  
> **Última atualização:** maio/2026  
> **Objetivo deste documento:** registrar como permitir que usuários tragam anos de histórico financeiro (planilhas, outros apps, exports manuais) para o FinElo sem perder dados e com experiência de valor clara após a migração.

---

## 1) Contexto e problema

Muitos usuários controlam finanças há anos em **planilhas** (Excel, Google Sheets) ou em **outros aplicativos**. Ao adotar o FinElo, o medo principal é:

- perder o histórico acumulado;
- ter que “começar do zero”;
- não ver retorno imediato do esforço de migrar.

O FinElo **já importa** CSV, Excel e OFX (bancos nativos + Smart Import), mas o fluxo atual foi desenhado para **extratos recentes**, não para **migração em massa de uma década** de lançamentos.

Este plano define visão de produto, o que reaproveitar do código atual, lacunas técnicas e um roadmap por fases.

---

## 2) Objetivos de produto

### Objetivos

1. **Preservar histórico** — datas, valores, descrições, categorias e vínculo com contas.
2. **Evitar duplicatas** — reimportação e sobreposição com extratos novos não devem inflar o histórico.
3. **Mostrar valor rápido** — após a carga, o usuário vê dashboard, tendências e patrimônio com dados reais (não planilha estática).
4. **Unificar passado e futuro** — histórico migrado + importação bancária/Open Finance no mesmo lugar.

### Não objetivos (fase inicial)

- Migração automática “one-click” de todos os concorrentes sem mapeamento.
- Reconstrução perfeita de faturas de cartão a partir de planilha genérica sem competência (caso avançado).
- Importação ilimitada via Open Finance retroativa (APIs limitam janela; ver seção 6).

### Mensagem de produto (rascunho)

> *“Não jogue fora anos de controle. Traga seu histórico para o FinElo, categorize em massa e enxergue tudo no dashboard — com extratos e cartão no mesmo app daqui pra frente.”*

---

## 3) Estado atual do FinElo (baseline técnico)

### 3.1 Fluxos de importação existentes

| Fluxo | Módulo principal | Formatos | Uso típico |
|-------|------------------|----------|------------|
| Bancos nativos | `src/components/views/ImportView.tsx`, `src/services/parsers/nativeBankParsers.ts` | CSV, Excel, OFX | Extratos por banco |
| Smart Import (mapeamento manual) | `ImportView.tsx`, `src/services/parserService.ts` | CSV, Excel, OFX | Planilhas customizadas |
| Open Finance | `src/services/openFinanceService.ts` | API (7–90 dias) | Premium; revisão linha a linha |
| Investimentos XP | `InvestmentImportModal.tsx`, `xpInvestmentParser.ts` | Excel | Posições, não `transactions` |
| Manual | `NewTransactionModal.tsx` | UI | Lançamentos avulsos |

Referência de CSV mínimo: `demo_transactions.csv` (colunas `Data`, `Descricao`, `Valor`).

### 3.2 Modelo de transação (`src/types.ts` → `Transaction`)

Campos relevantes para migração:

| Campo | Obrigatório | Notas |
|-------|-------------|-------|
| `Data` | Sim | Linha sem data é ignorada no parse |
| `Valor` | Sim | Sinal define tipo em contas correntes |
| `Descricao_Original` | Sim | Texto bruto |
| `Nome_Fantasia` | Sim | Default = descrição; regras podem renomear |
| `Tipo` | Sim | `Renda` ou `Despesa` |
| `Categoria` | Efetivo | Default `'-'` sem regra de mapeamento |
| `Origem` | Sim | Nome do arquivo ou `'manual'`; chave de lote/histórico |
| `ID_Conta` | Sim | Definido na importação |
| `Data_Pagamento` | Opcional | Importante para cartão (competência) |
| `Parcela_Atual` / `Total_Parcelas` | Opcional | Parcelamento |

### 3.3 Contas e saldo

- `Account.Saldo_Inicial` + `Account.Data_Saldo_Inicial` definem o ponto de partida do saldo calculado.
- Transações **anteriores** a `Data_Saldo_Inicial` **não entram** no saldo exibido (`getAccountsWithCalculatedBalance` em `useAppStore`).
- **Regra crítica para migração:** ao importar desde 2015, a data de saldo inicial da conta deve ser **≤ à primeira transação importada** (ou o saldo inicial deve refletir o saldo real na data de corte acordada com o usuário).

### 3.4 Categorização e pós-processamento

- `MappingRule` — match por substring em `Descricao_Original` (`SettingsView`, `useAppStore`).
- `reApplyAllRules` — reaplica regras em transações **já existentes** (útil após migração em massa).
- Open Finance pode aprender regras automaticamente; planilha não.

### 3.5 Histórico de importação e rollback

- Tabela `import_logs` + UI em `SettingsView`.
- `deleteTransactionsByOrigin` / `reassignTransactionsAccountByOrigin` — gestão por arquivo (`Origem`).
- Bloqueio: **mesmo `file_name` não importa duas vezes** (renomear arquivo contorna — fragilidade conhecida).

### 3.6 O que já consome histórico longo

| Tela / módulo | Benefício com 10 anos |
|---------------|------------------------|
| `DashboardView.tsx` | KPIs, orçamento, 50/30/20, patrimônio (modos monthly…yearly, **custom**) |
| `TransactionsView.tsx` | Filtros, saldos por conta |
| `ContasView.tsx` | Saldo calculado acumulado |
| `MonthlyEvolutionChart.tsx` | Evolução mensal (janela limitada ~6–12 meses por vez) |
| `NetWorthSummaryCard.tsx` | Patrimônio agregado |

**Lacuna de UX:** não há gráfico de tendência **anual/decenal** nativo; vale considerar na fase “momento uau”.

---

## 4) Lacunas para migração em massa (~10 anos)

| # | Lacuna | Impacto | Prioridade sugerida |
|---|--------|---------|---------------------|
| 1 | Sem wizard dedicado “Migrar meus dados” | UX intimidadora para leigos | P0 |
| 2 | Sem deduplicação por linha (só por nome de arquivo) | Duplicatas em reimportação | P1 |
| 3 | Insert monolítico de transações (sem chunking) | Timeout / limite Supabase em arquivos grandes | P1 |
| 4 | Sem preview/revisão antes do insert (exceto Open Finance) | Erros gravados em massa | P1 |
| 5 | Categorias `'-'` em massa | Dashboard pobre até regras/edição | P0 (guia + regras) |
| 6 | Cartão: planilha “flat” vs fatura por competência | Faturas/limite imprecisos | P2 |
| 7 | Performance UI (tudo em memória, paginação 1000) | Lentidão com dezenas de milhares de linhas | P2 |
| 8 | Sem conectores por export de apps concorrentes | Fricção de mapeamento | P3 |

Trecho relevante em `useAppStore.addMultipleTransactions`: comentário explícito de **sem deduplicação por linha** na importação CSV/Excel.

---

## 5) Proposta de solução (produto)

### 5.1 Princípio

Tratar migração como **produto**, não como “mais um import”:

```
Origem externa → Normalização → Validação → Lotes → FinElo → Momento uau
```

### 5.2 Assistente de migração (wizard) — visão

Novo fluxo (ex.: **Configurações → Migrar meus dados** ou entrada na `ImportView`):

| Passo | Conteúdo |
|-------|----------|
| 1. Origem | Planilha própria / outro app / export de banco |
| 2. Template | Download do **template FinElo** + guia (Excel/Sheets) |
| 3. Mapeamento | Reuso do Smart Import + **perfil salvo** (“Planilha Cassio 2015–2025”) |
| 4. Contas | Criar/vincular contas; calibrar `Data_Saldo_Inicial` |
| 5. Validação | Preview: contagem, intervalo de datas, duplicatas suspeitas, ignoradas |
| 6. Importação | Lotes (por ano ou N linhas); barra de progresso; `Origem` por lote |
| 7. Pós-migração | Aplicar regras + tela **“Resumo da sua migração”** |

### 5.3 Template oficial FinElo (CSV / Excel)

Colunas recomendadas:

```text
Data;Descrição;Valor;Categoria;Conta;Tipo;Observações
```

- **Data:** `DD/MM/AAAA` ou `AAAA-MM-DD`
- **Valor:** negativo = despesa, positivo = renda (ou usar coluna `Tipo`: `Renda` / `Despesa`)
- **Categoria:** opcional; se vazio → `'-'` até regras
- **Conta:** nome exato da conta no FinElo (ou mapeamento no wizard)
- **Origem sugerida por lote:** `migracao_planilha_2018_conta_itau.csv` (rastreável e reversível)

Arquivo de referência mínimo no repositório: `demo_transactions.csv`.

### 5.4 Modo “histórico legado”

- Prefixo em `Origem`: ex. `migracao/` ou tag em `import_logs` (campo futuro).
- Separar mentalmente e na UI: **histórico migrado** vs **extratos bancários ativos**.
- Documentar para suporte: exclusão por origem = desfazer lote inteiro.

### 5.5 Momento uau (pós-migração)

Tela ou modal após último lote:

- Total de lançamentos, anos cobertos, categorias distintas.
- Gráfico **por ano** (receita vs despesa) — complementa `MonthlyEvolutionChart` (mensal).
- Top categorias da vida financeira vs último ano.
- Patrimônio (se contas + investimentos + bens cadastrados).
- CTA: *“Agora importe o extrato do mês e o FinElo mantém tudo atualizado.”*

---

## 6) Caminho manual viável hoje (sem desenvolvimento)

Para suporte ou usuários avançados **agora**:

1. Normalizar planilha: `Data | Descrição | Valor | Categoria | Conta`.
2. **Dividir por ano e conta** — ex. `historico_2016_itau.csv` (evita timeout; facilita rollback).
3. Criar contas com `Data_Saldo_Inicial` na **primeira data** do histórico (ou saldo conhecido na data de corte).
4. Importar via **Smart Import** (`ImportView`); salvar `ImportConfig` reutilizável.
5. Cadastrar `MappingRule`s **antes** ou executar **Reaplicar regras** depois.
6. Validar: `DashboardView` (período custom), `ContasView` (saldos), amostra em `TransactionsView`.
7. **Cartão de crédito:** preferir imports por fatura/arquivo de emissor; planilha plana pode exigir `creditCardRebuildFromImportHistoryService` ou ajuste manual de competência.

**Limitação:** mesmo `file_name` bloqueia reimportação; renomear arquivo contorna (não ideal).

---

## 7) Roadmap técnico sugerido

### Fase P0 — Fundação (baixo esforço, alto impacto)

- [ ] Template CSV/Excel oficial + página de ajuda (pode linkar Central de Ajuda).
- [ ] Entrada “Migrar planilha histórica” na `ImportView` com checklist (saldo inicial, divisão por ano).
- [ ] Documentar no app: significado de `Data_Saldo_Inicial` no fluxo de migração.
- [ ] Guia de categorização em massa (regras + reaplicar).

**Arquivos prováveis:** `ImportView.tsx`, `docs/` ou Central de Ajuda, novo `public/templates/migracao-finelo.csv`.

### Fase P1 — Confiabilidade

- [ ] **Chunking** no insert de transações (padrão: 200–500, alinhado a outros serviços do projeto).
- [ ] **Preview** antes de gravar (tabela paginada, totais, amostra de erros).
- [ ] **Relatório de lote** em `import_logs` (importadas, ignoradas, duplicatas suspeitas).
- [ ] **Dedup opcional:** mesma `Data` + `Valor` + similaridade em `Descricao_Original` (configurável).

**Arquivos prováveis:** `useAppStore.ts` (`addMultipleTransactions`), novo `migrationImportService.ts`, modal de preview.

### Fase P2 — Experiência e escala

- [ ] Wizard multi-etapas dedicado.
- [ ] Perfis de migração persistidos (`import_configs` estendido ou tabela `migration_profiles`).
- [ ] Gráfico anual / linha do tempo longa no dashboard pós-migração.
- [ ] Otimização de carga: virtualização agressiva ou agregados server-side para listas muito grandes.
- [ ] Fluxo específico cartão: planilha → competência ou rebuild assistido.

**Arquivos prováveis:** `DashboardView.tsx`, `creditCardRebuildFromImportHistoryService.ts`, migrations Supabase se necessário.

### Fase P3 — Aquisição

- [ ] Conectores por export conhecido (Mobills, Organizze, etc.) — mapeamento de colunas fixo.
- [ ] Oferta onboarding: “Importe 10 anos em 30 minutos” com suporte assistido (founders/VIP).

---

## 8) Requisitos não funcionais

| Requisito | Meta inicial |
|-----------|----------------|
| Volume | Até ~50k lançamentos por usuário (10 anos × ~400/mês) |
| Tempo | Lote de 5k linhas em &lt; 60s (com chunking) |
| Idempotência | Reenvio do mesmo lote não duplica (hash ou dedup) |
| Reversão | Excluir por `Origem` / log de importação |
| Privacidade | Processamento no client + Supabase RLS; sem envio a terceiros |
| Auditoria | `import_logs` + detalhes de linhas ignoradas (já parcialmente em `imported_details`) |

---

## 9) Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Saldo errado após migração | Wizard força revisão de `Data_Saldo_Inicial`; help contextual |
| Duplicatas | Dedup P1; convenção de `Origem` por lote |
| Timeout Supabase | Chunking + retry |
| Categorias vazias | Template com coluna categoria + reaplicar regras + sugestão de regras por palavras frequentes (futuro) |
| Cartão impreciso | Caminho separado “migrar cartão por faturas”; não prometer paridade planilha flat no P0 |
| UI lenta | Paginação server-side ou limite de exibição default por período |

---

## 10) Métricas de sucesso

- % de usuários que completam migração (≥ 1 lote) no onboarding.
- Mediana de lançamentos importados por usuário migrado.
- Retenção D7/D30 de quem migrou vs quem não migrou.
- NPS / ticket: “saldo bateu com planilha?” (amostragem).
- Tempo até primeira visualização do dashboard com histórico (&lt; 15 min após upload).

---

## 11) Referências no repositório

```
src/types.ts                              # Transaction, Account, ImportConfig, MappingRule
src/hooks/useAppStore.ts                  # addMultipleTransactions, fetchTransactions, regras
src/components/views/ImportView.tsx       # UI de importação
src/services/parserService.ts             # CSV/Excel/OFX genérico
src/services/parsers/nativeBankParsers.ts
src/components/views/DashboardView.tsx
src/components/views/TransactionsView.tsx
src/components/views/SettingsView.tsx     # Regras, logs, configs
src/services/creditCardRebuildFromImportHistoryService.ts
src/services/creditCardMigrationService.ts
supabase/migrations/001_create_import_logs.sql
demo_transactions.csv                     # Formato mínimo
docs/cartao-v2-prd-implantacao.md         # Referência de estilo PRD técnico
```

Scripts pontuais (cartão XP, não pipeline genérico):

- `scripts/migrate_card_transactions.sql`
- `scripts/migrate_card_transactions_full.sql`

---

## 12) Decisões em aberto

1. **Uma conta “Histórico geral”** vs forçar divisão por conta real na planilha?
2. **Import único multi-aba Excel** vs obrigar um CSV por aba/conta?
3. **Dedup:** bloquear, avisar ou mesclar duplicatas suspeitas?
4. **Plano free:** limite de linhas históricas migradas ou só por arquivo?
5. **Serviço assistido** (time importa para VIP) — escopo e preço?

---

## 13) Próximo passo recomendado

1. Validar com 2–3 usuários reais uma migração manual (seção 6) e anotar fricções.
2. Implementar **P0** (template + checklist + ajuda).
3. Priorizar **P1** (chunking + preview) antes de marketing “traga 10 anos”.

---

*Documento vivo: atualizar este arquivo quando fases forem implementadas ou decisões da seção 12 forem fechadas.*
