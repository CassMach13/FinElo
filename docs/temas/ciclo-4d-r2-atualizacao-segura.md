# Ciclo 4D-R2 — proteção de trabalho durante atualização PWA

## Parecer e limite autorizado

**NO-GO. O bloqueio local não está encerrado.** Base: `11e58ddcd4dc68978cbea401e4c13a72c87fbc7a`, PR #97, branch `codex/finelo-theme-foundation`.

O diagnóstico encontrou uma dependência de política do Service Worker, fora da autorização condicional de implementação da etapa 3. Essa etapa determina: **“Se a solução exigir alterar [...] política do Service Worker [...], interromper essa parte e apresentar um patch separado para autorização.”** Por isso este ciclo não instala uma coordenação incompleta no produto. `ReloadPrompt`, Auth, serviços, persistência, `skipWaiting:false`, `clientsClaim` e caches permanecem como no HEAD de entrada.

A proposta isolada em [proposta-fronteira-worker-4d-r2.patch](proposta-fronteira-worker-4d-r2.patch) é **uma dependência necessária de contenção/inventário, não a solução completa nem um patch pronto para publicação**. Seu caminho de ativação continua negado. Ela é analisada em testes de diagnóstico, sem importá-la no worker de produto. Não transforma a ausência de protocolo em consentimento.

## Diagnóstico arquitetural

### Três caminhos independentes

1. `src/components/pwa/ReloadPrompt.tsx`: o clique chama `updateServiceWorker(true)` e agenda `window.location.reload()` após 1.000 ms, independentemente de ativação, recusa, rede ou conclusão financeira. Até um worker que recuse ativar não consegue remover esse timer de uma página antiga já carregada.
2. `vite-plugin-pwa/dist/client/build/react.js` e `register.js`, instalados pelo lockfile: o caminho `showSkipWaitingPrompt` adiciona um listener `controlling` que recarrega cada página quando `event.isUpdate`. O argumento `_reloadPage` de `updateServiceWorker` não desliga esse listener. Passar `false` não corrige o problema.
3. `workbox-build/build/templates/sw-template.js`: com `skipWaiting:false`, o gerador instala um handler que chama `self.skipWaiting()` ao receber `SKIP_WAITING`, sem inventário, prontidão, nonce ou transação. `clientsClaim:true` faz a ativação atingir outros clientes. Uma trava só no botão novo não impede uma mensagem emitida pelo botão antigo.

Os 12 testes em `tests/appearance/pwaR2Boundary.spec.ts` executam o handler do **gerador realmente instalado**, junto da proposta isolada. PASS nesses testes significa validar o diagnóstico/negação da proposta, **não aprovar segurança do produto**.

### Descoberta de clientes

O canal de aparência existente (`src/domain/appearance/session.ts`, `AppearanceSessionSync.tsx`) é um sinal sem dados financeiros, validado por conta. Não é inventário de abas ou protocolo de prontidão. O SDK Auth também possui comunicação própria; não foi alterado nem utilizado como coordenação PWA.

BroadcastChannel só entrega mensagens a participantes inscritos. Silêncio não diferencia “não existe outra aba” de “existe uma aba antiga, suspensa ou sem protocolo”. `navigator.serviceWorker.getRegistrations()` enumera registros, não os clientes de cada registro. A interface `Clients` é exposta no Service Worker. Referências primárias: [Service Workers — Clients](https://www.w3.org/TR/service-workers/#clients-interface), [WHATWG — BroadcastChannel](https://html.spec.whatwg.org/multipage/web-messaging.html#broadcasting-to-other-browsing-contexts).

Consequência: autorização segura não pode se basear exclusivamente em uma coleção de `HELLO`/heartbeats mantida na janela. É necessário inventário pelo worker, incluindo clientes não controlados e desconhecidos. O inventário não equivale a prontidão.

### Migração: A já carregada continua sendo A

Há dois problemas distintos: impedir B de ativar sobre clientes antigos e impedir a própria A de executar seus timers/reloads. Uma alteração de TSX em B não muda o JavaScript já executando em A; inserir o protocolo retroativamente em A seria falsear o teste de migração.

O ensaio `pwa-r2-migration-boundary.py` usa A imutável e B **explicitamente experimental**: o worker gerado de B recebe o prefixo da proposta que nega `SKIP_WAITING`. A fonte e o worker históricos ficam intactos. Esse ensaio verifica se a própria A perde o rascunho pelo timer mesmo com B ainda esperando. Não usa esse worker modificado como evidência de build de release.

O cenário anterior `single-reopened-offline` cancela o formulário com Escape antes de clicar em atualizar. O ensaio novo mantém o rascunho na aba iniciadora: PASS no cenário anterior não comprova a preservação desse estado novo.

Logo, o roteiro de migração precisa separar **cliente já cooperativo** de **legado já em execução**. O legado desconhecido deve bloquear ativação coordenada. Não há garantia de preservar seu estado se o próprio usuário acionar seu botão antigo, recarregar, fechar ou se o sistema descartar o processo. Nenhum patch novo pode prometer corrigir retroativamente esse código. O rollout precisará de uma passagem controlada após salvar/concluir trabalho legado e fechar os clientes antigos, sem recarga imposta pelo aplicativo. Essa passagem ainda requer revisão; não houve deploy.

## Mapa de observabilidade

O [inventário mecânico](evidencias-ciclo-4d-r2/inventario-estados.json) relaciona arquivos/linhas e ocorrências candidatas. Inclui falsos positivos de nomes de domínio; não é certificação de cobertura. A leitura dos handlers relevantes confirma:

| Área | Controle existente | Lacuna para PWA |
| --- | --- | --- |
| Objetivos: `GoalFormModal`, `UpdateGoalValueModal` | Valores em `useState`; `saving` envolvendo `await onSave`; fechamento só se `ok` | Sem registro global de rascunho/operação; o botão PWA ignora ambos |
| Lançamentos: `NewTransactionModal` | `isSaving`, validações e handlers assíncronos | Estado local; não participa de prontidão entre clientes |
| Pagamento: `PayCreditCardInvoiceModal` | `isSubmitting`; fechamento condicionado durante envio | Não há recibo de conclusão observado pelo coordenador |
| Importação: `ImportView` | `isLoading`, etapas locais, resolução pendente E864 | Leitura/parsing/classificação/confirmar/persistir não formam um contrato global de atualização |
| Investimentos: `InvestmentImportModal`, `investmentImportSession` | Estados `parsing`/`importing`, guarda por sessão | Não são uma licença global de recarga |
| Carteiras e investimentos | `isSubmitting`, await/erros nos formulários | Edição e resultado não observáveis fora do componente |
| Confirmações: `useDialogStore`, `GlobalDialog` | Promise até resposta do usuário | Resolver o diálogo não significa concluir a operação posterior |
| Configurações/Auth/suporte | Flags de carregamento locais e retornos por sessão | Não usar alterações de Auth como ACK PWA; ausência de spinner não prova inatividade |

Não há um registro global de `dirty/pending/unknown`, nem guarda `beforeunload` de aplicação que resolva essa coordenação. Uma detecção genérica de DOM/campo/`fetch` não basta: arquivo selecionado, estado fora de formulário, RPC encadeado, resposta recebida antes da atualização da UI e resultado incerto continuariam não observáveis. A proposta não intercepta ou repete escritas, não muda o SDK e não considera um POST enviado como concluído.

## Contrato proposto para implementação posterior

Este contrato está **proposto, não instalado**. A implementação depende de autorização para a fronteira de ativação no worker e de validação dos limites de migração.

1. **Identidade efêmera:** worker identifica clientes por `Client.id`; cada carregamento tem nonce/document epoch. Mensagens levam versão do protocolo, identidade da rodada e fase. Nunca carregam conta, token, valores ou conteúdo de formulário. O ACK precisa vir do cliente real pelo MessagePort dedicado.
2. **Estados conservadores:** `clean` exige cobertura explícita da tela e ausência de registros; `dirty` é trabalho não salvo; `pending` dura até resultado e feedback efetivamente observados; `unknown` inclui código sem adaptador, transporte incerto e cliente antigo. Só `clean` pode entrar em preparação. Rejeição/timeout de transporte não convertem automaticamente uma operação em `clean`.
3. **Tentativa exclusiva:** uma rodada de cada vez por worker/registro; a segunda tentativa recebe ocupado. BroadcastChannel é sinal auxiliar para reduzir avisos; não decide descoberta ou segurança.
4. **Prepare e congelamento:** obter inventário completo; enviar desafio fresco a todos. Antes de responder, cada UI verifica o registro e adquire a barreira que impede novos eventos críticos. Programação assíncrona que não passa por essa barreira deve marcar a tela `unknown`, bloqueando. Não há ACK se não for possível obter a barreira.
5. **Revalidação:** novo inventário e novo desafio de commit; comparar conjunto, epoch, nonce e estado. Cliente que não responde, fecha, abre, muda de documento/sessão ou inicia trabalho invalida a rodada. Timeout fixo serve para **negar**, nunca para assumir seguro; não aumentar o limite até passar.
6. **Ativação:** somente o worker, após validação final, pode autorizar o caminho novo. `SKIP_WAITING` legado não pode continuar sendo um atalho. A ativação precisa ser vinculada à revisão exata que recebeu consentimento. Reinício do worker perde a rodada e deve negar/recomeçar, nunca reconstruir consentimento de storage antigo.
7. **Recarga própria:** remover o timer forçado e os listeners implícitos de recarga do adaptador atual. Nenhuma aba manda outra navegar/recarregar. Cada documento usa confirmação própria e recebimento efetivo do controlador/revisão esperados. Não liberar interações de A contra caches B. A estratégia final de recursos e clientes novos precisa de teste antes de permitir ativação; congelar as abas conhecidas, sozinho, não resolve clientes que aparecem depois do último inventário.
8. **Falha/retorno:** rodada negada libera barreiras de preparação de forma rastreável, preserva estados e apresenta “Há trabalho ou uma aba sem confirmação. Conclua as operações e tente novamente.” Nada anuncia sucesso financeiro. Uma lease expirada não autoriza recarga nem ativação; tolerância a suspensão/reinício exige prova específica de ausência de commit tardio.

### Limites e problemas ainda de projeto

`clients.matchAll` não é uma transação atômica com abertura de janela, navegação, `skipWaiting` e `clientsClaim`. Uma dupla consulta não demonstra ausência de corrida. A solução precisa provar a segurança de um cliente novo no intervalo final, da suspensão/retomada de uma aba congelada, da expiração de uma barreira e do reinício do worker. Se isso exigir mudar `clientsClaim`, retenção/roteamento de recursos ou política de caches, cada mudança também entra no patch sujeito à nova autorização. Não foi criada essa garantia por afirmação ou somente por um modelo unitário.

Resultado aceito pelo servidor sem resposta observável deve permanecer **incerto**, sem replay automático. Limpar esse bloqueio exige uma ação de consulta/recuperação já suportada pelo produto ou um desenho separado; não se deve acrescentar idempotência financeira, fila offline ou escrita compensatória para aprovar PWA. Falta de conectividade, crash/encerramento manual e ações na interface antiga estão fora do poder de coordenação de uma versão ainda não carregada.

## Patch separado e o que ele não aprova

[proposta-fronteira-worker-4d-r2.patch](proposta-fronteira-worker-4d-r2.patch) acrescentaria `workbox.importScripts` antes do handler gerado e um script de fronteira. Mantém `skipWaiting:false`, `clientsClaim:true`, manifesto e definições de cache. **Muda a política de aceitação de mensagens de ativação**, portanto não foi aplicado. Novos bytes de worker e um arquivo de precache também seriam esperados; não se afirma equivalência de artefatos se esse patch vier a ser aplicado.

A fronteira proposta nega `SKIP_WAITING` legado, fornece inventário com `includeUncontrolled:true` e classifica todos os clientes como `unknown`. Qualquer pedido de ativação/commit é negado com `COORDINATION_NOT_INSTALLED`. Não contém um coordenador completo, não habilita atualização por timeout e não faz reload/navigate/fetch, não grava storage e não envia dados de conta. Aplicá-la sozinha reduziria disponibilidade de atualização explícita sem resolver o timer de A. **Não deve ser aplicada isoladamente como correção pronta.**

O objetivo do patch é tornar concreta a fronteira adicional que precisa ser autorizada e os efeitos de negar mensagens antigas. O diff pode ser inspecionado e testado com `git apply --check`; a branch mantém a política de entrada intacta.

## Matrizes, regressão e evidências

As contagens finais desta execução são registradas em `evidencias-ciclo-4d-r2/metrics.json`. A matriz original é reexecutada com os quatro artefatos imutáveis do R1 verificados por SHA, em perfis novos; ela é **baseline**, não evidência de uma correção R2 aplicada. Os resultados anteriores não são substituídos.

### Baseline completo — nova execução

**48 cenários: 23 PASS / 25 FAIL; exit code 1.** Há 23 FAILs de segurança reproduzidos e dois FAILs por timeout de prontidão de B após o clique. Os dois timeouts ocorrem em `ready(page, revision='b')`, com limite original de 30 s. Os snapshots de falha já mostram documento/runtime B e dados prontos, mas isso foi observado depois do deadline: não substitui a espera que falhou. A causa temporal não foi provada; não se atribui automaticamente a CPU ou ao produto. As duas observações são repetidas individualmente com o mesmo runner/deadline, preservando os primeiros resultados.

| Transição / estado | Edge Escuro | Edge Claro | Edge Auto | Chrome Escuro | Chrome Claro | Chrome Auto |
| --- | --- | --- | --- | --- | --- | --- |
| false→false, reaberta/offline/reconexão | PASS | PASS | PASS | PASS | PASS | PASS |
| false→false, duas ociosas | FAIL timeout | PASS | PASS | PASS | PASS | PASS |
| false→false, rascunho em outra aba | FAIL | FAIL | FAIL | FAIL timeout | FAIL | FAIL |
| false→false, POST pendente em outra aba | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| true instalada→false, reaberta/offline/reconexão | PASS | PASS | PASS | PASS | PASS | PASS |
| true instalada→false, duas ociosas | PASS | PASS | PASS | PASS | PASS | PASS |
| true instalada→false, rascunho em outra aba | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| true instalada→false, POST pendente em outra aba | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |

Antes do clique, **48/48** preservaram A e o trabalho pendente enquanto B aguardava. Os **46 cenários que completaram as observações posteriores** aprovaram bytes/versões, coleções financeiras, ausência de escrita financeira duplicada/persistida e isolamento de B na aba verificadora. Esses controles não são atribuídos aos dois cenários interrompidos. Os 12 POSTs intencionais foram sintéticos, retidos e recusados, sem servidor financeiro real; não provam corrupção/perda de dados remotos. Nos FAILs de segurança, o problema observado é o descarte de estado/feedback do cliente.

### Regressão local

- Focal da fronteira: **12 PASS / um arquivo**, como diagnóstico de proposta não instalada.
- Completa versionada com os dois overlays R2 explícitos: **3.428 PASS + um ignorado; 213 arquivos PASS + um ignorado (214)**, em **737,55 s**, exit code 0. O recibo inclui SHA dos overlays e a base `11e58dd`; `.env` e arquivos privados não versionados não foram copiados.
- Primeira execução completa: **13 arquivos FAIL / 199 PASS / um ignorado, 3.210 testes PASS + um ignorado**, em 715,65 s, exit code 1. O runner não definiu os placeholders públicos obrigatórios; as 13 suítes falharam ao importar o cliente Supabase. Isso foi erro de preparação da execução, corrigido com configuração sintética explícita em domínio `.invalid`, sem alterar produto/testes para eliminar a falha. O primeiro resultado e seu hash são preservados em `r2-run-attempts.json`/pacote.
- TypeScript: **14 diagnósticos conhecidos, zero novos**, exit code 0.
- Build padrão/PWA: **PASS, 49 entradas**, sem marcadores da fronteira proposta. Avisos de Browserslist desatualizado e tamanho de chunk permanecem registrados. Nenhum comando de deploy.
- O patch separado passa em `git apply --check`; `git diff 11e58dd -- src vite.config.ts package.json package-lock.json` permanece vazio. A checagem não aplica o patch.

O ensaio extra da fronteira usa A sem modificação, B com prefixo explicitamente experimental, Edge/Chrome e políticas instaladas true/false. Um contraexemplo reproduzido conserva status de segurança **FAIL** e exit code 1. Nenhum aumento de timeout é usado para convertê-lo em PASS.

### Reensaios e contraexemplo novo

Os dois reensaios usam o mesmo runner e deadline de 30 s, após terminar a execução completa: Edge/false→false/Escuro/ociosas **PASS**; Chrome/false→false/Escuro/rascunho **FAIL de segurança**, sem erro de observação. Exit code 1. A matriz inicial continua sendo 23 PASS/25 FAIL; não se apagam nem se substituem os timeouts. O segundo reensaio reproduz o descarte de rascunho no caso que antes não completou a observação, totalizando reprodução de segurança nos 24 casos distintos que falhavam no R1.

O contraexemplo adicional da fronteira terminou **4/4 reproduzidos, quatro FAILs de segurança, zero erros inesperados, exit code 1**:

| Navegador | A false → B experimental false | A true instalada → B experimental false |
| --- | --- | --- |
| Edge 156.0.4314.58 | FAIL: rascunho da própria A perdido | FAIL: rascunho da própria A perdido |
| Chrome 156.0.8078.80 | FAIL: rascunho da própria A perdido | FAIL: rascunho da própria A perdido |

Em todos: antes do clique havia dois documentos/runtime A e dois rascunhos; o inventário do worker experimental retornou os dois clientes como `unknown`; BroadcastChannel recebeu zero respostas da aba legada silenciosa. Após o clique no botão original, a aba iniciadora foi recarregada **ainda em A**, perdeu o formulário, B permaneceu `installed/waiting` e a segunda aba preservou o rascunho. Não houve POST financeiro. Isso demonstra perda de rascunho pelo timer legado **sem ativação ou mistura de versão** — distinta dos 24 casos de recarga por controle observados no R1. As capturas de antes/depois foram inspecionadas.

A proposta de inventário torna visível o cliente que um canal entre participantes não revela; não certifica prontidão. Nem esse inventário nem a negação de ativação consertam o timer já carregado em A. O produto e seus workers brutos não recebem o prefixo experimental.

| Adversarial obrigatório | Situação do produto / validação de R2 |
| --- | --- |
| Três abas com estados diferentes | Protocolo ausente; teste de aceitação R2 pendente |
| Aba que não responde | Inventário proposto classifica desconhecido; teste de aceitação R2 pendente |
| Aba fechada durante coordenação | Coordenação não instalada; pendente |
| Operação iniciada após primeira resposta livre | Dupla rodada/barreira não instalada; pendente |
| Cliente antigo sem protocolo | Contraexemplo nativo e negação da fronteira isolada; produto continua sem proteção |
| Duas abas tentando atualizar | Exclusão mútua de commit não instalada; pendente |
| Logout/login com atualização aguardando | Matriz baseline verifica isolamento depois da atualização; corrida durante rodada não homologada |
| Rede interrompida antes/depois da escrita | Baseline cobre offline/reconexão e POST retido/recusado; não equivale ao novo teste de escrita aceita |
| Resposta após mudança de versão | Baseline reproduz descarte de operação pendente; segurança FAIL |
| Servidor aceita sem resposta observável | Não simulado como aceitação neste ciclo; pendente; nenhum replay acrescentado |

**Não há 48/48 PASS da solução, nem aprovação dos adversariais.** Os testes unitários da proposta não substituem testes da aplicação, e emulação de navegador não homologa PWA instalado ou aparelho físico. Os bloqueios remotos, físicos, de acessibilidade e feedback financeiro anteriores continuam abertos.

Histórico preservado: [R1 aplicado](ciclo-4d-r1-pwa.md), [métricas anteriores](evidencias-ciclo-4d-r1-aplicacao/metrics.json). ZIP anterior SHA-256 `12d8c7fa215cbb828eb0dd251898e12f0683371a0f08fc1dc731d10d26126456`, índice `14c5f5717ede6ca24ef0ae8b5ec8405fac82f09367d99e96f31fda86c1ce1631`; pacote R1 anterior `85000adad08a923abe34244f7f810e702c5b0fb8b59e624fae286a7d0cdbe2a8`. Não foram regravados.

Resultado final de testes/TypeScript/build/PWA/CI e pacote R2: consultar métricas/manifesto desta seção e descrição da [PR #97](https://github.com/CassMach13/FinElo/pull/97), sempre pelo HEAD exato. CI verde de diagnósticos não fecha os FAILs de aceitação. Sem merge, deploy, migration, coorte nova, Claro global ou piloto.

## Recibo do pacote R2

Pacote externo: `finelo-ciclo-4d-r2-evidencias.zip`, **8.104.927 bytes**, **738 caminhos / 481 objetos únicos**. SHA-256 **`969b23124052e3a22bfeef0eefeec8985a352d4341da2354f84e6b9078de0648`**; índice **`c469d8849a907022606f3b23ea117475a7560b0851afa5f52c513f07351b01b1`**. CRC e todos os SHA verificados duas vezes. O Git recebe duas capturas, **131.302 bytes**, mais métricas/manifesto/inventário. Logs sintéticos externos passam por remoção determinística de linhas com formato de credencial; o recibo registra hashes e remoções. Não se publicam logs brutos no Git.

O índice identifica a base `11e58dd` e preserva as fontes históricas e os novos arquivos explícitos de reprodução. O relatório dentro do ZIP precede somente este apêndice de recibo; produto e fontes executadas não mudam. O CI do commit de fechamento é vinculado na descrição da PR para evitar atribuir o selo de um HEAD anterior ao atual. O patch separado continua parcial e não aplicado.
