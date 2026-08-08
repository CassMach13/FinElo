# Plano de piloto em produção — Sprint 1B

Data de preparação: 08/08/2026

## Objetivo e isolamento

- Publicar o código da Sprint 1B com os filtros inteligentes desligados por padrão.
- Não criar migration, não alterar transações e não habilitar variável global na Vercel.
- Habilitar a experiência somente para a conta-piloto `cassiomq@gmail.com` por `app_metadata.smart_transaction_filters_enabled=true`.
- Manter todos os demais usuários no fluxo legado e na chave local `finelo_transaction_filters_v1`.

## Estado verificado antes de produção

- `origin/main`: `886b1c5d17f059c96d08d0b5f9f216e33bf2be17`.
- branch candidata: `6a4e5debccc08b9b22081b4fddf3f47e361cd3e7`, exatamente três commits à frente de `origin/main` e nenhum commit atrás.
- diferença da Sprint 1B: oito arquivos, sem migration e sem nova chamada de escrita Supabase no diff.
- Vercel: `VITE_SMART_TRANSACTION_FILTERS_ENABLED` ausente; portanto não há habilitação global.
- Supabase oficial: uma conta corresponde ao piloto; zero usuários possuem a chave da nova flag, zero habilitados e zero desabilitados.
- backup manual disponível e sincronizado: `FinElo-Production-20260808-v7.7z`, 592.560 bytes, criado em 08/08/2026 às 10:50:28.
- testes focados: 34 aprovados; build de produção com a flag global explicitamente desligada aprovado.

## Baseline agregada da conta-piloto

Esta impressão digital não expõe descrições, valores, contas ou outros dados pessoais. Ela será recalculada após o piloto, desde que nenhuma operação legítima de escrita seja realizada no intervalo.

| Conjunto | Linhas | Hash MD5 do conjunto ordenado |
|---|---:|---|
| Transações | 3.768 | `8919ac4b65dc099aa9c7f9416f641a91` |
| Logs de importação | 86 | `ee596f43f9ed7955dc958dec54491a4e` |
| Lotes atômicos | 6 | `5e944c8b00f42ea01012c62678ea07b6` |

## Riscos residuais que exigem aprovação

1. **Deployment para todos, recurso para um:** embora a flag mantenha a interface nova desligada para os demais usuários, o novo pacote JavaScript e o service worker serão distribuídos a todos. O risco de regressão geral é baixo, mas não é zero.
2. **Atualização do PWA:** usuários com o app aberto podem receber aviso de atualização ou recarregamento quando o novo service worker for ativado.
3. **Visibilidade no piloto:** filtros persistidos na chave v2 podem ocultar lançamentos da tabela e da exportação. A interface informa `X de Y`, quantos ficaram fora da visão e oferece retorno ao histórico completo; os dados não são apagados.
4. **Volume real:** a conta-piloto possui 3.768 transações. O teste automatizado cobriu 3.500; o piloto validará o volume real e deve ser interrompido se houver travamento perceptível.
5. **Token da flag:** o opt-in usa `app_metadata` presente no token de autenticação. Após habilitar ou remover a flag, a conta-piloto deve sair e entrar novamente para garantir a atualização imediata.

## Sequência de liberação

1. Obter autorização explícita para merge/deployment após a leitura dos riscos acima.
2. Fazer fast-forward de `main` de `886b1c5` para `6a4e5de` sem tocar no worktree principal com alterações locais do usuário.
3. Monitorar o deployment da Vercel até `Ready`; confirmar que o domínio oficial responde e que a produção continua com zero usuários habilitados.
4. Abrir a conta-piloto ainda com a flag ausente e confirmar a experiência legada.
5. Alterar somente a conta-piloto, preservando todos os demais metadados, e exigir exatamente uma linha afetada.
6. Sair e entrar novamente na conta-piloto.
7. Validar no domínio oficial:
   - total completo de 3.768 transações ou novo total legitimamente esperado;
   - datas nos dias 1 e 31;
   - busca, chips, períodos, origem, conta e categoria;
   - `Mostrar todo o histórico`;
   - CSV/XLSX do mesmo subconjunto;
   - navegação, cartão e importação sem regressão.
8. Recalcular os hashes quando não houver escrita legítima no intervalo. Se houver importação ou edição intencional, comparar contagens e auditar exclusivamente a operação conhecida.
9. Manter o piloto individual por 24 a 48 horas antes de considerar qualquer expansão.

## Critérios de interrupção imediata

- qualquer usuário não piloto recebendo a interface inteligente;
- diferença inexplicável nas contagens ou hashes;
- data deslocada, lançamento aparentemente desaparecido ou exportação divergente;
- travamento, paginação incoerente ou impossibilidade de retornar ao histórico completo;
- erro novo relevante no deployment ou nos logs da Vercel.

## Rollback

### Rollback individual

1. Remover `smart_transaction_filters_enabled` somente da conta-piloto, preservando os outros metadados.
2. Confirmar por consulta agregada que voltamos a zero usuários habilitados.
3. Sair e entrar novamente para renovar o token.
4. Confirmar a volta da interface legada e da chave v1.

### Rollback urgente do deployment

1. Promover novamente o deployment aprovado do commit `886b1c5` na Vercel.
2. Remover a flag individual da conta-piloto.
3. Revalidar login, dashboard, transações, cartão, importação e exportação.
4. Reverter `main` em novo commit, sem reescrever histórico.

Não existe rollback de banco da Sprint 1B: ela não contém migration nem gravação de dados. O backup v7 permanece como camada adicional, não como mecanismo normal de reversão desta interface.
