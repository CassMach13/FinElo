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
