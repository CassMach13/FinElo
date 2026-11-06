# Ciclo 4C — Cobertura autenticada e Configurações

## Estado do ciclo

Em execução, a partir de `7159efc9d3ca71567ac4f1814ffdfa69b1732b5f`, na PR #97 em rascunho. Main e ancestral comum confirmados antes de editar: `6fa1188b1864e85da587e61c7e46009a5e82adb4`. Baselines imutáveis: 268 fontes main e 282 revisadas. Inventário inicial: 39 consumidores, com fingerprints AST anteriores à conversão e 163 arquivos funcionais selados. Focal anterior: **282 testes / 16 arquivos PASS**.

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

## Entrega pendente

As matrizes finais por componente, acessibilidade, paridade, contraste, sessão, equivalência, PDFs, CI, pacote externo e pendências 4D serão preenchidas conforme os sublotes forem homologados. As evidências anteriores permanecem preservadas.

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
