# Patrimônio V2 — resumo da homologação

A interface efetiva do FinElo, servida localmente e conectada exclusivamente ao staging, foi validada com dados sintéticos e Supabase Auth/RLS reais. A nova flag permaneceu desligada remotamente; variantes foram controladas somente nos processos locais.

## Resultados funcionais

16/16 cenários passaram: banco positivo e negativo, benefícios restritos, fatura vencida, pagamento parcial, quitação, fatura futura, compra manual antes do fechamento, parcelas futuras, pagamento tardio, estorno, crédito comprovado, conciliação pendente, múltiplos cartões, contas arquivadas e fontes insuficientes.

Os fatos sintéticos, a consulta independente em centavos, o motor canônico e a interface coincidiram para 15 cartões. A sessão com fontes insuficientes exibiu totais dependentes indisponíveis, sem recorrer ao saldo contábil ou presumir zero.

As visões individuais, o familiar selecionado e a família explicitamente consolidada passaram sem duplicação. A identidade independente recebeu zero registros alheios em oito consultas autenticadas por IDs conhecidos. Uma resposta de transações da sessão anterior foi liberada após logout/troca de usuário, sem ressuscitar dados ou valores antigos.

Comparar e trocar o período operacional, inclusive para mês passado, preservaram todos os componentes da posição atual. Indicadores operacionais e seus deltas continuaram disponíveis; a comparação histórica patrimonial permaneceu indisponível com explicação.

Com a flag V2 desligada, o painel legado permaneceu visível e as novas fontes/cálculos patrimoniais não foram executados. Com o seletor familiar desligado, o V2 ficou na visão pessoal; nenhuma família foi consolidada implicitamente.

## Verificação automatizada

Após a limpeza, em 16/10/2026: npm run verify:baseline aprovado, exit 0; 3068/3068 testes em 191 arquivos, incluindo os 66 novos V2; baseline TypeScript com 14 diagnósticos conhecidos e nenhum novo; build/PWA (49 entradas de precache) e git diff --check aprovados. A homologação também aprovou a bateria de 369 testes direcionados.

Os timeouts anteriores foram investigados. Dois imports dinâmicos de componentes usados somente em renderização estática foram movidos para o setup do arquivo de testes; as 72 asserções e o limite original de cinco segundos foram preservados. A suíte padrão então passou integralmente. Testes PostgreSQL em memória mostraram sensibilidade à carga concorrente; os resultados anteriores foram preservados nas evidências locais. A rodada padrão posterior teve um timeout de 20 s em identidade de importação (3067/3068); o arquivo passou 18/18 isolado e a rodada completa final passou 3068/3068 com concorrência limitada somente no processo local a dois workers. Nenhum timeout ou configuração versionada foi alterado.

## Controle dos dados e limpeza

O baseline anterior tinha 15 investimentos, 10 contas, 73 transações, nenhum bem/vínculo/assinatura, seis usuários e 126 migrations. Foram utilizadas 58 fixtures rastreáveis em oito tabelas. A inspeção de dependências identificou ainda 15 controles internos de revisão ligados exclusivamente às contas sintéticas; a autorização complementar passou a abranger 73 exclusões exatas, preservando os três contadores de revisão por usuário.

A transação preparada exige identidade, proprietário, hash completo das fixtures, dependências conhecidas, quantidade exata por tabela e 37 hashes históricos não Auth. Os contadores por usuário não são apagados ou resetados; incrementos previstos dos triggers são verificados. A limpeza foi concluída em 16/10/2026: 73 linhas removidas em transação única, retorno às contagens do baseline, 37/37 hashes históricos não Auth idênticos, zero resíduos dos IDs autorizados e zero órfãos nas FKs verificadas. Os contadores por usuário avançaram somente pelos triggers: A de 14 para 28 (13 cartões + uma importação), B e C de 1 para 2 (um cartão cada). Os usuários QA e os demais metadados foram preservados; A/B/C autenticaram normalmente após a limpeza. A flag V2 permaneceu desligada.

## Limites e ativação futura

Obrigações refletem os fatos registrados e reconhecidos pelo motor; não certificam a completude do registro no emissor. As parcelas futuras reconhecidas são incluídas. Os bens sintéticos não eram financiados; o recálculo global preexistente de financiamentos ficou fora desta homologação. O leitor V2 usa múltiplos SELECTs e não oferece snapshot transacional do frontend.

O histórico patrimonial continua indisponível; o [desenho temporal](./historical-design.md) é separado e não está implementado. Não houve migration, RLS, backfill, alteração de Billing Stripe ou ativação em produção.

Após revisão e merge autorizados, propor ativação administrativa restrita ao piloto, conferir completude/fontes e valores separados, preservar rollback pela flag e ampliar somente mediante validação posterior. Este documento não autoriza merge, deploy ou ativação.

Os ledgers com IDs operacionais, scripts de criação/limpeza, credenciais, sessões e logs brutos não integram o código de produção nem a publicação do PR. Somente fixtures sintéticas de testes automatizados fazem parte da validação versionada.
