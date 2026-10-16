# FinElo — posição patrimonial atual V2
Implementação local, 15/10/2026. Branch: `codex/investigate-card-net-worth`.
**Validação funcional, limpeza do staging e checks locais concluídos. Feature flag desligada por padrão; publicação e revisão pelo fluxo de PR.**

As decisões do complemento prevalecem sobre a proposta inicial. Não há reconstrução patrimonial histórica nesta entrega.

## Regras implementadas

| Indicador | Regra |
|---|---|
| Saldo de contas bancárias/caixa | Soma assinada dos saldos efetivos registrados de corrente, poupança e dinheiro em espécie. Mantém valores positivos e negativos; não baixa saldo por vencimento de cartão. |
| Benefícios restritos | Rubrica própria, incluída no patrimônio gerencial e excluída do disponível bancário após vencidas. |
| Obrigações econômicas reconhecidas | Soma canônica de todas as competências abertas de cada cartão, vencidas ou não. |
| Vencidas sem pagamento reconhecido | Apenas saldos econômicos classificados como vencidos; pagamento parcial reduz o residual, pagamento integral zera a obrigação. |
| A vencer | Parcela do mesmo total econômico que ainda não venceu, inclusive parcelas futuras materializadas reconhecidas pelo motor. |
| Crédito econômico comprovado | Somente carry final com procedência/resolução econômica, sem somar crédito já consumido por outra competência. |
| Disponível após vencidas | Saldo bancário/caixa − obrigações vencidas sem pagamento reconhecido. Benefícios, investimentos, bens e crédito restrito de cartão não são usados para compensar essa linha. |
| Patrimônio líquido | Contas bancárias/caixa + benefícios + investimentos + bens líquidos + crédito econômico remanescente − todas as obrigações econômicas reconhecidas dos cartões. |

O saldo legado de contas de crédito não entra como recurso nem como passivo adicional. Diferença de conciliação não vira dívida ou crédito sem resolução explícita válida. Pagamento com saída bancária e liquidação no cartão mantém as duas pernas; não cria despesa patrimonial adicional.

Contas arquivadas com saldo/obrigação continuam incluídas e identificadas. Contas de tipo `Investimento` ou `Outro` sem política inequívoca de fonte tornam o total incompleto, em vez de criar duplicação com carteiras ou liquidez presumida.

### Cenário sintético do piloto
- Banco: **R$ 201,43**.
- Benefício restrito: **R$ 674,85**.
- Obrigação vencida reconhecida: **R$ 7.437,11**.
- Disponível após vencidas: **−R$ 7.235,68**.
- Investimentos: R$ 78.810,73; bens líquidos: R$ 75.500,00.
- Patrimônio líquido: **R$ 147.749,90**.

Esses valores são fixtures de validação, não uma nova consulta à conta real.

## Integração e fonte única

`accountCardEconomics.ts` é o adaptador reutilizável:
```text
competenceHistoryCardsForAccount
  → projectCardTwoLedger
  → obrigações totais / vencidas / a vencer / créditos / completude / origem
```

Transações preserva sua integração anterior, chamando diretamente o mesmo construtor de competências e a mesma projeção canônica. O adaptador patrimonial, com guards de completude e filtragem próprios, é consumido pelo Dashboard V2. Ativar a flag do patrimônio não migra a integração de Transações. O núcleo econômico e as regras de cálculo de fatura não foram reimplementados no Dashboard. Os defaults de classificação permanecem compartilhados com Transações.

O [gate de compatibilidade de Transações](./transactions-compatibility-gate.md) documenta as divergências reproduzidas e a preservação do contrato anterior.

O adaptador expõe a origem `twoLedgerProjection`, base `registered_facts`, conta, data civil, quantidade de fatos manuais, competências, confirmações e resoluções, além dos motivos de cobertura insuficiente. Logs com conta explicitamente identificada são usados somente para aquela conta. Metadados sem conta explícita seguem a atribuição legada canônica.

**Completude significa cobertura dos registros carregados**, não certificação da dívida externa junto ao emissor ou garantia de que todas as parcelas futuras já foram importadas. Uma linha “2/12” não é multiplicada para inventar compromissos ausentes.

### Carregamento somente de leitura
- Leituras independentes em paralelo e consultas paginadas com ordenação determinística.
- Metadados de importação do mais recente para o mais antigo, preservando a precedência de Transações.
- Contas e movimentos por ID de conta; o autor familiar não remove movimentos da conta selecionada.
- Investimentos por proprietário, até a data civil atual, preservando as últimas posições registradas.
- Resoluções somente ativas, com reversões excluídas e procedência preservada.
- Caminho novo de confirmações **sem migração**, upsert ou alteração de storage. Confirmações locais legadas continuam reconhecidas; uma confirmação persistida prevalece sobre a mesma chave local.
- Falha em qualquer fonte essencial não publica um conjunto parcialmente carregado.
- Respostas antigas são descartadas por geração e chave de sessão/escopo. Atualizações de dados, retomada de foco e virada do dia provocam nova leitura.
- Remoção de conta/mudança de titular ou tipo durante a carga não vira saldo zero.

O lote do frontend usa múltiplas requisições SELECT. Ele não é uma transação atômica do banco. A completude de carga não afirma que não houve escrita simultânea por outro cliente; snapshots transacionais e fechamentos imutáveis pertencem ao desenho futuro.

### Ausência ou ambiguidade
O patrimônio e o disponível dependentes ficam indisponíveis quando faltam competências, existem fatos inválidos/repetidos, importações não atribuídas ou movimentos futuros que possam liquidar artificialmente a posição. Compras futuras sem vínculo reconhecido de parcelamento não recebem uma interpretação econômica inventada.

Parcelas futuras materializadas e identificadas são mantidas no motor. Nenhum filtro simplista por `Data <= hoje` apaga compromissos parcelados. Datas de vencimento da compra não são tratadas como pagamento efetivo.

## Feature flag e rollback

Nome: **`net_worth_components_v2_enabled`**.

- Default: desligado.
- Opt-in: `app_metadata.net_worth_components_v2_enabled = true`.
- Rollback: `enabled = false` ou `app_metadata.net_worth_components_v2_disabled = true`.
- Opt-out do usuário também desliga; não há opt-in por e-mail ou `user_metadata`.
- `VITE_NET_WORTH_COMPONENTS_V2_ENABLED=true` permite ensaio em ambiente que não aponte para o projeto Supabase de produção. O opt-out administrativo prevalece.
- O opt-in de produção exige decisão administrativa explícita futura; nenhuma flag remota foi ativada nesta entrega.

O V2 usa a visão Você quando o seletor de proprietários está desligado. A família só é consolidada após seleção explícita; os demais indicadores conservam seu escopo existente.

Com a flag desligada, o Dashboard mantém seu caminho legado. Com ela ligada, a posição atual tem data própria, independente do período operacional escolhido, e o ramo patrimonial comparativo não é executado. As leituras de investimento dos períodos comparados do caminho anterior são desabilitadas no V2.

**Comparação histórica patrimonial indisponível no V2.** As comparações operacionais, evolução de receitas/despesas, orçamento e outros indicadores de período continuam no caminho existente. O desenho separado está em `historical-design.md`; não foi implementado.

## Validação local

O cenário visual isolado fica em:
```text
/scripts/diagnostics/net-worth-preview.html
```

Ele monta apenas componentes e funções com dados sintéticos, sem autenticação ou sessão real. O teste de navegador bloqueia todas as requisições que não sejam de localhost.

Execução da fixture:
```powershell
npm run dev -- --host 127.0.0.1 --port 4181 --strictPort
# Em outra sessão, com Python Playwright disponível:
python scripts/diagnostics/validate-net-worth-preview.py
```

A fixture permite cenário do piloto, banco negativo, fatura futura, quitada, conciliação, fontes insuficientes, carga, erro e comparação operacional. “Flag V2 desligada” permite comparar visualmente o componente legado, sem alterar flags de usuários ou ambientes.

### Testes financeiros e de integração
- `tests/accountBalanceCardLegacyCompatibility.spec.ts`: 18 contratos completos da base anterior e proteção contra delegação ao adaptador patrimonial; preserva Transações com a flag desligada e após opt-in do Dashboard.
- `tests/dashboard/netWorthComponentsV2.spec.ts`: bancos positivos/negativos, vencidas/parcelas/futuras, pagamentos parciais/integrais/tardios, compras manuais, estornos, confirmações, conciliação, créditos, arquivadas, família, ausência de fontes e paridade com a superfície do cartão.
- `tests/dashboard/currentNetWorthSources.spec.ts`: paginação, leitura sem migração, confirmação local/persistida, reversões, escopo, falhas, corrida entre sessões/visões, recuperação e flag.
- `tests/dashboard/currentNetWorthCard.spec.ts`: componentes, valores negativos, estados de carga/erro/incompletude, crédito restrito e indisponibilidade histórica.
- Regressão existente do escopo do Dashboard ajustada para a presença da flag V2; as regras de propriedade e autorização são preservadas.
- Os testes de diagnóstico do primeiro relatório continuam documentando o comportamento legado; não indicam que os dados históricos foram corrigidos.

### Evidência de navegador
`evidence/browser-results.json`, `current-desktop.png`, `current-mobile.png` e `current-zoom-200.png`:
- Desktop, mobile e zoom de 200%.
- Sem transbordamento horizontal nos estados exercitados.
- Comparação operacional não modifica o total da fixture.
- Detalhe da origem acessível; recuperação de erro por teclado.
- Nenhum erro de execução da página.
- Tráfego restrito a localhost.

O detector visual não apontou problemas nos componentes novos. Avisos em trechos existentes de Dashboard/Transações, fora do diff funcional, não foram tratados como auditoria geral.

A homologação posterior passou 3068/3068 testes, incluindo os 66 novos casos V2; baseline TypeScript preservado e build/PWA aprovados. Os timeouts anteriores e o ajuste de setup dos testes de carteiras estão explicados no [resumo da validação em staging](./staging-validation-summary.md), que também documenta Auth/RLS reais e os limites da cobertura. Não houve teste em produção nesta homologação.

## Limites e próximo gate

A implementação não corrige a data-base de aberturas antigas nem altera saldos, movimentos, faturas ou conciliações. Ela reutiliza o saldo efetivo já adotado pelas contas não creditícias e muda a composição patrimonial no ramo V2.

A homologação cobriu interface real em desktop/celular, Auth/RLS de três identidades, escopos individual/familiar, pagamentos manuais e fontes insuficientes, com fixtures sintéticas isoladas. O resumo preserva resultados e limitações; os ledgers operacionais e scripts com IDs de staging permanecem locais.

Limpeza concluída em 16/10/2026: 73 exclusões exatas, 37 hashes preservados, contagens restauradas e Auth A/B/C aprovado. Checks finais aprovados: 3068/3068 testes, baseline TypeScript preservado e build/PWA. Próximo gate: revisão pelo PR e decisão explícita de merge. Merge, deploy manual e ativação em produção exigem decisão posterior. Sem backfill, migration, alteração de RLS ou Billing Stripe.
