# Homologacao da flag server-side da Sprint 1A

Escopo: somente o Preview conectado ao Supabase de staging. Nao usar estes arquivos em producao.

## Pre-condicoes

- Estar autenticado na conta principal do staging.
- Anotar a quantidade atual de transacoes.
- Escolher uma conta de teste do staging.

## Teste

1. Importe `96_sprint1a_flag_original_20260808.csv`.
2. Confirme a mensagem `2 novas transacoes, 0 ignoradas`.
3. Confirme que o total de transacoes aumentou exatamente em 2.
4. Importe `97_sprint1a_flag_renomeado_20260808.csv` na mesma conta.
5. Confirme que a segunda importacao foi bloqueada como conteudo ja importado, mesmo com outro nome.
6. Em Configuracoes, exclua o lote `96_sprint1a_flag_original_20260808.csv`.
7. Confirme que o total de transacoes voltou exatamente ao valor anotado no inicio.
8. Confirme que nenhum dos dois nomes aparece no historico de importacoes.

## Criterio de aprovacao

- Primeira importacao: 2 transacoes criadas.
- Arquivo identico renomeado: bloqueado sem criar transacoes ou lote.
- Exclusao do lote original: remove somente as 2 transacoes do teste.
- Contagem final: igual a contagem inicial.

Se qualquer contagem divergir, interromper o teste e nao aprovar producao.
