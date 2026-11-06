# FinElo · Auditoria e plano de temas

## Objetivo

Quem usa o FinElo por muitas horas poderá escolher **Escuro**, **Claro** ou **Automático** em Configurações. A mesma aplicação preservará marca, tipografia, geometria, espaçamentos, ordem de leitura e comportamento. Escuro continua sendo a primeira apresentação para quem nunca escolheu um tema.

A auditoria usou a `main` em `6fa1188b1864e85da587e61c7e46009a5e82adb4`. O escopo recomendado para o piloto é toda a área autenticada, inclusive estados vazios, erros, bloqueios de plano, ajuda e administração. Landing, login, recuperação e páginas públicas conservam sua apresentação neste projeto. A decisão mantém o tema ligado à conta e evita aplicar uma preferência pessoal antes da sessão. As duas capturas sintéticas existentes de Patrimônio foram inspecionadas como referência de apresentação, sem tratá-las como uma nova captura da revisão auditada.

## Fase 0 · Inventário e fontes

**Como esta fase serve ao objetivo.** Localiza os pontos onde cor tem papel visual, estrutural ou de classificação, para que a mudança preserve o produto e o Escuro.

Dos 271 arquivos versionados inspecionados, 107 contêm candidatos. Há 4.223 ocorrências de utilitários fixos do Tailwind, 656 referências a cores nomeadas, 11 classes de cor arbitrárias e 129 literais hex/RGB/HSL. São contagens de texto, com possíveis sobreposições. O [inventário por arquivo](inventario-estilos.md) registra metodologia, frequência e lista completa de candidatos.

| Evidência | Impacto para o tema |
| --- | --- |
| [Tailwind](../../tailwind.config.cjs) define `primary #1A202C`, `secondary #2D3748`, `accent #38B2AC`, `highlight #4299E1`, `light #F7FAFC`, `dark-text #E2E8F0` e `danger #F56565`. [CSS](../../src/index.css) usa `bg-secondary text-light` no body. | Os nomes atuais não distinguem texto, preenchimento, foco e estado. O mesmo nome pode aparecer em funções com necessidades de contraste diferentes. |
| `text-white` aparece 501 vezes e `border-white/10`, 168. As variantes de [Button](../../src/components/ui/Button.tsx) combinam texto branco, ciano/azul, sombras e foco. [Card](../../src/components/ui/Card.tsx) tem transparência e brilho sobre fundo escuro. | Texto branco tanto pode ser conteúdo comum como texto sobre ação. Transparência precisa ser medida sobre o fundo real. Uma substituição global faria os dois casos parecerem iguais. |
| [Faturas](../../src/components/modals/CreditCardInvoiceCyclesModal.tsx) têm 821 ocorrências fixas. [Transações](../../src/components/views/TransactionsView.tsx) têm 408 e [Importação](../../src/components/views/ImportView.tsx), 300. | Maior risco em estados financeiros, tabelas, abas, seleção, conciliação e fluxos longos com modais sucessivos. |
| [MainLayout](../../src/layouts/MainLayout.tsx), [Modal](../../src/components/ui/Modal.tsx), [GlobalDialog](../../src/components/ui/GlobalDialog.tsx), [Input](../../src/components/ui/Input.tsx) e [Select](../../src/components/ui/Select.tsx) concentram estilos reutilizados. | São bons pontos de conversão. Também existem controles diretos e painéis próprios, como os de Investimentos, que precisam de verificação independente. |
| [Patrimônio](../../docs/net-worth-components-v2/visual-refinement/README.md) já combina rótulo, sinal, valor e cor. [Gráficos](../../src/components/charts/AnnualEvolutionChart.tsx) combinam SVG, cores e interação. Também há barras feitas com HTML/CSS. | Preserve a semântica financeira por rótulo, sinal, legenda e forma. Separe paleta de UI de cores de dados, de bancos, de logotipos e de categorias definidas pelo usuário. |
| [Impressão](../../src/index.css) usa seletores de cor para aplicar dimensões, paginação e preenchimento. [PWA](../../vite.config.ts) e [HTML inicial](../../index.html) declaram cores escuras independentes. | O PDF pode mudar só por renomear uma classe. Splash, janela instalada e página têm fontes de cor diferentes. |

A prontidão estrutural para tema é **1/4** na dimensão de theming do Impeccable. Existe uma paleta central, porém há predomínio de cores diretas e o sistema ainda não resolve nem alterna preferências. A varredura mecânica não completou todos os alvos e não foi usada como gate. A auditoria não avaliou conformidade global, performance em execução ou responsividade de todas as telas.

Os pares de referência abaixo usam luminância sRGB, com razão calculada antes do arredondamento. No Escuro, `#94A3B8` sobre `#1A202C` dá 6,36:1. Dois pares a inspecionar em contexto são `#6B7280` sobre `#2D3748` (2,48:1) e branco sobre `#4299E1` (3,05:1). Esses valores são amostras de paleta. Confirme fundo, transparência, fonte e estado computados antes de registrar uma violação de tela. [W3C, contraste de texto](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

**APIs verificadas.** Tailwind 3.4 aceita cores em canais RGB com `<alpha-value>`, mantendo variantes como `/30`. O navegador oferece `matchMedia`, evento `change`, `color-scheme` e `theme-color`. O cliente Auth já persiste preferências com `auth.updateUser({ data })`. O projeto usa Vitest e tem um [harness visual local](../../scripts/diagnostics/validate-net-worth-preview.py) com Playwright Python; Playwright e axe não são dependências declaradas do aplicativo. [Tailwind 3](https://v3.tailwindcss.com/docs/customizing-colors#using-css-variables) · [CSSWG](https://www.w3.org/TR/css-color-adjust-1/) · [WHATWG](https://html.spec.whatwg.org/multipage/semantics.html#meta-theme-color) · [Supabase Auth](https://supabase.com/docs/reference/javascript/auth-updateuser) · [Playwright](https://playwright.dev/docs/test-snapshots)

## Arquitetura proposta

Use um conjunto de propriedades CSS semânticas, com Escuro em `:root` e sobrescritas de Claro em `:root[data-theme="light"]`. Um único resolvedor recebe identidade, disponibilidade do recurso, preferência e modo do sistema. Aplica o tema efetivo no documento antes da primeira pintura da área autenticada. O nível do documento cobre `GlobalDialog`, `ReloadPrompt`, elementos externos e portais futuros. Na saída ou entrada em rota pública, o tema retorna ao padrão antes de pintar a nova superfície.

Os componentes devem consumir nomes por função, como `bg-surface`, `text-content`, `border-control` e `ring-focus`, com utilitários Tailwind para espaçamento, geometria e estados atuais. Para cada papel, extraia o valor escuro do componente existente, incluindo alfa e fundo real. Se dois componentes usam cores diferentes com intenção própria, mantenha papéis ou variações distintas. As sete cores atuais continuam disponíveis durante a transição. Evite remapear `white` ou `slate`, duplicar árvores React ou aplicar filtros à página.

| Escolha | Regra |
| --- | --- |
| Escuro | Aplica Escuro e ignora mudanças no sistema. É o padrão quando a preferência está ausente, inválida ou a função está indisponível. |
| Claro | Aplica Claro na área autenticada. |
| Automático | Aplica a preferência do sistema via `matchMedia('(prefers-color-scheme: dark)')`, escuta mudanças só neste modo e remove o listener ao sair. Sem suporte, usa Escuro. |

O seletor fica em **Configurações → Aparência**, com um grupo de três opções acessível por teclado e feedback de gravação. Persista a escolha, incluindo `system`, em uma chave escalar proposta `user_metadata.appearance_theme`. O modo efetivo é derivado no dispositivo. O Supabase Auth é a fonte da escolha por usuário e dispensa tabela, migration ou mudança de RLS. Evite um segundo cache de preferência na fundação. O carregamento inicial mantém o visual escuro e usa a sessão resolvida pela inicialização atual de [App](../../src/App.tsx), inclusive no fallback offline existente.

[updateUserPreferences](../../src/hooks/useAppStore.ts#L736) aplica o patch local de forma otimista, chama `auth.updateUser` e registra falhas sem informá-las ao chamador ou restaurar a escolha. A fundação deve oferecer um resultado observável ao seletor, preservando o contrato dos chamadores atuais. Recomenda-se estado pendente de aparência separado da sessão, uma gravação por vez por conta e patch com apenas a chave de aparência. Confirme usuário e geração antes da gravação e na resolução. Se falhar, restaure somente a escolha anterior daquela sessão, informe o erro e permita tentar de novo. Uma resposta atrasada não sobrescreve outra conta nem uma escolha posterior. Reconcilie `USER_UPDATED` pelo fluxo atual sem chamar Auth dentro do listener. O sistema e o flag nunca gravam a preferência por conta própria.

A atualização de Auth já pode registrar atividade pelo listener existente. A homologação deve demonstrar que alternar aparência não chama importadores, rotinas financeiras ou consultas de recarga que alterem filtros ou projeções, e não adiciona telemetria. Preserve a árvore montada, abas, scroll, foco e edições abertas.

## Paleta inicial de Claro

| Papel | Proposta | Verificação de referência |
| --- | --- | --- |
| Fundo, superfície, superfície elevada | `#F5F7FA`, `#FFFFFF`, `#FFFFFF` | Distinguir elevação pela borda e sombra já previstas no componente. |
| Superfície alternada e controle em repouso | `#EDF2F7` e `#FFFFFF` | Testar hover, seleção, preenchimento automático e desabilitado. |
| Texto principal, secundário e placeholder | `#172334`, `#526175`, `#5D6B7D` | 15,83:1 principal no branco, 5,88:1 secundário no fundo e 5,43:1 placeholder no branco. |
| Borda decorativa e borda de controle | `#D8E0E8` e `#6B7A8A` | 1,33:1 no branco para a decorativa. A de controle dá 4,40:1 no branco e 4,10:1 no fundo. |
| Ação sólida, hover e texto sobre ação | `#0F766E`, `#115E59`, `#FFFFFF` | 5,47:1 e 7,58:1 nos pares com branco. Onde o botão usa gradiente, preservar tratamento ciano–azul e validar o ponto de menor contraste do gradiente e do hover. |
| Link e foco | `#1D4F91` e `#1D4ED8` | 7,59:1 e 6,24:1 contra o fundo. Verificar foco contra as superfícies adjacentes e sobre ações preenchidas. |
| Sucesso e alerta | `#166534` sobre `#ECFDF3`, `#854D0E` sobre `#FFFBEB` | 6,76:1 e 6,61:1. |
| Erro e informação | `#B42318` sobre `#FEF3F2`, `#1E40AF` sobre `#EFF6FF` | 6,05:1 e 8,01:1. |
| Séries de gráfico | `#0F766E`, `#1D4ED8`, `#7E22CE`, `#92400E`, `#B91C1C` | 5,47:1 a 7,09:1 contra branco. Use rótulos, traços e contornos nos encontros entre séries. |
| Sobreposição | `rgb(15 23 42 / 0.48)` | Candidata a scrim. Avaliar composição de dois modais, bloqueio visual e legibilidade da superfície elevada. |

A paleta é uma proposta de partida. Grades decorativas podem ser mais suaves, enquanto guias, indicadores ou limites necessários para entender valores precisam de contraste suficiente. Em SVG, defina tokens próprios para eixo, grade, tooltip, pontos, série e preenchimento. `AnnualEvolutionChart` e `AnnualEvolutionCard` concatenam `33` e `21` a cores hexadecimais; substitua essas concatenações por canais/alfa ou tokens de preenchimento. Preserve os caminhos, dimensões, interação, tracejado do ano anterior e nomes das séries.

## Riscos e esforço

| Risco | Nível | Controle |
| --- | --- | --- |
| PDF escuro com classes que também governam geometria | Alto | Introduzir marcadores de impressão explícitos antes de migrar classes de tela. Manter o PDF escuro nas três preferências. Reusar [contrato de impressão](../../tests/dashboard/dashboardPrintContract.spec.ts) e comparar PDF real, incluindo texto extraído, páginas e barras. |
| Texto e controles fixos em modais, formulários e estados financeiros | Alto | Converter componentes por papel e revisar todos os consumidores com sobrescritas, modais próprios, menus, portais, backdrop, focos e tooltips. Testar data, mês, hora, autofill, select, checkbox e rádio. Preservar o tratamento atual dos ícones WebKit em Escuro e usar o comportamento claro nativo quando adequado. |
| Gráficos, cores de banco e sinal financeiro | Alto | Separar cor de série, marca e dados. Conferir SVG e barras HTML com zeros, negativos, longas legendas, números grandes, estados sem dados e interação por toque/teclado. |
| PWA instalada, atualização e sessão offline | Médio a alto | Conservar cores de manifesto e splash inicialmente. Atualizar o meta `theme-color` conforme o tema efetivo onde suportado. Testar primeira pintura, retomada, troca de conta, atualização do service worker, Chrome Android instalado e Safari iOS adicionado à tela inicial. |
| Mobile e navegação sobre conteúdo | Alto | Validar cabeçalhos e barras fixas, paisagem, teclado aberto, áreas seguras, rolagem de modais, menus e elementos com foco próximo às bordas. |
| Exposição incompleta ou rollback tardio | Alto | Manter acesso a Claro/Automático desligado enquanto houver uma tela autenticada sem homologação. Testar flag off com escolha salva e versão anterior do PWA. |

Estimativa inicial de **12 a 19 dias de engenharia**, sem contar o período de observação do piloto. Fundação 2–3 dias, compartilhados 2–3, superfícies 4–7, homologação 3–4 e preparação do piloto 1–2. Reestime após obter as primeiras capturas do PDF e das telas de Transações e Faturas. As contagens indicam concentração de trabalho, não horas por ocorrência.

## Fase 1 · Fundação · próxima autorização

**Como esta fase serve ao objetivo.** Entrega o mecanismo de escolha e isola a aparência dos dados, protegendo o Escuro enquanto as superfícies ainda são convertidas.

Mapear os tokens escuros iniciais e criar o resolvedor, o seletor em Configurações e a persistência guardada. Reusar [App](../../src/App.tsx), as guardas de sessão de [useAppStore](../../src/hooks/useAppStore.ts) e o padrão de opt-in de [featureFlagService](../../src/services/featureFlagService.ts). Exercitar Claro numa fixture representativa ou ambiente local de teste. Em ambientes compartilhados, manter a função desligada até a matriz estar completa. Aceite com a tabela de modos coberta por testes, falha de rede visível, conta A e conta B isoladas no mesmo navegador, restauração da preferência e comparação Escuro antes/depois em desktop e mobile. Evitar ler tokens ou metadados diretamente do armazenamento de sessão.

## Fase 2 · Componentes compartilhados

**Como esta fase serve ao objetivo.** Faz a mesma hierarquia visual funcionar nas duas apresentações em todos os fluxos que usam controles comuns.

Converter shell e navegação, Button, Card, SummaryCard, Input, Select, MultiSelect, ProgressBar, Skeleton, alertas, diálogos e overlays globais. Incluir popovers do tour e componentes que definem cores em `className`. Usar uma página de prova com estados normal, hover, foco, inválido, desabilitado, carregando e ativo. Aceite com contraste e capturas para os dois temas, preservação das caixas e revisão de modais próprios. Introduzir marcadores de impressão antes de trocar as classes utilizadas pelo PDF.

## Fase 3 · Telas e visualizações

**Como esta fase serve ao objetivo.** Permite completar as tarefas usuais em Claro de ponta a ponta.

Converter em lotes revisáveis. Primeiro, Transações, Contas, cartões, faturas, conciliação, pagamentos, importação, sugestões de parcelas e Open Finance quando habilitado. Depois, Dashboard, patrimônio, orçamento, Investimentos e Metas. Finalizar Configurações, Ajuda, onboarding, administração e estados de plano ou permissão. Cada lote cobre popups, mobile e estados vazios, parciais e de erro. Preservar o mesmo estado React, valores em centavos, competência, duplicidade, seleções, resultados de relatório e conjunto de ações permitidas. Aceite por rota e tarefa, com o [inventário](inventario-estilos.md) anotado e exceções de marca, dados e impressão justificadas.

## Fase 4 · Homologação e regressão

**Como esta fase serve ao objetivo.** Comprova que Claro é legível, Escuro conserva o visual e as duas apresentações mostram os mesmos dados.

- Capturar **Escuro anterior**, **Escuro candidato** e **Claro candidato** para cada fluxo representativo em desktop 1440×900, mobile 390×844 e largura de 320 CSS px onde houver reflow. Incluir paisagem para navegação e testar 200% de zoom e reflow a 400% quando aplicável. Fixar versão de navegador, fontes, DPR, fixtures, horário e estado de animação. Preferir cenários sintéticos. Registrar revisão, viewport, modo do SO, modo escolhido e interação.
- Exigir geometria e conteúdo equivalentes no Escuro. Começar com comparação sem tolerância em regiões determinísticas. Isolar diferenças do navegador justificadas e exigir revisão humana com comparação de capturas para cada diferença intencional. Nunca atualizar referências automaticamente após falha.
- Exigir WCAG 2.2 AA nas superfícies incluídas. Texto normal 4,5:1, texto grande 3:1 e limites, estados e gráficos essenciais 3:1 contra cores adjacentes. Usar texto, ícone, sinal ou traço junto à cor. Conferir foco visível e não totalmente encoberto, teclado, reflow e alvo mínimo de 24×24 CSS px conforme as exceções do critério. Revisar dispositivos reais para controles nativos e PWA. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [Contraste não textual](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- Automatizar razões dos pares semânticos em Vitest sem arredondar o limiar. No navegador, medir estilo computado e alfa composto em superfícies estáveis. Rodar axe nos fluxos quando o harness estiver pronto. Revisar manualmente gradientes, fundos com imagem, SVG, tooltip, placeholder, sobreposições e foco sobre navegação fixa. A automação identifica parte dos problemas. Se a referência escura falhar em AA, registrar a falha e submeter a menor correção necessária à revisão visual antes de declarar conformidade.
- Em ambos os temas, verificar fixtures idênticas para saldo, fatura, competência, pagamentos, importação e exportações. Para PDF, comparar número de páginas, texto, layout, barras, cabeçalhos e ausência de páginas vazias. Executar baseline TypeScript, suíte e build. Referências locais em [prints sintéticos](../../docs/net-worth-components-v2/visual-refinement/README.md) e [contrato de PDF](../../tests/dashboard/dashboardPrintContract.spec.ts).

## Fase 5 · Piloto e publicação

**Como esta fase serve ao objetivo.** Permite validar uso prolongado com um grupo pequeno e recuperar a apresentação escura se surgirem problemas.

Propor estados de disponibilidade `off`, `pilot` e `all` no padrão de flags existente. `off` vence tudo. No piloto, somente contas inscritas por configuração administrativa podem escolher; o opt-out administrativo vence a inscrição. Em `all`, todo usuário autenticado elegível pode escolher, e quem não escolheu continua em Escuro. O flag usa configuração de implantação e `app_metadata` para inscrição/opt-out, sem recorrer à preferência editável. Se for preciso desligar sem novo bundle, a fundação deve localizar e validar um mecanismo remoto geral já suportado antes de prometer esse prazo. A auditoria não verificou um kill switch remoto genérico para tema.

Para rollback, desligar a função força Escuro e oculta o seletor, conservando a escolha pessoal. Com flag de build, reverter para implantação escura conhecida ou publicar build com `off`, validar atualização do service worker e confirmar o comportamento em abas abertas e PWA após atualização. Um cliente offline com bundle antigo só recebe a mudança quando sincroniza e atualiza. A decisão de expansão exige homologação completa, nenhum problema crítico de contraste ou tarefa, paridade financeira e exercício documentado de rollback. Realizar piloto com usuários frequentes que optarem por participar e colher feedback de uso prolongado antes da decisão de publicação.

**Decisão para revisão.** Aprovar primeiro a fundação, com o Escuro atual como referência e o seletor atrás da flag. A fundação deve entregar a primeira matriz de comparação e confirmar o caminho de rollback antes de qualquer exposição do Claro a usuários.
