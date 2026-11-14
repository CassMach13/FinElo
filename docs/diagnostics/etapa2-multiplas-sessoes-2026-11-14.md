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
- **Arquivos selados alterados** (exceção exata, pendente de aprovação; seção 6):
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
- **Suíte completa:** **224 arquivos, 3579 aprovados, 1 pulado, 0 falhas** (antes: 3546/1; +33 testes novos), com as variáveis placeholder do CI. Selos, segurança e transações: todos verdes com a nova camada encadeada..
- **Baseline TypeScript:** 13 diagnósticos conhecidos, nenhum novo.
- **Build:** `vite build` OK (PWA gerado, 49 entradas no precache)..

## 6. Selo — exceção exata submetida (NÃO aprovada ainda)

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
- **Pedido.** Aprovação explícita da exceção sobre o conteúdo exato do commit desta branch.

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

1. **Sem homologação em navegador ainda.** Os testes usam o supabase-js real, mas `navigator.locks`, BroadcastChannel entre abas reais, `sessionStorage` em aba duplicada e o callback OAuth/recuperação real **não** foram exercitados. Isso é a 2C e precisa de login das contas QA. A recuperação de senha segue bloqueada no staging (domínio de exemplo recusado pelo Auth).
2. **Serviços e helpers de módulo pela fachada.** Ficam protegidos pelo ponto quieto, e não por vinculação explícita. Um fluxo de componente não rastreado que espere algo fora da rede (temporizador) por mais que a troca inteira poderia retomar depois dela pela fachada. Nesse caso, gravações de A sairiam com B só se B tiver acesso via RLS às linhas alvo; o caso comum é o bloqueio pela RLS. Mitigação futura: passar o cliente por parâmetro nos serviços e componentes de gravação.
3. **Ação que chama outra ação depois de uma troca.** A ação interna captura o cliente no momento da chamada interna. A troca só acontece no ponto quieto, e a R2 bloqueia gravações enquanto houver operação de geração anterior.
4. **`localStorage` não é cofre.** Um XSS lê todas as sessões lembradas (até 5), como já lia a sessão única.
5. **Aba duplicada pelo navegador.** Copia o `sessionStorage`: abre na mesma conta (desejável) e com o mesmo slot de login pendente. Um login simultâneo nas duas cópias pode perder um dos logins; a atribuição continua correta, porque vem do Auth.
6. **Migração com validação falha depois de uma renovação.** Cenário contraditório, mas possível com queda de rede no meio: a sessão de conta única pode precisar de novo login.
7. **Botão "Sair" existente usa escopo global.** É o comportamento atual; a escolha por `local` no modo de várias contas fica para a Etapa 3.

## 10. Veredito

**GO para homologação (2C) — com limitações.** O gerenciador, a integração segura e a exceção de selo estão prontos e provados por teste local (cenários 1–15 com supabase-js real, mutação 18/18, suíte completa verde). Ficam pendentes antes de qualquer ativação: (a) **aprovação explícita da exceção de selo** (seção 6); (b) **homologação em navegador real** contra o staging com as contas QA A/B — exige ligar a trava só no servidor local e o seu login nas contas, e cobre locks/abas/callback reais (risco 1). Nada foi mesclado, publicado ou ativado; a Etapa 3 não foi iniciada.
