# Sprint 2C — estabilização da conciliação por competência

## Escopo e barreiras

- Branch isolada: `codex/sprint-2c-reconciliation-stabilization`.
- Banco permitido nesta fase: somente staging `sxmmrnwbxntccscojmfh`.
- Migration de staging: `063_sprint_2c_competence_safe_activation.sql`.
- Produção: nenhuma migration, limpeza ou reconstrução autorizada.
- A auditoria é somente leitura. Não acionar **Ativar projeção com snapshot** sem uma nova autorização explícita.

## O que deve ter mudado

1. A identidade da fatura é a competência `MM/AAAA` confirmada pelo usuário.
2. O vencimento pode cair no mesmo mês ou no mês seguinte sem deslocar os itens.
3. Classificações históricas inequívocas por ID são preservadas.
4. Confirmações explícitas de pagamento ou estorno no lote têm prioridade.
5. Duplicidades continuam bloqueando a ativação e agora são separadas entre:
   - linhas com reparo determinístico;
   - IDs ambíguos que exigem investigação.

## Validações automatizadas concluídas

- 222 testes Vitest em 37 arquivos.
- Baseline TypeScript preservado, sem novos diagnósticos.
- Build Vite de produção concluído.
- Migration 063 aplicada em staging.
- Teste SQL transacional da ativação e rollback executado em staging.
- Limpeza do teste SQL confirmada: `0` usuários sintéticos e `0` snapshots sintéticos restantes.

## Roteiro manual no preview

### 1. Linha de base

1. Entrar com a conta principal de staging.
2. Abrir **Transações** e selecionar **Todo o histórico**.
3. Registrar a quantidade exibida antes do teste.
4. Abrir **Cartões de crédito > Cartão XP > Histórico**.
5. Registrar as competências, vencimentos e totais visíveis.

### 2. Competência sem deslocamento

1. Clicar em **Ajustar competências por arquivo**.
2. Conferir um arquivo cujo vencimento esteja no mês seguinte.
3. Confirmar que a competência continua no mês anterior ao vencimento.
4. Não salvar alterações neste teste.

Exemplo esperado: competência `07/2026` com vencimento `10/08/2026` permanece na fatura `07/2026`.

### 3. Auditoria somente leitura

1. Clicar em **Auditar sem alterar dados**.
2. Registrar o checksum e os contadores do resumo.
3. Confirmar que o diagnóstico não desloca todos os itens para o mês seguinte.
4. Se houver duplicidades, abrir o diagnóstico detalhado e conferir se aparecem como reparáveis ou ambíguas.
5. Fechar a auditoria e confirmar que a quantidade de transações da linha de base não mudou.

### 4. Pagamentos e classificações

1. No histórico, conferir ao menos duas competências consecutivas.
2. Confirmar que o pagamento importado no extrato de `N` continua quitando `N-1`.
3. Conferir um estorno, uma compra parcelada e um ajuste já conhecido.
4. Confirmar que nenhum deles foi reclassificado silenciosamente.

## Critérios de interrupção

Interromper sem ativar se ocorrer qualquer um dos itens abaixo:

- competência deslocada em um mês;
- valor, data ou classificação histórica alterada sem confirmação;
- queda na quantidade de transações;
- auditoria criando snapshot ou marcando faturas como projeção atômica;
- ativação liberada com duplicidade, linha ausente ou órfã.

### 5. Reparo determinístico de pagamento duplicado

Esta etapa só aparece quando a auditoria encontra uma materialização antiga sem
`payment_transaction_id` e uma única linha canônica com a mesma fatura, data,
valor, origem, arquivo e número de linha.

1. Registrar a quantidade de transações antes do reparo.
2. Clicar em **Reparar duplicidade com snapshot** e conferir a confirmação.
3. Confirmar que a mensagem informa exatamente quantas materializações serão removidas.
4. Após o reparo, conferir que a quantidade de transações não mudou.
5. Registrar o novo resumo e checksum da auditoria automática.
6. Confirmar que o evento duplicado e o pagamento órfão desapareceram.
7. Testar **Desfazer último reparo** e repetir a auditoria antes de qualquer ativação.
8. Executar o reparo novamente somente após confirmar que o rollback restaurou o diagnóstico anterior.

O reparo não exclui `transactions`, itens da fatura, lotes ou metadados do
extrato. O banco recusa revisão desatualizada, mais de uma contraparte canônica,
proveniência divergente e qualquer remoção parcial.

## Rollback

- Preview: retornar ao deployment anterior; staging não compartilha dados com produção.
- Migration 063: remover apenas a função nova com
  `drop function public.activate_credit_card_projection_atomic_v2(uuid,text,text,jsonb,jsonb,jsonb);`.
- Migration 064: usar `064_sprint_2c_deterministic_payment_repair_down.sql`; primeiro
  desfazer qualquer snapshot de reparo ainda aplicável, depois remover os dois RPCs
  e a tabela de snapshots específica.
- A função v1 e a migration 062 permanecem intactas.
- Nenhum rollback de dados é necessário para a auditoria, pois ela não grava dados.
