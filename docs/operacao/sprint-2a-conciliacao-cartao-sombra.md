# Sprint 2A — conciliação de cartão em sombra

## Objetivo

Eliminar a possibilidade de uma reconstrução deixar a projeção do cartão
temporariamente incompleta. As transações em `transactions` são a fonte primária e
nunca podem ser removidas, reescritas ou reposicionadas por este fluxo.

## Risco confirmado no fluxo legado

Existem caminhos que removem `credit_card_statement_items` e/ou
`credit_card_statements` antes de terminarem a reconstrução. Uma interrupção de
rede ou erro posterior preserva as transações primárias, mas pode deixar a visão
derivada da fatura incompleta. Isso pode parecer perda de dados para o usuário.

O antigo método chamado `processShadowImport` também grava tabelas de projeção.
Por isso ele não é considerado o mecanismo sombra da Sprint 2A.

## Primeira entrega: pré-processamento realmente somente leitura

A branch `codex/sprint-2a-card-shadow` adiciona um construtor puro e determinístico
que:

1. trabalha integralmente em memória;
2. usa `ID_Transacao` como identidade imutável;
3. preserva datas civis `AAAA-MM-DD`;
4. contabiliza dinheiro em centavos inteiros na comparação;
5. mantém transações legítimas com mesma data, descrição e valor;
6. aplica pagamentos importados à competência determinada pelo motor atual;
7. inclui compras, estornos e pagamentos manuais nas origens `manual:AAAA-MM`;
8. mantém pagamento manual na competência escolhida, sem aplicar a regra N+1 dos CSVs;
9. bloqueia IDs ausentes ou repetidos, ciclos inválidos, vencimentos conflitantes e linhas não cobertas;
10. gera checksum determinístico da projeção;
11. lê todas as páginas da projeção atual antes de comparar;
12. considera órfãos e duplicidades persistidas impeditivos para uma futura ativação;
13. bloqueia a ativação enquanto ajustes manuais ou totais oficiais do arquivo não puderem ser preservados;
14. não chama `insert`, `update`, `upsert`, `delete` ou RPC.

Na interface do piloto, o botão **Auditar sem alterar dados** mostra contagens,
diferenças, bloqueios e checksum. Encontrar diferença não ativa nada.

## Invariantes para uma futura ativação atômica

A segunda entrega só poderá ser ativada quando todas as condições abaixo forem
verdadeiras:

- toda transação importada ativa do cartão pertence exatamente a um ciclo;
- todo lançamento manual pertence exatamente à competência inferida pelas regras atuais;
- toda transação possui `ID_Transacao` e aparece exatamente uma vez na sombra;
- nenhum item pertence a outra conta ou usuário;
- datas da sombra são idênticas às datas civis da fonte;
- totais de compras, estornos, taxas, juros e pagamentos fecham em centavos;
- a versão lida no início ainda é a versão ativa no momento da troca;
- a troca ocorre dentro de uma única transação PostgreSQL;
- qualquer erro aborta a transação inteira e mantém a versão anterior ativa;
- o snapshot anterior fica identificável no log de auditoria para rollback individual.
- `manual_totals_json`, totais oficiais do arquivo e pagamentos persistidos são preservados ou a troca é recusada.

## Fora de escopo nesta primeira entrega

- nenhuma migration;
- nenhuma aplicação em produção;
- nenhum backfill;
- nenhum recálculo automático de histórico;
- nenhuma alteração na regra histórica de diferenças menores que R$ 1,00;
- nenhuma mudança nas tabelas primárias de transações ou importações.

## Cenários automatizados obrigatórios

- pagamentos de julho/agosto e diferença de R$ 0,10;
- duas compras legítimas com mesma descrição, data e valor;
- dias 01 e 31 sem deslocamento de fuso;
- pagamento manual permanecendo na competência escolhida, sem recuar uma fatura;
- lote de 1.000 linhas de R$ 0,01 sem deriva decimal;
- ID repetido entre competências bloqueando o plano;
- divergência de um centavo sendo reportada sem tolerância implícita;
- leitura paginada completa e falha total se qualquer página não puder ser lida.

## Retorno

Enquanto esta entrega permanecer em branch/preview, o retorno é simplesmente
descartar a branch. Não existe rollback de banco porque nenhum schema ou dado é
alterado. Uma futura migration terá documento, backup, staging, flag individual e
rollback próprios antes de qualquer aplicação em produção.
