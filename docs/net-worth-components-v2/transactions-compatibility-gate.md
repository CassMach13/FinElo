# Compatibilidade de Transações — gate do PR #91

Referência anterior ao V2: cc40d32e1d608de7fb3214aaed8ab7f80f6071da.
Head sob investigação: 1cadf0e5c76afdf402d045b7aa5c8ddf139af4ee.
Dados exclusivamente sintéticos, relógio e fuso fixos; nenhuma consulta ou escrita remota nesta revisão.

## Risco confirmado

A substituição incondicional da preparação anterior por projectAccountCardEconomics alterava Transações mesmo com net_worth_components_v2_enabled desligada. A flag controla o Dashboard; não protegia aquela substituição.

O adaptador patrimonial filtra logs que identificam outra conta e, ao encontrar invalid_fact em qualquer entrada, não reconstrói competências. Transações usava a projeção devolvida sem aplicar um gate de completude; nessas condições, podia cair no fallback contábil/snapshot. Essa integração não era equivalente à anterior.

A comparação executou computeAccountCardDisplay da base original contra os mesmos 18 conjuntos de entrada usados no head inicial do PR. Foram congelados todos os campos de saída, incluindo diagnóstico, datas, status, limite e conciliação. **13/18 eram equivalentes; 5/18 divergiam.** Não se inferiu que dados de produção contêm esses casos.

| Caso sintético divergente | Caminho anterior | Head inicial do PR |
|---|---|---|
| Mesmo arquivo, metadados em duas competências/contas | Mantinha a atribuição legada, inclusive seus compromissos coincidentes | Filtrava o log da outra conta, mudando competência destacada, status e limite |
| Apenas log com outra conta explícita, origem coincidente | Usava o fallback legado por origem para reconstruir a competência | Suprimia essa competência e usava o fallback do cartão |
| Transação importada sem data válida, competência conhecida no log | Mantinha a competência reconhecida pelo histórico | Invalidava a preparação inteira e perdia a fatura/status |
| Confirmação sem timestamp histórico válido | Mantinha abatimento reconhecido pelo histórico | Invalidava todas as competências e usava fallback |
| Confirmação negativa ignorada, referente a outro mês | Ignorava essa confirmação e mantinha a fatura válida | Invalidava todas as competências e usava fallback |

Os outros casos cobrem histórico importado, pagamento do CSV N para N−1, metadados sem conta, compra manual diária, pagamento parcial, quitação, parcelas futuras, confirmação válida, confirmação com pagamento observado, conciliação pendente, ajuste bancário, crédito econômico explícito, importação sem atribuição, cartão sem histórico/datas e fatura a vencer.

## Correção mínima

Transações volta a chamar diretamente competenceHistoryCardsForAccount e projectCardTwoLedger, com as mesmas entradas e fallback da base anterior. Isso vale tanto com a flag patrimonial desligada quanto com opt-in do Dashboard: ativar patrimônio não migra silenciosamente a integração de Transações.

O Dashboard V2 conserva projectAccountCardEconomics, seus guards de completude e a filtragem de metadados. Ambas as integrações reutilizam o mesmo construtor de competências e o mesmo núcleo econômico; não foi criado motor, aritmética de fatura ou política de conciliação alternativos. Nenhuma mudança na flag ou nas regras financeiras do patrimônio.

A compatibilidade preserva também ambiguidades preexistentes, como atribuição por nome coincidente. Elas não foram corrigidas fora do rollout. Qualquer mudança futura na interpretação dos cartões de Transações exige um gate próprio; a equivalência de apresentação entre superfícies não é prometida para fontes ambíguas/incompletas.

## Regressões e validação

- tests/accountBalanceCardLegacyCompatibility.spec.ts e seus snapshots: contrato completo da base anterior para os 18 cenários, com flag desligada; repetição com override de ambiente ligado exige a mesma saída.
- Snapshots capturados executando o arquivo original da base, temporariamente e sem copiar cálculo financeiro para os testes. O arquivo temporário não integra o commit; CI não depende de Git para obter a referência.
- Um teste adicional falha se Transações voltar a chamar o adaptador patrimonial, mesmo quando seus guards recusam entradas.
- Não atualizar esses snapshots para aceitar uma migração implícita de Transações. Alterações intencionais requerem revisão explícita do contrato.

Validação local após a correção: **262/262 testes em 10 arquivos**, incluindo os **19 novos**; **18/18 snapshots da base preservados**. Baseline TypeScript: **14 diagnósticos conhecidos, nenhum novo**. Build/PWA: **aprovado**, com 49 entradas de precache. git diff --check e checagem de privacidade dos 31 arquivos do PR aprovados. A suíte completa é reexecutada pelo GitHub Actions no commit complementar; seu resultado e o Preview automático são registrados no PR. Merge, deploy manual e ativação em produção continuam aguardando decisão do usuário.
