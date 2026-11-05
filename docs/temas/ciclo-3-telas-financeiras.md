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
