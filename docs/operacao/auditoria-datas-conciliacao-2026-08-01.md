# Auditoria de datas, completude e conciliação — 2026-08-01

## Objetivo e limite de segurança

Esta auditoria investiga relatos de transações aparentemente perdidas, deslocadas de data ou mal
conciliadas. As correções desta branch não executam migration, não alteram dados existentes e não
reescrevem histórico. Produção permanece fora do escopo até homologação explícita.

## Diagnóstico confirmado

1. Datas civis retornadas como `YYYY-MM-DD` eram convertidas em alguns fluxos com
   `new Date("YYYY-MM-DD")`. Em `America/Sao_Paulo`, `2026-08-01` vira um instante local em
   `31/07/2026 21:00`. Quando o código lia os componentes locais, a transação podia aparecer,
   ser filtrada ou ser agrupada em julho.
2. Filtros por período e métricas do dashboard podiam excluir o primeiro dia do intervalo.
3. O gráfico de evolução mensal podia contabilizar uma transação do dia 01 no mês anterior.
4. A edição e a exportação de datas possuíam conversões UTC inconsistentes.
5. A data padrão de "hoje" vinha de UTC em algumas telas. Depois das 21h no horário de Brasília,
   ela podia apontar para o dia seguinte.
6. Recorrências e parcelas usavam `setMonth` sobre o dia original. Exemplos reproduzidos:
   - início em 01/03/2026: 01/03, 29/03, 29/04, 29/05;
   - início em 31/01/2026: 31/01, 03/03, 31/03, 01/05.
   Esse defeito pode persistir datas realmente reposicionadas em novos lançamentos.
7. A navegação mensal do dashboard podia pular fevereiro quando a âncora estava no dia 31.
8. A leitura de transações era paginada sem ordenação determinística. Se uma página falhasse, o
   estado da interface era substituído silenciosamente pelo conjunto parcial já recebido.
9. `import_logs` e consultas diretas do histórico do cartão não eram integralmente paginados.
   Ao ultrapassar o limite de resposta do Supabase, lotes antigos podiam sumir da interface e da
   reconstrução visual, sem terem sido apagados do PostgreSQL.
10. Uma consulta do histórico de cartão familiar restringia por `user_id` do usuário logado,
    ocultando transações da conta familiar que o RLS permitia consultar.
11. O vencimento persistido de um lote legado era ignorado quando a mesma linha não continha
    também uma competência explícita. O fallback podia exibir o vencimento no mês seguinte.

## Correções implementadas nesta branch

- Uma única utilidade de data civil preserva `YYYY-MM-DD` sem convertê-lo em instante UTC.
- Filtros, dashboard, gráfico, exportação, saldos, cartão e edição inline usam a mesma regra.
- Novas recorrências somam meses em calendário e limitam dias inexistentes ao último dia válido:
  31/01 → 28/02 → 31/03 → 30/04.
- Leituras extensas são completas, determinísticas e do tipo "tudo ou nada". Em falha de página,
  a lista anterior é preservada e o usuário recebe um aviso; um histórico parcial não é publicado.
- A reconstrução de cartão lê todas as transações e logs antes de iniciar qualquer limpeza da
  projeção do cartão.
- O histórico familiar consulta a conta autorizada, deixando o RLS decidir quais linhas podem ser
  vistas.
- O vencimento válido já gravado no log legado é preservado.
- A apresentação de pagamento importado informa explicitamente a competência anterior que ele
  quita; isso não altera totais.

## O que não foi alterado por exigir aprovação específica

### 1. Atomicidade da importação

Hoje a inserção de `transactions` e a inserção de `import_logs` são duas operações separadas. Se a
primeira tiver sucesso e a segunda falhar, podem existir transações sem log. A solução segura é uma
função/RPC transacional no banco, com idempotência por usuário e arquivo. Isso exige migration,
teste de restauração e plano de rollback.

### 2. Reconstrução atômica da projeção do cartão

O reprocessamento remove itens de `credit_card_statement_items` antes de inserir a nova projeção.
As transações primárias permanecem no banco, mas uma falha intermediária pode deixar a visão do
cartão temporariamente incompleta. A solução recomendada é reconstruir em sombra e trocar a versão
ativa em uma transação no banco. Isso exige desenho e migration separados.

### 3. Histórico familiar de importações

As migrations familiares ampliam acesso a `transactions`, mas `import_logs` ainda possui políticas
do próprio usuário. Uma migration de RLS deve ser revisada contra vazamento entre famílias antes de
ser aplicada.

### 4. Regra de diferença inferior a R$ 1,00

Existe uma regra histórica que não carrega pequeno excedente de pagamento inferior a R$ 1,00.
Alterá-la pode recalcular faturas antigas dos mais de 800 usuários. O caso de homologação atual não
acumula R$ 0,10: R$ 400,00 e R$ 399,90 são pagamentos de competências anteriores distintas. A regra
só deve mudar com especificação financeira e comparação de histórico antes/depois.

### 5. Modelo de tipos de datas

O tipo TypeScript declara alguns campos como `Date`, enquanto o Supabase devolve colunas civis como
texto. A utilidade nova protege os fluxos auditados, mas uma alteração global do contrato deve ser
feita em sprint própria para evitar mudanças silenciosas em integrações antigas.

## Evidência de validação automatizada

- Baseline TypeScript: nenhum diagnóstico novo; um diagnóstico antigo foi removido.
- Testes focados: data civil, paginação, primeiro/último dia, dashboard, gráfico mensal, cartão e
  competência de pagamento.
- O teste julho/agosto confirma pagamentos distintos, sem resíduo acumulado de R$ 0,10 no cenário:
  - pagamento de R$ 400,00 no arquivo de julho quita a competência anterior;
  - pagamento de R$ 399,90 no arquivo de agosto quita julho.

## Roteiro de homologação no staging

Use somente a conta demo e remova os lançamentos de teste antes de repetir um caso.

1. Importe `12_nubank_datas_limite_agosto_2026.csv`.
   - Resultado: 2 novas transações, 0 ignoradas.
   - Confirme 01/08/2026 por R$ 10,01 e 31/08/2026 por R$ 10,31.
   - Confirme as mesmas datas no dashboard, no filtro de agosto, no gráfico e nos exports CSV/XLSX.
2. Crie uma despesa recorrente mensal iniciando em 01/03/2026, quatro ocorrências.
   - Esperado: 01/03, 01/04, 01/05 e 01/06.
3. Crie uma despesa parcelada ou recorrente iniciando em 31/01/2026, quatro ocorrências.
   - Esperado: 31/01, 28/02, 31/03 e 30/04.
4. Navegue no dashboard de março para fevereiro usando uma âncora no fim do mês.
   - Esperado: fevereiro abre diretamente; março não se repete.
5. Repita os arquivos `10_xp_cartao_fatura_julho_2026.csv` e
   `11_xp_cartao_fatura_agosto_2026.csv` após limpar somente esses lotes no staging.
   - Esperado em julho: fatura R$ 399,90 e pagamento no extrato de R$ 400,00 identificado como
     pagamento da competência anterior.
   - Esperado em agosto: fatura R$ 449,90 e pagamento no extrato de R$ 399,90 identificado como
     pagamento de julho.
6. Exporte as transações e confira que nenhuma data do dia 01 virou o último dia do mês anterior.
7. Faça logout/login e repita os filtros para confirmar que o resultado não depende do estado local.

## Critérios de bloqueio de produção

Bloquear o merge se qualquer data mudar após recarregar, se a contagem divergir do arquivo, se um
histórico anterior desaparecer, se os totais do cartão mudarem, ou se a consulta familiar expuser
uma conta não autorizada.

## Retorno

Antes do merge, a branch pode ser recusada sem afetar produção. Depois de um eventual merge, o
rollback recomendado é reverter os commits desta entrega e redeployar o último commit aprovado;
como não há migration nem backfill, não existe rollback de dados nesta etapa.
