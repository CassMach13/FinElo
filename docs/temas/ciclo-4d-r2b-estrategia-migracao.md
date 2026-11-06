# Ciclo 4D-R2B — estratégia de migração e coordenação PWA

## Escopo e dois pareceres

Base: `25a218d9c38f31134c39ebf4313a862a497e8649`, PR #97 em rascunho, branch `codex/finelo-theme-foundation`. **NO-GO para piloto/publicação.** Este ciclo acrescenta somente laboratório, testes, documentação e evidências. Não aplica o patch R2, não altera `src`, `vite.config.ts`, `public`, worker de produto, Auth, dependências, serviços financeiros ou coorte. Nenhum merge/deploy/migration.

**A — Legado:** passagem condicionada à conclusão observável do trabalho e à saída voluntária de todos os clientes antigos. Um worker novo pode negar ativação antecipada, mas não remover timers, evitar F5/fechamento ou reconstruir rascunhos do JavaScript antigo. Os casos de perda continuam **FAIL residual**, não PASS por incompatibilidade. Exigem procedimento operacional e, se considerados aceitáveis, decisão explícita do responsável pelo produto.

**B — Cooperativos:** protótipo executável com inventário do worker, registro de trabalho, exclusão mútua e duas rodadas de prontidão. A ativação continua sendo a transição **natural do navegador**, sem `skipWaiting`. Cada aba confirma sua própria saída, limpa, para uma origem neutra. As contagens e o parecer do recorte local estão na matriz final abaixo; aprovação desse laboratório não significa integração/homologação do FinElo, Auth remoto ou PWA instalado.

## Comparação de alternativas

| Alternativa | Legado já aberto | Corrida de aba nova | Custo/limite | Decisão |
| --- | --- | --- | --- | --- |
| Corrigir só o botão/hook na UI nova | Não muda A; mensagem antiga ainda pode pedir ativação | Não enumera clientes silenciosos | Pouca mudança, garantia insuficiente | Não usar isoladamente |
| `skipWaiting:false` com handler Workbox atual | A ainda envia `SKIP_WAITING`; timer local continua | A ativação pode atingir outros clientes | É a base aprovada atual, não coordenação segura | NO-GO atual preservado |
| Veto legado + ativação antecipada após duas consultas | Nega mensagem antiga; não remove timer de A | Consulta e ativação não são uma transação com abertura de cliente | Precisaria de admissão/roteamento/retenção de recursos mais complexos | Não escolhido para esta referência |
| Esperar fechamento/saída voluntária, sem ativação antecipada | Preserva A enquanto ela continuar usando o registro | Cliente novo que usar A prolonga a espera | Atualização pode aguardar indefinidamente | Fundamento escolhido |
| Saída cooperativa para **outra origem**, com o fundamento acima | Legados seguem procedimento manual | A própria condição de ativação do navegador impede ultrapassar o novo cliente controlado | Exige origem neutra aprovada; retorno explícito; validar instalado/físico | Protótipo implementado |
| Reduzir o escopo futuro para `/app/` e usar rota neutra fora dele | Registro legado `/` precisaria de transição própria | Mesmo fundamento natural, sem origem externa | Altera URLs, escopo/manifesto e coexistência de registros | Alternativa futura, não implementada |
| Unregister/limpar caches/reload forçado | Pode apagar evidência e trabalho; não resolve resultado incerto | Mascara o problema | Não é estratégia de segurança | Rejeitado |

O browser só pode ativar naturalmente a versão em espera quando a condição de uso/eventos do registro permitir. `skipWaiting` remove essa espera; mudar somente `clientsClaim` não cria um inventário transacional de clientes. A escolha de **não antecipar** a ativação é deliberada. Referência primária: [Service Workers — Try Activate](https://www.w3.org/TR/service-workers/#try-activate).

## A — Procedimento legado e riscos reais

1. Publicar, futuramente e somente após autorização, uma versão em espera que não aceite o atalho legado `SKIP_WAITING`. Não aplicar o patch parcial R2 isoladamente como se fosse solução completa.
2. Não orientar o usuário a clicar no botão antigo enquanto houver trabalho. A orientação precisa existir fora do código já aberto, por exemplo no roteiro de suporte/publicação aprovado; nenhum aviso novo consegue substituir retroativamente aquele código.
3. Concluir importações, pagamentos, confirmações, formulários e demais operações pelo fluxo existente. Confirmar o resultado real. Uma mensagem de erro, um spinner que sumiu ou o envio de um POST não demonstram ausência/conclusão de commit.
4. Se o resultado for incerto, verificar o histórico/resultado pelos meios existentes antes de repetir ou abandonar a operação. **Não repetir a escrita automaticamente.** Uma recuperação que exigisse mudar processamento/idempotência/serviços financeiros seria outro escopo.
5. Depois de salvar/concluir, sair voluntariamente de **todas** as páginas que ainda usam o registro antigo: fechar as abas/janelas ou navegar para fora da origem/escopo. Uma aba antiga silenciosa, inclusive em outro desktop/janela do mesmo perfil, pode manter a espera.
6. Voltar voluntariamente e verificar a versão efetivamente carregada. Se ainda for A, não declarar sucesso: algum cliente/evento ainda pode impedir B. A espera não se resolve com um tempo arbitrário ou com limpeza de cache.

O usuário que clicar no botão antigo ainda pode executar o timer de 1 s; F5 e fechamento também podem perder rascunhos. Uma operação aceita sem resposta pode persistir no servidor e perder o contexto de feedback no cliente fechado. A estratégia **não promete impedir essas ações**. A permanência de A, offline ou com POST pendente, não autoriza B a avançar enquanto A continuar usando o registro.

### Ensaio legado com artefatos reais congelados

`scripts/diagnostics/pwa-r2b/legacy.py` usa os quatro builds sintéticos do R1, recuperados do ZIP com SHA verificado. A instalada, tanto true como false, é **imutável**. B é uma cópia experimental do worker gerado, com o veto R2 anterior prefixado; não há modificação do worker de produto nem instrumentação inserida em A. A ativação é observada pelo domínio nativo ServiceWorker do CDP, sem criar uma janela cliente na origem da aplicação.

Há quatro sessões independentes (Edge/Chrome × política instalada true/false), cada uma com dez passos. Os passos de uma sessão compartilham deliberadamente o mesmo registro, formulários e transporte. Não são quarenta instalações independentes. O B desse ensaio preserva o bundle FinElo sintético congelado para isolar o ciclo de vida: **não é a integração da interface cooperativa ao FinElo**. Essa interface é ensaiada separadamente no laboratório B.

O transporte registra exatamente duas tentativas de Objetivo por sessão: uma resposta aceita observada e um commit sintético sem entrega da resposta, seguido de fechamento manual. Não importa faturas reais nem usa backend externo. O recebimento positivo devolve o payload esperado pelo serviço existente; os valores são comparados, e nenhuma regra de gravação do produto é alterada. O cenário sem resposta não é convertido em sucesso financeiro do cliente.

Os primeiros passos usam 390×844. A conclusão por “Salvar” é exercitada em desktop 1440×1000, explicitamente registrada; não certifica que o prompt antigo deixe todos os controles acessíveis no mobile. A usabilidade do overlay legado e a instalação física permanecem limites de homologação.

## B — Referência cooperativa executável

Laboratório autônomo em `scripts/diagnostics/pwa-r2b/`, servido por Python somente em loopback:

- `http://127.0.0.1:5221`: documento A/B, worker, recursos versionados e API **sintética em memória**.
- `http://127.0.0.1:5222`: página neutra estática, sem sessão, conta, payload financeiro, polling da aplicação ou afirmação de sucesso.
- O ensaio legado usa a origem histórica 5210 e, em execução separada, a página neutra 5222. Os executores não compartilham servidores simultaneamente.

```mermaid
sequenceDiagram
    participant U as Aba iniciadora A
    participant W as Worker B em espera
    participant P as Outras abas A
    participant N as Origem neutra
    participant UA as Navegador
    U->>U: Tentar trava exclusiva de trabalho
    U->>W: BEGIN com request novo
    W->>W: clients.matchAll inclui desconhecidos
    W->>P: Desafio prepare, nonce e epoch
    P-->>W: clean + barreira, ou bloqueio
    U->>W: COMMIT
    W->>P: Novo desafio e inventário
    P-->>W: Nova confirmação ou negação
    Note over U,P: Qualquer bloqueio cancela; ninguém é recarregado
    P->>N: Somente clique próprio, revalidação local limpa
    U->>W: LEAVE, iniciadora por último
    W-->>U: Saída permitida, sem ativação antecipada
    U->>N: Clique próprio; nenhum cliente A restante
    UA->>UA: Ativação natural de B
    N->>UA: Retorno voluntário à aplicação
    UA-->>U: Documento, controlador e recursos B verificados
```

### Identidade, inventário e prontidão

O worker usa `clients.matchAll({type:'all',includeUncontrolled:true})`; BroadcastChannel não decide inventário. Clientes são identificados por `Client.id`, documento por epoch aleatório, rodada por ID aleatório, cada desafio por nonce novo. ACK exige porta dedicada, nonce/rodada/epoch e estado atual. Nenhuma mensagem leva usuário, sessão ou valores.

Estados explícitos: `clean`, `dirty`, `pending`, `unknown`. Silêncio, resposta inválida, caminho não coberto ou resultado incerto nunca significam `clean`. Um worker cliente desconhecido também bloqueia. A versão do worker em espera é o destinatário concreto; troca/reinício perde a rodada, não restaura consentimento a partir de storage antigo.

### Exclusão mútua e barreira de novo trabalho

Cada escopo de edição/operação segura uma Web Lock **compartilhada**. Uma tentativa de atualização precisa obter a mesma lock em modo **exclusivo**, com `ifAvailable:true`: falha imediatamente se houver trabalho ou outro coordenador. A referência mantém a lock até cancelar/expirar/sair por último. A abertura do formulário ocorre **depois** de adquirir sua lock; campos não ficam editáveis antes disso.

O worker faz duas rodadas e inventários frescos. Mudança de membros, epoch ou estado invalida o compromisso. Uma nova operação depois do primeiro ACK não pode obter lock; uma injeção de caminho sem cobertura, ensaiada separadamente, devolve `unknown` na segunda rodada. Referência: [Web Locks — modos e aquisição condicional](https://w3c.github.io/web-locks/#api-lock-request).

ACK: **700 ms**; resposta RPC: **1.800 ms**; lease: **8.000 ms**. São limites fixos do laboratório. Expiração/timeout **negam ou cancelam**; não autorizam ativação, não completam operações e não causam reload. Os prazos não foram aumentados para aprovar casos. A suspensão de um coordenador pode reduzir disponibilidade até ele retomar/fechar; isso não permite ultrapassá-lo.

### Saída própria e a corrida após a última consulta

Cada aba precisa clicar em “Continuar nesta aba”. O worker revalida o cliente; o documento revalida token, prazo e registro de trabalho imediatamente antes da navegação, sem `await` entre a última verificação local e `location.assign`. Uma aba não chama `reload`/`navigate` de outra. A iniciadora precisa ser o último cliente observado.

A janela de corrida **não é ignorada**: se uma aba controlada por A surgir depois do último inventário e antes da saída da iniciadora, a condição natural do navegador continua impedindo B de ativar. Essa aba pode prolongar/cancelar a passagem; não é descartada para cumprir uma contagem. Isso é ensaiado tanto com cliente cooperativo em admissão quanto com cliente sem protocolo e rascunho.

Não existe uma RPC de ativação nem chamada `skipWaiting`/`clients.claim` na referência. O único reload próprio é a entrada manual da primeira instalação, antes de liberar a UI ou qualquer trabalho, com guarda `!booted && clean`. O retorno prematuro da página neutra pode carregar A; a tela exibe/verifica A, não inventa sucesso B.

### Recursos, resultado financeiro e sessão sintética

Cada build tem documento/JS/CSS/SVG imutáveis, caches separados e hashes. Um worker A recusa recurso B com 409; não substitui pelo recurso de outra versão. HTML, runtime, CSS, URLs e bytes observados são confrontados. Nenhuma resposta `/api/` entra em cache; não há fila de escrita, replay, compensação ou deleção de caches.

A API do laboratório usa inteiros em centavos e um identificador **sintético de teste**. Não possui idempotência para compensar falhas: repetir um POST incrementaria de novo e seria detectado. Aceitação, recusa, resposta retida, conexão interrompida e aceitação sem resposta têm efeitos distintos. `pending` dura até resultado e feedback observados; incerteza conserva o bloqueio. A reconciliação é uma consulta explícita, sem reenvio do POST.

Esse ID/result endpoint é instrumento do servidor fictício, **não proposta de novo payload ou serviço financeiro do FinElo**. O port deverá usar os contratos/consultas já existentes; se não houver certeza recuperável, o estado deve permanecer desconhecido. Uma nova regra de idempotência/persistência exigiria outro escopo.

O laboratório preserva preferência Claro/Escuro/Automático e identidade QA na origem original; a página neutra não os recebe. Isso não testa SDK Auth, RLS ou duas contas reais. O ensaio FinElo legado compara identidade/preferência e coleções sobre o transporte sintético, sem expor tokens.

### Suspensão: evidência e limites

As tentativas com `Page.setWebLifecycleState(frozen)` não produziram confirmação do evento `freeze`. Seus FAILs/timeouts foram preservados; retorno do comando não foi tratado como suspensão comprovada. As execuções seguintes distinguem **emulação CDP de execução JavaScript desabilitada** e **injeção do contrato do evento de lifecycle**. Nenhuma dessas duas técnicas homologa suspensão física.

A referência contém tratamento conservador do evento: marca `unknown`, cancela a tentativa, preserva campos/operações e exige confirmação de retomada. Expiração de coordenação pode permitir novo trabalho em A depois do cancelamento; não se exige deadlock como prova de segurança. A checagem é que B não ultrapasse o cliente nem perca esse novo trabalho.

## Proposta completa de alterações e diff para revisão

O diff executável deste ciclo é **a referência isolada**, dividido em interface, worker e migração/harness. Os três arquivos `proposta-r2b-interface.patch`, `proposta-r2b-worker.patch` e `proposta-r2b-migracao.patch` adicionam apenas caminhos de diagnóstico sobre a base `25a218d`. Não são um patch já homologado de integração no FinElo; não contêm alterações aplicadas a `src` ou ao worker de produto.

O port futuro precisa destes três grupos, sujeitos a autorização específica:

| Grupo | Alterações necessárias no produto/infraestrutura | Critério para autorizar |
| --- | --- | --- |
| Interface | Substituir `useRegisterSW`/timer de `ReloadPrompt` por registro sem listeners implícitos de reload; núcleo de registro e locks; admissão antes do trabalho; estado de suspensão; banner por rodada e saída própria | Todos os pontos de trabalho e feedback cobertos; desconhecido bloqueia; nenhuma mudança financeira |
| Adaptadores de trabalho | Instrumentar pontos de abertura/edição/submissão/importação/confirmar/resultado nas telas e modais do inventário R2; considerar jobs automáticos iniciados pelo shell/store e troca de sessão | Revisar cada entrada; não inferir conclusão de spinner/fetch; não alterar cálculos, serviços, payloads ou RLS |
| Worker | Veto a **todos** os caminhos legados de ativação antecipada antes do handler gerado; protocolo/inventário; manter espera natural; não tomar clientes não controlados; revisão exata dos artefatos | Remover/impedir handler `SKIP_WAITING` acessível, provar nenhuma ativação antecipada e versões corretas no build real |
| Migração | Origem neutra aprovada, TLS, retorno fixo/allowlist, sem cookies compartilhados ou dados, roteiro de salvar/concluir/fechar/voltar e aceitação dos resíduos legados | Testar Auth remoto, PWA instalado e dispositivos; validar realmente sair do escopo |
| Recursos | Manter artefatos imutáveis por build e política de retenção comprovada; não limpar caches para aprovar teste | Pacotes A/B reais, navegações/cache offline e restauração ensaiados |

Não há permissão implícita para mudar esses arquivos hoje. O plano não fica restrito à Dashboard: Objetivos, Transações/classificador, cartão/pagamento, Importação/E864, Investimentos/importação, Carteiras, Configurações/perfil e confirmações globais precisam de adaptadores explícitos. Os locais e lacunas estão no [inventário R2](evidencias-ciclo-4d-r2/inventario-estados.json). Até completar uma tela/job, sua prontidão deve ser desconhecida. Não se instala um observador genérico de DOM/fetch para fingir essa cobertura.

### Decisões pendentes para o port

- O escopo atual é `/`. A rota neutra comum na mesma origem não basta. Aprovar origem externa sem cookies de domínio compartilhados, sem terceiros/scripts/analytics e com destino de retorno fixo, ou aprovar a migração mais invasiva de escopo/URLs. As portas loopback demonstram origens distintas, mas cookies por hostname não são isolados por porta; o laboratório usa apenas storage local e sessão sintética.
- Um PWA instalado pode abrir o destino externo **em outra janela/navegador**, deixando o cliente antigo vivo. Isso deve manter B esperando, mas pode inviabilizar a UX até o usuário fechar o app. Não foi homologado em aparelhos.
- Mudança de `clientsClaim` sozinha não neutraliza `skipWaiting` para clientes já controlados. A referência evita antecipação e também não reivindica clientes não controlados. As duas decisões deverão ser explícitas no diff de produto.
- Web Locks e storage precisam estar disponíveis. Falta da API, particionamento inesperado ou estado de admissão inválido devem bloquear atualização, não habilitar fallback de reload.
- Crash, descarte pelo sistema, F5 e fechamento fora do fluxo não podem receber garantia absoluta de retenção de DOM. Aviso `beforeunload`, se futuramente proposto, é auxílio e não prova de segurança.
- Se houver rollback futuro após alguma instalação, não publicar novamente um worker com ativação antecipada. Rollback deve ser uma nova versão sujeita à mesma espera e ao mesmo contrato, preservando caches/trabalho. Não houve rollback/deploy neste ciclo.

## Matrizes e rastreabilidade

As matrizes completas, passos, fontes congeladas por execução e hashes estão em `evidencias-ciclo-4d-r2b/metrics.json` e no pacote externo do manifesto. Os casos cooperativos exercitam os dois navegadores, três temas no núcleo e viewports 1280×800/390×844 conforme a execução. Não são testes em aparelho ou instalado.

Casos obrigatórios do laboratório: limpo, rascunho, pendente, incerto; três abas com estados distintos; silêncio/cliente desconhecido; execução JS suspensa; nova aba antes do commit e depois da última consulta; trabalho tardio; caminho sem cobertura; fechamento antes/depois do commit; reinício do worker; lease expirada; coordenador sem execução; tentativas concorrentes; cancelamento; offline antes/depois da escrita; resposta tardia; valores negativo/zero; recusa e contrato sintético de lifecycle.

A prova financeira do protótipo verifica ausência de repetição, exatamente os commits sintéticos esperados e saldo idêntico no retorno a B. A prova do legado preserva os FAILs das ações antigas; a versão nova não é declarada controladora retroativa de A.

Histórico mantido: [R1 aplicado](ciclo-4d-r1-pwa.md), [R2](ciclo-4d-r2-atualizacao-segura.md). ZIP R1 aplicado SHA-256 `12d8c7fa215cbb828eb0dd251898e12f0683371a0f08fc1dc731d10d26126456`; ZIP R2 `969b23124052e3a22bfeef0eefeec8985a352d4341da2354f84e6b9078de0648`. Nenhuma referência/histórico foi regravada. Uma aprovação unitária da fronteira não é aprovação do protocolo completo.

**Parecer global obrigatório: NO-GO**, enquanto PWA real, Auth remoto isolado, aparelhos físicos, acessibilidade e feedback financeiro não forem encerrados. O sucesso do protótipo, se confirmado na matriz, só fundamenta a revisão da estratégia e a definição de um futuro ciclo autorizado de integração.

## Resultados finais locais

**A — Legado: viabilidade condicional da passagem, sem eliminação dos resíduos.** Quatro sessões, 40 passos: **24 PASS / 16 FAIL residuais / zero falhas inesperadas**, exit code 1. Fechar/sair depois de concluir o trabalho permite a ativação natural. Botão antigo, F5, fechar rascunho e fechar após commit sem resposta continuam FAIL; não são aceitos automaticamente pelo responsável do produto.

| Passo | Edge true | Edge false | Chrome true | Chrome false |
| --- | --- | --- | --- | --- |
| defer-dirty | PASS | PASS | PASS | PASS |
| offline-reconnect | PASS | PASS | PASS | PASS |
| old-button | FAIL | FAIL | FAIL | FAIL |
| manual-refresh | FAIL | FAIL | FAIL | FAIL |
| close-dirty | FAIL | FAIL | FAIL | FAIL |
| save-observed | PASS | PASS | PASS | PASS |
| defer-pending | PASS | PASS | PASS | PASS |
| close-accepted-unobserved | FAIL | FAIL | FAIL | FAIL |
| natural-after-voluntary-exit | PASS | PASS | PASS | PASS |
| identity-preferences-finance | PASS | PASS | PASS | PASS |

**B — Cooperativos: referência tecnicamente viável no recorte isolado.** O artefato final completou **70/70 PASS em uma bateria única**, exit code 0; a auditoria financeira independente aprovou **70/70** expectativas de tentativas, commits e saldos. Isso não fecha o bloqueio de PWA do produto: integração, Auth remoto e suspensão/instalação física não estão homologados.

| Cenário | Tema | Edge | Chrome |
| --- | --- | --- | --- |
| clean | dark | PASS | PASS |
| dirty | dark | PASS | PASS |
| pending | dark | PASS | PASS |
| uncertain | dark | PASS | PASS |
| clean | light | PASS | PASS |
| dirty | light | PASS | PASS |
| pending | light | PASS | PASS |
| uncertain | light | PASS | PASS |
| clean | system | PASS | PASS |
| dirty | system | PASS | PASS |
| pending | system | PASS | PASS |
| uncertain | system | PASS | PASS |
| three-mixed | dark | PASS | PASS |
| silent | light | PASS | PASS |
| script-suspended | system | PASS | PASS |
| unknown-client | dark | PASS | PASS |
| new-before-commit | light | PASS | PASS |
| new-after-final-check | system | PASS | PASS |
| unknown-after-final-check | dark | PASS | PASS |
| late-work | light | PASS | PASS |
| uncovered-unknown | system | PASS | PASS |
| closed-before-commit | dark | PASS | PASS |
| closed-after-commit | light | PASS | PASS |
| restart | system | PASS | PASS |
| expiry | dark | PASS | PASS |
| owner-script-suspended-expiry | light | PASS | PASS |
| concurrent | system | PASS | PASS |
| cancel | dark | PASS | PASS |
| offline-before-write | light | PASS | PASS |
| offline-after-commit | system | PASS | PASS |
| delayed-result | dark | PASS | PASS |
| negative | light | PASS | PASS |
| zero | system | PASS | PASS |
| refused | dark | PASS | PASS |
| lifecycle-event-contract | light | PASS | PASS |

Os campos ficam somente para leitura enquanto há operação pendente/incerta no laboratório. No port real, impedir edição concorrente ou preservar uma revisão mais nova do rascunho é uma decisão explícita de interface/observabilidade, não alteração automaticamente autorizada do processamento financeiro.

### Tentativas anteriores preservadas

A bateria anterior `cooperative-verified` terminou **68 PASS / 2 FAIL**: o observador consultou o estado logo após clicar na retomada assíncrona, antes da resposta de versão. Dois reensaios com espera pela confirmação efetiva passaram, sem alterar prazos. Depois da guarda final de campos pendentes/incertos, a bateria completa foi reexecutada e produziu os 70 PASS acima, sobre fontes congeladas próprias. Não se substituiu o 68/2 por um agregado.

A execução anterior `cooperative-final` terminou **64 PASS / 6 FAIL**: aceitação/recusa rápidas já haviam sido observadas e encerrado o token antes de o observador procurar o estado pendente transitório. O recibo mostrou commits/recusas reais do transporte sintético; o observador passou a aceitar esses recibos, não o simples envio. Os seis timeouts continuam nos arquivos originais.

Também permanecem: smoke com erro de nome do observador, execução parcial interrompida durante observação de worker redundante, erro de contagem da terceira aba, suposição excessiva de retenção da trava após expiração, e tentativas de freeze sem evento confirmado. O observador final usa CDP para estados de worker, não avaliação de um worker já redundante. Nenhuma dessas correções aumenta timeout, limpa cache ou simula sucesso financeiro.

### Verificações de isolamento e regressão

- Testes focais: **29 PASS / três arquivos**, incluindo dez testes novos de isolamento e fronteira executando o worker do laboratório. Não equivalem à aprovação do protocolo completo por si sós.
- TypeScript: **14 diagnósticos conhecidos / zero novos**, exit code 0.
- Build/PWA padrão: **PASS, 49 entradas**, zero marcadores do protótipo; placeholders sintéticos e flag de aparência desligada somente no processo de build.
- Três diffs separados passam na checagem reversa sem aplicação; só adicionam caminhos de diagnóstico. Diferença de `src`, `vite.config.ts`, `public`, dependências e serviços em relação a `25a218d`: **zero**.
- O CI do HEAD de fechamento é registrado na descrição da PR #97, com SHA/run exatos. Não se reutiliza o selo de `25a218d` para aprovar código posterior.

O parecer global continua **NO-GO**, mesmo com 70/70 no laboratório. Nenhuma aceitação dos riscos legados, permissão de integração, merge, deploy, ampliação de coorte ou início de piloto foi inferida.

## Recibo do pacote externo

`finelo-ciclo-4d-r2b-evidencias.zip`: **7.855.464 bytes**, **1.021 caminhos / 733 objetos únicos**. SHA-256 **`506e9472c00eb0bea63501500ba4d36b3efef005d683085b395441b3257b42f1`**; índice **`d144b902917eb78c89a225fae36307698331be661fe288e0ed509e5a19c8a31d`**. CRC e todos os SHA foram verificados duas vezes. O Git recebe três PNGs, **155.900 bytes**, mais métricas e manifesto; logs completos ficam somente no pacote higienizado.

O relatório no ZIP precede somente este recibo. As fontes executadas e os hashes das interfaces/workers permanecem congelados por execução. O recibo de CI do commit de fechamento fica na descrição da PR para identificar o HEAD exato, sem ciclo artificial de novos commits só para gravar o selo.
