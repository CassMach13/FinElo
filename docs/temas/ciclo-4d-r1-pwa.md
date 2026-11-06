# Ciclo 4D-R1 — Investigação da atualização PWA

## Parecer e limites

**A falha original foi explicada e o ensaio com navegação explícita passou. O parecer geral continua NO-GO.** A entrega não homologa PWA instalado, aparelhos ou Auth remoto. Base revisada: `c7f1a5c668ef4f39b9b0d489a93c02fa07e72308`, PR #97 em rascunho, branch `codex/finelo-theme-foundation`.

O harness foi corrigido. Nenhum arquivo de `src`, Auth, RLS, persistência financeira, dependências do produto ou configuração PWA de produção foi alterado. Existe uma **proposta separada de uma linha** para a política do worker; ela é compilada somente numa cópia descartável e **não foi aplicada a `vite.config.ts`**. A Etapa 5 do pedido exige autorização específica antes de aplicar uma mudança de política de produção.

## Causa raiz do FAIL 4D

O teste confundia **ativação/controle do worker** com **substituição do documento já renderizado**. O código dizia que o App recarregaria em `controllerchange` e esperava a metatag B durante 60 s, sem navegar nem clicar no botão original. Essa premissa não é garantida pela configuração existente.

Na reconstrução, o arquivo `integrated-validate-pwa.py` permaneceu idêntico ao de `c7f1a5c` até a evidência anterior ser salva. O FAIL foi reproduzido: documento A, Claro preservado, worker B já ativo/controlador e precache B. **Não era o Vite Preview servindo um `index.html` antigo.**

| Artefato da reconstrução original | SHA-256 / resultado |
| --- | --- |
| HTML A efetivamente recebido no navegador | `9e2fc4626c3ef05b9451528b729427484f35716ed7df43018acec2f16d2990b3` |
| HTML B em disco | `4615bb4ba3f96ecffebc8894cb74e608ace4e551977804b31d837dee69b73e35` |
| HTTP direto `/`, `/app` e `/index.html` | mesmo hash do HTML B |
| Entrada `/index.html?__WB_REVISION__=cf1b7dab6f245b07e6d7f4204c807e56` no CacheStorage | mesmo hash do HTML B |
| SW A | `08646300bf9e5f43f88b539e2e2537d8529516ef05c6c5ef1bf92b03bd76b935` |
| SW B em disco e HTTP | `ad7b902e0c99ec00a03fad255ab9d39824f1c1d90330500bbc9370c0b317c2b3` |
| Registro depois da atualização | `installing=null`, `waiting=null`, ativo/controlador com identidade 2 e estado `activated` |
| Documento aberto depois de 60 s | A; nenhum botão “Atualizar Agora” nessa página reaberta |

O build B terminou às **14:21:01 de 06/11/2026, America/Sao_Paulo**. Os eventos mostraram `updatefound`, `installed`, substituição do worker anterior, `controllerchange` e `activated`; a ativação terminou aproximadamente um segundo depois. O documento A permaneceu aberto. Datas e eventos detalhados estão em `before-reconstruction.json`; os instantes de geração, publicação, instalação, controle e navegação são registrados separadamente.

## Contrato do aplicativo e comportamento da política atual

`vite.config.ts` usa `registerType: 'prompt'`, `skipWaiting: true` e `clientsClaim: true`. O `ReloadPrompt.tsx` usa `useRegisterSW` e mostra “Atualizar Agora” quando `needRefresh` fica ativo. O cliente instalado do `vite-plugin-pwa` 1.2.0 liga esse aviso ao estado/evento de espera e a determinados eventos externos. Seu listener de recarga por controle é instalado nesse caminho; não é um listener universal do App para qualquer `controllerchange`.

O `App.tsx` verifica atualizações na montagem, foco e a cada dez minutos; **verificar não significa navegar para o HTML novo**. O fallback de `ReloadPrompt` chama `location.reload()` um segundo depois de um clique, mas não executa quando o botão sequer é oferecido.

Com `skipWaiting:true`, o worker pode passar diretamente à ativação, sem oferecer uma espera estável. O resultado do aviso também depende de como o Workbox reconhece a atualização no objeto que registrou o worker. Por isso são comparadas duas situações: a página da primeira instalação e uma página reaberta já controlada por A. **Não se afirma que o botão sempre falta em todas as situações.** A reconstrução original comprova a ausência na página reaberta que originou o FAIL.

É uma interação preexistente entre configuração e cliente de atualização, preservada em `c7f1a5c`; não foi introduzida pela conversão de temas. A diferença entre documento A e worker B é permitida pelo ciclo de vida da plataforma. O problema de UX é não haver um caminho de confirmação consistente na política de atualização configurada como prompt.

## Correção aplicada exclusivamente ao diagnóstico

`integrated-validate-pwa.py` agora guarda o controlador anterior, solicita a verificação, espera a troca do controlador e realiza **recarga explícita de navegador**. Depois confirma HTML B, dados financeiros, preferência, cache e troca de conta. O registro do teste declara `explicitBrowserReload:true` e `automaticDocumentReloadCertified:false`; não atribui a recarga ao aplicativo.

O ensaio corrigido passou nas sete etapas locais: instalação/controle inicial, reload offline da aparência, reconexão, nova página, atualização B após recarga explícita, logout A/login B e desregistro/registro na origem descartável. Remover um registro não é desinstalar um PWA do sistema operacional.

`integrated-pwa.config.ts` foi apenas extraído para uma função reutilizável, mantendo seu comportamento padrão. A configuração `pwa-r1.config.ts` adiciona à compilação diagnóstica um identificador executado pelo runtime, além da metatag HTML. A condição de sucesso exige **HTML B e JavaScript B**, e não apenas uma string no documento. Todas as guardas continuam exigindo staging, flag existente e backend fictício; propostas são recusadas antes de ler a cópia em modo indevido. A entrada executável continua restrita a loopback/elegibilidade QA existente.

Nenhum timeout foi ampliado como solução. O timeout histórico de 60 s não certificava a transição que se pretendia medir. O diagnóstico atual usa condições explícitas e limite de 30 s para estados de atualização.

## Instrumentação e correções do próprio validador R1

Observadores em perfis descartáveis registram chamadas nativas, `updatefound`, estados `installing/waiting/active`, identidade de cada objeto worker, `controllerchange`, navegações, hashes de respostas, entradas do CacheStorage e decisões observáveis do `ReloadPrompt`. O estado do prompt é **inferido da UI original**, identificado como tal no JSON; os logs e cliques originais também são registrados. Não se substituiu o SDK Auth ou o componente de produção.

Para eliminar a ambiguidade de um controlador que já havia mudado antes de a página capturá-lo, os artefatos finais de diagnóstico acrescentam ao SW uma **resposta de mensagem somente de leitura** com revisão, política e SHA do worker gerado. Ela não registra/ativa workers, não chama `skipWaiting` e não modifica caches. Os bytes gerados originais são preservados como prefixo e em cópias independentes; `observed-builds.json` mapeia ambos os hashes. A reconstrução histórica e o harness corrigido usam o SW original, sem esse acréscimo. **A instrumentação não integra o build padrão ou a proposta de uma linha.**

Foram corrigidos dois erros da primeira matriz R1, mantendo seus resultados como preliminares:

1. O driver Playwright **1.64.1** instalado testa a verdade do retorno do predicado antes de resolver uma Promise. Um predicado `async` podia liberar a espera e devolver `false`; isso foi comprovado no código instalado e por canário isolado. O novo polling usa `page.evaluate`, aguarda o valor e aceita apenas o booleano `true`.
2. Esperas separadas aceitavam ator/prontidão financeira do documento A e, depois, a versão do novo documento B ainda em carregamento. O resultado era comparar arrays vazios transitórios com os dados carregados de A. A prontidão agora exige ator, status financeiro e versões HTML/runtime **na mesma avaliação e no mesmo documento**. A comparação financeira não foi relaxada nem passou a ignorar valores; os registros de divergência preliminar foram preservados.

Asserções financeiras e de cache continuam exatas. O canário não é teste de PWA nem de aplicativo; só comprova a semântica da ferramenta. Dados financeiros offline não são certificados pelo cache estático.

## Matriz independente

Perfis descartáveis Edge/Chrome headless, viewport 390×844, origem `http://127.0.0.1:5210`, HTTP sintético e SDK instalado. **Não são aparelhos nem PWA instalado.** As variantes A/B são construídas antes de sua disponibilização local; assets, entry e SW têm publicação registrada em ordem. O teste compara servidor mantido e reiniciado, sem aumentar timeout.

Os resultados finais, incluindo qualquer FAIL, são consolidados no manifesto de evidências. A matriz abrange:

| Comparação | Evidência exigida |
| --- | --- |
| Navegação normal / cache antigo com servidor mantido | HTML/runtime B e mesmos dados após navegação |
| SW bloqueado | HTTP B sem depender de cache ou registro |
| Atualização manual e recarga explícita, Escuro/Claro/Automático | controlador/cache B, documento B, preferência e finanças iguais |
| UI original, primeira instalação e página reaberta | aviso/clique ou ausência registrados; não substituir por clique inventado |
| Nova aba no mesmo perfil | sessão/preferência correta e B sem apagar o cache do perfil |
| Contexto novo sem cache | B por HTTP, sem herdar storage do contexto anterior |
| Interrupção com servidor desligado e retomada | requisição de atualização recusada; recuperação após reiniciar o mesmo servidor |
| Proposta isolada via botão original | B espera, usuário confirma, controlador/documento/runtime tornam-se B |
| Offline/reconexão, logout/login B e nova página | aparência confirmada preservada, zero conteúdo de A para B, cache apenas estático |

**30 grupos canônicos: 28 PASS e dois FAIL**, ambos no caminho de UI da política atual após reabrir a página. São 22 grupos da política original e oito da proposta isolada. Não somar os retestes ou matrizes preliminares a esses 30.

| Grupo final | Edge | Chrome |
| --- | --- | --- |
| Navegação normal | PASS | PASS |
| SW bloqueado / contexto novo sem cache | PASS | PASS |
| Verificação manual + recarga, três preferências | PASS (3) | PASS (3) |
| UI original na página da primeira instalação | PASS; botão oferecido | PASS; botão oferecido |
| UI original em página reaberta | **FAIL; B ativo, A aberto, sem botão** | **FAIL; B ativo, A aberto, sem botão** |
| Nova aba no mesmo perfil | PASS | PASS |
| Interrupção/reinício do servidor | PASS | PASS |
| Cache antigo/servidor mantido | PASS na confirmação focal, ressalva abaixo | PASS |
| Proposta: botão original, três preferências + página reaberta | **PASS (4)** | **PASS (4)** |

Nos oito grupos da proposta, o worker esperou a confirmação, o botão original foi acionado, HTML/runtime/controlador B foram confirmados, as sete coleções financeiras permaneceram iguais, logout/login B e nova página passaram, houve **zero tentativas de escrita financeira e uma escrita de aparência por grupo**. Automático acompanhou as mudanças de preferência do sistema sem novas escritas.

**Observação aberta, sem atribuição prematura ao produto:** um controle instrumentado de servidor mantido chegou a `waiting` com o aviso visível sob a política original; o teste exigia ativação automática e expirou. O validador agora respeita a possibilidade de confirmar pela UI. A confirmação focal concluiu B, porém não reproduziu aquele estado de espera. Sua causa específica não foi isolada entre navegador/instrumentação; a recuperação **daquela mesma instância é NOT TESTED**, pois o perfil descartável já havia sido encerrado. O registro e a falha anteriores permanecem no pacote; o PASS da repetição não declara essa observação corrigida ou inexistente. A proposta oferece espera/confirmação de forma reproduzível nos oito ensaios acima.

## Patch de política proposto, não aplicado

[proposta-pwa-prompt-4d-r1.patch](proposta-pwa-prompt-4d-r1.patch): **somente `skipWaiting:true` → `skipWaiting:false`**. Mantém `registerType:'prompt'`, `clientsClaim`, o componente, caches, escopo, manifesto e dados. O SW gerado para a proposta contém o handler `SKIP_WAITING`, permitindo que o botão original libere a ativação. A revisão permanece esperando até a confirmação; a interface original continua responsável pela navegação.

O runner escreve uma cópia descartável `.pwa-r1-proposed-vite.config.ts`, verifica que ela difere em exatamente essa linha, compila com a entrada sintética e a remove. A configuração real não é escrita. A proposta não é um deploy, não está habilitada no build normal e não é um novo gate do produto. **Aplicar essa mudança na configuração do produto requer a autorização da Etapa 5.**

## Segurança, regressões e validação

Os 284 selos de fontes do produto continuam valendo; a configuração de produção e o `ReloadPrompt` também receberam selos SHA canônicos específicos. Não houve alteração em `src`, cálculos, parsers, RLS, payloads, Auth, flags ou coorte. As duas exceções visuais aprovadas do 4D permanecem idênticas. A matriz compara todas as coleções financeiras do snapshot e os dados brutos do transporte; não aceita gravações financeiras como sucesso.

O cache é verificado por URL/hash: precache de recursos estáticos da origem local, sem respostas `/auth`, `/rest`, `/functions` ou `/storage`. O HTML de entrada é estático e tem hash igual no disco/HTTP/cache, sem conteúdo personalizado por conta. Fixtures sintéticas embutidas nos bundles de diagnóstico não são dados de clientes nem evidência de cache financeiro de produção.

Teste focal: **258 testes / 17 arquivos PASS**. Inclui guardas da proposta, preservação da configuração/UI de produção, tema, Auth instalado, privacidade de sessão e contratos visuais financeiros. TypeScript: **14 diagnósticos conhecidos, zero novos**. Build padrão: **PASS, 49 entradas PWA e zero marcadores R1** nos bundles. Nenhum deploy foi executado.

A suíte completa passou na cópia de `git archive c7f1a5c` com lista explícita dos arquivos R1 sobrepostos: **3.416 testes PASS + um ignorado; 212 arquivos PASS + um ignorado (213)**, em 744,66 s. Não foram copiados arquivos privados não versionados ou `.env`; backend de processo fictício. O recibo `regression-source.json` identifica as fontes e os overlays exatos, também incluídos no pacote. Os 20 testes locais privados dos ciclos anteriores ficaram fora desta execução. Os ajustes posteriores de observação Python/JS são verificados pela matriz nativa; configuração TS/testes focais de produto permaneceram iguais. CI do HEAD final: [checks da PR #97](https://github.com/CassMach13/FinElo/pull/97/checks), com SHA/run/resultados exatos na descrição da PR; não reutilizar o selo do 4D para aprovar código posterior.

## Reprodutibilidade e evidências

Fontes: `pwa-r1-reconstruct.py` (replay com observadores), `pwa_r1_observation.py`/`pwa-r1-observe.js`, `pwa-r1-validate.py`, `pwa-r1.config.ts` e `pwa-r1-regression-copy.py`. A reconstrução original foi feita **antes** de corrigir o harness; a versão final do script lê os bytes imutáveis do harness de `c7f1a5c` via `git show`, permitindo repetir a expectativa histórica sem reverter o arquivo corrigido. Os outputs desse replay usam nomes próprios, preservando os arquivos `before-*` originais.

Ferramentas temporárias: Python Playwright 1.64.1, Edge/Chrome instalados e dependências do lockfile do produto. Exemplos na raiz, com `PYTHONPATH` apontando para a instalação isolada:

```text
python scripts/diagnostics/pwa-r1-validate.py --phase build
python scripts/diagnostics/pwa-r1-validate.py --phase matrix --output final-matrix.json
python scripts/diagnostics/pwa-r1-regression-copy.py
```

O runner controla e encerra apenas seu servidor loopback; nunca apontar o backend para Supabase real. A proposta exige a cópia descartável validada pelo runner. O build padrão continua sendo `npm run build`, sem essa configuração. Os arquivos de produção/SDK não são alterados para instrumentar o teste.

Evidências anteriores do 4D permanecem históricas, incluindo o FAIL. O pacote R1 separa reconstrução intacta, harness corrigido, matrizes preliminares rejeitadas e conjunto final. Credenciais, headers, perfis de navegador, `.env`, faturas privadas e dependências temporárias ficam fora do pacote.

Conjunto canônico: `canonical-summary.json`, derivado de `verified-matrix.json` e da substituição identificada em `navigation-confirmation.json`. Não apaga resultados anteriores. [Evidências compactas e manifesto](evidencias-ciclo-4d-r1/README.md) registram os hashes e a dupla verificação do pacote externo.

Pacote externo final: **7.940.433 bytes / 1.023 caminhos / 506 objetos**; SHA-256 `85000adad08a923abe34244f7f810e702c5b0fb8b59e624fae286a7d0cdbe2a8`, índice `7ba126f9908a7f1a22082aaa90868486ad8ccec96e462eba3c8edd9d58a2d0b8`. CRC e todos os SHA conferidos duas vezes. Quatro imagens versionadas: **285.667 bytes**. O checkpoint de fontes é `1de5b472df58f8e535aa1b2c80ad921efa7c5537`; o fechamento acrescenta documentação e embalagem.

## Impacto no NO-GO

O risco “não sabemos se o servidor/cache entregou B” foi resolvido por hashes e eventos. O ensaio manual A→B tem uma correção comprovada de harness. A aprovação por UI deve ser avaliada conforme a política efetivamente usada; o teste da proposta não aprova a configuração real por substituição.

Permanecem **BLOCKED** Auth remoto/staging isolado autorizado e **NOT TESTED** instalação/fechamento/reabertura/reinstalação no sistema, iPhone/Safari, Android/Chrome, interação física, leitor de tela e zoom nativo. Os demais bloqueios de feedback financeiro, Firefox, acessibilidade e riscos legados do [4D](ciclo-4d-homologacao-integrada.md) não foram tratados neste lote. O [roteiro manual](ciclo-4d-roteiro-manual.md) continua aplicável.

**Manter NO-GO.** Não há merge, deploy, migration, ampliação de coorte ou ativação global. A eventual autorização do patch de uma linha não autoriza publicação nem encerra os demais gates.
