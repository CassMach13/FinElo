# Sprint 1B — filtros inteligentes e transparência da visão

## Limites desta etapa

- Branch: `codex/sprint-1b-smart-filters`.
- Ambiente permitido: Vercel Preview ligado ao Supabase de staging `sxmmrnwbxntccscojmfh`.
- Produção `xotxxxohcmivyzswyjtm` não recebe migration, flag, deploy ou escrita nesta etapa.
- A Sprint 1B não altera transações: ela somente decide quais registros já carregados serão apresentados ou exportados.
- A experiência fica desligada por padrão. O piloto individual exige `app_metadata.smart_transaction_filters_enabled=true`; a variável `VITE_SMART_TRANSACTION_FILTERS_ENABLED=true` é reservada ao Preview/Staging ou a um rollout global aprovado.
- Os filtros antigos usam `finelo_transaction_filters_v1` e os novos usam `finelo_transaction_filters_v2`. Reprovar a Sprint não modifica a configuração anterior do usuário.

## Evidências automáticas obrigatórias

Antes da homologação manual, devem estar verdes:

1. `npm run typecheck:baseline` — nenhum diagnóstico TypeScript novo.
2. `npm test` — suíte completa, incluindo busca com 3.500 transações sem mutação da coleção.
3. `npm run build` com `VITE_SMART_TRANSACTION_FILTERS_ENABLED=true`.
4. Build adicional com a flag desligada, comprovando que a tela legada permanece compilável.

## Preparação segura

1. Entrar somente na conta principal de staging.
2. Anotar o total com `Mostrar todo o histórico`; esse é o total de referência, não o total do mês atual.
3. Não importar nem excluir arquivos neste roteiro, exceto se um cenário declarar isso explicitamente.
4. Não usar dados pessoais de clientes ou arquivos de produção.
5. Para o teste de volume, pode ser usada a conta de staging que já contém o lote sintético de 1.000 linhas; não é necessário recriá-lo.

## Teste A — contagem transparente

1. Abrir `Transações` com o período padrão `Este mês`.
2. Comparar `Exibindo X de Y transações` com o total registrado na preparação.
3. Clicar em `Mostrar todo o histórico`.

Resultado obrigatório:

- quando houver registros ocultos, a tela informa quantos estão fora da visão e afirma que não foram apagados;
- `Mostrar todo o histórico` retorna exatamente ao total de referência;
- nenhuma data, valor, categoria, conta ou quantidade no banco muda.

## Teste B — busca inteligente

Pesquisar, individualmente e depois em combinações de dois ou três termos:

- parte da descrição, ignorando maiúsculas e acentos;
- nome da conta;
- categoria;
- nome do arquivo de importação;
- data no formato armazenado;
- valor com ponto e com vírgula.

Resultado obrigatório:

- todos os termos digitados precisam existir na mesma transação, mesmo em campos diferentes;
- limpar somente o chip `Busca` preserva período, origem, conta e demais filtros;
- uma busca sem resultado mostra estado vazio e permite limpar os filtros sem recarregar a página.

## Teste C — atalhos de período

Validar `Este mês`, `Mês anterior`, `Últimos 30 dias` e `Todo histórico`. Em seguida, usar o período personalizado com primeiro e último dia de um mês.

Resultado obrigatório:

- primeiro e último dia permanecem incluídos;
- nenhuma data muda por fuso horário;
- remover o chip de período não apaga os outros filtros ativos;
- `Voltar para este mês` restaura somente a visão inicial planejada.

## Teste D — origem e cartão

Aplicar separadamente `Importadas`, `Manuais` e `Cartão`. Depois combinar cada origem com busca e período.

Resultado obrigatório:

- `Importadas` não inclui lançamentos manuais;
- `Manuais` não inclui linhas de arquivo;
- `Cartão` usa o tipo da conta e não a semelhança de descrição/valor;
- trocar o atalho não altera conciliação, fatura ou saldo.

## Teste E — filtros detalhados e chips

1. Selecionar duas contas, duas categorias, entradas/saídas e responsável quando disponível.
2. Remover cada chip separadamente.
3. Testar `Sem conta`, se já houver registro assim no staging.

Resultado obrigatório:

- cada chip remove somente seu próprio critério;
- combinações usam interseção previsível;
- `Limpar tudo`/`Mostrar todo o histórico` remove todas as restrições;
- nenhum filtro corrige ou vincula dados automaticamente.

## Teste F — persistência sem armadilha

1. Ativar busca, período e origem.
2. Atualizar a página.
3. Sair e entrar novamente na mesma conta e navegador.
4. Usar `Mostrar todo o histórico` e atualizar novamente.

Resultado obrigatório:

- a visão restaurada continua exibindo a contagem `X de Y` e os chips ativos;
- o usuário sempre consegue retornar ao histórico completo em um clique;
- desligar a flag retorna à experiência legada e à configuração v1, sem herdar silenciosamente os filtros v2.

## Teste G — exportação fiel

1. Anotar o total visível sem filtros e exportar CSV e XLSX.
2. Aplicar uma combinação que produza um subconjunto conhecido e exportar novamente.
3. Conferir quantidade de linhas, datas, valores e contas.

Resultado obrigatório:

- cada arquivo exporta exatamente o que está visível na tabela;
- o total geral continua inalterado;
- CSV e XLSX contêm o mesmo conjunto lógico.

## Teste H — volume e responsividade

1. Abrir uma conta de staging com pelo menos 1.000 transações; quando disponível, repetir com mais de 3.000.
2. Alternar períodos, pesquisar três termos, trocar a origem e limpar tudo dez vezes.
3. Repetir em largura de celular e desktop.

Resultado obrigatório:

- nenhuma ação congela a interface ou exige recarregamento;
- contador, paginação e tabela permanecem coerentes;
- botões e chips continuam acessíveis sem sobreposição;
- voltar ao histórico completo restaura o total exato.

## Critérios de reprovação imediata

- qualquer escrita ou configuração no projeto de produção nesta etapa;
- total completo diferente do total de referência;
- filtro, busca ou exportação alterando transações;
- datas deslocadas, especialmente nos dias 1 e 31;
- chip removendo filtros não relacionados;
- CSV/XLSX divergindo da visão;
- usuário sem caminho evidente para reencontrar registros ocultos;
- regressão na tela legada com a flag desligada.

## Rollback

Se a Sprint 1B for recusada:

1. Desligar a flag somente no Preview/conta-piloto e atualizar a sessão.
2. Confirmar que a tela legada voltou usando `finelo_transaction_filters_v1`.
3. Promover novamente o último deployment aprovado ou reverter o commit da Sprint 1B.
4. Não executar rollback de banco: a Sprint 1B não possui migration nem grava dados.
5. Manter a chave v2 no navegador é inofensivo; ela não é lida com a flag desligada. Pode ser removida posteriormente sem afetar a v1.
6. Revalidar login, dashboard, total de transações, datas, cartão e exportação legada.

## Evidências registradas em 08/08/2026

- Preview estável da branch `codex/sprint-1b-smart-filters`, commit `d0a6ca0`, validado sem qualquer alteração em produção.
- Conta-piloto de staging: total completo confirmado em 28 transações; atalhos, busca, origem, conta, categoria, tipo, chips, persistência e retorno ao histórico completo aprovados.
- Datas-limite, filtros combinados e remoção isolada de chips preservaram os registros e os demais critérios ativos.
- Teste de exportação com o subconjunto conhecido `STG-QA Conta Nubank`: 19 de 28 transações, 10 colunas em CSV e XLSX, cabeçalhos idênticos e 19 linhas logicamente idênticas após normalização de datas e valores.
- A tela foi restaurada para 28 de 28 transações após o teste de exportação.
- Ensaio atômico de rollback no projeto `finelo-staging`: a flag da única conta-piloto foi removida, confirmada como ausente e restaurada exatamente ao metadado inicial dentro da mesma transação. Resultado final agregado: um usuário-alvo e flag restaurada como `true`.
- Builds com a flag ligada e desligada aprovados; 164 testes aplicáveis aprovados, além de teste de volume com 3.500 transações sem mutação da coleção.
- Avaliação manual inicial: experiência considerada mais clara. Homologação qualitativa adicional com outros usuários permanece pendente antes de qualquer decisão de produção.
