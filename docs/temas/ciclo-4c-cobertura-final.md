# Ciclo 4C — Cobertura autenticada e Configurações

## Estado do ciclo

Homologação local concluída, a partir de `7159efc9d3ca71567ac4f1814ffdfa69b1732b5f`, na PR #97 em rascunho. Main e ancestral comum confirmados antes de editar: `6fa1188b1864e85da587e61c7e46009a5e82adb4`. Baselines imutáveis: 268 fontes main e 282 revisadas. Inventário inicial: 39 consumidores, com fingerprints AST anteriores à conversão e 163 arquivos funcionais selados. Focal anterior: **282 testes / 16 arquivos PASS**. Árvore final do produto: `ab91f69d3c1da868cf3ac5b815d5630e4b63f361`; commits anteriores do ciclo: `cf9b15b`, `ae29d36`, `f51a2b3`.

Sublotes: 4C1 Objetivos, Contas e Configurações; 4C2 Ajuda, administração e assinatura; 4C3 menus, portais e resíduos. Cada sublote exige suas evidências antes do seguinte. O Claro continua isolado. Sem merge, deploy de produção, migration, pagamento real, alteração de coorte ou homologação física.

## Inventário inicial das rotas

| Entrada real | Superfícies | Cobertura inicial / decisão |
| --- | --- | --- |
| `/app`, `dashboard` | Dashboard, gráficos e patrimônio | Homologados em 4A/4B; reutilizar e proteger |
| `transactions`, `import` | Transações, faturas, pagamentos, conciliação e importação | 3A–3D concluídos; revisar dependências residuais, sem duplicação |
| `investments` | Investimentos legado/V2, modais e carteiras | 4B concluído; preservar a guarda de sessão autorizada |
| `goals` | GoalsView, GoalCard, GoalFormModal, UpdateGoalValueModal | Sem adaptação de cores nos consumidores; controles compartilhados já convertidos |
| `settings` | Configs, contas, importações, categorias, orçamentos, bens, regras, família, segurança, backup e auditorias administrativas | Parcial; importação/regras e bens já adaptados, demais seções e auxiliares requerem 4C1 |
| Sem entrada no mapa atual | ContasView | Componente legado existente; homologar isoladamente sem criar rota nova. Gestão acessível de contas está em Settings |
| `help` | HelpView, HelpCenterBrowse, HelpArticleContent, CreditCardHelpGuide, SupportAttachmentLink | Parcial pelo reuso dos controles; falta adaptação local de listas, formulários, mensagens e anexos |
| `admin` | AdminTicketsView e AdminDashboard | Não convertidos; preservar whitelist e autorização do servidor |
| `pricing` | PricingView, planos e aviso de upgrade | Autenticada; converter apresentação sem iniciar checkout |
| `success` | PaymentSuccessView | Entrada autenticada do mapa, sem rota pública própria; converter e manter contratos de assinatura |
| Shell | UserAccountWidget, Avatar, navegação e InstallPWA | Shell e menus com adaptação prévia; verificar resíduos, estados, nomes acessíveis e sessão |
| Globais | GlobalDialog, TermsModal, AppLock, ReloadPrompt, tours e onboarding | Cobertura mista; revisar portais e overlays no 4C3 |

## Fronteira pública

O roteador redireciona usuários autenticados em `/`, `/login` e `/pricing` para `/app`. Visitantes de `/pricing` recebem LandingPage. LandingPage e AuthView pertencem ao contexto anônimo e mantêm a identidade original, sem herdar preferências de uma conta anterior. `/update-password` é recuperação de autenticação, fora do shell pessoal; preservar sua apresentação original e testar que não recebe aparência da sessão anterior. `/dashboard` é somente um redirecionamento protegido. Links desconhecidos continuam seguindo o comportamento anterior.

## Isolamento de sessão: regressão anterior e exceção autorizada

As rotinas e componentes originais foram exercitados com contas sintéticas A/B e transporte fechado, sem rede. A main e o commit revisado reproduzem:

| Cenário | Resultado anterior |
| --- | --- |
| Substituir A por B com objetivos/chamados carregados | **FAIL**: caches de objetivos, chamados, métricas administrativas e intenção de ajuda não fazem parte da limpeza atômica em `setUser` |
| Resposta de chamados iniciada por A e concluída em B | **FAIL**: a resposta substitui a coleção de B por dados de A |
| Criação de objetivo iniciada por A e concluída em B | **FAIL**: o retorno acrescenta o objetivo de A à coleção de B; não há movimentação de contas |
| Confirmação global aberta por A durante troca para B | **FAIL**: o diálogo global continua aberto com o texto de A |

O bloqueio não foi introduzido pela pintura. Conforme o item 7, os cenários foram interrompidos e a proposta concreta apresentada antes de qualquer alteração no store. O usuário autorizou explicitamente a correção pontual de sessão; o patch foi aplicado somente depois dessa resposta.

### Correção delimitada, autorizada e aplicada

[Patch autorizado](./proposta-isolamento-4c.patch), 114 linhas de diff, inicialmente validado em cópia isolada:

1. Acrescentar os caches identificados à limpeza atômica já existente ao mudar o ID autenticado.
2. Cancelar a confirmação global com resposta `false` e remover suas opções antigas. Isso não autoriza exclusões nem confirma operações.
3. Reutilizar a geração de sessão existente para descartar resultados antigos em criação de objetivo, consultas de chamados e métricas administrativas. Não modificar consultas, payloads, valores, cálculos ou regras de acesso.
4. Recriar MainLayout por `user.id`, estendendo ao shell/formulários o mesmo mecanismo visual do 4B. Atualizações da mesma conta e troca de tema mantêm a chave.

Os quatro casos da cópia proposta passaram antes da autorização. Após aplicar, **309 testes / 16 arquivos focais PASS**, incluindo **13 regressões novas**. O patch não modifica o SDK Auth, RLS, armazenamento ou envio de anexos, assinaturas nem dados remotos. Os hashes anteriores não foram atualizados: um adaptador aceita apenas o SHA exato do store aprovado, e um teste reverte o diff para reconstruir o SHA original. Qualquer mudança adicional quebra o selo. A exceção estrutural aceita somente `<MainLayout key={user?.id} />`.

## Metodologia prevista

Preservar classes Escuras, geometria e impressão; aplicar os tokens existentes por papéis explícitos e CSS de tela. Comparar main/revisado/Escuro/Claro, desktop/mobile, conteúdo, geometria, cores, SVG quando existente e raster. Manter a tolerância de 3A somente para ruído com igualdade independente de conteúdo/geometria/cores. Medir contraste Claro, teclado/foco e zero operações financeiras adicionais em trocas CSS.

Fixtures sintéticas e SDK/handlers originais com transporte/storage em memória. Pagamentos não serão iniciados; contratos, preços e destinos de checkout serão comparados sem acesso aos provedores. RLS, dados reais e serviços remotos não serão alterados.

## Referências e rastreabilidade

Os checkpoints abaixo preservam a sequência de autorização e fechamento dos sublotes. A matriz final e os limites da entrega constam ao final. [Evidências compactas](./evidencias-ciclo-4c/README.md); o pacote externo contém também resultados intermediários rejeitados, identificados separadamente da matriz aceita. As evidências anteriores permanecem intactas.

## Checkpoint 4C1 em homologação

Pintura por papéis explícitos em Objetivos, Contas, Configurações, convites e amostra de aparência. Seção de Patrimônio preservada do 4B. Probe inicial de Claro desktop/mobile: seis estados sem erro de página; badges Aceito/Pendente corrigidos com superfícies semânticas. Troca A/B no navegador: **40 casos PASS**, incluindo formulários de Objetivos/Contas/Ajuda, mesmo ID, logout/login e criação pendente; todos os commits React observados sem conteúdo do titular anterior. Comparações completas de quatro referências e PDFs em execução.

### Prova adicional com o SDK Auth instalado

Cinco testes novos usam `@supabase/supabase-js` instalado, `setSession`, `refreshSession`, `updateUser` e `signOut` reais do SDK, com JWTs totalmente sintéticos e transporte fechado (nenhuma requisição externa): **5/5 PASS**. Demonstram que a escrita com bearer capturado deixa o cache do SDK desatualizado, mas `TOKEN_REFRESHED` e `USER_UPDATED` antigos não substituem o Claro confirmado no store; a consulta de reconciliação recupera a preferência remota. Também cobrem escrita A pendente após `SIGNED_IN` de B, logout/login por conta, falha/reconexão e bloqueio de duas gravações concorrentes. Nenhuma rota REST financeira é chamada. Esses ensaios são de integração com o SDK local, não uma nova homologação de serviço remoto.

### Checkpoint de impressão 4C1

**24 PDFs / 148 páginas PASS**, nas quatro referências: objetivos normais/extensos, formulário, contas, configurações e detalhes de financiamento. Quantidade de páginas, dimensões, texto e raster idênticos. Os estilos de pintura novos são exclusivamente `@media screen`; não alteram o contrato impresso.

### Fechamento do sublote 4C1

**392 capturas** (376 estados + 16 operações), desktop/mobile e quatro variantes. **294 equivalências** de dados/payloads/props funcionais e **196 paridades Escuras PASS**. Anotações `data-finance` nos props de elementos React são excluídas do comparador de dados; nenhum outro campo de payload é removido. **6.268 verificações de contraste**: nenhum problema nos componentes do 4C1. Quatro capturas desktop incluem a mesma estrela do menu, com contraste 1,669; componente externo a este sublote, reservado ao 4C3, sem ser aceito como PASS global.

Uma divergência de composição de sombra em duas capturas mobile foi investigada, sem aumentar a tolerância: invalidar o cache de pintura e restaurar exatamente display e rolagem eliminou a diferença, mantendo conteúdo, geometria e cores iguais. Não houve correção de CSS Escuro nem uso de máscara. A confirmação final passa com as referências reemitidas.

Os cadastros/edições sintéticos de categoria, conta e regra produzem os mesmos payloads e resultados nas quatro referências. Objetivos cobrem validação, carregamento, erro, criação pendente, valor manual, edição, arquivamento/restauração e exclusão/cancelamento, sem escrever em transações ou eventos econômicos. Seções de Configurações cobrem configs, contas, histórico, categorias, orçamento, bens, regras, família e auditorias administrativas. **24 PDFs / 148 páginas**, **40 cenários de sessão** e **314 testes focais** (309 + 5 do SDK real local) aprovados. PIN, amostra elegível e resíduos globais recebem ensaios dedicados no 4C3.

## Auth: perfil pendente e login de outra conta — correção adicional autorizada

Reproduzido com o **SDK instalado real**, transporte fechado e contas sintéticas: iniciar `updateUserPreferences({full_name: ...})` em A, manter o `PUT /auth/v1/user` pendente, executar `auth.signInWithPassword` para B e liberar A. O SDK emite o retorno antigo `USER_UPDATED` e restaura A tanto no cache SDK quanto no store depois de B. O teste usa as APIs públicas reais, não substitui os métodos Auth e não contata Supabase remoto. Nenhuma credencial é registrada. Esse caminho já existe antes do 4C; o patch de sessão previamente aprovado não o altera.

O cenário foi interrompido como **FAIL anterior**, conforme o item 7. Depois de apresentar o patch concreto e seis ensaios da cópia isolada, o usuário autorizou explicitamente a correção delimitada de Auth. O patch foi aplicado somente após essa resposta; os seis casos agora são regressões permanentes com o SDK instalado e os helpers HTTP reais do produto.

### Patch adicional autorizado e aplicado

[Patch para revisão](./proposta-preferencias-auth-4c.patch). Em cópia isolada, a escrita das preferências gerais usa bearer capturado e valida o titular/época antes de atualizar a apresentação otimista. As gravações são serializadas por conta, mantendo ordem FIFO; operações antigas ainda na fila são descartadas quando a sessão muda. O retorno HTTP não salva nem restaura a sessão global do SDK. Não há refresh que recoloque uma sessão capturada.

O campo `data` enviado ao Auth é preservado, inclusive preferências de classificação/pagamento; não muda cálculo, consulta financeira, RLS, migração, coorte, importação ou assinatura. A política otimista/erro da conta atual permanece. O cache de metadados do SDK fica eventual até uma atualização normal do Auth; a interface continua recebendo imediatamente a preferência pelo store. O writer deixa de provocar `USER_UPDATED` por si só. Essa diferença de sincronização foi explicitada e recebeu a nova autorização de Auth/store exigida pelo item 7.

**Seis ensaios da cópia proposta PASS**: corrida A→B com login oficial; sucesso da mesma conta com payload de preferência financeira preservado; concorrência FIFO e união de campos; descarte de operação antiga na fila; falha offline com a política otimista anterior; Claro confirmado durante perfil e `TOKEN_REFRESHED` desatualizado. O cenário original usa main/revisado estruturalmente equivalentes nessa rotina; os valores esperados dos selos anteriores continuam intactos. Dois arquivos recebem exceção por SHA exato (store e cliente HTTP), com reversão dos dois patches reconstruindo os hashes anteriores; **161 dos 163 arquivos funcionais permanecem byte a byte iguais**. Qualquer alteração adicional quebra os selos. A proposta não é uma certificação de todos os possíveis concorrentes internos do SDK.

## Checkpoint 4C2 em confirmação

Nove consumidores convertidos: HelpView, HelpCenterBrowse, HelpArticleContent, CreditCardHelpGuide, AdminTicketsView, AdminDashboard, SupportAttachmentLink, PricingView e PaymentSuccessView. Campos de suporte receberam associação aos rótulos existentes; artigos expõem expansão e região controlada; cartões administrativos podem ser ativados pelo teclado. Classes, textos, geometria, autorização e checkout foram preservados.

A main também reproduziu uma janela de anexo pendente de A que recebe acesso depois da troca para B. A correção é exclusivamente de ciclo de vida visual: o componente fecha a janela em branco ainda pendente ao desmontar e descarta o retorno antigo; uma janela já aberta com sucesso não é fechada ao navegar. O serviço de storage e suas permissões não mudaram. **20 cenários desktop/mobile em Claro/Escuro PASS** (troca, logout, mesmo ID, navegação e erro tardio). O AST aceita somente os trechos exatos dessa guarda.

Primeira matriz completa: **280 capturas, 210 equivalências de dados/resultados, 4.040 verificações AA sem falha**. Sete rasters de digitação tiveram diferença acima do limite de 3A, apesar de conteúdo/geometria/cores iguais; continuam reprovados até a confirmação de pintura, sem tolerância adicional. **16 PDFs / 32 páginas PASS**, complementando os 24/148 do 4C1. Nenhum checkout, portal de cobrança, pagamento real ou conta remota foi acionado.

### Fechamento do 4C2

Matriz aceita: **280 capturas / 140 paridades / 210 equivalências PASS**. Para seis estados de controles nativos, a comparação visual usa páginas independentes, todas com os mesmos dados exatos produzidos pelo replay principal e as interações originais para alcançar o estado. São **48 capturas / 24 paridades adicionais PASS**. O replay completo continua comprovando payloads/resultados dos handlers; seus frames instáveis não foram aceitos como paridade nem apagados. Não houve máscara, filtro de imagem, alteração de classes Escuras ou ampliação da tolerância de 3A.

Os scripts registram a configuração comum de renderização; as imagens são capturadas antes do stress de alternância CSS. Estado visual isolado e replay operacional têm relatórios distintos. **TypeScript: 14 diagnósticos conhecidos / 0 novos**. O 4C1 foi registrado em `cf9b15b`; a correção adicional de Auth, após autorização, em `ae29d36`. A amostra continua sendo a única exposição autorizada do Claro. Próximo sublote: menus, Avatar, PIN, termos, PWA e portais.

## Fechamento visual 4C3

Avatar, estrela Premium, menu da conta, PIN, carregamento Auth, Termos, instalação/atualização PWA e portais de tutorial receberam os papéis semânticos remanescentes. O Avatar preserva o hash HSL original no Escuro e recebe uma camada semântica no Claro. O helper compartilhado de ícones permanece intacto; Pricing adapta os ícones em seu próprio consumidor. Varredura de cinco entradas autenticadas: **256 módulos / 106 TSX**, sendo o helper de ícones o único consumidor com cores fixas sem papéis locais próprios, coberto por seus consumidores. Nenhuma rota nova foi criada.

**144 capturas / 72 paridades / 108 equivalências PASS**; 64 rasters exatos e oito ruídos dentro do limite de 3A, sempre com conteúdo, geometria e cores idênticos. **1.007 verificações AA no Claro, zero falhas**. Os quatro apontamentos da estrela externa ao 4C1 estão encerrados pela adaptação local e pela matriz global atual. Mais **24 capturas / 12 paridades exatas / 18 equivalências**, com consentimento de anexo e carregamento administrativo: **223 verificações AA + 1.480 medições adicionais PASS**. Estas incluem todos os 360 matizes possíveis do Avatar, PIN, seleção, cores nativas e foco/hover do aviso de assinatura.

Menu responde a Enter/Escape e devolve o foco; o aviso de assinatura contém Tab/Shift+Tab, cancela por Escape e devolve o foco sem iniciar checkout. Termos e instruções iOS usam o gerenciamento de foco já existente no Modal. Texto legal, versão e exigência de leitura foram preservados. O chamador de consentimento utiliza o writer de metadados já autorizado, com bearer capturado, identidade corrente e ciclo de vida do shell; somente fecha após confirmação remota. [Diff exato para revisão](./consentimento-writer-autorizado-4c.patch). Não se usa a política otimista do perfil para aceitar Termos.

**38 ensaios de interação / 16 capturas adicionais PASS**, incluindo confirmação/erro dos Termos, escrita pendente durante troca A→B ou logout, consentimento de arquivo, teclado, foco e intenção de atualização PWA interceptada. **206 verificações AA adicionais PASS**. Nenhum retorno antigo aceita Termos de B, fecha seu diálogo ou restaura A. Os portais de Ajuda/Configurações recebem apenas atributos de pintura reversíveis; Admin conserva o aviso original de que não há tutorial específico.

Impressão financeira complementar: **16 PDFs / 48 páginas** de Dashboard, Transações, Importação e Investimentos nas quatro referências, com paginação, dimensões, texto e raster iguais. Total novo do ciclo: **56 PDFs / 228 páginas PASS**.

Revisão de React: efeitos visuais desconectam observers/listeners e restauram atributos; não há consultas/store/cálculos no bridge de portais. Detector Impeccable limitado executado uma vez: avisos sobre classes legadas de animação, borda lateral, gradientes e paleta foram conferidos contra os baselines e preservados por contrato; a pintura Clara remove os gradientes de texto e usa tokens com contraste computado. Sem redesign ou inversão de cores.

Build final/PWA: **PASS, 49 entradas**; TypeScript: **14 conhecidos, nenhum novo**. Aparência/Ajuda/onboarding: **298 testes / 17 arquivos PASS**. Confirmação posterior: **3.421 testes / 211 arquivos PASS** na execução integral e **22 ensaios de fronteira/flag PASS**.

## Matriz final de cobertura

| Rota / consumidor | Situação | Estados e proteção |
| --- | --- | --- |
| `/app?view=goals`: GoalsView, GoalsPanel, GoalCard e dois modais | **Completo / PASS** | Normal, atingido, expirado, arquivado, vazio, erro, lista longa, CRUD, validação, valor manual, pendência e cancelamento; zero movimentações financeiras |
| `settings`: configs, contas, categorias, orçamento e regras | **Completo / PASS** | Seções, busca vazia, listas, cadastro/edição/cancelamento, valores e payloads iguais; seções de importação reutilizam 3B |
| `settings`: família, convites, permissões e preferências | **Completo / PASS** | Convite e confirmação/cancelamento; perfis e decisões de acesso originais; flags/coorte sem ampliação |
| `settings`: bens, detalhes de financiamento e consórcio | **Completo / protegido do 4B** | Não reconvertido; impressão e selos funcionais revalidados |
| `settings`: backup e auditorias administrativas | **Completo / PASS** | Superfícies e avisos existentes; sem execução destrutiva de reprocessamento/backup remoto |
| ContasView | **Completo / isolado** | Componente legado sem rota atual; diagnóstico cobre normal/vazio/lista longa e cadastro de cartão; não foi exposto por navegação nova |
| `help`: artigos, guia de cartões, suporte, histórico, mensagens e anexos | **Completo / PASS** | Busca, vazio, expandir, draft, validação, envio sintético, erro, loading, resposta, seleção/consentimento de arquivo e acesso pendente; serviço/storage intactos |
| `admin`: AdminTicketsView e AdminDashboard | **Completo / PASS** | Lista, chamado, resposta, status, filtro, vazio, métricas carregando, CRM e busca; whitelist/RLS originais |
| `pricing` autenticada e `success` | **Completo / PASS** | Planos mensal/anual, promoção, esgotado, assinatura ativa, aviso/cancelamento e confirmação; preços/links/checkout selados, nenhum pagamento iniciado |
| Shell, UserAccountWidget, Avatar e menus | **Completo / PASS** | Desktop/mobile, badges, fallback, foco, hover, Enter/Escape e retorno de foco |
| AppLock, AuthLoadingScreen, GlobalDialog e Termos | **Completo / PASS** | PIN, loading, diálogo info/warning/danger, leitura legal, desabilitado, confirmação, falha e troca de titular durante gravação |
| InstallPWA, ReloadPrompt e portais de tours | **Completo / PASS em emulação** | Instalação e instruções iOS, pronto offline/atualização, tours Ajuda/Configurações e fallback Admin. Sem instalar ou atualizar um PWA real |
| Dashboard, Transações, Importação, faturas/pagamentos/conciliação, Investimentos e onboarding | **Completo / protegido de 3A–4B** | Adaptadores anteriores reutilizados, 39 contratos de consumidores, selos de domínio, suíte integral e regressão financeira de impressão |
| LandingPage, AuthView, `/pricing` anônimo e `/update-password` | **Excluídos deliberadamente** | Identidade pública original; sem tema pessoal herdado, formulário/dados de A ou amostra de aparência |

Não resta uma rota autenticada do inventário classificada como parcial ou não convertida na referência isolada. Isso não habilita a aplicação Clara globalmente. Métodos de configuração de PIN existentes no store não possuem controles renderizados em Settings; nenhum fluxo novo foi inventado. A proteção efetivamente exibida é AppLock. Mobile não recebeu uma entrada nova de instalação: o diagnóstico monta adicionalmente o componente para verificar a apresentação, mantendo a visibilidade de navegação anterior.

## Matriz de acessibilidade e paridade

| Verificação | Resultado | Limite da conclusão |
| --- | --- | --- |
| 4C1: 196 paridades Escuras | **PASS**: 190 exatas, seis ruídos limitados | Quatro observações da estrela externa ao sublote foram corrigidas e encerradas na matriz 4C3 |
| 4C2: 140 paridades Escuras | **PASS**: 137 exatas, três ruídos limitados | Seis estados nativos usam páginas independentes com dados idênticos ao replay; 24 comparações auxiliares exatas |
| 4C3: 72 paridades + 12 residuais | **PASS**: 64 + 12 exatas | Oito ruídos limitados no conjunto global; nenhuma mudança de conteúdo, geometria ou cor funcional |
| Contraste Claro | **PASS** | 6.268 observações em 4C1, 4.052 em 4C2, 1.007 globais, 223 residuais, 1.480 adicionais e 206 de interação. Mínimo texto 4,571:1 no 4C2; essenciais 3,567:1. São amostras computadas, não certificação integral WCAG |
| Avatar/PIN/seleção/nativos | **PASS** | 360 matizes do Avatar; pontos PIN vazios/preenchidos; seleção, radios/checkbox, file-selector-button, foco/hover e desabilitado |
| Teclado e overlays | **PASS** | Tab/Shift+Tab, Enter, Escape, foco inicial/restaurado, região legal rolável, menu, modal e aviso de assinatura; sem acionar checkout |
| Trocar CSS | **PASS** | Contadores de commits React, seletores financeiros, requests e eventos iguais antes/depois em todas as capturas da matriz |
| Contraste Escuro anterior | **Preservado, não certificado AA** | Limitações anteriores continuam registradas; paridade não equivale a aprovar o contraste legado |
| Leitor de tela, Safari e aparelhos físicos | **Pendente 4D** | Viewports Edge 1440×1000 e 390×844 não substituem homologação assistiva ou física |

O limite de raster de 3A continua: delta por canal até 2 e quantidade de pixels até `max(20, área × 0,0001)`, exclusivamente com igualdade independente de conteúdo/geometria/cores. Sem máscaras, inversão ou filtros. Frames de composição instável foram rejeitados e preservados no pacote, sem incorporá-los aos PASS.

## Equivalência e segurança consolidadas

**630 comparações principais de dados, props funcionais, payloads e resultados PASS**: 294 no 4C1, 210 no 4C2, 108 no 4C3 e 18 residuais. A comparação inclui valores, identificadores, titularidade e coleções integrais da fixture. Somente atributos de pintura `data-finance` em elementos React são normalizados; nenhum campo financeiro é omitido. Os objetivos continuam independentes do livro de transações. Preços, destinos de pagamento, permissões, importações, conciliação e cálculos não foram alterados.

Treze regressões permanentes de store/sessão, 40 ensaios de navegador e 20 de janelas de anexo PASS. Mais 11 testes com SDK Supabase instalado e helpers HTTP reais verificam cache, eventos, fila, concorrência, login oficial A→B, offline/reconexão e confirmação de tema, sem transporte externo. Termos acrescenta quatro resultados assíncronos por tema/viewport. Não há conteúdo antigo nos commits observados da interface atual. As diferenças de conteúdo em estados legados inválidos são as exceções de sessão explicitamente autorizadas, não tolerância de raster.

Os 163 selos funcionais originais não foram regravados: 161 arquivos iguais e duas exceções por SHA exato, reversíveis até os bytes originais. O writer genérico não atualiza o cache de metadados do SDK por conta própria; a interface usa o store e a reconciliação normal. A cobertura dos escritores autorizados não certifica todo concorrente interno possível do SDK nem altera os fluxos públicos de recuperação de senha.

Fixtures usam dados exclusivamente sintéticos, SDK/query builders/handlers do produto, transporte e storage em memória e rede externa bloqueada. As verificações de RLS da suíte executam PostgreSQL descartável local; a fixture de UI não é apresentada como prova de políticas remotas. Nenhuma sessão, conta financeira ou cobrança real foi utilizada.

## Qualidade e próximos passos

Suíte local final: **3.421 testes / 211 arquivos PASS**. Primeira execução: 3.419 PASS e dois contratos desatualizados (HTML com papel semântico e mock do writer autorizado); ambos foram adaptados sem enfraquecer as asserções, e a execução integral de confirmação passou. Focal final: **298 / 17 PASS**. TypeScript: **14 diagnósticos preexistentes, nenhum novo**. Build/PWA: **PASS, 49 entradas**; aviso anterior de bundle grande preservado. PDFs: **56 / 228 páginas PASS**, com paginação, dimensões, texto e raster idênticos.

O 4D deverá homologar integração em staging autorizado, aparelhos iOS/Android, Safari, PWA realmente instalado, leitores de tela e sessão/múltiplas abas no ambiente real. Também deve deliberar os riscos legados já separados nos relatórios 3D/4A/4B (feedbacks, overflow e entradas sintéticas incoerentes), sem atribuí-los à pintura. Antes de piloto global, exigir capturas comparáveis por rota nos dois temas, regressão de impressão, contraste, foco, troca A/B e aprovação explícita de elegibilidade/publicação. Rollback visual: manter flag desligada e retirar o consumidor da amostra; rollback de Auth exige preservar as correções de privacidade autorizadas, sem reintroduzir o writer inseguro.

O aplicativo continua Escuro. O seletor é **Tema da amostra**, somente staging + flag existente + `app_metadata.appearance_pilot`; desligado ou fora da coorte não renderiza a amostra. Sem merge, deploy de produção, migrations, operações destrutivas ou ampliação da coorte.

Os 22 ensaios de fronteira usam o App real nas rotas públicas, nos dois viewports; verificam flag desligada, conta inelegível, Claro/Escuro/Automático com mudança do sistema, falha de gravação sem perder confirmação, eventos Auth, troca A→B, logout e ausência de herança pessoal. A LandingPage contém imagens lazy fora do viewport: o roteiro público aguarda fontes e pintura visível, sem bloquear esperando essas imagens não solicitadas. Não foi alterado código público para resolver a espera.

## Pacote e revisão da PR

[Seis capturas finais comparativas, métricas e hashes](./evidencias-ciclo-4c/README.md): 511.826 bytes de PNGs versionados. O pacote externo **finelo-ciclo-4c-evidencias.zip** tem **56.975.460 bytes**, 3.109 arquivos lógicos e 2.037 objetos únicos. CRC e hashes conferidos duas vezes. SHA-256 do ZIP: `380903f2ee675ce33f625bd213b2ff3e988eab0b11865f1424b8c1e69b20513a`; índice: `98645f93895ab2e894bd77bb3882885fdc489915a67858936f1b212f8ef82dcd`. O índice distingue caminhos lógicos e objetos deduplicados. Não contém faturas privadas, credenciais ou logs brutos de teste.

Validação remota: [Quality baseline do HEAD da PR #97](https://github.com/CassMach13/FinElo/pull/97/checks). O corpo da PR registra o SHA final, o run e o resultado observado. A diferença já existente entre testes locais e CI corresponde a 20 casos com fixtures privadas locais (CSV e XP) ausentes do Git; não são distribuídas neste pacote.

O 4C está preparado para revisão de código e evidências. A autorização para publicação geral não faz parte deste ciclo; exige a homologação integrada do 4D. PR em rascunho, sem merge ou deploy de produção.
