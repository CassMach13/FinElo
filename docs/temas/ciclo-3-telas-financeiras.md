# Ciclo 3A — Transações e sugestões de parcelas

Data: 2026-11-05. PR [#97](https://github.com/CassMach13/FinElo/pull/97), branch `codex/finelo-theme-foundation`, partida `a86989e`. Baseline main `6fa1188b1864e85da587e61c7e46009a5e82adb4`, confirmado por fetch e ancestral comum antes das alterações.

## Decisão de escopo

Este é o **primeiro lote concluído do Ciclo 3**, usando a alternativa de entrega por lotes completos autorizada no pedido. Abrange o fluxo central de Transações e o modal E864 de sugestões de parcelas. **Não conclui as quatro áreas do Ciclo 3 e não autoriza publicação do Claro no aplicativo completo.**

`TransactionsView` concentra mais de cinco mil linhas, incluindo grandes fluxos de faturas e conciliação. O modal de histórico de faturas possui centenas de referências fixas de cor. Converter esses fluxos junto com Transações ampliaria a superfície de regressão sem uma homologação igualmente completa. Permanecem lotes próprios: importação de ponta a ponta, faturas/pagamentos/histórico e resolução de conciliação. Dashboard, investimentos, objetivos e páginas públicas continuam fora deste lote.

## Implementação e arquivos

As classes Tailwind originais foram preservadas. Cada consumidor recebeu papéis explícitos `data-finance`, revisados por estado; `src/components/appearance/financial.css` os traduz para os tokens semânticos existentes **somente sob `[data-finelo-theme="light"]` e dentro de `@media screen`**. Não há inversão, filtro global ou substituição automática de classes. As regras novas alteram pintura, sem dimensões, fontes, espaçamento ou paginação.

| Área | Arquivos alterados | Cobertura deste lote |
| --- | --- | --- |
| Transações | `src/components/views/TransactionsView.tsx` | Lista/tabela/cartões mobile, busca, filtros legados, período, ordenação, paginação, seleção, edição inline, totais, estados vazios/carregamento, exclusão e avisos |
| Filtros e recorrências | `transactions/SmartTransactionFiltersPanel.tsx`, `RecurrencesPanel.tsx` | Filtros inteligentes, família, seleção, recorrências sugeridas e painéis |
| Resumos e identidade | `transactions/AccountBalanceCard.tsx`, `EconomicIdentityControls.tsx` | Contas correntes/dinheiro, resumo financeiro e movimentação; apresentação do cartão preparada, fluxos de fatura pendentes |
| Inclusão/edição | `modals/NewTransactionModal.tsx`, `views/AccountModal.tsx`, `modals/CategoryModal.tsx`, `MappingRuleModal.tsx` | Formulário monetário manual, parcelamento manual, validação, erro, cancelamento e modais encadeados; ramos específicos de crédito não homologados |
| Sugestões E864 | `modals/InstallmentSuggestionModal.tsx` | Candidato único, recusa, ambiguidade com mesma categoria, escolha manual e cancelamento |
| Elementos compartilhados | `ui/FamilyOwnerAuditPanel.tsx`, `FamilyOwnerBadge.tsx`, `TransactionOwnerGroupHeader.tsx`, `SwipeableItem.tsx`, `TourButton.tsx` | Cinco cores de autoria, ações mobile e botão de tour; passos/overlay do tour pendentes |
| Acessibilidade | `ui/Input.tsx`, `Select.tsx`, `Modal.tsx` | Associação automática label/campo, ajuda/erro, foco inicial, Tab/Shift+Tab, Escape e restauração de foco nos modais optantes |

Os caminhos abreviados da tabela ficam sob `src/components/`. `Modal.manageFocus` é opcional, desligado por padrão nos consumidores não revisados. Nos grupos de rádio, o foco inicial respeita a opção marcada, inclusive “não aplicar” quando há ambiguidade. Células editáveis aceitam Enter/Espaço; eventos de botões filhos não ativam a edição da célula. Ações mobile se revelam ao receber foco. Esses aprimoramentos de teclado são intencionais; não alteram o fluxo financeiro nem a geometria padrão.

O teste de contraste identificou um caso real: o rótulo de autoria “Você” em superfície composta ficava em 4,374:1. Apenas no Claro, foi adotado o token de ação mais escuro para essa autoria. As cinco variantes familiares foram novamente verificadas. O Escuro não foi recolorido.

## Referência e isolamento

O preview é um recurso de diagnóstico local em modo `staging`, sem rota de navegação ou entrada no build publicado. Usa os componentes e handlers reais, substituindo apenas as ações de persistência por um store volátil observável. A fixture contém 62 lançamentos em duas contas; no cenário familiar são 66 lançamentos em seis contas e cinco autorias. Inclui salário, despesas, zero, estorno, transferência interna, parcela atual/futura, importado não editável, descrição longa e três meses fechados de recorrência.

O servidor recebe URL/chave Supabase **fictícias** e flags desligadas. Antes de importar os consumidores, o bootstrap substitui local/session storage por mapas em memória, desliga BroadcastChannel e intercepta solicitações remotas. O Playwright ainda bloqueia tráfego externo e service workers. Um sentinela no storage real é conferido por outra janela de execução para provar que o preview não o apagou. Não houve login, leitura de dados reais, escrita remota, alteração da QA ou ampliação da coorte neste ciclo.

O snapshot da main é reconstruído por `git archive` em namespace separado, com 268 fontes e seus SHA-256 verificados antes do ensaio. A importação nativa usa o mesmo URL de módulo das dependências estáticas para evitar duplicar instâncias de Zustand por sufixos de importação do Vite.

Esta evidência é **sintética e local**. Não é apresentada como homologação autenticada de integração Supabase ou como novo ensaio do Auth do Ciclo 2. A persistência, os eventos de sessão e a elegibilidade aprovados naquele ciclo não foram alterados.

## Matriz visual e acessibilidade

Viewport desktop 1440×1000 e mobile 390×844, escala 1, relógio fixo em 2026-11-05, fuso America/Sao_Paulo, Edge headless. Cada comparação usa os mesmos dados, estado, rolagem e foco. A referência main também recebe foco explícito equivalente, pois o foco automático dos novos modais é uma melhoria autorizada neste lote.

A comparação conserva os hashes brutos e prefere igualdade exata. Há um limite explícito para ruído de rasterização: no máximo 2 níveis por canal RGB, em no máximo 0,01% dos pixels (piso de 20 pixels). Qualquer diferença maior falha. Isso foi introduzido após inspecionar duas capturas mobile com 9 e 12 pixels variando apenas 1–2 níveis em bordas arredondadas; não houve mudança de classes/paleta ou geometria. Cada diferença aceita permanece registrada por estado no manifesto, sem substituir a imagem original. Não se declara igualdade binária quando esse limite é usado.

| Cenários | Desktop | Mobile | Verificação |
| --- | --- | --- | --- |
| Lista extensa, positivos/negativos/zero/movimentação | PASS | PASS | Paridade Escuro/main e contraste Claro |
| Filtros, busca e vazio filtrado | PASS | PASS | Mesmos resultados e nenhum payload |
| Conta, categoria e regra encadeadas | PASS | PASS | Cancelamento sem gravação |
| Inclusão, validação obrigatória, parcelamento manual e erro | PASS | PASS | Payloads, valores e saldos iguais |
| Edição, importado bloqueado, seleção e exclusão cancelada | PASS | PASS | Imutabilidade quando cancelado/bloqueado |
| Retenção após mudar categoria fora do filtro | PASS | Não aplicável | Edição inline da tabela desktop |
| Carregamento, recorrências e filtros inteligentes/família | PASS | PASS | Cinco autorias e campos nativos |
| E864: único, recusa, dois candidatos iguais em categoria, manual, cancelar | PASS | PASS | Escolhas e campos preservados |
| Hover, foco, data nativa e apresentação sem tema | PASS | PASS | Rodada específica de controles |

A auditoria computada percorre texto efetivamente renderizado, valores/placeholder de campos, bordas essenciais, ícones de ação e foco visível, considerando composição de cores e opacidade. Exige texto ≥4,5:1 e elementos essenciais/foco ≥3:1; não usa só cores nominais da paleta. A referência não pode exceder a largura da viewport. Campos desabilitados, seleção, erro e overlays também são exercitados. A medição concentra-se no modal superior quando há sobreposições.

Resultado final: **56 comparações**, sendo 47 do núcleo e nove de controles. **54 exatas**; duas mobile com ruído limitado: importado bloqueado, nove pixels com delta máximo 2; E864 ambíguo, 11 pixels com delta máximo 1. As imagens não foram mascaradas nem corrigidas. Houve **11.136 verificações de contraste aprovadas**, mínimo de **5,122:1 para texto** e **3,567:1 para elementos essenciais/foco**. Zero overflow horizontal nos estados capturados e zero solicitações externas pela rede do navegador.

Os números por estado e hashes ficam nos [manifestos](evidencias-ciclo-3/). Isso não equivale a uma certificação WCAG do produto: acessibilidade exige também revisão de leitores de tela, navegação completa e plataformas reais. Safari/iOS, teclado virtual, PWA instalada, diálogos nativos do sistema e Android físico permanecem pendentes.

| Seleção de capturas | Escuro | Claro |
| --- | --- | --- |
| Desktop, lista financeira | [PNG](evidencias-ciclo-3/desktop-dark-lista.png) | [PNG](evidencias-ciclo-3/desktop-light-lista.png) |
| Mobile, inclusão | [PNG](evidencias-ciclo-3/mobile-dark-inclusao.png) | [PNG](evidencias-ciclo-3/mobile-light-inclusao.png) |
| Desktop, E864 ambíguo | [PNG](evidencias-ciclo-3/desktop-dark-parcelas-ambiguous.png) | [PNG](evidencias-ciclo-3/desktop-light-parcelas-ambiguous.png) |

Problemas anteriores do Escuro continuam separados: navegação ativa com branco ~2,58:1, região ciana do botão com branco ~2,43:1 e alguns rótulos pequenos ~3,10:1, registrados no Ciclo 2. Não foram corrigidos silenciosamente para preservar a aparência aprovada.

## Regressão financeira e E864

`tests/appearance/financialPresentation.spec.ts` mantém fingerprints AST dos **15 consumidores financeiros contra a main**. Removendo somente os atributos de apresentação/acesso revisados e a importação de CSS, o restante precisa ser idêntico: classes legadas, expressões, condições, fórmulas e callbacks. Dois testes adicionais verificam associação de labels/ajuda/erros; outros dois proíbem regras fora do escopo Claro/screen e propriedades estruturais no adaptador. Total: 19 novos testes.

No navegador, os handlers reais alimentam ações voláteis que registram os payloads. O harness compara objetos completos de lançamentos, eventos e saldos calculados entre main, Escuro e Claro, antes/depois de inclusão de três parcelas, edição, classificação e cancelamento. Alterar categoria conserva o saldo. Nenhum parser, serviço, engine, hook financeiro, rotina de conciliação ou campo de permissão foi modificado.

O E864 usa dois candidatos com IDs e nomes diferentes, ambos na mesma categoria. Com dois candidatos, nenhum candidato fica selecionado; a opção “não aplicar” fica marcada. Único/manual aplicam somente nome/categoria por meio de `aplicarEscolhasDeParcela` real. Recusa, ambiguidade não resolvida e cancelamento conservam todos os campos. Valor, compra, vencimento, competência `referenceMonth`, número/total de parcelas, conta e origem permanecem iguais. A fixture repete a data de compra entre parcelas, sem modificar critérios de matching ou ordenação temporal.

O ensaio visual não substitui a suíte existente de domínio/importação/conciliação, executada integralmente. Não afirma comparar saldos reais de faturas ausentes da fixture. O risco **preexistente de identificação de pagamento por `Nome_Fantasia`/apelido**, documentado no protocolo E864, permanece pendência separada: não foi introduzido, investigado novamente ou corrigido nesta conversão visual.

## Impressão/PDF

`src/index.css`, seletores de impressão, mecanismo de exportação e classes originais permanecem iguais. O adaptador novo só opera em mídia screen. O PDF de referência usa a lista financeira real com 50 linhas visíveis da fixture, contendo valores positivos, negativos, estorno e movimentação. **PASS: nove páginas preservadas, com rasterização idêntica página a página entre main, Escuro e Claro**, além da presença de conteúdo financeiro. Os hashes de cada página constam em [visual.json](evidencias-ciclo-3/visual.json).

Este é um PDF representativo dos componentes financeiros, não uma afirmação de nova função de exportação nem uma repetição da Dashboard autenticada sem dados do Ciclo 2. Os 38 testes existentes de contrato/cabeçalho de impressão passaram na suíte completa.

A inspeção da primeira e da última página confirma saldos, salário e totalizador. A referência isolada conserva a saída legada de Transações, que inclui cartões mobile e tabela no mesmo documento; as nove páginas já aparecem na main. Não se corrigiu essa duplicação nem se declarou adequação editorial de um novo relatório. A evidência comprova preservação da impressão, sem ampliar o escopo para redesenhar o PDF.

## Validações

- Suíte completa final: **201 arquivos, 3.278 testes aprovados**, zero falhas.
- Aparência e parcelas, revalidação focal: **170 testes aprovados**.
- TypeScript: **14 diagnósticos conhecidos, nenhum novo**.
- Build: **PASS**, precache PWA com 49 entradas. Avisos existentes de bundle e base Browserslist antiga permanecem.
- Comparação visual/financeira/PDF: **PASS**, nos limites e cenários descritos acima. Revalidação dos 19 testes de apresentação após limpeza de whitespace: PASS.

## Reprodução e política de evidências

Fontes de diagnóstico: `scripts/diagnostics/financial-preview.html`, `financial-preview.tsx`, `financial-preview-runtime.tsx`, `serve-financial-preview.ps1`, `prepare-financial-baseline.py` e `validate-financial-themes.py`. Não são entradas do aplicativo publicado.

1. Instalar as dependências usuais do projeto e disponibilizar Python, Playwright Python, PyMuPDF e Edge em ambiente de teste.
2. Executar `python scripts/diagnostics/prepare-financial-baseline.py --base 6fa1188b1864e85da587e61c7e46009a5e82adb4`. O script recusa sobrescrever fontes diferentes.
3. Em PowerShell, executar `./scripts/diagnostics/serve-financial-preview.ps1 -Port 5201`. As variáveis de processo fictícias só valem durante esse comando.
4. Executar `python scripts/diagnostics/validate-financial-themes.py --port 5201 --out-dir <artefatos> --manifest <artefatos>/validation.json`.
5. Executar também `--phase controls` em outro diretório/manifesto para hover/foco/data e ausência do atributo de tema. Não alterar fontes/snapshot durante os ensaios, pois o HMR pode reiniciar a fixture.
6. Parar o servidor local ao terminar. O snapshot temporário não deve ser versionado.

Foram versionados somente seis PNGs e três manifestos compactos de resultados/hashes: [núcleo](evidencias-ciclo-3/visual.json), [controles](evidencias-ciclo-3/controls.json) e [índice completo](evidencias-ciclo-3/index.json). O pacote **`finelo-ciclo-3a-evidencias.zip`** fica fora da árvore Git e está anexado à entrega: **168 capturas e três PDFs**, 15.815.148 bytes, SHA-256 `613b8387b25f650c06583d1e91453a6dd86c52a85b39de449b97d80e728dad6d`. O ZIP foi reaberto e cada arquivo conferido pelo hash. As referências main e diferenças mínimas de rasterização permanecem disponíveis no pacote, sem mascaramento. Os scripts e hashes permitem reproduzir e auditar o conjunto.

## Isolamento, rollback e próximos lotes

A elegibilidade continua exigindo staging, flag de piloto e autorização administrativa por conta. Este ciclo não muda essas condições, não introduz opt-in em novas telas e não aplica Claro ao shell completo. Preferências existentes podem permanecer salvas sem efeito fora da experiência isolada. Sem migrations, alteração financeira, dados de produção, merge ou deploy em produção.

Rollback de apresentação: desligar a flag de staging/reconstruir ou reverter o commit deste lote. Não requer desfazer dados. A ausência de atributo de tema mantém a aparência Escura; não há migração de preferência nem recarga de transações para mudar aparência.

Próximos lotes, mantendo a mesma coorte:

1. **Importação completa:** arquivos, prévia, configuração, nativa/manual, revisão, mensagens de erro, deduplicação, confirmações/cancelamentos. Reutilizar o modal E864 já homologado e comparar payloads sem reprocessar faturas reais desnecessariamente.
2. **Faturas/cartões:** cartão atual/anterior, histórico, pagamentos integrais/parciais, competências, vencimentos, limite, estornos e ramos de crédito dos formulários. Criar fixture completa de ciclos e comparar totais/saldos e PDF.
3. **Conciliação:** todos os estados e resoluções, vínculos e cancelamentos, mantendo as regras legadas. Tratar o risco por apelido em proposta separada.
4. **Homologação transversal:** plataformas físicas/PWA, leitores de tela, PDF nativo e restantes consumidores antes de propor qualquer Claro global. Correções AA do Escuro exigem revisão explícita.

PR #97 permanece em rascunho para revisão do lote 3A. A publicação geral continua pendente dos lotes seguintes e de autorização específica.

## Lote 3B — Importação completa

Continuação autorizada de `6f7a94b11286843d073295cc2be4e3c7601ea531`, com a main `6fa1188b1864e85da587e61c7e46009a5e82adb4` como segunda referência. O lote converte a apresentação da Importação e dos seus auxiliares. Faturas, pagamentos e conciliação continuam reservados ao 3C. Nenhuma conta foi incluída no piloto e nenhuma preferência, sessão ou base remota foi utilizada na homologação deste lote.

### Componentes e limites da conversão

| Consumidor | Estados convertidos |
| --- | --- |
| `ImportView` | Catálogo e favoritos, configurações nativas, conta, datas e competência; arquivos, carregamento, mapeamento, seleção, inversão e linhas ignoradas; confirmações, alertas, sucesso, limites e integração |
| `OpenFinanceReviewModal` | Leitura, período, conta, metadados opcionais de cartão, confiança, seleção, categoria, revisão, confirmação, erro e conclusão |
| `SaveConfigModal` | Criar/atualizar mapeamento, campos, opções, aviso e cancelamento |
| `ImportSuccessPanel` | Resumo, avisos e ações de retorno |
| `ImportDetailsModal` | Lançamentos importados/ignorados; distinção entre ativos, excluídos e legado sem ID |
| Trechos de `SettingsView` | Histórico de importações, busca e paginação; configurações e regras; detalhes, confirmação e correção de conta. Outras áreas de Configurações não integram este lote |
| Auxiliares | `AccountModal`, diálogos globais e controles compartilhados reutilizados; popover do tour recebe tokens somente quando aberto na Importação isolada em Claro |

Os papéis explícitos `data-finance` reutilizam os adaptadores financeiros do 3A. As novas regras de pintura estão dentro de `@media screen` e de seletores de Claro; as classes legadas permanecem. Não há inversão de cores, substituição ampla de Tailwind ou mudança de disposição. Datas e selects nativos recebem identificação acessível; controles de arquivo e cabeçalhos de seleção operam por teclado; modais optam pelo gerenciamento de foco existente. A estrela de favorito não propaga Enter/Espaço para a seleção do banco. O fechamento por teclado do consentimento devolve o foco ao acionador.

### Exceção de conteúdo expressamente aprovada

O upload manual e alguns estados de Open Finance já definiam `notification`, mas não a exibiam nesses contextos. A falha foi reproduzida no baseline. A resposta do usuário foi **“Autorizar a correção visual mínima”** para exibir as notificações existentes nos dois temas.

O novo `ImportFeedback` apenas apresenta a mensagem já produzida pelo fluxo, com `alert/assertive` para erro e `status/polite` para resultado. Não duplica o resumo positivo que já possui painel. Não altera validação, tratamento de arquivo, consentimento, requisição ou gravação. A diferença de conteúdo no Escuro é registrada separadamente no manifesto como exceção aprovada, sem aplicar tolerância de rasterização. A classe `no-print` impede que o feedback acrescente conteúdo ou paginação ao PDF existente.

### Homologação reproduzível e isolamento

A entrada de diagnóstico usa URL/chaves fictícias, armazenamento em memória, BroadcastChannel desativado e nenhuma sessão do SDK. O transporte sintético é instalado **antes** dos imports da aplicação, intercepta todas as chamadas remotas e `/api/`, e recusa rotas não previstas. Uma segunda barreira no navegador bloqueia tráfego externo; um sentinela verifica que o armazenamento real não foi alterado. Não há senha, token de usuário nem uso de perfil pessoal do navegador. O simulador de janela do provedor registra apenas host/caminho, sem abrir conexão externa.

São exercitados os componentes, parsers, serviços e handlers originais. A importação em lote chama o `addMultipleTransactions` original e percorre os contratos RPC com respostas sintéticas. Operações individuais de integração e CRUD usam armazenamento em memória; a evidência comprova igualdade dos argumentos e resultados do cliente, sem alegar homologação de um provedor ou banco reais. A sessão, o backend remoto e a autorização do Supabase não são substituídos no aplicativo publicado.

As fixtures incluem CSV, XLSX, XLS, OFX, arquivo vazio, cabeçalho sem dados, CSV sem colunas válidas, ZIP Excel truncado, regra `MERCADO`, valores positivos/negativos/zero, linhas ignoradas e repetidas, falhas de leitura/gravação e repetição após interrupção. O teste cobre o mesmo arquivo renomeado na mesma conta e na segunda conta, respeitando a idempotência por conta existente. Inclui 65 linhas de prévia, revisão de integração extensa e 25 históricos.

O E864 é reutilizado sem mudança: candidato único, recusa, dois candidatos distintos com a mesma categoria, escolha manual e cancelamento. A compra repetida permanece em setembro, a parcela importada é `2/4`, com referência de outubro e vencimento em novembro. Configuração manual sem vencimento ou competência continua bloqueada pelas mesmas validações.

### Equivalência financeira

Cada cenário guarda o estado completo antes/depois e compara os quatro caminhos: commit revisado, main, Escuro atual e Claro atual. Os JSONs externos contêm argumentos de parsing/importação, corpos e filtros de requisição sanitizados, respostas e lançamentos, contas, saldos calculados, vínculos de lote, logs, regras e configurações. Cabeçalhos, credenciais e respostas de token não são registrados. Os hashes resumidos não substituem os JSONs verificáveis do pacote completo.

Além dos testes de fluxo, seis fingerprints de implementação preservam classes, cálculos, branches e callbacks dos consumidores. Somente atributos e os acréscimos de apresentação/acessibilidade declarados são excluídos; o componente puro `ImportFeedback` é a exceção nominal aprovada. Onze arquivos financeiros têm SHA-256 normalizado selado contra `6f7a94b`: parsers e auxiliares, serviços de importação/integração/histórico, store, sugestões E864, referência/ciclo do cartão e integridade do lote. O código financeiro nesses arquivos permanece idêntico. Quatro testes adicionais verificam escape de HTML, regiões vivas e supressão de feedback inativo/duplicado.

### Evidência visual, contraste e impressão

Os resultados consolidados, hashes e capturas selecionadas ficam em `evidencias-ciclo-3b/`. O pacote completo externo contém as quatro variantes de cada estado em **1440×1000** e **390×844**, com relógio, fuso, dados, escala e dimensões fixos. A captura aguarda fontes/imagens e usa composição por software em sRGB para evitar artefatos do driver gráfico. O foco é igualado para comparação; os contratos de teclado, contenção e restauração são verificados separadamente.

A comparação exige igualdade de geometria, conteúdo e cores computadas antes de admitir a tolerância do 3A: no máximo 2 níveis por canal e 0,01% dos pixels (mínimo de 20). Casos não exatos incluem prova JSON das apresentações de referência/atual e seu hash. A tolerância não se aplica à exceção aprovada de feedback, nem autoriza mudar cores funcionais.

O contraste do Claro é calculado sobre estilos efetivamente renderizados, considerando transparência e os fundos em gradiente. Exige **4,5:1** para texto, valores, placeholders e campos; **3:1** para bordas de controle, ícones de ação e foco verificável. A amostragem inclui hover, foco, desabilitados, seleção, sobreposições, alertas, campos de data e controles nativos. Logotipos de marca não são avaliados como texto comum; os nomes legíveis dos bancos são. O estado de favorito tem rótulo, `aria-pressed` e contorno contrastante, além do símbolo.

A Importação não possui um exportador PDF próprio. A verificação compara a impressão existente da prévia com valores financeiros, do histórico completo e do upload com erro aprovado. Compara dimensões, contagem e raster de **todas** as páginas entre main, commit revisado, Escuro e Claro; verifica a presença dos dados e a ausência de gravações. A inspeção visual confirma limitações anteriores: a prévia tem uma página inicial só com título, parte da tabela não aparece na impressão e o histórico termina com uma página sem texto. O conteúdo financeiro está na prévia textual e nas páginas de histórico verificadas. Não se redesenha o documento nem se interpreta a equivalência como correção editorial da impressão legada. Os testes gerais de paginação permanecem obrigatórios.

### Limitações e riscos legados separados

- **OFX pela interface manual:** a precedência de `manualMapping.fileContent` no parser encaminha esse fluxo para CSV. A fixture OFX selecionável termina com zero lançamentos nos dois baselines e nos dois temas. O parser OFX dedicado existe, mas esse defeito de roteamento não foi corrigido neste lote visual. A evidência comprova mensagem legível e ausência de gravação, não sucesso de importação OFX pela interface.
- **Consentimento secundário:** o botão legado “Continuar →” passa o evento diretamente a `handleConsentSubmit(isRetail = false)`, podendo ativar o ramo demonstrativo preexistente por truthiness. A homologação usa “Importar via Open Finance”, que passa `false` explicitamente. O risco antecede esta alteração e requer correção funcional separada; não houve bypass de autenticação real.
- **Conta nativa ausente:** a dica visual de conta não era a mesma condição do `disabled` do input; os contratos SQL existentes aceitam conta nula em determinados casos. Preserva-se a regra. `aria-disabled` descreve o bloqueio real, enquanto o papel de pintura conserva a dica visual; não se cria silenciosamente uma nova validação financeira.
- Chrome/Edge headless verifica o cliente em viewports mobile, sem substituir teste físico de Safari/iOS/Android, PWA instalada, leitor de tela ou seletor nativo de arquivo/calendário. Alerts/confirms nativos são registrados por mensagem/tipo e mantêm a implementação do navegador.
- Não foram testados credenciais reais de Open Finance, consentimento no provedor, RLS ou uma importação real de produção. O risco legado de conciliação por `Nome_Fantasia`, já documentado no 3A, permanece fora deste lote.

### Reprodução, rollback e pendências do 3C

Preparar os snapshots com `prepare-financial-baseline.py --base <SHA> --target-name theme-import-main-baseline` e `theme-import-reviewed-baseline`, usando os SHAs acima. Iniciar `serve-import-preview.ps1 -Port 5202`. Executar `validate-import-themes.py --port 5202 --themes all --suite <files|integration|history|extras|controls> --out-dir <diretório> --manifest <diretório>/validation.json` e `validate-import-print.py --port 5202 --out-dir <diretório>`. Python requer Playwright, PyMuPDF e Edge. A captura desabilita otimizações Skia detectadas em runtime, opção que o [Chromium documenta para seu caminho de testes](https://chromium.googlesource.com/chromium/src/+/HEAD/content/public/common/content_switches.cc), além de aguardar composição e recursos. Os snapshots são verificados por hash e não fazem parte da entrega publicada.

O Claro permanece isolado à referência de teste; o app integral continua Escuro. Flag, elegibilidade e preferências não foram ampliadas. Rollback é desligar a flag/reconstruir ou reverter o commit visual, sem desfazer dados. O 3C deve converter os fluxos completos de faturas, pagamentos, histórico de cartões e conciliação, com seus próprios cenários financeiros e de impressão; depois seguem plataformas físicas/PWA e homologação transversal antes de qualquer autorização de Claro global.

### Resultado final e matriz de aceite do 3B

Todas as linhas abaixo comparam desktop e mobile nos quatro caminhos, incluindo equivalência dos resultados financeiros. “PASS” de OFX e impressão significa **preservação do comportamento legado**, com as limitações já descritas.

| Grupo | Cobertura | Capturas | Resultado |
| --- | --- | ---: | --- |
| Arquivos e E864 | Seleção, vazio/inválido, leitura, mapeamento, ignorados/inversão, sucesso, duplicidade por conta, erros/retry/interrupção; datas/competências; E864 único/recusa/ambíguo/manual/cancelamento | 344 | PASS |
| Integração | Conexões/loading, limites, consentimento/erro, janela simulada, leitura/período, revisão extensa, seleção/categorias, merge, metadados e persistência/recuperação | 216 | PASS |
| Histórico e configurações | Busca/vazio, detalhes/ignorados/ativos/excluídos/sem ID, paginação, correção de conta/cancelamento, confirmações, configurações e regras | 184 | PASS |
| Auxiliares | Conta nova, tutorial, prévia extensa, mapeamento incorreto, XLS/XLSX/OFX, salvar configuração/erro, cota, flag desligada | 168 | PASS |
| Controles complementares | Foco em favoritos/data/remoção, aviso de banco divergente, desconexão/cancelamento, navegação e tabelas roladas até as últimas colunas | 80 | PASS |

- **992 capturas**; **482 comparações de paridade Escura exatas** entre main/revisado/atual. Nenhuma precisou da tolerância do 3A. Outras **14 comparações** registram somente a exceção aprovada de feedback em sete estados por viewport.
- **11.371 verificações de contraste Claro aprovadas**: mínimo **4,894:1** para texto/campos e **3,567:1** para elementos essenciais/foco. Sem overflow horizontal do documento; tabelas largas preservam seu rolamento interno. O controle transparente legado também entra na comparação de geometria, mesmo quando o foco o revela no Claro.
- Teclado: favorito não seleciona banco; upload realmente desabilitado não abre seletor; upload nativo habilitado e upload manual abrem por teclado; Tab/Shift+Tab ficam no modal; Escape fecha e o consentimento restaura foco. Nenhuma dessas verificações grava lançamentos. Estes controles não constituem certificação integral WCAG do aplicativo ou do Escuro legado.
- **Payloads, lançamentos, regras, metadados, logs, contas e saldos equivalentes** em todos os cenários; zero requisições externas e zero erros JavaScript não tratados.
- **12 PDFs**, com **3, 12 e 2 páginas por variante**, respectivamente prévia/histórico/erro. Todas as 68 páginas comparadas têm raster idêntico; sem mudança de conteúdo, dimensões ou paginação em relação aos baselines.
- Suíte completa: **3.289 testes em 203 arquivos**, todos aprovados, incluindo E864 e regressões financeiras/38 contratos de impressão. Revalidação focal: **181 testes**; revalidação final após limpeza de whitespace: **77 testes de aparência**. TypeScript: **14 diagnósticos conhecidos, zero novos**. Build/PWA: **PASS**, 49 entradas de precache.

Evidências compactas: seis PNGs, manifestos por suíte, resumo e índice em [`evidencias-ciclo-3b/`](evidencias-ciclo-3b/). Pacote externo completo: `finelo-ciclo-3b-evidencias.zip`, **73.493.415 bytes**, **1.113 arquivos indexados**, incluindo capturas, PDFs, renderizações, JSONs financeiros completos, logs e fontes auditadas. SHA-256 do ZIP: `abc294b0b298dfba121826375790b34948ef02a9f6482667972b3f432d88caa1`. O ZIP foi reaberto, seu CRC conferido e cada entrada indexada validada por SHA-256. O índice versionado permite verificar o pacote sem colocá-lo no Git.

O lote 3B está concluído para revisão na PR #97 em rascunho. A confirmação do Quality baseline do commit publicado será registrada na descrição da PR. Não houve merge, deploy, migration ou modificação de dados reais; o Claro global continua pendente do 3C e da homologação transversal.

## Lote 3C — Cartões, faturas e pagamentos

Continuação de `3e7341556b5d55eb2dcbb549e7d35e0141fb8fb9`, na mesma branch/PR em rascunho. A main remota e o ancestral comum foram confirmados em `6fa1188b1864e85da587e61c7e46009a5e82adb4`. Antes de editar a interface: **3.289 testes/203 arquivos aprovados**, TypeScript com 14 diagnósticos conhecidos/zero novos e build/PWA aprovado (49 entradas). Os arquivos não rastreados anteriores foram preservados.

### Inventário e separação dos motores

| Motor | Gate exercitado na fixture | Caminho efetivo |
| --- | --- | --- |
| Legado | Novo e V2 desligados | Ledger e métricas legadas; histórico por competência com a projeção econômica canônica |
| V2 | `isCardV2Enabled=true`, novo desligado | Snapshots de `credit_card_statements`, merge com lançamentos manuais e a mesma navegação de histórico |
| Novo | `isCreditCardEngineEnabled=true`, V2 desativado pela precedência existente | Snapshots do motor novo, histórico canônico, pagamento direcionado e auditoria de competências/sombra somente leitura |

As flags acima pertencem somente à identidade fictícia da referência local. Não houve opt-in de conta real, mudança de coorte ou alteração dos gates. `ensureCreditCardForAccount` já faz upsert dos metadados ao montar os caminhos com snapshots; esse contrato é reproduzido em memória. A troca de pele não deve repetir essa operação nem qualquer requisição financeira.

Proteção/rollback: o app completo continua Escuro e a flag/coorte dos Ciclos 1–2 permanece inalterada; o Claro de cartões só existe na referência isolada. Desativar o piloto mantém o visual legado, coberto por captura sem o atributo de tema. Um eventual revert do commit visual 3C não exige desfazer pagamentos ou dados, pois não há migration, novo formato financeiro ou escrita de preferência introduzidos neste lote.

| Superfície | Tratamento |
| --- | --- |
| `AccountBalanceCard` | Reutiliza os adaptadores do 3A; disponibilidade negativa passa a usar o papel negativo no Claro, conservando a classe Escura. Homologação de limites, saldo, dívida, carregamento, vencimento e ações nos três motores |
| `TransactionsView`, ramos de cartão | Histórico, competência selecionada, auditoria de lançamentos, composição/pagamentos/fontes, confirmação de quitação e desfazer, erros e modais encadeados; ramos remanescentes de faturas também recebem papéis explícitos |
| `PayCreditCardInvoiceModal` | Fatura selecionada, aberto/vencido/pago, conta/categoria, valor/data, parcial/excedente, validação, persistência, erro, cancelamento e carregamento |
| `CreditCardInvoiceCyclesModal` | Seleção de cartão, arquivos, competência/vencimento, totais, validações, bloqueios e toda a apresentação dos relatórios de auditoria/simulações, sem executar ativação/reparo/reconciliação |
| `CardDiagnosticsModal` | Superfície, itens informativos/de atenção, ações e vazio; novo gerenciador de foco sem DOM para preservar a geometria |
| `CompetenceInvoiceBarChart` | Barras, valores, meses/legenda, seleção/hover/foco; setas/Home/End acionam a seleção já existente |
| `NewTransactionModal`, ramos de cartão | Reutilizados e homologados com os tokens do 3A: compra, parcelas, estorno, competência e encaminhamento ao fluxo dedicado de pagamento. Seus handlers e conteúdo não foram modificados |

Compartilhados reutilizados: Card, Button, Input, Select, Modal, GlobalDialog, AccountModal e CategoryModal. Não foi criada uma segunda biblioteca de controles. O seletor de tema não foi colocado no fluxo financeiro nem se expôs Claro global.

### Proteção financeira e fidelidade

Antes da conversão foram arquivadas capturas Escuras em desktop/mobile dos três motores, incluindo a aplicação, histórico, pagamento, gráfico, ciclos e diagnóstico. Os snapshots imutáveis de main (268 fontes) e revisado (277 fontes) são verificados por SHA-256 antes da automação.

Sete fingerprints dos consumidores preservam classes e implementação original, excluindo somente os atributos declarados de apresentação/acessibilidade e o componente nominal `DialogFocusManager`, que não renderiza DOM. **156 módulos** de domínio, serviços, store, hooks, utilitários e métricas têm hash normalizado LF selado contra o commit revisado. Não se alteram cálculo, vencimento, competência, alocação, fim de semana, reconhecimento de pagamentos/estornos, parcelas, limite, classificação, permissões ou confirmações manuais.

Os atributos `data-finance` atribuem papéis explícitos aos nós existentes. As regras adicionais ficam em `@media screen` e sob Claro. Classes, fórmulas de altura/largura das barras, callbacks de clique, formatos e textos continuam os originais. Não há filtros/inversão de cor, substituição de classes ou ajuste estrutural para corrigir cores. As melhorias de teclado/foco são intencionais dentro do escopo de acessibilidade, sem mudança do conteúdo Escuro ou de handlers financeiros.

A medição inicial encontrou contraste insuficiente no CTA de auditoria sobre seu gradiente legado, em badges fúcsia de simulação e no checksum semitransparente. A correção usa superfície informativa e tokens existentes, com opacidade legível somente no checksum Claro; não redesenha os componentes nem muda o Escuro.

### Fixtures, automação e isolamento

`card-fixtures.ts` declara entradas sintéticas em centavos, com IDs de QA, três competências e compras parceladas com a mesma data de compra em meses distintos. Cobre: aberta, fechada, paga, parcial antes do vencimento, segundo pagamento que quita o restante, atraso, vencimento nominal em sábado, estornos antes/depois do fechamento, parcelas futuras, competência legada inconsistente, vazio, múltiplos cartões/limites, disponibilidade insuficiente, confirmação de quitação/cancelamento, falhas de leitura/autorização/persistência e recuperação.

A entrada de diagnóstico instala armazenamento em memória e transporte fechado **antes** dos imports. URL/chaves são fictícias; não há sessão SDK nem credenciais reais. O navegador é novo, bloqueia rede externa e confere um sentinela do armazenamento original. Leitura de snapshots e confirmações usa os serviços existentes com respostas sintéticas; a auditoria usa o método original do store e os relatórios originais. Registro de lançamentos/pagamento e preferências têm efeitos externos substituídos por memória/eventos verificáveis. Os payloads dos handlers reais e as projeções financeiras resultantes são comparados; isso não é homologação de RLS ou de persistência no servidor real.

Cada cenário conserva JSON completo de lançamentos, contas, saldos, histórico, confirmações, eventos econômicos e requisições sanitizadas, além da projeção em centavos. O segundo pagamento tem duas pernas opostas de 6.000 centavos e quita a competência correspondente; cancelar ou confirmar quitação externa não inventa lançamentos. Falha de registro conserva o formulário e o ledger, permitindo nova tentativa.

A troca local do atributo de aparência é medida com React Profiler e contadores de requisições/eventos: deve manter dados, valores e contadores idênticos, sem commits React. A persistência da preferência continua no mecanismo do Ciclo 2, inalterado; a medição do 3C corresponde à troca CSS da referência isolada, sem alegar um seletor global de aplicação já publicado.

As quatro variantes são main, revisado, Escuro atual e Claro atual, em 1440×1000 e 390×844, escala/relógio/fuso fixos. Comparam-se payloads/resultados por motor, conteúdo, geometria e cores computadas. Só depois dessa igualdade é admissível a tolerância de raster do 3A (até 2 níveis por canal/0,01% dos pixels, mínimo 20); eventual uso exige prova bruta, sem exceções automáticas de conteúdo.

### Impressão, limites e riscos independentes

Não há alteração de regras de impressão. A fixture impressa inclui múltiplos cartões e competências, fatura paga e histórico aberto. A comparação verifica todas as páginas, dimensões, raster, texto extraído, valores e datas, sem gravar lançamentos. Modais fixos e botões do gráfico continuam excluídos da impressão pelas regras legadas; equivalência não significa criação de um novo relatório PDF de faturas.

Permanecem fora do lote: conciliação por `Nome_Fantasia`/apelido, OFX manual, consentimento secundário de Open Finance e correções de competências históricas. O dado legado inconsistente é apresentado e comparado, sem reclassificação/reprocessamento. Na entrada manual, a inferência preexistente pode limpar o tipo ao passar para Renda sem descrição suficiente; as fixtures preenchem a descrição para exercitar os caminhos de estorno e pagamento, sem corrigir a regra. A confirmação “já está pago no banco” preserva sua distinção de um pagamento efetivo com saída de conta.

A homologação mobile é por viewport no Edge headless. Safari/iOS/Android físicos, PWA instalada, leitor de tela e popups nativos permanecem na homologação transversal. Contraste computado e teclado não constituem certificação WCAG 2.2 integral do app; as limitações AA preexistentes do Escuro não foram corrigidas com diferenças não autorizadas.

### Alterações de acessibilidade e correções de pintura

As diferenças de interação do Escuro foram analisadas dentro do escopo de acessibilidade: os modais de ciclos/pagamento passam a usar o gerenciamento de foco compartilhado; o diagnóstico customizado recebe nome/papel de diálogo, contenção de Tab/Shift+Tab, Escape e restauração do foco, sem acrescentar DOM; o gráfico aceita setas/Home/End, acionando o mesmo `onSelect`. Não se alteraram textos, classes Escuras, dimensões ou handlers financeiros. A paridade é medida com o mesmo controle focado nas variantes antigas e atuais; esses avanços de teclado não são exceções de conteúdo nem usam tolerância raster.

A medição encontrou e corrigiu exclusivamente no Claro: fundo em gradiente de uma chamada de auditoria que reduzia o contraste, rótulos fúcsia sem papel semântico, opacidade do checksum e precedência do hover legado sobre a cor das barras. As regras novas são de pintura, delimitadas por `@media screen` e `data-finelo-theme="light"`. Não há filtros ou substituição de classes. A disponibilidade negativa conserva a cor funcional negativa no Claro; o texto/valor existente continua indicando o estado em ambos os temas.

A revisão React não introduziu efeitos de dados ou dependências financeiras. O detector visual Impeccable apontou dois padrões anteriores (borda lateral de card e texto cinza em superfície colorida). A borda/geometria e as classes antigas foram preservadas por requisito; a apresentação Clara é verificada pelo contraste efetivamente computado, em vez de redesenhar esses componentes.

### Reprodução isolada

Preparar os snapshots com `prepare-financial-baseline.py --base 6fa1188b1864e85da587e61c7e46009a5e82adb4 --target-name theme-card-main-baseline` e `--base 3e7341556b5d55eb2dcbb549e7d35e0141fb8fb9 --target-name theme-card-reviewed-baseline`. `serve-card-preview.ps1 -Port 5203` inicia somente o servidor local com configuração fictícia temporária de processo. Nenhum arquivo de ambiente é modificado.

Com Python/Playwright, Edge e PyMuPDF disponíveis, executar `validate-card-themes.py --port 5203 --themes all --suite <core|payments|manual|cycles|controls|supplement> --out-dir <pasta>` para cada suíte, e `validate-card-print.py --port 5203 --out-dir <pasta>`. As validações conferem os hashes dos baselines, bloqueiam rede externa e armazenam cada resultado financeiro completo. O pacote inclui fontes auditadas, snapshots, manifestos, logs e a prova de que a correção final de tipagem do handler do gráfico emite JavaScript idêntico em desenvolvimento e produção. Os relatórios finais de navegador foram refeitos após essa correção e a correção de hover.

### Resultado final e matriz de homologação 3C

**PASS — lote 3C concluído para revisão, com Claro isolado.** São **2.200 capturas preservadas**, **1.100 comparações Escuras, todas 1.100 exatas**, e **58.161 verificações de contraste Claro aprovadas**, sem exceção nova de conteúdo ou uso de tolerância raster. Os três motores foram exercitados em desktop e mobile nas quatro variantes. O código dos consumidores, CSS e fixtures de cada manifesto foi conferido com a versão final.

| Bateria | Capturas | Paridades / exatas | Contrastes Claro | Resultado |
| --- | ---: | ---: | ---: | --- |
| Cartões/histórico: 19 cenários | 936 | 468 / 468 | 16309 | PASS |
| Pagamentos/confirmações/erros | 360 | 180 / 180 | 2418 | PASS |
| Compra/parcelas/estorno/encaminhamento | 240 | 120 / 120 | 3915 | PASS |
| Ciclos/validações/auditoria longa | 304 | 152 / 152 | 33107 | PASS |
| Gráfico/teclado/foco/nativos/bloqueios | 288 | 144 / 144 | 1962 | PASS |
| Diagnósticos com avisos/configuração | 72 | 36 / 36 | 450 | PASS |

Mínimos computados: **5,122:1 para texto/campos** e **3,567:1 para elementos essenciais/foco**. A bateria inclui valores positivos/negativos/zero, dívida/disponibilidade, barras e seleção, hover, foco, controles desabilitados, campos monetários/data, overlays, listas longas e validações. Nenhum overflow horizontal do documento, erro JavaScript não tratado ou requisição remota. As tabelas/modais preservam seu rolamento interno.

Na matriz abaixo, os três PASS de cada linha abrangem os motores legado, V2 e novo; as colunas visuais incluem desktop/mobile, Escuro/Claro e comparação main/revisado. Equivalência significa igualdade de payloads/resultados, valores em centavos, datas, competências, totais, saldos e limites entre variantes — não correção retrospectiva de dados legados.

| Cenário | Visual/contraste | Financeiro | Legado/V2/novo |
| --- | --- | --- | --- |
| 1. Fatura aberta com compras e parcelas | PASS | PASS | PASS |
| 2. Fatura fechada não paga | PASS | PASS | PASS |
| 3. Fatura integralmente paga | PASS | PASS | PASS |
| 4. Pagamento parcial antes do vencimento | PASS | PASS | PASS |
| 5. Segundo pagamento que quita o restante | PASS | PASS | PASS |
| 6. Pagamento após o vencimento | PASS | PASS | PASS |
| 7. Vencimento nominal em fim de semana | PASS | PASS | PASS |
| 8. Estorno antes e após o fechamento | PASS | PASS | PASS |
| 9. Parcelas futuras atravessando competências | PASS | PASS | PASS |
| 10. Competência histórica legada inconsistente | PASS | PASS | PASS |
| 11. Cartão sem lançamentos | PASS | PASS | PASS |
| 12. Múltiplos cartões e limites distintos | PASS | PASS | PASS |
| 13. Disponibilidade negativa/insuficiente | PASS | PASS | PASS |
| 14. Confirmação de fatura já paga e desfazer | PASS | PASS | PASS |
| 15. Cancelamento de pagamento sem gravação | PASS | PASS | PASS |
| 16. Erro de leitura/autorização/persistência e retry | PASS | PASS | PASS |

A entrada manual também **gravou sinteticamente** três parcelas cuja soma é -12.345 centavos e um estorno de +12.345 centavos, comparando os payloads completos. O cancelamento das três modalidades não grava. O segundo pagamento gera pernas opostas de 6.000 centavos e zera o saldo da competência; confirmação externa de quitação e desfazer preservam a ausência de novas linhas financeiras. Erro/latência de persistência, formulário preservado e retry são reproduzidos por transporte em memória, sem alegar validação do backend real.

Foram aprovadas **228 trocas CSS de ida/volta**, com zero commits React, requisições ou eventos financeiros adicionais e estado financeiro idêntico. A persistência Auth/entre abas do Ciclo 2 não foi modificada nem substituída por esse teste local de pintura. Os sete fingerprints de consumidores e 156 selos financeiros passam; `NewTransactionModal` e os compartilhados foram reutilizados sem alteração neste lote.

**Testes e build:** suíte completa **3.297 testes/204 arquivos PASS**; focal financeira **1.384/94 PASS**; revalidação de aparência após os ajustes finais **85/6 PASS**. TypeScript mantém **14 diagnósticos conhecidos, zero novos**; build/PWA **PASS**, 49 entradas de precache. E864 e regressões financeiras/impressão estão na suíte completa. A confirmação do Quality baseline no commit publicado será registrada na descrição da PR, sem merge ou deploy.

**Impressão:** **36 PDFs/96 páginas PASS**, com dimensões, contagem, texto, valores/datas e raster idênticos nas quatro variantes por cenário/motor. Não houve ajuste de paginação ou de regras de impressão. As exclusões legadas de modais fixos e botões continuam documentadas acima.

**Evidências:** [seis capturas comparativas, resumo e manifestos compactos](evidencias-ciclo-3c/README.md); pacote externo `finelo-ciclo-3c-evidencias.zip`, **247.566.436 bytes**, **3.261 arquivos indexados**. SHA-256 do ZIP: `4ec83dd6dfb045f120b4688a5e303f23c3000ac54228e7bd5882c5ea0407f0de`. Índice SHA-256: `daf2de4cd3bacbc7875db07163cd20b9b75a767b881e86bb690e9abc397ec3ad`. O pacote foi reaberto, com CRC e SHA-256 de cada entrada indexada verificados. Contém todas as capturas, resultados financeiros, PDFs/renderizações/textos, versões do ambiente, logs, snapshots e fontes. Os manifestos originais conservam o hash do harness registrado ao encerrar cada suíte; a evolução de cenários independentes do runner está identificada no README, sem alterar os selos dos consumidores/CSS/fixtures.

Os limites de ambiente e os riscos legados acima permanecem separados do PASS visual. A PR #97 continua em rascunho; nenhum dado financeiro real, coorte, permissão, migration ou ambiente de produção foi alterado. O 3D e a homologação transversal seguem pendentes; este resultado não autoriza publicação geral do Claro.

### Próximo lote 3D

O 3D deve tratar os fluxos completos de conciliação: abertura por competência, diagnóstico versus resolução, estados pendente/resolvido, classificações/vínculos, confirmação, cancelamento, desfazer, permissão/erro e impressão. Exigir fixtures próprias de dois livros e comparação de todos os saldos/payloads; não incorporar correções por apelido sem proposta funcional específica. Depois, concluir a homologação transversal e os consumidores restantes antes de discutir liberação global do Claro. Mantêm-se coorte, flag e possibilidade de rollback visual sem desfazer dados.

Execução proposta, ainda sem implementação/autorização de publicação:

1. Selar `ReconciliationFlow`, `ReconciliationResolutionModal`, seus pontos de entrada em Transações/diagnóstico e `cardReconciliationService`; registrar baselines dos três motores e do ledger de resoluções. A competência deve continuar explícita por prop.
2. Converter apenas apresentação dos estados calculando/pronto/erro/concluído e das opções/valores/fontes autoritativas. Preservar os dois passos: selecionar uma resolução não grava; a confirmação final mantém a mesma intenção/chave de idempotência.
3. Exercitar delta negativo/zero/positivo, cancelamento nos dois passos, resolução ativa, reversão, ausência de permissão, timeout depois de gravar, retry com a mesma chave, concorrência, troca de competência e estado ocupado. Uma mudança de tema não deve recalcular a conciliação ou recriar a intenção; medir as chamadas e a identidade da chave.
4. Exigir paridade Escura nas quatro variantes, contraste Claro/teclado/scroll desktop-mobile, igualdade em centavos dos dois livros e de payloads/resoluções, impressão existente, suítes financeiras/TypeScript/build e pacote verificável. Revisar o 3D antes de qualquer piloto mais amplo; Dashboard, investimentos, plataformas físicas/PWA e demais consumidores continuam em lotes próprios.

## Lote 3D — Conciliação

Base revisada: `04414c742aab9a665afad0aa5f05a16cfe313f14`. A branch remota, main e ancestral comum foram revalidados; main/ancestral continuam `6fa1188b1864e85da587e61c7e46009a5e82adb4`. As comparações usam main, revisado, Escuro e Claro atuais, com relógio/fuso/escala fixos, em 1440×1000 e 390×844. Nenhuma alteração de elegibilidade, autenticação, banco ou produção.

### Inventário, baseline e conversão

| Superfície/contrato | Tratamento 3D |
| --- | --- |
| `ReconciliationFlow` | Tokens para cálculo em andamento, erro/retry, conclusão, lista de resoluções e botões de reversão/ocupado |
| `ReconciliationResolutionModal` | Seleção de alternativas, resumo/sinal da diferença, competência, classificação, consequências, valor oficial/procedência, confirmação, aviso, voltar/cancelar e desabilitados |
| `TransactionsView` | Ponto de entrada real e wrapper existentes, preservados; a chave `${accountId}-${referenceMonth}` remonta o fluxo ao trocar o alvo |
| `AccountBalanceCard` e `CardDiagnosticsModal` | Entradas reais “Ver diferença”/“Conciliação” e diagnóstico reutilizadas do 3C, sem alteração |
| Modal/GlobalDialog, tokens/adaptadores | Reutilizados; foco, teclado, scrim e rolagem existentes, sem nova biblioteca ou geometria |
| `cardReconciliationService`, intenção, opções/resoluções e dois livros | Nenhuma edição; serviço original invocado contra transporte sintético |

Somente os dois primeiros componentes de produto foram editados: atributos `data-finance` e importação do adaptador CSS existente. Classes, strings, dimensões, fórmulas, efeitos e callbacks permanecem iguais. Cinco fingerprints de consumidores, incluindo entradas/chave de montagem, e 156 hashes financeiros foram registrados antes de editar. Os dois livros são expostos pelas superfícies existentes de cartão, diferença e efeitos da classificação; a homologação conserva essas superfícies e compara suas projeções completas, sem acrescentar um painel financeiro novo.

Baseline focal antes da conversão: **1.132 testes/82 arquivos PASS**, TypeScript com **14 diagnósticos conhecidos/zero novos**. A suíte completa inicial teve 3.296 testes aprovados e um timeout de 5 segundos em `productEventsPostgres`, antes das alterações de produto. O arquivo passou isoladamente com seus **18 testes**, sem mudar timeout, teste ou migration. A ocorrência e o reteste estão no pacote. Foram preservadas quatro capturas Escuras anteriores (seleção/confirmação, desktop/mobile), além dos snapshots imutáveis das fontes.

### Segurança das fixtures e invariantes

O cálculo real do servidor é uma fronteira externa: a fixture modela as respostas de `card-reconciliation` e a tabela de resoluções em memória. O frontend usa **ReconciliationFlow, serviço Supabase, classificação de erros, retry e intenção originais**. Os saldos/projeções são calculados pelos módulos originais de dois livros, com fatos sintéticos declarados em centavos. Resolução e reversão são registros distintos; não se apagam fatos ou resoluções originais. O transporte modela a unicidade por chave, inclusive uma gravação antes de devolver timeout. Isso homologa os contratos do frontend; não certifica Edge Function, RLS ou concorrência de banco reais.

A barreira é instalada antes dos imports: URL/chaves fictícias, nenhum login real, storage em memória, BroadcastChannel desativado, rede externa bloqueada e sentinela do storage original conferido. A entrada de diagnóstico exige DEV/staging; não é entrada do build público. Não há alteração de variáveis persistentes do ambiente. IDs/chaves de intenção são determinísticos somente na fixture para comparar payloads, sem registrar tokens/cabeçalhos.

Somente o motor novo habilita a conciliação no produto. Legado e V2 são exercitados nos pontos de entrada reais como controles negativos: sem botão de conciliação e sem chamada de cálculo. Não se força o fluxo nesses motores nem se amplia uma coorte. As fixtures incluem duas contas, competência aberta/fechada, livros com fatos distintos, zero/excedente, resoluções ativas, lista longa, falhas, sessão encerrada, respostas atrasadas e troca de alvo. O delta negativo é uma resposta histórica inconsistente de defesa: o domínio atual não o produz como diferença acionável; a UI o apresenta sem corrigir/reclassificar os fatos.

Asserções automatizadas comparam payloads, chaves, quantidade de registros, projeções em centavos, competências e datas entre as quatro variantes. Selecionar uma opção não gera chave nem gravação; os cancelamentos anteriores à confirmação final conservam os saldos. Uma operação já enviada continua sujeita à resposta do serviço se o usuário fechar a janela: fechar a apresentação não equivale a cancelar uma gravação no servidor. A troca CSS é medida com Profiler/contadores em etapas de seleção, confirmação e processamento, sem recálculo, requisição ou nova intenção.

### Resultado final e matrizes 3D

**Conversão visual concluída para revisão, com limitações anteriores de feedback registradas abaixo.** Preservadas **320 capturas**, **160 comparações Escuras, todas exatas**, e **1.066 verificações de contraste Claro aprovadas**. Sem tolerância raster, nova exceção de conteúdo Escuro, overflow horizontal do documento, erro JavaScript não tratado ou requisição externa. O scroll interno anterior foi preservado.

| Bateria | Capturas | Paridades / exatas | Contrastes Claro | Pintura/financeiro |
| --- | ---: | ---: | ---: | --- |
| Estados, validações, nativos e listas | 144 | 72 / 72 | 552 | PASS |
| Classificar, confirmar, retry e reverter | 136 | 68 / 68 | 334 | PASS |
| Alvo, latência, sessão e foco | 24 | 12 / 12 | 104 | PASS |
| Entradas reais e gates dos motores | 16 | 8 / 8 | 76 | PASS |

Mínimos computados: **5,122:1 texto/campos** e **4,397:1 elementos essenciais/foco**. Verificados hover, foco, seleção, desabilitado, campos monetários/procedência, carregamento, erros, aviso, confirmação, resultado, listas longas e modais encadeados. A diferença continua identificada por texto e sinal; excedente não recebe significado econômico apenas por sua cor. Loop Tab/Shift+Tab, Escape e restituição de foco usam o Modal existente.

| Invariante financeira/segurança | Resultado | Evidência automatizada |
| --- | --- | --- |
| 1. Competência explícita | PASS | Payload preserva conta/mês; zero edição do serviço/props |
| 2. Selecionar não grava | PASS | Primeiro passo sem POST de resolução nem criação de chave |
| 3. Confirmação mantém intenção | PASS | Payload usa a chave única criada ao confirmar |
| 4. Retry sem duplicar | PASS | Recusa antes de gravar e retry com a mesma chave; uma linha |
| 5. Timeout após gravar | PASS | Uma resolução após retry automático; dois timeouts também mantêm uma linha |
| 6. Cancelar sem efeito financeiro | PASS | Cancelar na seleção ou fechar antes da confirmação conserva estado/ledger |
| 7. Desfazer preserva contrato | PASS | Nova reversão, resolução original mantida; recusa não grava |
| 8. Tema sem operações extras | PASS | 64 trocas CSS com zero render React, chamadas, eventos e intenções adicionais |
| 9. Novo alvo sem estado antigo | PASS | Troca conta/mês remonta; resposta velha não substitui alvo novo; chave nova |
| 10. Autorização preservada | PASS | Falha no cálculo e sessão encerrada não geram resolução; legado/V2 sem acesso |

Os cenários cobrem diferença positiva/negativa/zero, livros distintos, competência com vencimento futuro ou anterior, resolução disponível/sem diferença, confirmação intermediária/final, valor oficial válido/inválido e procedência, cancelamento nos dois passos, recusa antes de gravar, timeout após gravar, retry automático com mesma chave, dois timeouts e recálculo, clique repetido durante envio, reversão permitida/recusada, resposta antiga após trocar alvo, troca durante gravação, dados legados inconsistentes, autorização negada e sessão encerrada. Payloads e resultados completos são iguais entre variantes; somente o motor novo tem o fluxo habilitado, com os dois gates negativos testados na aplicação real.

**A matriz de feedback tem ressalvas próprias:** a mensagem de reversão recusada e a de incerteza após dois timeouts/recálculo são **FAIL de feedback preexistente**, nas quatro variantes; o bloqueio, a chave e a ausência de duplicação são PASS financeiros. A linha de valor/procedência em mobile é **limitação de layout anterior**, com acesso por foco/scroll preservado. Não se atribui PASS a feedback inexistente nem se altera o Escuro para ocultar a diferença.

**Testes finais:** **3.303 testes/205 arquivos PASS** na suíte local completa, incluindo E864/regressões financeiras; **1.138/83 PASS** na focal de cartões/conciliação/aparência; **91/7 PASS** de aparência após a conversão. TypeScript: **14 diagnósticos conhecidos, zero novos**. Build/PWA: **PASS**, 49 entradas de precache. Os cinco fingerprints e 156 selos financeiros passam. O CI do commit enviado será registrado na PR com sua contagem própria; fixtures privadas locais não são publicadas para igualar números.

**Impressão: 16 PDFs/32 páginas PASS**, pelos pontos de entrada reais em pendente, confirmação, resolvido e revertido. Contagem, dimensões, texto, valores e raster idênticos entre main/revisado/Escuro/Claro por estado, sem alterar regras de impressão. O contrato anterior exclui modais fixos; o PDF conserva a aplicação financeira existente atrás deles, e não passa a criar um relatório de resoluções. A impressão não muda projeções, linhas ou chamadas.

**Reprodução:** preparar `theme-reconciliation-main-baseline` e `theme-reconciliation-reviewed-baseline` com `prepare-financial-baseline.py --base <SHA> --target-name <nome>` usando os SHAs acima; iniciar `serve-card-preview.ps1 -Port 5204`. Com Edge, Python/Playwright e PyMuPDF, executar `validate-reconciliation-themes.py --port 5204 --themes all --suite <states|operations|isolation|entry> --out-dir <pasta>` e `validate-reconciliation-print.py --port 5204 --out-dir <pasta>`. Não usar uma sessão real ou um endpoint de produção. O README de evidências registra a evolução independente do runner.

**Evidências:** [seis PNGs e manifestos compactos](evidencias-ciclo-3d/README.md). Pacote externo `finelo-ciclo-3d-evidencias.zip`, **15.758.290 bytes**, **1.171 arquivos indexados**; ZIP reaberto com CRC e todos os hashes conferidos. SHA-256: `3acc716fbc83fe9939e2d8dbb37a11b416ce63ad3f658c7640afba414d726445`. SHA-256 do índice: `4650709af545f917b25a55a746a908d18b2ca6beedc432a309491bc2bea97899`. O conjunto prioriza estados distintos, evitando repetir as 2.200 capturas do 3C; os dados completos de cada operação permanecem disponíveis no ZIP.

### Limitações anteriores preservadas

| Limitação | Evidência e decisão |
| --- | --- |
| Linha valor oficial/procedência em 390 px | O input e select excedem a largura interna; requer rolagem horizontal do corpo, sem overflow do documento. O foco/scroll permite alcançar ambos. Geometria preexistente preservada e capturada nos dois temas |
| Aviso de reversão recusada | A reversão é bloqueada e não grava; o aviso do serviço fica no estado da intenção, mas a etapa de seleção/zero não o desenha. Falha anterior de feedback, preservada para deliberação posterior |
| Dois timeouts após gravação | O retry usa a mesma chave e existe só uma resolução. O recálculo mostra o estado real; quando a diferença zera, a etapa zero não exibe o aviso de incerteza. Falha anterior de feedback, preservada, sem criar exceção de conteúdo Escuro |

Essas limitações não são tratadas como tolerância de raster ou como novos comportamentos aprovados. A paridade e os efeitos financeiros são comparados separadamente da completude do feedback; os JSONs conservam os indicadores correspondentes em cada variante. A correção do feedback/geometria exigirá deliberação específica. Não foi iniciada investigação funcional paralela de `Nome_Fantasia`/apelido, OFX, consentimento secundário Open Finance ou competências históricas; esses riscos permanecem na lista anterior, sem alteração.

### Próximo ciclo e homologação transversal

1. **Dashboard:** inventariar cards, filtros, tooltips, eixos, legendas, séries positivas/negativas/zero, vazios/erros, seleção de titular e exportações. Selar cálculos e fontes; converter pintura com tokens/cores funcionais distinguíveis por texto ou símbolo; exigir quatro variantes, contraste, desktop/mobile e PDF.
2. **Investimentos e patrimônio:** inventariar carteiras, ativos, detalhes/edição/classificação, importação específica, titular/família e estados longos. Preservar preços, rentabilidade, agrupamento, impostos, parsers, arredondamentos e permissões; usar fixtures sintéticas com payloads e resultados selados.
3. **Demais superfícies:** mapear Settings remanescente, páginas auxiliares, administrativo, mensagens e rotas menos frequentes. O Claro global continua bloqueado enquanto houver consumidores sem homologação; proteger o Escuro por paridade e flag desligada.
4. **Transversal:** Safari/iOS/Android físicos, PWA instalada/offline/reconexão, leitor de tela, zoom, alto contraste, controles/popups nativos e impressão longa. Os viewports Edge desta bateria não substituem essas plataformas. Resolver as limitações de feedback acima em tarefa delimitada, antes de deliberar sobre piloto mais amplo/publicação.

Não há merge, deploy ou autorização de liberação geral decorrentes deste lote. Rollback da pintura não exige desfazer resoluções ou pagamentos: nenhum formato, serviço, banco ou preferência financeira foi modificado.
