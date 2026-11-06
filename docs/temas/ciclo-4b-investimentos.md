# Ciclo 4B — Investimentos e Patrimônio associado

## Escopo e referências

Continuação da PR #97, branch `codex/finelo-theme-foundation`, a partir do aprovado `06af063fb8dca519131bbabcbfeaec9ca0938d96`. Main e ancestral comum confirmados antes da edição: `6fa1188b1864e85da587e61c7e46009a5e82adb4`. As duas referências foram extraídas do Git, com manifestos SHA-256, antes de converter a interface. O teste focal anterior à edição passou em **382 casos / 22 arquivos**.

Este lote trata apresentação e acessibilidade. Não houve alteração de serviços, parsers, consultas financeiras, fórmulas, arredondamentos, RLS, persistência, flags ou elegibilidade. O aplicativo continua Escuro; o Claro permanece no ambiente isolado de diagnóstico. Não houve merge, deploy em produção, migration ou operação em dados reais.

## Inventário e arquitetura

| Área | Consumidores e cobertura |
| --- | --- |
| Entrada legado/V2 | `InvestmentsView`: período, carregamento, erro/recuperação, total, lista desktop/mobile, vazio, instituição, cópia, inclusão/edição/exclusão e importação |
| Entrada manual/arquivo | `InvestmentModal`, `InvestmentImportModal`: rótulos associados, valores/principal, datas/taxas, seleção e leitura de Excel, prévia, conferência, bloqueio, duplicidade e persistência |
| Estrutura V2 | `PortfolioShelf`, `PortfolioManagerDrawer`, `PortfolioFormModal`, `ClassifyInvestmentModal`, `ClassificationBadge`: seleção, carteiras arquivadas, ativo lógico, classificação/movimentação, cancelamento, confirmações e erros |
| Visão financeira | `PortfolioSummary`, `PortfolioAllocation`, `PortfolioConcentration`, `PortfolioHistoryChart`, `PortfolioMaturities`, `PortfolioInsightsNarrative`, `InvestmentBalanceDisplay` |
| Titularidade | `InvestmentOwnerSelector` reutiliza `OwnerScopeControl`; o seletor não possui opção de consolidação familiar. O consolidado é exercitado no Dashboard real associado, sem inventar uma agregação em Investimentos |
| Bens | Somente seção `settings-manage-assets` de `SettingsView`, com `CrudCard`; `AssetModal` e `AssetDetailModal`: quitado, financiamento, consórcio, dívida, equity, amortização e progresso |
| Patrimônio compartilhado | Reuso de `DashboardView`, `CurrentNetWorthPanel`, `CurrentNetWorthCard`, `NetWorthSummaryCard` e `OwnerScopeNetWorthNote`, já convertidos em 4A |
| Infraestrutura | `investments.css`, `InvestmentAppearanceBridge`; reuso dos tokens e adaptadores financeiros existentes, Modal, GlobalDialog, campos, controles e overlays |

O legado mantém `investment_portfolios_enabled=false` e não consulta tabelas de carteiras/ativos lógicos. V2 acrescenta organização e seleção de outro titular autorizado. Essa seleção permite organizar carteiras/classificar posições conforme a regra anterior; lançamento, importação, edição e exclusão permanecem com o titular. O bloqueio Wealth é mantido.

As classes Escuras, atributos e coordenadas SVG, dimensões e estilos inline anteriores continuam protegidos. `investments.css` contém pintura sob `@media screen`, restrita ao Claro, e regras delimitadas de acessibilidade para foco/hover/dismissão. Não há inversão, filtro ou substituição indiscriminada de Tailwind. A variação do saldo segue **neutra**: inclui aportes, resgates e oscilações e não representa rentabilidade. Alocações conservam rótulos, percentuais e quantidades explícitos; não se introduziu uma legenda dependente exclusivamente de cor.

## Proteção financeira e decisão de sessão

Os contratos anteriores à edição protegem **25 consumidores** por fingerprint AST e **160 arquivos** por SHA-256 normalizado. Incluem cálculo de posições, patrimônio, evolução, vencimento, classificação, serviços, parser XP, import session, mensagens, tipos e cliente Supabase. O contrato adicional do `MainLayout` parte do arquivo imutável de `06af063` e permite **somente** a alteração autorizada da chave de Investimentos.

### Exceção explicitamente autorizada pelo usuário

Antes da conversão, main e baseline revisado reproduziram um FAIL de privacidade: abrir a edição de A e substituir diretamente a sessão autenticada por C preservava o nome do produto de A no formulário de C. Logout com usuário nulo desmontava a rota e passava; a substituição direta entre usuários não nulos mantinha o estado local da tela. Trocas de titular e respostas atrasadas das listas passavam nas duas referências.

O usuário respondeu **“Autorizar a guarda visual por sessão”**. A correção foi limitada a `investments: <InvestmentsView key={user?.id} />` no `MainLayout`. Uma mudança de conta recria a tela e seus modais; trocar tema ou titular autorizado não muda essa chave. Não se alteraram Auth, RLS, serviços, consultas ou a autorização das operações. A exceção de paridade é a remoção do conteúdo inválido da sessão anterior, não uma tolerância de rasterização. A guarda não pretende cancelar operações remotas já iniciadas.

`InvestmentAppearanceBridge` atua apenas no DOM: descrição dos hints, foco inicial/retorno, Tab delimitado nos diálogos existentes, Escape, hover persistente e ativação por teclado do seletor de arquivo. Não importa store ou serviço financeiro. Os campos de investimento recebem associação entre rótulo e controle.

## Método de homologação

Fixtures sintéticas usam SDK, store, componentes, cálculos, parser e handlers originais, com URL/chave fictícias, storage em memória e transporte fechado antes dos imports. Uma barreira adicional de navegador permite apenas loopback. POST/PATCH/DELETE do serviço original afetam somente arrays em memória. A simulação de permissões não substitui a validação das políticas SQL da suíte existente; nenhuma sessão, credencial ou conta de produção foi utilizada.

Referências: main, baseline revisado, Escuro atual e Claro atual; desktop **1440×1000**, mobile **390×844**, Edge, fuso America/Sao_Paulo e relógio fixo em 05/11/2026. Dados, dimensões e ações são iguais por cenário. A seção de bens é isolada somente no roteiro de diagnóstico; Configurações gerais não participa da conversão nem da alegação de Claro homologado.

Cada estado registra props financeiras reais, centavos, banco sintético, payloads, IDs, datas, ownership e fontes. O perfil React e os contadores de requests/eventos antes/depois da troca CSS devem permanecer idênticos. As corridas registram **cada commit React**, incluindo renders intermediários e campos de formulário visíveis.

Para paridade, são comparados conteúdo, geometria, cores computadas e pintura SVG, antes do raster. IDs transitórios de gradientes React são normalizados exclusivamente nas referências de IDs. Não há máscara de pixels. A tolerância herdada de 3A limita delta de canal a 2 e pixels a `max(20, floor(área×0,0001))`, sempre condicionada à igualdade das verificações anteriores. Foco, modalidade de teclado e ponteiro são explicitamente igualados, e camadas do compositor são recriadas/restauradas somente durante o diagnóstico, sem mudança de CSS final.

## Matrizes e evidências

**PASS de conversão visual e equivalência financeira, com as limitações legadas explicitadas abaixo.** Foram registradas **904 capturas de interface**: 216 main, 216 revisadas e 236 em cada tema atual. Há **424 comparações Escuras**: 422 rasters exatos e dois ruídos de 10 e 20 pixels, delta máximo 1, dentro do limite já aprovado; conteúdo, geometria, cores computadas e SVG são iguais. Nenhuma tolerância foi ampliada.

**656 comparações financeiras PASS**: 636 entre as quatro referências e 20 entre temas atuais nos estados adicionais de teclado. Comparam props reais, valores brutos e centavos, datas, IDs, ownership, banco e payloads. As 16 capturas da troca direta de sessão são analisadas pela regressão de privacidade, separadamente da paridade do estado inválido anterior. Foram medidos **904 roundtrips CSS**, dos quais **472 nas variantes atuais**, com zero commits React, consultas, gravações ou eventos adicionais; sem render React, os cálculos de render não são reexecutados.

| Fixture / fluxo | Legado | V2 | Evidência financeira e visual |
| --- | --- | --- | --- |
| Vazio / uma posição | PASS | PASS | Sem soma fictícia; totais e quantidades nas quatro referências |
| Múltiplas carteiras, classes e instituições | PASS | PASS | Mesmos saldos, agrupamentos, IDs e percentuais; carteiras somente em V2 |
| Positivo, negativo e zero | PASS | PASS | Sinal, centavos, total e apresentação neutra preservados; zero manual bloqueado pela validação nativa existente |
| História de 12 meses | PASS | PASS | Mesmos buckets, saldo, delta e traçado SVG |
| História incompleta / última posição anterior | PASS | PASS | Lacunas e aviso de mês anterior mantidos, sem preenchimento inventado |
| Vencido, dentro de 90 dias e futuro | PASS | PASS | Datas 10/10/2026, 15/12/2026 e 10/05/2027; mesma agenda e contagens |
| Aporte e resgate representados nos snapshots | PASS | PASS | Cenário `flows` altera saldos nominais; não cria rentabilidade nem ledger de aportes inexistente neste módulo |
| Sem classificação / dados legados | PASS | PASS | Sem associação implícita; legado não consulta tabelas V2 |
| Classificar / mover / desfazer / cancelar | n/a | PASS | Serviços originais, payloads e resultado idênticos; cancelar não grava |
| Criar / renomear carteira; criar ativo lógico | n/a | PASS | Mesmo owner, IDs, auditoria, limites e payloads |
| Arquivar / desarquivar / confirmar / cancelar | n/a | PASS | Aviso original e cancelamento sem gravação |
| Inclusão e edição manual / erro de gravação | PASS | PASS | Mesmo payload, datas e valores; erro mantém o formulário e cancelar não persiste |
| Excel válido, vazio, inválido e corrompido | PASS | PASS | Parser XP real; três posições válidas somam **1.713.597 centavos**; demais casos não gravam |
| Reimportação duplicada / erro de persistência | PASS | PASS | Um único POST válido; bloqueio de arquivo já importado e recusas sem inserção parcial |
| Leitura / persistência / interrupção | PASS | PASS | File.arrayBuffer e transporte apenas atrasados, sem substituir parser/serviço; controles desabilitados, nenhuma escrita prematura; troca de conta durante leitura não reabre dados antigos |
| Bens: quitado / financiamento / consórcio | PASS | PASS | Mesmos valores brutos, dívida, equity, amortização e payload de edição |
| Lista longa / mobile | PASS com ressalva | PASS com ressalva | 35 linhas adicionais e mesmas geometrias; overflow anterior de 18 px preservado |
| Erro e recuperação | PASS de paridade | PASS de paridade | Recusa, alerta já existente, retry/período e resultados equivalentes; feedback de primeira carga tem o FAIL legado descrito abaixo |

### Titulares e sessão

| Cenário | Main / revisada | Escuro / Claro atuais |
| --- | --- | --- |
| Autenticado e outro titular autorizado | PASS | PASS; lançamento/importação/edição/exclusão indisponíveis no titular alheio |
| Sem permissão e recusa de escrita | PASS | PASS; transporte fechado recusa; políticas SQL reais também cobertas nos testes PGlite |
| Família consolidada | PASS | PASS no Dashboard associado: **22.505.001 centavos**, incluindo **1.505.001** em investimentos e **21.000.000** em bens líquidos |
| Trocar titular carregando / resposta anterior atrasada | PASS em todos os renders | PASS em todos os renders |
| Logout nulo e login C | PASS | PASS sem posições nem campos de A |
| Substituição direta A → C com edição ou importação | **FAIL anterior, 8 de 12 casos por referência** | **PASS** após guarda autorizada; nenhum diálogo da sessão anterior |
| Substituição direta com classificação / drawer | PASS nas referências | PASS; guarda uniforme de toda a tela |
| Renovar objeto do usuário com o mesmo ID | Mantém a tela | PASS; modal permanece, chave estável |
| Alternar apenas pintura com dados carregados | Sem trabalho financeiro | PASS: 472 verificações nas variantes atuais |

O teste ampliado cobre 12 combinações de modal/motor/viewport por variante. As referências antigas registram 131 renders com conteúdo indevido em edição/importação; as duas variantes atuais não registram nenhum. Os traces completos incluem linhas, ownership, campos, diálogos e rótulos visíveis em cada commit. A interrupção do parser acrescenta oito verificações entre contas nos temas atuais.

### Contraste, teclado e responsividade

**37.148 amostras de contraste Claro PASS**, **1.348 observações distintas**. Mínimos: **4,936:1** em texto/campos/placeholder e **3,567:1** em elementos essenciais, bordas e foco. As amostras incluem repetições por estado; não são 36 mil elementos distintos. Campos e botões desabilitados são medidos mesmo quando a norma permitiria exceção.

PASS de foco inicial/retorno, Tab/Shift+Tab delimitados, Escape com foco preservado, dismissão também em hover sem foco, hover sobre o popup, navegação do gráfico por teclado, campo de data e seleção de arquivo por Enter. O nome acessível do upload deriva da instrução visível; Cancelar conserva seu nome, e os botões de período e os ícones mobile possuem nomes. Comparações usam âncora e popup dentro da mesma área visível, sem reposicionar componentes do produto.

O detector Impeccable foi executado: sete avisos de estilo anteriores (bordas/spinners, texto em gradiente e paleta da tela de bloqueio). As classes originais permanecem por exigência de paridade; o Claro recebe tokens e o título recebe cor sólida. Não se aceitou redesenho por causa desses avisos.

### Testes e CI

- **Suíte completa: 3.356 testes / 207 arquivos PASS**, execução final de 1.162,73 s.
- **Focal Investimentos/Patrimônio/aparência: 526 / 31 PASS**; validação final de contratos e nomes acessíveis: **206 / 12 PASS**.
- **25 contratos AST + contrato delimitado do MainLayout e 160 selos financeiros PASS**; 28 testes específicos do 4B.
- **TypeScript: 14 diagnósticos conhecidos, nenhum novo. Build/PWA PASS, 49 entradas** de precache.
- A primeira execução completa detectou um contrato antigo de 3B que não aceitava o novo import CSS de Settings. A allowlist foi estendida somente nesse consumidor; o hash original foi preservado. A suíte completa foi reexecutada e passou.
- [Quality baseline do checkpoint de código `d39ecd3`: PASS](https://github.com/CassMach13/FinElo/actions/runs/42146424373). CI: **3.336 testes / 206 arquivos PASS e um teste/arquivo ignorado**, 207 arquivos ao todo; TypeScript e build aprovados. Os 20 casos locais adicionais pertencem a fixtures privadas anteriores (um CSV e 19 casos parametrizados XP), ausentes do Git e do pacote. O último commit da PR recebe nova execução completa; seu resultado exato fica na descrição da [PR #97](https://github.com/CassMach13/FinElo/pull/97).

### Pacote verificável

Índice, métricas e capturas representativas: [evidencias-ciclo-4b](./evidencias-ciclo-4b). O pacote externo local `finelo-ciclo-4b-evidencias.zip` contém **130,453,436 bytes**, **2409 arquivos indexados** e **985 referências de imagem**, deduplicadas em **443 PNGs**: 904 capturas UI, 68 rasters de páginas PDF e 13 capturas anteriores à edição. Inclui fontes main/revisadas/atuais, contratos, payloads, traces, audits, planilhas sintéticas, PDFs, logs, versões e reprodução. Não inclui CSVs/extratos privados ou credenciais.

- SHA-256 do ZIP: `0275285f00cfbb1d41c8377581a0245ac8cfa62dd7da0e9f7632ba22f0d55fd1`.
- SHA-256 do índice: `2e279e47d679ff204d4441baad131b4d0a909b051022d0c9128b61385c551e35`.
- ZIP CRC e SHA-256 de **todos** os arquivos indexados verificados na leitura posterior à gravação.

O Git recebe somente seis PNGs representativos, métricas e hashes. O pacote completo fica fora do repositório, anexado à entrega local.

## Impressão e PDF

**PASS: 16 PDFs / 68 páginas.** Posições legado, posições V2, histórico incompleto V2 e detalhe de financiamento, nas quatro referências. As 12 comparações com a main preservaram número de páginas, dimensões, texto extraído, valores/datas e SHA do raster de todas as páginas. A pintura nova é exclusiva de tela. A impressão existente não foi redesenhada.

## Limitações anteriores e limites da evidência

- O corpo da página de Investimentos pode exceder a largura mobile em **18 px a 390 px**, também na main e no baseline. Não houve alteração de geometria para corrigir esse comportamento anterior.
- **FAIL de feedback legado:** um erro na primeira carga pode manter o estado de carregamento sem mostrar o aviso reservado a um resultado já carregado. A recuperação por mudança de período é exercitada; não foi incluída uma correção funcional de feedback legado.
- O cálculo de amortização pode mostrar principal negativo com entradas sintéticas incompatíveis entre taxa, parcela e saldo. Os valores anteriores são preservados e comparados; este lote não valida nem corrige a regra de financiamento.
- Contraste deficiente do Escuro anterior é registrado, não aprovado pela paridade. A obrigação de legibilidade do Claro é medida separadamente.
- Viewport mobile no Edge não equivale a validação física Android/iOS, Safari, PWA instalada ou leitor de tela humano. A simulação offline não certifica Auth/RLS de um ambiente remoto.
- Os fluxos de importação mantêm suas regras anteriores: datas interpretadas pelo parser, bloqueio por arquivo/mês, possibilidade de selecionar novamente durante leitura e bloqueios dos botões existentes. Não se alteraram cálculos ou deduplicação.

## Situação final

Ciclo 4B concluído para revisão, com as limitações anteriores discriminadas. PR #97 permanece em rascunho; a execução final de CI é vinculada na descrição da PR. O Claro global continua bloqueado. Nenhum merge, deploy de produção, migration ou ampliação de coorte foi realizado.

## Plano do Ciclo 4C

1. Inventariar os consumidores ainda escuros fora dos lotes aprovados; definir separadamente Metas e Configurações gerais, assinaturas e páginas públicas. Não ampliar este lote retrospectivamente.
2. Homologar aparelhos físicos, Safari/iOS, Android, instalação/retorno offline PWA, leitor de tela e preferência de movimento/contraste. Verificar controles nativos e impressão física.
3. Deliberar os problemas legados documentados (overflow mobile, feedback de primeira carga, dados de amortização e avisos dos ciclos anteriores) em tarefas próprias, com autorização e regressões específicas.
4. Só após cobertura integral, piloto controlado com contas autorizadas de staging, comparação de Escuro, rollback por flag e monitoramento de acessibilidade. Publicação geral exige autorização posterior do usuário.

## Reprodução

Preparar `theme-investments-main-baseline` e `theme-investments-reviewed-baseline` com `scripts/diagnostics/prepare-financial-baseline.py --base <SHA> --target-name <nome>`. Iniciar `serve-card-preview.ps1 -Port 5206` (somente ambiente fictício local). Gerar arquivos com `node scripts/diagnostics/investment-workbooks.mjs`.

Executar `investment-validate-themes.py --phase core|states|assets|security|all`, `investment-validate-operations.py`, `investment-recapture-focus.py`, `investment-validate-classification-undo.py`, `investment-validate-hover.py`, `investment-validate-loading.py`, `investment-validate-session-a11y.py`, `investment-validate-print.py` e `investment-compare-evidence.py`. Os roteiros aceitam `--out`; a validação de tela também aceita `--variant`. Playwright/Edge e PyMuPDF são ferramentas temporárias de diagnóstico, sem nova dependência da aplicação. Fontes, manifestos, versões, logs e instruções completas acompanham o pacote verificável.
