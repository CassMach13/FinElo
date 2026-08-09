# Roteiro de homologação — Sprint 2B: idempotência de pagamentos

## Limites de segurança

- Executar exclusivamente no staging e na branch `codex/sprint-2b-payment-idempotency`.
- Não usar contas, cartões, arquivos ou dados oficiais.
- Não executar SQL, migration ou limpeza em produção.
- Anotar a contagem de transações antes de cada etapa.
- Se qualquer contagem diminuir ou uma transação mudar de data/valor, interromper o teste.

## Dados sintéticos

Crie um cartão exclusivo chamado `STG-2B Cartão Idempotência`, com fechamento no
dia 19 e vencimento no dia 28. Use somente estes arquivos:

1. `20_xp_cartao_idempotencia_julho_2026.csv`: quatro linhas, incluindo duas
   compras legítimas idênticas e um pagamento de R$ 190,00 na borda histórica.
2. `21_xp_cartao_idempotencia_agosto_2026.csv`: duas linhas, incluindo o
   pagamento de R$ 190,00 que quita a fatura de julho.

## Cenário principal

1. Anote a contagem inicial de transações.
2. Importe o arquivo 20 para o cartão sintético, confirmando competência 06/2026
   e vencimento 28/07/2026.
3. Confirme o acréscimo exato de quatro transações.
4. Importe o arquivo 21, confirmando competência 07/2026 e vencimento 28/08/2026.
5. Confirme o acréscimo exato de duas transações: total inicial + 6.
6. Execute a auditoria sombra e salve o relatório e o checksum.
7. Em Configurações, use **Corrigir Conta** somente no lote do arquivo 21,
   mantendo o mesmo cartão sintético.
8. Confirme que a contagem continua inicial + 6; o reprocessamento não pode criar,
   apagar ou mover transações.
9. Repita a auditoria sombra.

## Resultado obrigatório

- zero duplicidade por transação;
- zero evento de pagamento sem identidade;
- zero pagamento órfão;
- uma única projeção de pagamento de R$ 190,00 em 20/08/2026, vinculada à
  transação do arquivo 21 e quitando 07/2026;
- as duas compras idênticas de R$ 45,00 permanecem separadas;
- checksum idêntico antes e depois de **Corrigir Conta**;
- alerta de pagamento anterior à janela permitido para o arquivo 20;
- nenhuma data, valor ou quantidade de transações alterada.

## Teste de repetição protegida

Tente importar novamente o arquivo 21 sem excluir o lote. O conteúdo deve ser
recusado pelo controle de lote já existente, e a contagem deve continuar inicial + 6.

## Limpeza do staging

Somente após registrar todos os resultados, exclua os dois lotes pelo fluxo normal
da interface e confirme o retorno à contagem inicial. Depois exclua o cartão
sintético, se não houver nenhum lançamento restante.

## Rollback

Esta Sprint não possui migration. Se for recusada, descarte a branch ou reverta o
commit da Sprint 2B. Como a homologação usa cartão e arquivos sintéticos no staging,
nenhum dado de produção precisa ser restaurado.
