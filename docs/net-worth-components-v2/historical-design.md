# Desenho técnico separado — histórico patrimonial
Status: proposta para revisão; não implementada. Nenhuma tabela, trigger, migration, política RLS ou backfill foi criado.
Complementa a posição atual V2 de 15/10/2026. O histórico patrimonial continua indisponível nesta etapa.

## 1. Dois produtos financeiros distintos

Uma consulta histórica precisa declarar dois cortes:
- **T — data econômica:** até quando os fatos afetam a posição patrimonial.
- **K — data de conhecimento:** quais versões dos fatos estavam disponíveis ao sistema.

**Posição reconstruída com os dados conhecidos hoje:** posição em T usando o conhecimento atual K. Um extrato de janeiro importado em março pode mudar essa reconstrução de janeiro.

**Fotografia dos dados disponíveis naquela época:** posição em T usando K igual ao instante de fechamento daquela época. O extrato importado em março não pode aparecer numa fotografia de janeiro produzida antes de sua chegada.

Exemplo: compra em 20/01, importada em 05/03, pagamento em 10/02 importado em 06/03:
- reconstrução de 31/01 feita hoje reconhece a compra, mas não o pagamento de fevereiro;
- fotografia de 31/01 com conhecimento até 31/01 não conhece essa compra importada apenas em março;
- uma nova reconstrução não deve sobrescrever silenciosamente um fechamento antigo.

Os rótulos da interface devem explicitar o modo, T, K, versão e cobertura. Não chamar ambos de “saldo em janeiro” sem qualificação.

## 2. Contrato de fatos e datas

| Campo conceitual | Significado |
|---|---|
| fact_id / event_id | Identidade estável do mesmo fato econômico; nunca inferida apenas por texto, valor e data. |
| economic_effective_at / economic_date | Quando o fato altera ativos ou passivos. Datas civis devem preservar o calendário de America/Sao_Paulo. |
| due_date | Quando a obrigação vence. Não é data de liquidação nem data de aquisição. |
| settled_at | Data efetiva de pagamento reconhecido; distinta da confirmação e do vencimento. |
| recorded_at / system_from / system_to | Quando uma versão entrou e deixou de valer no conhecimento do sistema. |
| source_import_id / source_row_id / hash | Proveniência, identidade de lote/linha e verificação de integridade. |
| owner_id / account_id | Titularidade econômica do ativo/passivo, distinta da autoria do lançamento. |
| recorded_by | Autor da ação; não define automaticamente o dono do saldo. |
| reverses_fact_id / supersedes_version_id | Reversão e correção explícitas, sem apagar a versão anterior. |
| confidence / coverage / missing_reason | Fonte, limitações e lacunas; ausência não significa zero. |

A data de confirmação do usuário não deve ser usada automaticamente como a data econômica do pagamento. Um “já paguei” hoje pode se referir a pagamento anterior. O sistema precisará coletar ou preservar essa informação e distinguir confirmação de valor de confirmação total.

Nos dados existentes, `Data_Pagamento` de compra no cartão pode significar vencimento da fatura escolhida. Não reconstruir liquidação apenas a partir desse campo. A materialização de parcelas desloca datas mês a mês; isso também impede tratar cada `Data` como uma nova contratação independente.

## 3. Pipeline proposto

1. Autorizar o escopo para a sessão atual e resolver as contas/titulares permitidos.
2. Selecionar as versões visíveis no corte K.
3. Construir obrigações com reconhecimento econômico até T, preservando compromissos contratados com vencimentos posteriores.
4. Selecionar pagamentos, estornos, correções e resoluções efetivos até T e conhecidos em K.
5. Atribuir os fatos às competências com as regras e a configuração versionadas daquela apuração.
6. Executar o mesmo motor econômico canônico, sem um motor paralelo de faturas históricas.
7. Selecionar posições bancárias, investimentos, valores de bens e financiamentos sustentados em T/K.
8. Agregar cada ativo/passivo uma vez, preservando benefícios restritos e crédito comprovado.
9. Publicar posição + T/K + cobertura por fonte + versão de cálculo + fingerprint das entradas.

Passar `asOf=T` ao motor atual não executa os passos 2–4. Hoje esse parâmetro classifica vencimentos. O adaptador temporal futuro precisará preparar as entradas corretas antes da execução.

### Compras manuais e parcelamentos
- Uma compra diária manual passa a existir na data econômica informada, sem exigir arquivo bancário.
- Uma contratação parcelada exige identidade de contrato/compra original, data de contratação e cronograma versionado.
- Parcelas futuras de uma contratação já reconhecida entram no passivo patrimonial; compras ou recorrências apenas planejadas não entram como dívida contratada.
- Importar uma parcela não pode duplicar a mesma parcela previamente materializada.
- Não multiplicar uma linha “2/12” para inventar dez valores iguais sem cronograma comprovado.
- Cancelamento/estorno modifica a obrigação conforme sua efetividade e proveniência; não elimina o conhecimento de que a compra existiu antes.

### Pagamentos, confirmações e conciliação
- A perna bancária reduz caixa e a perna do cartão reduz obrigação, relacionadas pelo mesmo evento.
- Confirmação manual e pagamento posteriormente observado precisam de vínculo de equivalência/reconciliação; não são dois pagamentos por coincidência de valor.
- Preservar as versões e reversões das confirmações; hoje um registro atual não prova todos os estados anteriores.
- Classificações econômicas explícitas de conciliação têm identidade, efetividade, autoria e conhecimento.
- Suspense e divergências de conciliação continuam fora da dívida/crédito automático.
- Configuração de classificação, fontes autoritativas e resoluções precisam ser reprodutíveis no corte K.

## 4. Posições de ativos e financiamentos

**Bancos:** abertura versionada por data-base e conhecimento, seguida dos movimentos financeiros efetivos. Uma abertura registrada depois de T não comprova automaticamente o saldo anterior. Arquivamento é organização visual, sem baixa contábil implícita.

**Investimentos:** fotografias imutáveis ou versões das posições por titular, ativo e data de referência. As posições mensais atuais podem ser usadas onde a cobertura for demonstrada; alterações posteriores precisam de versão para reproduzir “como conhecido naquela época”. Não carregar a última posição atual em todos os meses antigos. Registrar mês de referência, data de conhecimento, fonte e ausência de cotação/posição.

**Bens:** histórico de avaliações por bem, com data econômica e data de registro. Uma avaliação feita hoje para uma data antiga é uma reconstrução, não uma fotografia conhecida no passado. Sem avaliação sustentada, indicar lacuna em vez de aplicar o valor atual retroativamente.

**Financiamentos:** saldo de principal por data ou eventos suficientes para reconstruí-lo (abertura, amortizações, encargos capitalizados, refinanciamento e correções). Juros pagos, principal amortizado e pagamento total não são intercambiáveis. Manter vínculo com o bem; o financiamento é deduzido uma vez, independentemente de como a UI apresenta bens líquidos.

## 5. Propostas de persistência — requerem aprovação antes de qualquer implementação

É necessário primeiro inventariar quais históricos/auditorias existentes realmente preservam versões completas. Não assumir que `created_at`, logs de importação ou snapshots atuais recuperam versões apagadas.

| Estrutura candidata | Finalidade |
|---|---|
| Versões de fatos econômicos | Ledger de versões imutáveis para obrigação, pagamento, estorno, confirmação, resolução e correção, com dois eixos temporais e identidade estável. |
| Versões de aberturas e titularidade | Data-base, valor, vigência e conhecimento; preservar mudanças de conta/dono. |
| Cronogramas versionados de compromissos | Compra original e parcelas vinculadas, reconhecimentos, alterações e equivalências com importação. |
| Fotografias/versionamento de investimentos | Posição por ativo/titular, data de referência, conhecimento e origem. |
| Histórico de avaliações de bens | Valor e justificativa/fonte em cada data, sem sobrescrever versões anteriores. |
| Histórico de saldo de financiamento | Saldos ou eventos de principal com cobertura declarada e vínculo ao bem. |
| Configurações de cálculo versionadas | Versão do motor, classificação, atribuição de competência, datas e política de fontes. |
| Fechamentos patrimoniais mensais | T, K, modo, versão, totais, cobertura, fingerprints, responsável e vínculo com revisão anterior. |

Os nomes acima são conceitos, não tabelas criadas. Antes de migrar, apresentar separadamente o esquema SQL, índices, impacto de volume, estratégia de captura, retenção, rollback, privacidade e proposta de autorização.

**Captura:** preferir fatos versionados na mesma transação da mutação original, com identificadores idempotentes. Se triggers forem necessárias para capturar mudanças feitas por caminhos diferentes, propor sua ordem, escopo e custo antes de implementá-las. Não criar triggers como efeito colateral desta etapa.

**Dados legados:** não fazer backfill implícito. Uma importação antiga pode fornecer evidência econômica e data de conhecimento do lote, mas não recuperar uma versão que nunca foi preservada. Qualquer reconstrução inicial ou backfill deverá ter proposta, simulação e autorização específicas. Lacunas devem continuar identificadas.

## 6. Fechamentos mensais reproduzíveis

- Corte T no fim do mês civil, com fuso e regra inclusiva explícitos; cortes internos usam intervalos consistentes.
- K é o instante de conhecimento escolhido para o fechamento.
- Registrar versão do motor, configuração, fontes e fingerprints das entradas.
- Separar fechamento provisório de fechamento completo; registrar fontes ausentes.
- Mesmo T/K, conjunto de versões e configuração devem produzir exatamente os mesmos centavos.
- Importação retroativa pode gerar nova revisão “reconstruído com dados atuais”, sem reescrever a fotografia original.
- Correções e reaberturas criam versão nova, com motivo e vínculo; não apagar a anterior.
- Reprocessamento idempotente não duplica pagamentos, passivos, parcelas ou carry.
- Só publicar delta entre períodos com mesmo modo, política de fontes e cobertura suficiente. Caso contrário, “comparação indisponível” ou apresentação parcial explicitamente separada, sem delta total enganoso.

A captura atual do frontend consiste em várias leituras de API; não é um snapshot transacional atômico do banco. Para fechamentos imutáveis, avaliar uma leitura consistente no servidor e a persistência do fechamento, com desenho e autorização próprios.

## 7. Família, acesso e privacidade

- A propriedade da conta/ativo define o saldo; a autoria do movimento continua sendo evidência de quem registrou.
- Um lançamento feito por familiar na conta selecionada pertence à posição dessa conta.
- Consolidação familiar soma contas/ativos autorizados sem duplicar titularidade ou pernas de transferência.
- Autorização é sempre avaliada para a sessão atual. Um vínculo familiar antigo não deve conceder acesso atual após revogação.
- Para histórico, cruzar autorização atual com titularidade/vigência econômica relevante; não reconstruir acessos passados somente com o vínculo atual.
- Fotografias devem ser mantidas por titular e autorizadas na leitura; evitar cópias familiares que preservem indevidamente dados de um membro que saiu.
- Transferência de titularidade e mudança de composição familiar exigem política explícita para os períodos comparados.
- Preparar proposta específica de RLS/visões/funções para essas estruturas futuras; nenhuma alteração de RLS nesta entrega.

## 8. Critérios de aceite da futura etapa histórica

1. Compra retroativa muda a reconstrução atual do passado, mas não muda fotografia já fechada.
2. Pagamento depois de T não liquida obrigação em T; pagamento antes de T conhecido só depois afeta apenas os modos compatíveis com K.
3. Confirmação, correção e reversão têm resultados distintos antes/depois de sua efetividade e conhecimento.
4. Parcelas contratadas futuras entram sem duplicar importações; planejamentos ficam fora.
5. Estorno parcial/total, crédito comprovado e suspense conservam a identidade econômica.
6. Avaliação de bem e saldo de financiamento têm origem temporal suficiente; ausência impede total completo.
7. Mesmo T/K/versão reproduz os mesmos centavos, independentemente da ordem de leitura.
8. Famílias e mudanças de acesso não permitem vazamento por snapshot/cache/fechamento.
9. Arquivamento posterior não elimina posição anterior.
10. Fechamento corrigido cria revisão; não sobrescreve evidência original.

**Decisão pendente:** aprovar esse contrato temporal e a proposta concreta de dados/captura antes de qualquer desenvolvimento histórico. A implementação entregue nesta etapa consulta e exibe somente a posição atual.
