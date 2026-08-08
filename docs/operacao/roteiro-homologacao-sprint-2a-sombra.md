# Roteiro de homologação — Sprint 2A em sombra

## Regra de segurança

Nesta etapa use exclusivamente **Auditar sem alterar dados**. Não use
**Reconstruir faturas deste cartão** durante o teste da Sprint 2A: esse segundo
botão é o fluxo operacional já existente e grava a projeção atual.

O teste novo faz apenas leituras paginadas de `credit_card_statements`,
`credit_card_entries`, `credit_card_payments` e `credit_card_statement_items`. Ele não altera
transações, lotes, faturas ou configurações.

## Preparação

1. Entre no preview com a conta principal do staging.
2. Abra **Transações** e anote a quantidade total de registros.
3. Anote os totais e os vencimentos exibidos no cartão usado nos testes.
4. Abra o modal **Faturas pelo histórico** desse cartão.
5. Confira competência e vencimento de cada arquivo, sem aplicar reconstrução.

## Execução principal

1. Clique em **Auditar sem alterar dados**.
2. Aguarde a mensagem final; não feche a janela enquanto estiver “Auditando”.
3. Registre:
   - status da auditoria;
   - número de transações, itens e faturas;
   - diferenças, bloqueios e alertas;
   - ausentes, órfãos, alterados e duplicidades;
   - faturas com metadados protegidos;
   - indicação “apta” ou “não apta”;
   - checksum.
4. Feche e reabra o modal, repita sem editar nada e confirme que o checksum é o mesmo.
5. Volte a **Transações** e confirme que a quantidade total não mudou.
6. Confirme que datas, totais do cartão e histórico continuam iguais aos anotados.

## Cenários que precisam aparecer na fonte do staging

- arquivos de julho e agosto com pagamento de fatura;
- diferença de R$ 0,10 entre pagamentos/lotes;
- duas compras legítimas com mesma data, descrição e valor;
- lançamento manual em dia 31;
- pagamento manual direcionado a uma competência;
- estorno manual;
- lote grande de 1.000 linhas, se ainda estiver disponível.

Não é necessário importar novamente se esses casos já existirem na conta.

## Critério para avançar

A homologação da camada somente leitura passa quando:

- a contagem de transações antes e depois permanece idêntica;
- nenhuma data, valor, lote ou fatura muda;
- duas execuções sem alteração produzem o mesmo checksum;
- a leitura termina sem página parcial;
- o relatório diferencia ausentes, órfãos, alterados e duplicidades;
- pagamentos manuais não aparecem deslocados para a fatura anterior na sombra.

Um resultado **diferente** não é falha por si só: a finalidade da sombra é revelar
divergências do motor atual. Resultado **não apta**, bloqueios, órfãos ou
duplicidades impedem a próxima etapa até investigação individual.

## Retorno

Esta entrega não possui migration nem escrita de banco. Se for recusada, basta
retirar o preview ou descartar a branch `codex/sprint-2a-card-shadow`; produção e
staging permanecem exatamente como estavam.
