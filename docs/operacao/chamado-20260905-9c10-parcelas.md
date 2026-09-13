# Chamado 20260905-9C10 — numeração de parcelas importadas

## Causa confirmada

O motor normalizado preservou corretamente as parcelas importadas, mas o editor genérico de transações possuía três comportamentos combinados:

1. no mobile, o editor completo era oferecido também para registros importados;
2. ao editar um registro existente, os controles de recorrência não eram hidratados com a metadata persistida e o payload enviava `Parcela_Atual`/`Total_Parcelas` ausentes;
3. o mesmo payload atribuía `Fonte = Manual`, enquanto a persistência aceitava todos os campos enviados sem uma política específica para importadas.

Assim, a linha física em `transactions` podia perder a metadata que continuava correta em `credit_card_entries`. A apresentação ainda convertia `null/null` artificialmente em `1/1`, produzindo a sequência observada `1/3 → 1/1 → 3/3`.

## Correção preventiva

- O editor completo mobile fica restrito a transações genuinamente manuais, como já ocorria no desktop.
- A edição inline de importadas aceita somente `Nome_Fantasia`, `Categoria` e `linked_asset_id`.
- A mesma whitelist é reaplicada no store antes da persistência; payload estrutural de importada vira recusa/no-op determinístico.
- O salvamento de registro existente preserva parcela, total, fonte e descrição original já persistidos.
- Metadata ausente ou inválida é mostrada como `—`; `1/1` só aparece para valores reais `1` e `1`.
- Criação e edição de parcelamento manual continuam com o contrato anterior.

## Reparação histórica preparada, não executada

Os arquivos em `scripts/sql/20260905_9c10_installment_metadata_*.sql` não são migrations e não participam de deploy. Eles fixam:

- conta `97d11eb6-ed8d-47d0-9639-956ad222eb16`;
- cartão `4c839d44-c1d1-4486-9b93-5c5077a1d37b`;
- exatamente 67 relações individuais por `transaction_id`;
- hash de identidade `92d7311e810b92df05054e994f92746af551430254a1f53886a40d343b364ea3`;
- hash de todos os dados invariáveis `a1379912b521e6c0609dd5f00dc4de96b6839f32fce5f074aae39c390c701357`.

O reparo futuro só poderá copiar `installment_current`/`installment_total` de `credit_card_entries` para `Parcela_Atual`/`Total_Parcelas` quando a relação, origem, arquivo, valor, data, usuário, conta e cartão coincidirem. Locks, isolamento serializável e validações antes/depois fazem qualquer divergência abortar a transação inteira.

O rollback separado só restaura `NULL/NULL` no mesmo conjunto e também exige contagem e hashes exatos. A baseline é composta pelo conjunto `NULL/NULL`, pelo hash de identidade e pelo hash canônico de todas as demais colunas das transações, entries e cartão; nenhum snapshot remoto foi criado nesta etapa.

## Gate para promoção futura

1. Publicar primeiro apenas a proteção preventiva.
2. Confirmar que o conjunto histórico continua em exatamente 67 linhas e nos hashes registrados.
3. Se a contagem ou qualquer hash mudar, não executar o reparo: investigar se o defeito permaneceu ativo ou se houve edição legítima concorrente.
4. Executar o dry-run e arquivar sua saída antes de pedir autorização específica para reparo.
5. Após eventual reparo, provar que nenhum campo além das duas colunas de parcela mudou e manter o rollback como contingência separada.
