# FinElo · Ciclo 2: compartilhados e consistência da sessão

Continuação da PR [#97](https://github.com/CassMach13/FinElo/pull/97), branch `codex/finelo-theme-foundation`, sobre `fa9667d`. Base visual: main `6fa1188b1864e85da587e61c7e46009a5e82adb4`. Este ciclo mantém o tema restrito à referência autenticada de staging. A aplicação completa ainda não oferece Claro.

## Auth: resultado e decisão

O problema foi reproduzido no SDK real: após um PUT bem-sucedido salvando Claro, bloquear apenas a renovação do token deixou `getSession().user` com a preferência antiga. O estado confirmado da aplicação passou a preservar Claro ao receber esse snapshot. Após liberar a rede, `auth.refreshSession()` atualizou a cópia persistida do SDK.

No SDK instalado, `GoTrueClient.updateUser` aguarda a inicialização e a aquisição do lock antes de `_useSession` selecionar a sessão da escrita. Uma checagem anterior da identidade não vincula a requisição à conta capturada. Trocar somente o PUT por `auth.updateUser` reintroduziria a possibilidade de selecionar outra conta após uma espera. Um segundo cliente Auth com a sessão capturada dividiria a responsabilidade pelo refresh token e pelo armazenamento da sessão. Este ciclo mantém a escrita mínima com o bearer capturado e usa as APIs oficiais para leitura e atualização da sessão.

- `setUser` protege apenas a chave de aparência confirmada contra metadados antigos de eventos do SDK. Os outros metadados seguem seu fluxo atual.
- `syncAppearancePreferences` confere a sessão e usa `auth.getUser(jwt)` com o token capturado. Apenas uma resposta do servidor, da conta e geração atuais, pode substituir a preferência confirmada. Leituras iniciadas antes de uma gravação ou login posterior são descartadas.
- A confirmação é armazenada por conta em memória e, quando permitido, em `localStorage` sob chave versionada. O cache contém somente `dark`, `light` ou `system`; não contém sessão, credenciais ou dados financeiros. Ele não concede elegibilidade. O servidor continua sendo a autoridade e pode substituir o cache por uma escolha feita em outra aba/dispositivo.
- Após uma gravação, a API oficial `refreshSession()` é chamada **sem passar a sessão capturada**. Assim, ela opera na sessão que o SDK mantém naquele momento e não restaura uma conta anterior. Se falhar, a gravação já confirmada permanece válida e a reconciliação é retomada em eventos de Auth, foco, visibilidade ou retorno de conexão.
- Eventos `TOKEN_REFRESHED`, `USER_UPDATED` e `SIGNED_IN` agendam a consulta fora do callback síncrono do SDK para evitar reentrância no lock. Não há chamada de hidratação financeira neste sincronizador.
- `BroadcastChannel` transmite somente o sinal `changed`. Cada aba consulta sua própria conta; não são transmitidos tokens, identificadores ou metadados. Sem suporte ao canal, permanecem os eventos de Auth, foco e conexão.
- Uma segunda gravação concorrente na mesma aba é recusada. Entre abas, prevalece a última escrita bem-sucedida no servidor, e ambas consultam o resultado autorizado. Não há ordenação global pelo instante do clique nem fila offline de gravações.

Referências: [getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [refreshSession](https://supabase.com/docs/reference/javascript/auth-refreshsession), [updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser). A decisão também foi conferida no código da versão instalada em `node_modules/@supabase/auth-js/src/GoTrueClient.ts`.

| Cenário | Resultado | Evidência |
| --- | --- | --- |
| Claro com SDK desatualizado | PASS | Falha controlada do refresh; confirmação preservada |
| Renovação real `TOKEN_REFRESHED` | PASS | SDK passa a devolver Claro |
| `USER_UPDATED` real | PASS | Atualização de metadado independente preserva Claro |
| `SIGNED_IN`, recarga e novo login | PASS | Preferência restaurada |
| Duas abas da mesma conta | PASS | Alteração propagada e consultada no servidor |
| Gravações sobrepostas entre abas | PASS | Primeiro PUT retido; segundo concluído; primeiro liberado; abas convergem à última escrita no servidor |
| Duas gravações na mesma aba | PASS | Segunda recusada; primeira confirmada |
| Offline e reconexão | PASS | Confirmação preservada e nova consulta ao reconectar |
| Logout e login da conta QA | PASS | Servidor restaura Claro |
| Troca A → B e A → logout → B → A com trabalho em voo | PASS em regressão unitária | Respostas de gerações anteriores descartadas; escrita usa o token original |
| Leitura iniciada antes da confirmação | PASS em regressão unitária | Não substitui a gravação nova |
| Storage bloqueado ou preferência ausente/inválida | PASS em regressão unitária | Cache opcional; fallback Escuro |
| Recarga de transações por aparência | PASS | Zero requisições à lista de transações durante gravação/refresh/USER_UPDATED; identidade e saldo preservados nos testes |

O ensaio autenticado usa login normal em um frontend local ligado exclusivamente ao projeto `finelo-staging`. A conta QA isolada tinha zero transações. A troca para outra conta real não foi necessária: o isolamento entre identidades foi exercitado com respostas controladas nos testes. Após os ensaios, a conta retornou ao estado bloqueado, sem senha, sem inscrição no piloto, sem as duas chaves temporárias de aparência, com zero sessões e zero transações. Logs normais de autenticação/atividade da QA permanecem como evidência do ensaio. [Resultado Auth](evidencias-ciclo-2/auth.json) · [Harness autenticado](../../scripts/diagnostics/validate-appearance-auth.py).

## Componentes convertidos

| Componente | Conversão deste ciclo |
| --- | --- |
| Shell autenticado | `AuthenticatedShell` separa apenas a apresentação. MainLayout mantém navegação, permissões, telas, callbacks e TermsModal; classes, IDs padrão e hierarquia DOM preservados. A referência tem IDs próprios. |
| Navegação e menu da conta | NavItem, seleção ativa, badge, cabeçalho, menu, divisores, hover e foco |
| Card e SummaryCard | Superfície, títulos, rótulos, variantes, comparação, ícones e tooltip |
| Button | Quatro variantes públicas, hover, foco e desabilitado; adaptadores dos valores legados usados por GlobalDialog |
| Input e Select | Texto, placeholder, borda, erro, hover, foco, desabilitado e calendário nativo |
| MultiSelect | Campo, menu, checkbox, seleção, divisores, hover, rótulo acessível e Escape com retorno ao acionador |
| Modal e GlobalDialog | Scrim, superfície, divisores, título, texto, ícones e quatro estados de diálogo |
| Skeleton e SkeletonCard | Superfície e preenchimento de carregamento |
| ProgressBar | Trilha e cores semânticas das classes conhecidas, mantendo cálculo, largura e precedência da cor fornecida pelo consumidor |

Os adaptadores usam papéis `data-appearance-part` e variáveis semânticas dentro do escopo claro. As classes escuras existentes foram preservadas, inclusive as classes usadas como seletores de impressão. Isto evita uma migração em massa de utilitários e protege os consumidores ainda não convertidos. Cores customizadas desconhecidas de ProgressBar continuam sob responsabilidade de cada tela; devem ser inventariadas no Ciclo 3.

A amostra usa os componentes reais e um store de diálogo independente, criado pela mesma fábrica do store global. Confirmar ou cancelar um diálogo da amostra não aciona uma operação da aplicação. GlobalDialog passa a conduzir o foco ao diálogo, conter Tab e restaurar o acionador ao fechar. MultiSelect ganha Escape. Essas melhorias de teclado são intencionais; não mudam medidas, ações de confirmação/cancelamento ou regras financeiras. A comparação de pixels usa os mesmos estados de foco nos dois lados.

## Falhas de estados corrigidas

A medição efetiva revelou que a precedência das classes antigas fazia o Input claro ficar com fundo `rgb(2, 6, 23)` ao focar, mantendo o texto escuro. O hover de SummaryCard recuperava o fundo escuro, e o hover do botão secundário recuperava texto branco sobre uma superfície clara. Os adaptadores agora declaram esses estados com precedência suficiente, independentemente da ordem de importação das folhas. No Claro, mensagens de erro e badges também deixam de pulsar em opacidade para preservar o contraste ao longo do tempo; skeletons mantêm sua animação decorativa. O harness verifica os conflitos e a ausência de fade informativo sem congelar as animações nessa verificação.

## Matriz visual e contraste

Fixture fictícia estável, Edge headless, escala 1, desktop **1440 × 900** e mobile **390 × 844**. O harness carrega os componentes originais da main por `git show` e extrai dela as classes do shell, usando o mesmo conteúdo e viewport. A adaptação do GlobalDialog de baseline limita-se à injeção do store de referência; suas classes originais são preservadas.

| Estado | Desktop Escuro × main | Mobile Escuro × main | Claro desktop/mobile |
| --- | --- | --- | --- |
| Shell e formulário | PASS, pixels idênticos | PASS, pixels idênticos | PASS |
| Foco de campo | PASS, pixels idênticos | PASS, pixels idênticos | PASS |
| Hover de botão | PASS, pixels idênticos | PASS, pixels idênticos | PASS em emulação |
| MultiSelect aberto | PASS, pixels idênticos | PASS, pixels idênticos | PASS |
| Resumos e variantes | PASS, pixels idênticos | PASS, pixels idênticos | PASS |
| Skeleton e ProgressBar | PASS, pixels idênticos | PASS, pixels idênticos | PASS |
| Modal | PASS, pixels idênticos | PASS, pixels idênticos | PASS |
| GlobalDialog | PASS, pixels idênticos no mesmo foco | PASS, pixels idênticos no mesmo foco | PASS |
| Menu da conta | PASS, pixels idênticos | PASS, pixels idênticos | PASS |
| Escopo desativado | PASS, pixels idênticos à main | PASS, pixels idênticos à main | Volta ao Escuro |

São 36 PNGs para nove estados, dois temas e dois tamanhos; 18 comparações em Escuro. O modo Automático reage à mudança de `prefers-color-scheme`. O ensaio também verifica ausência de rolagem horizontal, Tab/Shift+Tab, Escape, retorno do foco, seleção múltipla, valor de data e select nativos. Os controles nativos são verificados no motor Chromium; isto não certifica a aparência do calendário do iOS ou Android físicos.

O Claro passou em **2.070 verificações computadas em 38 combinações de estado e viewport**, incluindo texto, hover de quatro botões, foco de três campos, menu, quatro variantes de diálogo e respectivos hovers. Mínimos medidos: **5,122:1 para texto** e **3,567:1 para limites de controles/progresso/foco**. Critérios: texto normal ≥4,5:1 e limites essenciais/indicador de foco ≥3:1. Os 23 pares da paleta continuam cobertos por Vitest. O cálculo considera cores renderizadas, alfa e gradiente; as capturas congelam animações para reprodução.

O Escuro conserva limitações **anteriores à PR**, verificadas no baseline: branco na navegação ativa ~2,58:1; branco na região ciana do botão ~2,43:1; alguns rótulos pequenos ~3,10:1. Não há declaração de conformidade AA integral do Escuro nem das telas ainda não convertidas. Corrigir esses pares exige uma decisão explícita de acessibilidade e identidade visual para o próximo ciclo; não foram recoloridos silenciosamente aqui. A medição completa está no JSON.

| Evidências | Escuro | Claro |
| --- | --- | --- |
| Desktop formulário | [PNG](evidencias-ciclo-2/desktop-escuro-formulario.png) | [PNG](evidencias-ciclo-2/desktop-claro-formulario.png) |
| Mobile formulário | [PNG](evidencias-ciclo-2/mobile-escuro-formulario.png) | [PNG](evidencias-ciclo-2/mobile-claro-formulario.png) |
| Desktop resumos | [PNG](evidencias-ciclo-2/desktop-escuro-resumos.png) | [PNG](evidencias-ciclo-2/desktop-claro-resumos.png) |
| Mobile modal | [PNG](evidencias-ciclo-2/mobile-escuro-modal.png) | [PNG](evidencias-ciclo-2/mobile-claro-modal.png) |
| Desktop diálogo | [PNG](evidencias-ciclo-2/desktop-escuro-dialogo.png) | [PNG](evidencias-ciclo-2/desktop-claro-dialogo.png) |

[Todas as capturas e PDFs](evidencias-ciclo-2/) · [Medições e hashes](evidencias-ciclo-2/visual.json) · [Harness](../../scripts/diagnostics/validate-shared-themes.py).

Além da fixture, houve comparação **da aplicação autenticada completa**, com login normal na mesma QA e data fixa: main local na porta 5199 e branch na porta 5200, esta com `VITE_APPEARANCE_PILOT=false`. As quatro capturas de Dashboard/Configurações em desktop/mobile são idênticas pixel a pixel. Nenhum escopo de tema aparece com a flag desligada. [Resultado e hashes](evidencias-ciclo-2/authenticated-dark.json) · [Dashboard main](evidencias-ciclo-2/autenticado-main-desktop-dashboard.png) · [Dashboard branch](evidencias-ciclo-2/autenticado-branch-desktop-dashboard.png) · [Harness](../../scripts/diagnostics/validate-authenticated-dark.py).

## PDF e isolamento

`src/index.css`, o mecanismo de Exportar PDF e os seletores de paginação permanecem iguais aos da main. Não foi necessário separar seletores neste ciclo porque as classes originais de cor foram mantidas. As variáveis claras e seus adaptadores só se aplicam em `@media screen`; a referência de Configurações continua dentro de `no-print`. Os PDFs da fixture compartilhada em Claro e Escuro mantiveram duas páginas e rasterização idêntica à main. O **PDF da Dashboard autenticada** manteve quatro páginas, com cada página rasterizada idêntica entre main e branch com a flag desligada. A QA não possui lançamentos; a paginação com dados financeiros extensos continua contemplada pelos contratos existentes e deve receber novas fixtures no Ciclo 3. Os 38 testes de contrato/cabeçalho de impressão passaram. [PDF main](evidencias-ciclo-2/dashboard-main.pdf) · [PDF branch](evidencias-ciclo-2/dashboard-branch.pdf).

O piloto mantém a tripla condição: modo de build `staging`, `VITE_APPEARANCE_PILOT=true` e `app_metadata.appearance_pilot=true`. Produção permanece inelegível. Não houve ampliação da coorte. Nenhuma migration, regra de acesso, cálculo, importador ou rotina de conciliação foi alterada. Manifesto, splash, metadados de cor e política de atualização da PWA permanecem escuros. Publicar Claro para toda a aplicação continua bloqueado pela falta de conversão das telas.

## Validações e reprodução

- Suíte completa: **200 arquivos e 3.259 testes aprovados**.
- Revalidação focal final de aparência e impressão: **85 testes aprovados**.
- TypeScript: **14 diagnósticos conhecidos, nenhum novo**.
- Build: aprovado; precache PWA gerado. Permanecem avisos existentes de tamanho de bundle e base Browserslist antiga.

Para reproduzir a referência: iniciar Vite em loopback e executar `python scripts/diagnostics/validate-shared-themes.py --base 6fa1188 --out-dir <diretório>`, com Playwright Python, PyMuPDF e Edge disponíveis. O script bloqueia todos os destinos externos. `validate-theme-preview.py` encaminha para o harness ampliado.

O ensaio Auth aceita um arquivo privado de credenciais QA e não o grava nos artefatos. Requer somente staging, conta isolada autorizada e Vite na porta 5198 com o piloto habilitado. O harness usa a instância real do store de desenvolvimento e o URL do módulo SDK já carregado, evitando duplicar clientes/stores por URLs diferentes durante HMR. Não preparar ou remover snapshots/configurações de baseline enquanto um ensaio autenticado estiver rodando, pois o Vite pode recarregar a página.

## Pendências e Ciclo 3

1. Converter consumidores por lotes, começando por Transações, Importação e faturas. Revisar controles escritos diretamente nas telas, classes fornecidas aos componentes e cores customizadas de ProgressBar. Não alterar parsers ou regras financeiras para trocar cores.
2. Converter Dashboard, gráficos, investimentos, objetivos, tabelas, alertas e demais modais de negócio. Validar séries, valores positivos/negativos e legibilidade sem depender apenas de cor.
3. Revisar variantes legadas de Button usadas pelos consumidores: há valores fora das quatro variantes públicas. Este ciclo preserva a saída escura existente; a consolidação precisa de comparação por consumidor.
4. Deliberar separadamente sobre os pares AA pendentes do Escuro. Manter evidências de cada mudança necessária de contraste para revisão, sem transformar o ciclo em redesign.
5. Ampliar fixtures com dados financeiros representativos e páginas longas de PDF. Repetir evidências equivalentes em ambos os temas, inclusive teclado, erros, estados vazios e sobreposições encadeadas.
6. Homologar Safari/iOS e Android físicos, orientação horizontal, teclado virtual, PWA instalada, prompts de instalação/atualização e impressão nativa. A emulação desktop/mobile deste ciclo não substitui esse ensaio.
7. Só depois de todos os consumidores passarem, propor a aplicação do tema no shell completo e nos overlays globais. Manter a mesma coorte de staging até aprovação do piloto; produção exige autorização posterior.

Rollback: desligar a flag e reconstruir staging, ou retirar a inscrição administrativa e renovar a sessão. A preferência salva pode permanecer, sem efeito visual fora da referência. Para rollback de código, reverter o commit deste ciclo na mesma branch. Não é necessária reversão de dados ou migration.

PR #97 permanece em rascunho para revisão deste ciclo. Não houve merge nem deploy em produção.
