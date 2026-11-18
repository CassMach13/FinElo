# FinElo — Etapa 2 | Gerenciador de múltiplas sessões autenticadas

Data: 2026-11-14 · Branch `feat/multi-account-session-manager` (base `main` 4e827b8, com a Etapa 1 mesclada)
Situação: **implementado e testado localmente; sem merge, sem deploy, sem Etapa 3.**
Ativação: **desligada.** Para ligar é preciso a trava de build `VITE_MULTI_ACCOUNT_SESSIONS=true` (não existe em nenhum arquivo de ambiente versionado) **e** o opt-in do navegador. Em produção, nada muda.

## 1. Preparação

- **Estado da `main` e do repositório.** A `main` estava em 4e827b8 (PR #100 mesclado). A Etapa 2 foi feita num worktree separado (`C:/wt-multi`). O checkout principal tinha arquivos não versionados de outras frentes, e nada deles foi tocado.
- **Versão instalada.** `@supabase/supabase-js` e `@supabase/auth-js` estão na 2.86.0.
- **Documentação.** A documentação atual (Context7, `/supabase/supabase`) e o código da versão instalada (`GoTrueClient.js`) foram consultados. As conclusões que guiaram o desenho:
  - **`storageKey`.** O padrão é `sb-<ref>-auth-token`. O lock entre abas usa `lock:<storageKey>` (`navigator.locks`), e o BroadcastChannel do SDK também usa o nome da chave. Chaves distintas por conta isolam a sessão, o lock e os eventos.
  - **`getUser`.** Valida no servidor. `getSession` só lê o armazenamento e renova se o token estiver vencido, independentemente de `autoRefreshToken`.
  - **`refreshSession` e renovação automática.** A renovação roda dentro do lock. `_callRefreshToken` deduplica dentro da instância. Com `autoRefreshToken: false`, `_recoverAndRefresh` **não** apaga uma sessão vencida na inicialização (ela fica para renovação sob demanda). `startAutoRefresh`/`stopAutoRefresh` controlam o ticker manualmente.
  - **`onAuthStateChange`.** Emite `INITIAL_SESSION` a cada novo assinante. Um callback de URL emite `SIGNED_IN`/`PASSWORD_RECOVERY` via `setTimeout(0)` depois de gravar a sessão. Chamar o Auth dentro do callback trava o lock.
  - **`signOut()` sem escopo.** O escopo padrão é `global`: revoga todas as sessões do usuário, inclusive em outros dispositivos.
  - **`signOut({ scope: 'local' })`.** Também chama `/logout` na rede. Com erro de rede ou 5xx, o SDK **mantém** a sessão. Daí a dependência de `_removeSession` (contrato interno já fixado por teste na Etapa 1).

## 2. Inventário do cliente global (antes da Etapa 2)

São 27 arquivos que importam o cliente global, **todos selados**. Contagem por arquivo (`from` / `rpc` / `functions` / `auth` / gravações):

| Arquivo | from | rpc | fn | auth | grav. |
|---|---:|---:|---:|---:|---:|
| `src/hooks/useAppStore.ts` | 60 | 5 | 0 | 25 | 39 |
| `src/services/creditCardEngineService.ts` | 32 | 0 | 0 | 0 | 16 |
| `src/services/creditCardStatementService.ts` | 18 | 0 | 0 | 0 | 9 |
| `src/services/investmentService.ts` | 16 | 0 | 0 | 0 | 7 |
| `src/services/investmentStructureService.ts` | 11 | 0 | 0 | 2 | 7 |
| `src/services/creditCardAtomicRebuildService.ts` | 8 | 12 | 0 | 0 | 0 |
| `src/services/competenceInvoiceUserConfirmations.ts` | 6 | 0 | 0 | 0 | 3 |
| `src/services/openFinanceService.ts` | 6 | 0 | 0 | 0 | 4 |
| `src/services/transactionEconomicIdentityService.ts` | 5 | 0 | 0 | 1 | 1 |
| `src/services/invoicePaymentDeletion.ts` | 3 | 0 | 0 | 0 | 2 |
| `src/services/cardReconciliationService.ts` | 2 | 0 | 1 | 0 | 0 |
| `src/services/economicEventService.ts` | 2 | 0 | 0 | 1 | 2 |
| `src/services/productAnalytics.ts` | 1 | 0 | 0 | 1 | 1 |
| `src/services/currentCardEconomicInputs.ts` / `currentNetWorthSources.ts` | 1 cada | 0 | 0 | 0 | 0 |
| `src/services/userActivityService.ts` | 0 | 1 | 0 | 0 | 0 |
| `src/components/views/TransactionsView.tsx` | 7 | 0 | 0 | 0 | 1 (`import_logs`) |
| `src/components/views/ImportView.tsx` | 3 | 0 | 0 | 1 | 3 (`import_configs`) |
| `src/components/investments/InvestmentOwnerSelector.tsx`, `src/components/dashboard/DashboardOwnerSelector.tsx`, `src/hooks/useFamilyOwnerContext.ts` | leitura | | | | 0 |
| `src/components/modals/InviteMemberModal.tsx` | 1 | 0 | 0 | 1 | 0 |
| `src/App.tsx`, `src/components/views/AuthView.tsx`, `src/components/views/UpdatePasswordView.tsx`, `src/components/modals/TermsModal.tsx`, `src/components/appearance/AppearanceSessionSync.tsx` | 0 | 0 | 0 | Auth | 0 |

- **Storage e Realtime.** Não há chamadas de Storage nem de Realtime.
- **OAuth e cadastro.** Ficam em `src/services/acquisitionAuth.ts`, que já recebe o `auth` por parâmetro e portanto é vinculável sem alteração.
- **Login por senha.** Fica em `src/components/views/AuthView.tsx`.

## 3. Arquitetura implementada

### 2A — gerenciador e armazenamento isolado (módulos novos, não selados)

- **`src/domain/session/accounts/accountStore.ts`.** Registro de contas lembradas (`finelo.sessionAccounts.v1`).
  - Guarda só `userId` confirmado pelo Auth, e-mail para exibição, datas e `signedOut`. **Sem senha e sem token.**
  - No máximo 5 contas, sem duplicatas, e o registro é saneado na leitura.
  - Chaves determinísticas `sb-<ref>-auth-token.account.<uuid>`; só UUID vira nome de chave.
  - A conta ativa é **por aba** (`sessionStorage`). Uma aba nova assume a conta usada por último.
  - Não há criptografia própria: `localStorage` não é cofre contra XSS, e isso está declarado no código.
- **`src/domain/session/accounts/accountManager.ts`** (`SessionAccountManager`):
  - **Pool de clientes.** Um cliente supabase-js por conta e por aba, nunca dois para a mesma chave. Todos usam `autoRefreshToken: false` e `detectSessionInUrl: false`.
  - **Cliente pendente.** Tem chave `…pending.<slot>` e é o **único** que lê a URL de callback. A sessão só vira conta depois que `getUser` (rede) confirma o dono; o `sub` do JWT local nunca decide. Com outra conta ativa na aba, a nova é só registrada, e a troca é explícita.
  - **Fachada `client`.** É o que `supabase` exporta no modo de várias contas e aponta para a conta ativa **desta aba**. Antes de concluir um callback, as chamadas de Auth esperam a adoção.
  - **Multiplexador de `onAuthStateChange`.**
    - Encaminha ao app só os eventos da conta ativa da aba, e nenhum durante a troca.
    - Emite `INITIAL_SESSION` a cada assinante e reenvia `PASSWORD_RECOVERY` de callback.
    - `SIGNED_OUT` de qualquer conta marca o registro.
  - **Renovação.** Só a conta ativa, só com a aba visível e fora de uma troca (`startAutoRefresh`/`stopAutoRefresh`). Entre abas, a mesma conta é serializada pelo lock do SDK.
  - **Fetch por conta (`createAccountFetch`).** Aplica as regras R0–R2 da Etapa 1. Uma regra nova bloqueia a requisição se o token que sairia não for da conta dona do cliente. O fetch também conta as requisições em voo, para o ponto quieto.
  - **Saída e remoção.**
    - `signOutAccount`: escopo `local`, a conta continua lembrada.
    - `removeAccount`: encerra a sessão, esquece a conta e apaga as chaves.
    - `signOutAll`: encerra todas e esvazia o registro.
- **`src/domain/session/accounts/multiAccountSessions.ts`.** Ativação com duas travas (build + opt-in).
  - Faz a migração do armazenamento de conta única (`migrateLegacySession`): validação prévia com `getUser`, cópia sob `lock:<chave antiga>`, nova validação na chave nova, e só então apaga a chave antiga. **Não chama `signOut`**, porque isso revogaria a sessão; qualquer falha desfaz a cópia.
  - Avisa as outras abas (`mode-changed`) para recarregarem.

### 2B — integração segura

- **Cliente vinculado à operação** (`src/domain/session/operationBinding.ts` + `sessionCommitFence.ts`). A cerca de commit da Etapa 1 já reexecuta o criador do store a cada chamada de ação. Agora, nessa reexecução síncrona, o cliente da conta ativa é capturado, e o criador o guarda numa constante local (`const supabase = operationClient(sharedSupabase)`). **Todo o código da ação, inclusive depois de `await`, usa o cliente da conta que a iniciou.** As ações fora da cerca (`setUser`, `signOut`, `fetchFounderCount`) usam o cliente compartilhado.
- **Protocolo transacional de troca, em 9 passos** (`src/domain/session/accounts/accountSwitch.ts`):
  1. Identifica a sessão atual e as operações pendentes.
  2. **Espera o ponto quieto:** nenhuma ação do store e nenhuma requisição em voo, confirmado depois de uma volta do loop. Não cancela gravação em andamento, que termina na conta que a iniciou. Sem ponto quieto em 15 s, a troca é **recusada sem mudar nada** (`operations_pending`).
  3. Invalida a geração visual (`endSession`; R0 bloqueia token de usuário) e bloqueia a interface.
  4. Limpa o store e os diálogos (que fecham como "cancelar").
  5. Seleciona a instância da nova conta.
  6. Valida com `getUser`.
  7. Atualiza a identidade (store, epoch, conta da aba, instância da sessão).
  8. Recarrega os dados.
  9. Libera a interface.

  Uma falha em 6 faz **rollback** para a conta anterior, sem novo login. Sessão revogada ou expirada marca **só a conta de destino** para novo login; erro de rede mantém a sessão dela.
- **Ações internas** (`src/domain/session/accounts/appAccountSessions.ts`; sem interface, que é a Etapa 3):
  - `switchActiveAccount`;
  - `signOutActiveAccount` (sair da conta atual, escopo local);
  - `removeRememberedAccount` (remover deste navegador);
  - `signOutEveryAccount` (sair de todas);
  - `listRememberedAccounts`;
  - `authForAddingAccount`.
- **Arquivos selados alterados** (exceção exata, aprovada em 2026-11-14; seção 6):
  - **`src/supabaseClient.ts`.** No modo de várias contas exporta a fachada; senão, o **mesmo** `createClient` de antes, com as mesmas opções.
  - **`src/App.tsx`.** Durante os passos 3–9, mostra a `AuthLoadingScreen` já existente.
  - **`src/hooks/useAppStore.ts`.** Captura do cliente por chamada de ação (+8/−1 linhas). Nenhuma regra financeira mudou.
- **Módulos da Etapa 1 ajustados** (não selados):
  - `sessionSignOut.ts`: escopo `local` opcional; sem escopo, o comportamento é idêntico.
  - `sessionFence.ts`: exporta helpers.
  - `sessionCommitFence.ts`: captura do cliente.

## 4. Serviços migrados e chamadas globais remanescentes

| Origem | Como fica vinculado | Proteção |
|---|---|---|
| Ações do store (60 `from`, 5 `rpc`, 25 `auth`) | **Vinculação explícita** por ação (`operationClient`) | Cliente capturado no início, com a cerca de commit e as regras R0–R2 |
| 15 serviços e 2 helpers de módulo do store (`mutateGoal`, `readAtomicImportEligibility`) | Fachada (alvo no momento da chamada) | Chamados de ações rastreadas, a troca só muda o alvo **no ponto quieto**; regras R0–R2 e o token tem de ser da conta do cliente |
| Componentes (gravações em `import_configs` e `import_logs`, leituras de família) | Fachada | O ponto quieto também conta requisições em voo (laços sequenciais terminam antes da troca); a interface fica desmontada durante a troca; R0 entre os passos 3 e 7 |
| Auth (`AuthView`, `UpdatePasswordView`, `TermsModal`, `AppearanceSessionSync`, `App`) | Fachada (conta ativa ou login pendente) | O multiplexador de eventos e a adoção confirmada pelo Auth |

Os serviços **não** receberam cliente por parâmetro nesta etapa. Isso tocaria 15 arquivos selados a mais, e a garantia equivalente vem do ponto quieto. Fica como evolução gradual possível, listada nos riscos.

## 5. Testes

- **Focais Etapa 2** (`tests/security/multiAccount/`, supabase-js **real** e servidor Auth/REST falso; cada "aba" é um grafo de módulos isolado sobre o mesmo `localStorage`): **25/25**. Cenários do pedido:
  1. A→B→A sem novo login, nos 9 passos, sem logout no servidor.
  2. A e B simultâneas em abas diferentes, cada uma com o seu token.
  3. Gravação de A em voo enquanto B trabalha noutra aba: sai como A.
  4. Resposta tardia da primeira sessão de A: troca recusada no prazo. Mesmo com a aba virando por baixo, a operação nunca usa o cliente de B, e o commit é descartado.
  5. Troca durante importação: espera a importação rastreada e o laço não rastreado; 6 de 6 gravações saem como A, e a seguinte já sai como B.
  6. Renovação simultânea entre abas: 1 chamada de refresh. Só a conta ativa renova.
  7. B revogada: só B pede novo login, e A fica intacta.
  8. Remover B preserva A (logout `local` só de B) e propaga para a outra aba.
  9. Sair da conta atual (A, escopo `local`): B continua utilizável sem senha, e A exige novo login.
  10. Recarregar a página restaura a conta da aba; uma aba nova abre com a última conta usada.
  11. Falha de rede na troca: rollback para A, e B continua com sessão.
  12. Migração do armazenamento de conta única: válida, recusada e "já ativada". A sessão não é revogada.
  13. Callback OAuth: com o `sub` local forjado como "A", o Auth diz B e a sessão vai para B. Só o cliente pendente lê a URL; sessão inválida não é lembrada.
  14. Acesso familiar: com B ativa, tudo sai como B. Sessão de A plantada na chave de B é bloqueada.
  15. Nenhum token ou senha em logs, erros, resultados ou registro.

  Além desses: registro (limite de 5, sem duplicatas, saneamento); multiplexador de eventos; store **real** usando o cliente da conta que iniciou a ação; invariância do modo de conta única.
- **Mutação:** **18/18 mutantes mortos** (script em scratchpad, cada mutante quebra uma garantia e roda a suíte focal). A 1ª rodada matou 13/18; os 5 sobreviventes (token de outra conta mascarado pela R1, sessão 401 não apagada pelo SDK, eventos no meio da troca, conta da aba × última usada, interface liberada antes da recarga) revelaram lacunas de TESTE — sem defeito de código — e ganharam cenários próprios (inclusive 7b: Auth responde 401); na 2ª rodada, 5/5 mortos..
- **Correção da 2C (`fc379d9`, seção 11):** +6 cenários (login só resolve após a adoção; recarga no meio da adoção; aba com conta escolhida; rede caindo na adoção; Auth recusando no boot; aba duplicada). Focais **31/31**; mutação da correção **7/7 mortos**; suíte completa **3585 aprovados, 1 pulado, 0 falhas**; baseline TS 13 (nenhum novo); build OK. Nenhum arquivo selado alterado.
- **Suíte completa (entrega original):** **224 arquivos, 3579 aprovados, 1 pulado, 0 falhas** (antes: 3546/1; +33 testes novos), com as variáveis placeholder do CI. Selos, segurança e transações: todos verdes com a nova camada encadeada..
- **Baseline TypeScript:** 13 diagnósticos conhecidos, nenhum novo.
- **Build:** `vite build` OK (PWA gerado, 49 entradas no precache)..

## 6. Selo — exceção exata APROVADA (2026-11-14)

- **Patch.** `tests/security/approved-multi-account-sessions.patch` (91 linhas) toca **só** os três arquivos selados listados.
- **Hashes.** `before` é o `approved` da Etapa 1 rev. 2:

  | Arquivo | before | approved |
  |---|---|---|
  | `src/hooks/useAppStore.ts` | `42f097f7…` | `718e6284…` |
  | `src/App.tsx` | `469a731a…` | `d2edded6…` |
  | `src/supabaseClient.ts` | `5d5968c3…` | `c870b1aa…` |

- **Encadeamento.** A camada vem antes da Etapa 1: Etapa 2 → Etapa 1 → gravação manual. Arquivos de teste ajustados só para encadear a camada: `approvedManualSave.ts`/`.spec.ts`, `approvedSessionIsolation.spec.ts`, `remainingSession.spec.ts`.
- **Spec novo** (`approvedMultiAccountSessions.spec.ts`). Verifica:
  - o hash exato e a reversão byte a byte;
  - a cadeia sem lacuna;
  - que uma edição extra reprova;
  - que o patch toca só os 3 arquivos;
  - que **nenhum outro arquivo selado mudou** desde a `main`.
- **Aprovação.** Aprovada explicitamente pelo responsável em 2026-11-14 sobre o conteúdo exato de `2074af5` (hashes acima, conferidos no commit antes do registro). Qualquer nova edição nesses três arquivos exige regenerar o patch e nova aprovação.

## 7. Impacto em login, logout e OAuth

- **Conta única (padrão, e produção).** Nenhum. O cliente é o mesmo `createClient`, com as mesmas opções. O `operationClient` devolve o próprio cliente global, e o gate da troca é sempre `false`. Isso é verificado por teste.
- **Várias contas (trava + opt-in):**
  - **Login por senha e cadastro** (pela fachada, sem conta ativa) acontecem no cliente pendente. A sessão é adotada depois do `getUser`, e o app recebe `SIGNED_IN` como antes.
  - **OAuth.** O callback é lido só pelo cliente pendente; o `flowType` continua implícito.
  - **Recuperação de senha.** `PASSWORD_RECOVERY` é encaminhado depois da adoção.
  - **Logout do botão "Sair" existente.** Inalterado: escopo global da conta atual (como hoje), sem afetar as outras contas do navegador.
  - **Novos.** "Sair da conta atual" (escopo `local`), "Remover conta deste navegador" e "Sair de todas" estão disponíveis na API interna.
- **Preservados:**
  - **Preferências de aparência:** o `persistAppearanceTheme` é capturado por token.
  - **AppLock:** não é autenticação, e nada foi baseado no PIN.
  - **RLS e acesso familiar:** sem mudança no banco.
  - **Validação de inicialização:** `getUser` antes de exibir dados.
  - **PWA:** sem mudança no SW.

## 8. Compatibilidade com a Etapa 1

- **Regras e mecanismos mantidos.** R0, R1, R2, o epoch, a cerca de commit e o logout que esquece a sessão local continuam valendo e são reutilizados.
- **Testes.** Todos os testes da Etapa 1 continuam verdes.
- **Selo da Etapa 1.** A exceção dela não foi alterada; a nova camada a precede.

## 9. Riscos residuais

1. **Homologação em navegador feita (seção 11), com lacunas.** `navigator.locks`, abas reais, `sessionStorage` por aba e login por senha foram exercitados contra o staging. **Não** foram exercitados no navegador: callback OAuth real (Google/GitHub), link de recuperação de senha (segue bloqueado no staging: domínio de exemplo recusado pelo Auth) e aba duplicada pelo navegador (só em teste). A troca com rede caindo e a sessão revogada de B ficaram só nos testes (cenários 7, 7b, 11).
2. **Serviços e helpers de módulo pela fachada — FECHADO na revisão (seção 12).** A avaliação original estava errada: uma continuação de A suspensa fora do cliente (Promise, timer, processamento local, confirmação) retomava depois da troca e gravava com o token de B. Inserção que depende de `auth.uid()`/`user_id` padrão seria aceita pela RLS dentro dos dados de B. Correção: a troca concluída reinicia a página, e a fase `switching` bloqueia a rede da aba até lá. Melhoria futura (exige exceção de selo): passar o cliente por parâmetro nos serviços de gravação, para trocar sem reiniciar a página.
3. **Ação que chama outra ação depois de uma troca.** A ação interna captura o cliente no momento da chamada interna. A troca só acontece no ponto quieto, e a R2 bloqueia gravações enquanto houver operação de geração anterior.
4. **`localStorage` não é cofre.** Um XSS lê todas as sessões lembradas (até 5), como já lia a sessão única.
5. **Aba duplicada pelo navegador.** Copia o `sessionStorage`: abre na mesma conta (desejável) e com o mesmo slot de login pendente. Se as duas cópias adotarem a mesma sessão pendente, só uma adota e a outra não derruba a sessão (teste próprio); a cópia que não adotou fica sem conta até recarregar. A atribuição continua correta, porque vem do Auth.
8. **Login pela fachada agora espera a adoção** (uma chamada `getUser` a mais antes de o login resolver). Adoção recusada volta como erro de Auth na tela de login, com mensagem própria (limite de 5 contas, sessão não confirmada, rede).
6. **Migração com validação falha depois de uma renovação.** Cenário contraditório, mas possível com queda de rede no meio: a sessão de conta única pode precisar de novo login.
7. **Botão "Sair" existente usa escopo global.** É o comportamento atual; a escolha por `local` no modo de várias contas fica para a Etapa 3.

## 10. Veredito

> **Atualizado na revisão de 2026-11-18 (seção 12):** a entrega de 2026-11-14 tinha uma falha real de concorrência (gravação de A com a identidade de B) e um teste de selo que falhava no CI. As duas estão corrigidas; o veredito vigente está na seção 12.

**GO com limitações para a Etapa 2 (internamente; continua desligada).** O gerenciador, a integração segura e a exceção de selo (aprovada em 2026-11-14) estão provados por teste local e por homologação em navegador real contra o staging (seção 11). A 2C achou **um defeito real**: o login navega antes da adoção, deixando a sessão presa no slot pendente. Ele foi corrigido em `fc379d9`, sem tocar em arquivo selado, e reverificado no navegador. Limitações para qualquer ativação: OAuth real e link de recuperação não exercitados no navegador (risco 1); serviços protegidos por ponto quieto, e não por cliente explícito (risco 2); o botão "Sair" atual segue global (risco 7, Etapa 3). Nada foi mesclado, publicado ou ativado; a trava não está em nenhum ambiente versionado; a Etapa 3 não foi iniciada.

## 11. Homologação 2C em navegador (2026-11-14)

**Ambiente.** Servidor local `vite --mode staging` em `127.0.0.1:5199`, com `VITE_MULTI_ACCOUNT_SESSIONS=true` só nesse processo. O destino das chamadas foi confirmado como o projeto de staging. Contas QA A e B: login feito pelo responsável no painel do navegador; nenhuma senha foi digitada pelo agente. Identificadores aparecem só pelos 4 últimos caracteres e nenhum token foi registrado (comparação de token por prefixo de SHA-256). Nenhum dado financeiro foi gravado: só chamadas normais de Auth e leituras do app. Ao final: servidor parado, `.env.staging` copiado removido e chaves de teste apagadas da origem local.

| # | Verificação | Resultado |
|---|---|---|
| B1 | Migração da sessão de conta única de A para o gerenciador | PASS: mesma sessão antes/depois, chave antiga removida, registro só com metadados |
| B2 | Recarga após a migração | PASS: A ativa sem novo login, só A renova, painel de A |
| B3 | Login de B numa aba sem conta | **FALHA → corrigido.** A tela de login navega (`location.assign`) assim que `signInWithPassword` resolve, e isso interrompia a adoção (`getUser` em rede). A sessão de B ficava presa no slot pendente e a aba voltava para A. Correção `fc379d9`: (a) login pela fachada/`pendingAuth()` só resolve depois da adoção, e recusa vira erro; (b) sessão pendente da aba é adotada no boot |
| B3′ | Mesma sessão presa, depois de recarregar com a correção | PASS: B adotada no boot (registro [A, B], slot pendente vazio); a aba, que tinha escolhido A, continuou em A |
| B4 | Troca A→B e B→A na mesma aba, sem novo login | PASS: `ok`; 20 requisições REST por troca, **todas** com o portador da conta de destino; `getUser` só da conta de destino; 0 `/token`; saudação da conta certa; só a conta ativa renova |
| B5 | Duas abas ao mesmo tempo (A e B) | PASS: aba A com 16 REST, todas A; aba B com todas B; cada aba renova só a sua conta |
| B6 | Recarga das duas abas | PASS: cada aba volta para a sua conta (A e B) |
| B7 | Renovação simultânea da mesma conta em duas abas (`expires_at` vencido só no armazenamento local, `getSession` no mesmo instante) | PASS: **1** `refresh_token` no total; a outra aba fez 0 chamadas de token; as duas ficaram com o mesmo token novo |
| B8 | Remover B do navegador a partir da aba de A | PASS: aba A intacta; chave de B apagada; a aba onde B estava ativa foi para `/login`, sem conta e sem dados |
| B9 | Login real de B depois da correção (aba sem conta) | PASS: logo após a navegação, B ativa, registro [A, B], slot pendente vazio, painel de B |
| B10 | Sair da conta atual (B) | PASS: sessão de B removida com confirmação do servidor (escopo local); B continua lembrada, marcada como saída; A intacta (32 REST, todas A) |
| B11 | Sair de todas | PASS: A e B encerradas com confirmação do servidor; nenhuma chave `sb-`; registro vazio; as duas abas em `/login` |
| B12 | Vazamento | PASS: nenhum token no console das duas abas, no registro, no `sessionStorage` ou na URL |

**Não exercitado no navegador:** callback OAuth real, link de recuperação (bloqueado no staging), aba duplicada pelo navegador, queda de rede no meio da troca e sessão revogada pelo servidor. Esses casos estão cobertos só pelos testes (cenários 7, 7b, 11, 13 e o teste de aba duplicada).

## 12. Revisão do PR #101 (2026-11-18): CI e concorrência

### 12.1 Falha do CI (run 43608212142) — causa confirmada e corrigida (`1e91788`)

- **Causa.** `approvedMultiAccountSessions.spec.ts` comparava com `origin/main` via `git diff`. O `actions/checkout@v5` usa `fetch-depth: 1` e não traz `origin/main`; o teste caía para `HEAD` e comparava a árvore com ela mesma: `[]` contra os 3 arquivos. O mesmo contrato quebraria depois do merge, porque `origin/main` já conteria os 3 arquivos.
- **Correção (sem git).** O manifesto `tests/security/multi-account-sessions-sealed-base.json` fixa o sha256 (LF) dos **284** arquivos selados na base da Etapa 2 (`4e827b8`, o merge-base). O contrato exige que:
  - revertida a exceção, todo arquivo selado tenha exatamente o hash da base;
  - a exceção toque exatamente os 3 arquivos aprovados;
  - o manifesto cubra exatamente o conjunto selado;
  - o hash de base dos 3 arquivos seja o `before` aprovado.

  Falta de arquivo, de entrada ou de referência reprova; nada é aprovado por ausência. Quando o commit base existe localmente, uma conferência extra (um único `git cat-file --batch`) valida o manifesto contra o git; em checkout raso ela aparece como **pulada**, nunca como aprovada.
- **Prova.** Checkout raso (1 commit, sem `origin/main`): 25 aprovados + 1 pulado. Merge simulado na main (local, descartado): 26/26. Worktree: 11/11. Mutantes do contrato **5/5 mortos**, também no checkout raso: arquivo selado editado, arquivo da exceção editado além do aprovado, entrada removida, hash forjado e caminho a mais. Patch e hashes aprovados **inalterados**; nenhum arquivo selado mudou.

### 12.2 Concorrência dirigida — FALHA REAL confirmada e corrigida

**Teste** (`tests/security/multiAccount/switchConcurrency.spec.ts`, supabase-js real + servidor falso, operação de SERVIÇO pelo cliente global, fora do `useAppStore`):
1. 1ª chamada Supabase como A;
2. espera fora do cliente: Promise pendente, timer, processamento local em etapas, confirmação do usuário;
3. a troca A → B começa nesse intervalo;
4. a operação retoma e grava (`insert`, `rpc` ou `update`).

**Resultado ANTES da correção (`1e91788`):** nas **12 combinações**, e também numa operação iniciada durante a fase `draining`, a gravação de A saiu com o **token de B** (`POST`/`PATCH` com `sub` = B, aceita pelo servidor). **Causa:** o ponto quieto só vê ações rastreadas do store e requisições em voo. A fachada resolve a conta no instante de cada chamada, e JavaScript não tem contexto assíncrono que distinga uma continuação antiga de uma ação nova. Ações do store não tinham o problema: capturam o cliente de A, e a R1/R2 bloqueia a continuação. Um builder capturado antes da espera também já era bloqueado (R1).

**Correção mínima (só arquivos não selados):**
- **A troca concluída reinicia a página no passo 8** (`SwitchHost.reload('switched')` → `location.reload()`). Toda continuação da conta anterior morre com a página, e a página nova nasce na conta da aba (`sessionStorage`). O rollback (`'rolled_back'`) não reinicia: as continuações pendentes são de A e terminam em A.
- **Barreira da fase `switching`:** do passo 3 até a página sair, todos os clientes da aba recusam REST/Storage/Functions (`account_switch_in_progress`), leituras inclusive.
- **Ponto quieto atômico:** a última verificação e a entrada em `switching` acontecem no mesmo instante, sem microtarefa no meio.

Não foi aumentado nenhum tempo de espera. O app não tem `beforeunload`, então a recarga não pode ser cancelada; se fosse, a aba ficaria bloqueada, sem gravar.

**Fase `draining`:** novas operações **podem** começar, como A (a fachada ainda é A). Se ficarem em voo, seguram a troca; se não houver ponto quieto em 15 s, a troca é recusada sem mudar nada. Se a operação nova sair da rede e retomar depois da troca, cai na barreira e depois na recarga: nunca grava como B. Uma gravação de A que retoma **antes** do ponto quieto termina como A e segura a troca: nada se perde e nada vira B.

**Resultado DEPOIS:** focais **50/50** (31 + 17 de concorrência + 2 do anfitrião real do app). Mutação: concorrência **7/7** (sem barreira; barreira só para gravações; clientes sem o predicado; troca sem recarga; app sem recarga; app recarregando no rollback; rollback recarregando); M26 (fase `switching` depois do ponto quieto) morto; anteriores 18/18 (M2 e M18 redirecionados ao código novo) e 7/7. Suíte completa **3607 aprovados / 1 pulado / 0 falhas**; baseline TS **13** (nenhum novo); build OK.

### 12.3 Produção

- Nenhuma variável `VITE_MULTI_ACCOUNT_SESSIONS` existe no projeto Vercel, em nenhum ambiente (consulta só dos nomes).
- Nenhum arquivo de ambiente versionado liga a trava, e um teste garante isso.
- A produção é construída da `main` (`4e827b8`), que não contém a Etapa 2.

### 12.4 Veredito para merge

**GO com limitações**, condicionado ao CI verde no novo SHA e à sua revisão. O PR continua em rascunho; não foi mesclado nem publicado, e a Etapa 3 não começou.

- **Riscos novos desta revisão:** nenhum em aberto. Os dois achados (CI e gravação como B) estão corrigidos e provados.
- **Mudança de comportamento a aceitar:** a troca concluída reinicia a página. Estado de interface não salvo se perde, o que já acontecia com diálogos (passo 4). A troca leva o tempo de uma carga de página.
- **Limitações já aceitas, inalteradas:**
  - OAuth real e link de recuperação não exercitados no navegador;
  - serviços sem cliente explícito (agora contidos pela recarga);
  - botão "Sair" atual com escopo global (Etapa 3);
  - `localStorage` não é cofre contra XSS;
  - aba duplicada exercitada só por teste.
