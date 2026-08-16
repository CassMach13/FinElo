# Sprint 2N — roteiro de homologação do plano reversível

## Objetivo

Validar o desenho agregado e não executável para uma futura conservação de
faturas duplicadas, sem alterar transações, faturas, pagamentos, metadados,
flags ou schema.

## Limites de segurança desta Sprint

- não existe migration da Sprint 2N;
- não existe RPC, `insert`, `update`, `delete` ou payload de mutação;
- `Elegível para escrita` permanece sempre `não`;
- a trava de ativação da Sprint 2M permanece fechada;
- o relatório não expõe IDs, competências, origens, descrições, valores ou a
  revisão opaca da projeção;
- a leitura MCP usada na validação aponta somente para o staging e confirmou
  `transaction_read_only = on`.

## Evidência automatizada obrigatória

1. Executar o teste dedicado:

   ```powershell
   npm.cmd test -- tests/credit-card/atomicRebuildStatementConservationPlan.spec.ts
   ```

2. Confirmar os seis cenários:

   - plano reversível completo sem linha vencedora;
   - bloqueio sem revisão persistida;
   - bloqueio quando o relatório 2M pertence a outra sombra;
   - revisão obrigatória quando a simulação 2M está incompleta;
   - encerramento seguro quando não existem duplicidades;
   - determinismo e ausência de dados identificáveis no relatório.

3. Executar a regressão das Sprints 2K–2N e a baseline TypeScript.

4. Executar o build de produção local. Avisos antigos de tamanho de bundle não
   impedem a homologação, desde que o build termine com sucesso.

## Teste manual no Preview

### Caso A — staging atual sem duplicidades

1. Entrar com a conta principal do staging.
2. Abrir o histórico do cartão de crédito usado nos testes.
3. Executar novamente a auditoria somente leitura.
4. Localizar o painel `Sprint 2N — plano reversível de conservação`.
5. Confirmar:

   - resultado `nenhuma duplicidade exige plano`;
   - grupos `0 / 0`;
   - faturas afetadas e compostas `0 → 0`;
   - operações reais `0`;
   - `Elegível para escrita agora: não`;
   - nenhum botão novo de reparar, mesclar, excluir ou ativar foi criado.

6. Anotar a quantidade total de transações antes e depois da auditoria. As duas
   quantidades devem ser idênticas.

### Caso B — repetição e estabilidade

1. Executar a auditoria três vezes sem editar ou importar dados.
2. Confirmar que o status e todas as contagens da Sprint 2N permanecem iguais.
3. Atualizar a página, entrar novamente no histórico e repetir a auditoria.
4. Confirmar novamente que nenhuma transação, fatura ou pagamento mudou.

### Caso C — ativação continua bloqueada

1. Conferir que o botão de ativação continua bloqueado pela Sprint 2M.
2. Confirmar que a presença do painel 2N não muda essa trava.
3. Não alterar flags e não executar reparos durante esta homologação.

## Cenário sintético de estresse coberto por teste

O teste automatizado monta, apenas em memória:

- um grupo com duas faturas persistidas;
- uma futura fatura composta;
- dois vínculos de itens;
- um vínculo de pagamento;
- metadados manuais e totais oficiais protegidos;
- snapshot e rollback com cardinalidade simétrica;
- seis travas obrigatórias e zero travas executáveis.

Resultado esperado: plano `plan-ready`, uma duplicidade excedente planejada
para resolução futura, zero mudança financeira, zero alteração de transação e
zero operação real.

## Critérios de reprovação e rollback

Reprovar o Preview se ocorrer qualquer um destes eventos:

- quantidade de transações mudar após uma auditoria;
- aparecer valor, descrição, ID, arquivo ou competência no painel agregado 2N;
- aparecer botão ou caminho de escrita novo;
- a ativação deixar de ser bloqueada;
- relatórios mudarem entre auditorias sem mudança de dados;
- qualquer teste novo falhar ou a baseline TypeScript aumentar.

Como a Sprint 2N não grava dados nem possui migration, o rollback do Preview é
somente retornar o deployment para o commit anterior. Nenhum rollback de banco
é necessário.
