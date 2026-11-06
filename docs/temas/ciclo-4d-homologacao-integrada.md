# Ciclo 4D — Homologação integrada, dispositivos e PWA

## Parecer e escopo efetivamente executado

**NO-GO para iniciar o piloto neste momento. Entrega local parcial verificável; o ciclo não está integralmente homologado.** O usuário determinou: **“Concluir testes locais e registrar remoto/físico pendente”**. Não houve Auth remoto, deploy, ampliação de coorte, migration, operação com dados de clientes ou publicação. A PR #97 permanece em rascunho.

A integração local comprovou a navegação, equivalência financeira, persistência sintética entre sessões, impressão e exportação descritas abaixo. A atualização A→B do PWA falhou no ensaio local. Permanecem bloqueios de ambiente e riscos de feedback financeiro essencial que exigem decisão antes de qualquer piloto. PASS local não substitui teste remoto ou físico.

Data de referência das fixtures: **2026-11-06 12:00 UTC**. Baseline aprovado: **`56afa733bbc444e4d7d7be741e939a7b8c44bc99`**. Branch: `codex/finelo-theme-foundation`.

| Referência | Resultado |
| --- | --- |
| `origin/main` e ancestral comum, confirmados por fetch | `6fa1188b1864e85da587e61c7e46009a5e82adb4` |
| main local, detectada como desatualizada | `f35e4151817d3ac09edc320bef76f9d232401377`; não usada como autoridade |
| CI do baseline aprovado | [Quality baseline 42235545960 PASS](https://github.com/CassMach13/FinElo/actions/runs/42235545960) |
| Prévia Vercel do baseline | Deployment `dpl_d5vFt4eTM269ttrQQ2WeuDAgHTNP`, READY, SHA exato; logs mostram `vite build` padrão, não modo staging |
| Backend isolado e duas contas QA remotas | **BLOCKED**: não comprovados; nenhuma tentativa de login remoto |

As fontes imutáveis foram congeladas em 268 arquivos de main e 284 do baseline revisado. O 4D compara 16 pares Escuros com o revisado, exatamente iguais. A comparação ampla com main permanece nos selos/evidências do [4C](ciclo-4c-cobertura-final.md), que usou a mesma main `6fa1188`; não foi repetida como se fossem novas capturas 4D.

## Prévia integrada e proteção do produto

A entrada `scripts/diagnostics/integrated-preview.html` monta o **App real**, store e **Supabase SDK instalado 2.86.0**, com HTTP sintético interceptado pelo runner. Storage, LockManager, BroadcastChannel, eventos Auth e renderização são os do navegador; os métodos do SDK não foram substituídos. JWTs e identidades são fictícios; isto **não prova Auth servidor, revogação, RLS ou permissões de backend**.

A guarda exige simultaneamente modo `staging`, flag existente ativa, host loopback e backend exatamente `https://integrated-fixture.invalid`. A elegibilidade usa o `app_metadata` QA existente; B inelegível permanece Escuro. O envelope `display:contents` cobre App e portais sem redesenhar a geometria. A entrada não é importada por `index.html`/App e é negada em production, development, host remoto, flag desligada ou backend real. Não há parâmetro de URL que habilite o produto em produção. `login=a` pertence exclusivamente à entrada sintética protegida; não contorna autenticação real.

O aplicativo normal continua Escuro por padrão, com elegibilidade/flag anteriores e sem seletor global. O build padrão de produção foi executado inclusive com a flag de processo ativa para verificar a separação por modo; não se trata de deploy. O build diagnóstico PWA usa configuração separada, somente loopback, sem alterar `vite.config.ts` ou o service worker do produto.

Todas as requisições externas da entrada QA são recusadas. Leituras usam fixtures sintéticas; tentativas financeiras são negadas pelo transporte. A matriz normal usou amortização sintética consistente e não tentou escritas financeiras. O controle adversarial com a antiga fixture inconsistente tentou um PATCH antes da troca de tema, tanto no revisado como no atual, e ambos foram negados. Isso não é uma escrita causada pelo tema nem autorização para corrigir a amortização.

## Correções delimitadas e contratos

Somente duas superfícies de produto mudaram; diff completo em [ajustes-visuais-4d.patch](ajustes-visuais-4d.patch):

1. **Dashboard:** papel existente `data-finance="info"` no texto de identificação dos bancos, cujo contraste Claro era 1,702:1. Classes Escuras, conteúdo e geometria preservados.
2. **GoalFormModal:** `manageFocus` do Modal compartilhado e `autoFocus={false}` no Input. O autofocus do filho precedia a captura do acionador e impedia restaurar o foco; o Modal passa a gerir foco inicial, Tab, Escape e retorno. Somente ativar `manageFocus` não bastou; os quatro motores confirmaram a correção final.

Não houve edição de Auth/store, writer autorizado no 4C, SDK, RLS, consultas, payloads financeiros, cálculos, parsers, classificação, duplicidades, cartões, importação, conciliação, gates ou persistência. **282 fontes preservadas + duas exceções de UI com reversão exata**. O novo selo conserva os 284 hashes brutos originais e compara também hashes canônicos que normalizam **somente CRLF→LF**. Uma falha inicial do novo teste comparava texto normalizado com hash bruto; foi corrigido o verificador, sem regravar os hashes aprovados. O adaptador AST anterior aceita apenas a reversão pontual do autofocus; os valores esperados dos selos antigos não mudaram.

## Matriz integrada por rota, tema e navegador

Perfis descartáveis de navegador, desktop **1440×1000** e mobile **390×844**. Escuro, Claro e Automático com sistema Claro. Mudança do sistema para Escuro testada separadamente no grupo de preferências. Não são aparelhos físicos. Baseline e atual usam dados/relógio/dimensões iguais, sem máscaras ou ampliação de tolerância.

| Rota e estado principal | Edge | Chrome | Firefox | WebKit | Temas / finanças |
| --- | --- | --- | --- | --- | --- |
| Dashboard, cards/gráficos/período | PASS | PASS | PASS com ressalva JS | PASS | Escuro/Claro/Automático; valores iguais |
| Transações, tabela/filtros/competência | PASS | PASS | PASS com ressalva JS | PASS | mesmos dados e sinais monetários |
| Importação, entrada/retorno à navegação | PASS | PASS | PASS com ressalva JS | PASS | nenhum arquivo real processado |
| Investimentos legado, cards/período/erro | PASS | PASS | PASS com ressalva JS | PASS | fixture e totalizadores iguais |
| Objetivos, lista e modal de formulário | PASS | PASS | PASS com ressalva JS | PASS | cancelamento sem gravação; foco corrigido |
| Configurações, conta/preferência | PASS | PASS | PASS com ressalva JS | PASS | tema não modifica o ledger |
| Ajuda e retorno ao Dashboard | PASS | PASS | PASS com ressalva JS | PASS | navegação completa pelos controles reais |
| Administração, solicitação pendente e troca para B | PASS | PASS | PASS | PASS | papel sintético; retorno antigo descartado |

**208 capturas**, incluindo 16 referências Escuras revisadas; **128 comparações financeiras PASS**, zero divergências; **16/16 pares Escuros exatos**. Essas 128 comparações são os snapshots previstos pelo runner, não 128 operações financeiras diferentes. A aparência inicial inelegível, reload, duas abas, logout/login, erro e respostas tardias têm ensaios adicionais de sessão. O recorrido não reexecuta todos os estados especializados de 3A–4C: tabelas extensas, E864, três motores de cartão, conciliação, integrações desativadas e V2 continuam cobertos pelos validadores anteriores e pela suíte de regressão, sem alteração de gates.

| Motor instalado no ensaio | Versão | Compatibilidade local |
| --- | --- | --- |
| Microsoft Edge | 156.0.4314.58 | PASS no percurso principal |
| Google Chrome | 156.0.8078.80 | PASS no percurso principal |
| Firefox | 157.0 | **FAIL de compatibilidade JS**: seis contextos iniciais com erro de LockManager do SDK; rotas renderizaram |
| WebKit automatizado Windows | 27.2 | PASS no percurso; não certifica Safari/iPhone |

O erro Firefox também ocorre no baseline `56afa73` com SDK e transporte sintético idênticos. O teste de controle conserva ambos os resultados. Não foi atribuída regressão ao 4D nem feita atualização de SDK; o efeito em Auth remoto permanece BLOCKED. Disponibilidade do motor e screenshots concluídos não tornam essa compatibilidade integralmente PASS.

## Sessão, Auth e preferências

**36 grupos canônicos PASS**: nove grupos por motor, após substituir os ensaios preliminares pelos retestes correspondentes. Não somar novamente os 12 retestes direcionados ou os oito grupos adicionais. `auth-canonical.json` registra o conjunto final; resultados preliminares permanecem identificados no pacote.

| Cenário obrigatório | Grupo local / resultado | Auth remoto |
| --- | --- | --- |
| 1. Login sem preferência | `choices-reload-system`: Escuro inicial PASS | BLOCKED |
| 2. Escolha Escuro | `choices-reload-system` PASS | BLOCKED |
| 3. Escolha Claro | `choices-reload-system` PASS | BLOCKED |
| 4. Escolha Automático | `choices-reload-system` PASS | BLOCKED |
| 5. Mudar preferência do sistema | `choices-reload-system` PASS, emulação de media query | BLOCKED |
| 6. Atualizar página | `choices-reload-system` PASS, storage nativo | BLOCKED |
| 7. Duas abas | `two-tabs-rapid-save` PASS, BroadcastChannel/storage nativos | BLOCKED |
| 8. Duas tentativas rápidas | mesmo grupo PASS, preserva confirmação e política de concorrência | BLOCKED |
| 9. Perfil concorrente com refresh antigo | `profile-refresh-offline-reconnect` PASS | BLOCKED |
| 10. Offline durante gravação | mesmo grupo PASS, última preferência confirmada mantida | BLOCKED |
| 11. Reconexão/sincronização | mesmo grupo PASS | BLOCKED |
| 12. Logout A/login B e novo login A | `switch-form-late-read-logout` PASS | BLOCKED |
| 13. Substituição direta por B | grupos de troca/duas abas PASS | BLOCKED |
| 14. Retorno pendente A após B | `pending-profile-after-login-b`, `late-goals-read-theme-switch-and-b` e `admin-metrics-pending-replaced-by-b` PASS | BLOCKED |
| 15. Termos pendentes durante troca | `pending-terms-after-login-b` PASS; não aceita Termos por B | BLOCKED |
| 16. Fechar modal/restaurar foco | `modal-focus-restoration` PASS após correção pontual | BLOCKED |

Inspecionados o writer com bearer capturado/fila por conta, verificações de identidade após awaits, descarte de leitura antiga, recriação do shell, limpeza de caches e confirmação de Termos do 4C. SDK/eventos reais com respostas HTTP controladas não restauraram A após B. O Profiler observa os commits React e o DOM não contém drafts/marcadores de A depois da troca. Isso não certifica todas as corridas possíveis do SDK ou autorização de backend.

No ensaio de perfil/duas abas houve **12 GETs de investimentos**, zero recargas de transações e zero escritas financeiras. O Dashboard já depende do objeto `user` inteiro: atualização de metadados pode reexecutar esse efeito. Trata-se de acoplamento anterior, não de mudança no sincronizador de aparência; não foi corrigido como otimização fora do escopo. Nenhum token, senha ou header de autorização integra os relatórios; identidades e nomes são sintéticos.

## Acessibilidade, contraste e dispositivos

**32.784 observações de contraste computado**, com limiares de 4,5:1 para texto e 3:1 para elementos essenciais. Claro/Automático-Claro: **21.856 observações, zero falhas**, mínimos de **5,122:1 texto / 3,567:1 essenciais**. Escuro: **10.928 observações, 2.888 amostras abaixo do limiar**, incluindo repetições dos mesmos controles/estados. Não são 2.888 defeitos distintos; exigem triagem humana por função, estado e exceções aplicáveis. Preservar o Escuro não equivale a certificá-lo WCAG AA.

| Ensaio nos quatro motores | Estado | Limite / evidência |
| --- | --- | --- |
| Teclado no percurso de sete rotas | PASS | navegação pelos controles reais; não inventaria todo tooltip/gráfico do produto |
| Foco do formulário de objetivo e retorno ao acionador | PASS | quatro retestes finais, mesma geometria |
| Reflow em 720 e 360 px, equivalentes a 200%/400% | PASS | zero overflow de documento/main nessa amostra; **não é zoom nativo** |
| Paisagem 844×390 | FAIL | seis botões de navegação sem nome acessível; texto oculto no breakpoint legado |
| Campos de mês, preenchimento e contraste | PASS | Edge/Chrome `month`; Firefox/WebKit fallback `text`; não aprova seletor físico mobile |
| Alto contraste via `forced-colors` | PASS na emulação | não certifica configuração real do sistema/leitor |
| Preferência de movimento reduzido | FAIL | animações continuam; teste não injeta o CSS de supressão usado só em capturas determinísticas |
| Tutorial após sair rapidamente do Dashboard | FAIL no revisado e atual | timer antigo abre “Bem-vindo…” sobre Transações |
| Zoom nativo 200%/400%, toque real, seletores de data do aparelho | NOT TESTED | preencher roteiro manual |
| VoiceOver, TalkBack, Narrator e leitura humana de gráficos/tooltips | NOT TESTED | não declarar conformidade WCAG integral |
| iPhone/Safari, Android/Chrome e desktop operado fisicamente | NOT TESTED | automação headless não equivale a esses aparelhos |

Hover/foco/desabilitado/seleção e controles nativos têm as verificações dos componentes dos ciclos anteriores; a amostra integrada acrescenta navegação e contraste de tela. Nenhuma aprovação universal desses estados ou de tecnologias assistivas é inferida apenas dos números de contraste.

## PWA: resultado real e sequência interrompida

Build diagnóstico compilado somente em loopback 5210, com SW/cache reais do navegador e HTTP de backend sintético. Build padrão do produto permanece separado (49 entradas; diagnóstico 59).

| Caso | Estado | Observado |
| --- | --- | --- |
| Registro/ativação do SW | PASS | escopo `http://127.0.0.1:5210/`, revisão A ativa |
| Reload offline com sessão/preferência confirmada | PASS | Claro mantido; **cache de dados financeiros não certificado** |
| Reconexão | PASS | interface voltou online |
| Nova página no mesmo contexto | PASS | Claro preservado; não representa app standalone fechado/reaberto |
| Atualização A→B, cache anterior e aparência após atualização | **FAIL** | metatag continuou A após timeout de 60 s; B existe no disco e hash do SW mudou |
| Logout/login e desregistrar/registrar após essa atualização | NOT TESTED | sequência não chegou a essas etapas |
| Primeira instalação, abertura independente, fechar app/reabrir, remover/reinstalar | NOT TESTED | não houve instalação no sistema ou aparelho |

O diagnóstico final manteve ator sintético A e Claro, porém documento revisão A. Tentativas anteriores do harness (contexto destruído durante reload e timeout preliminar) estão separadas. `skipWaiting()` está presente; a hipótese de cache de metadados estático do servidor não foi confirmada. **Causa ainda não isolada entre harness e aplicação; não declarar regressão provada do produto nem converter o FAIL em PASS.** Não foram alterados SW, política de cache ou Auth para contornar o resultado. O roteiro manual inclui atualização e recuperação em instalação efetiva.

## Impressão, exportação e regressão financeira

**12 PDFs, 42 páginas**, quatro estados (Dashboard, Transações, Investimentos, formulário de Objetivo), referência revisada Escura + atual Escuro + atual Claro. **Oito comparações PASS**, dimensões, texto, número de páginas e raster SHA-256 idênticos. Nenhuma alteração de contrato de impressão.

**Seis arquivos CSV/XLSX**, três variantes e dois formatos; **quatro comparações PASS**. CSV idêntico em bytes; XLSX com células/strings/estilos idênticos, desconsiderando somente metadados de geração do contêiner. Downloads foram acionados pela interface, sem escrita financeira. Cenários especializados de paginação anteriores continuam na regressão; não foram substituídos por estes quatro estados.

O ledger bruto e os resultados financeiros das 128 comparações não mudaram. Os três motores de cartão continuam nos testes existentes com gates inalterados. Nenhuma fatura XP real foi reprocessada neste ciclo.

## Riscos legados e novos apontamentos

| Risco / severidade | Reprodução / atribuição | Situação e decisão |
| --- | --- | --- |
| Feedback essencial após reversão recusada/timeouts de conciliação — **alta** | Documentado no 3D; não reexecutado remotamente nem corrigido | **Bloqueia piloto** até correção autorizada ou decisão formal que elimine resultado incerto; antiguidade não elimina critério NO-GO |
| Erro na primeira carga de Investimentos — **alta** | Pendência 4B; condição exata de primeira carga do validador anterior não reexecutada | NOT TESTED na condição histórica exata; o HTTP 503 do percurso legado integrado mostrou mensagem e “Tentar novamente” no revisado e atual. Esse PASS restrito não encerra a pendência 4B |
| Atualização PWA A→B — **alta** | FAIL local descrito acima; origem não isolada | Resolver/reproduzir em ambiente autorizado antes de aprovar atualização/piloto |
| Firefox LockManager SDK — **média/alta** | Mesmo erro inicial no revisado e atual, HTTP sintético | FAIL local de compatibilidade; investigar remoto sem atualizar SDK silenciosamente |
| Navegação sem nome acessível em paisagem — **média** | 844×390, quatro motores, classes/estrutura NavItem não mudaram | Legado; exige correção específica/decisão de risco |
| Movimento reduzido e timer do tutorial — **média** | animações efetivas; timer reproduzido no revisado/atual | Pendentes; nenhuma correção funcional independente |
| Contraste Escuro — **média**, triagem por função | 2.888 amostras repetidas abaixo do limiar | Preservado e separado de regressão nova; não há selo WCAG integral |
| Overflow 86 px Dashboard / 18 px Investimentos e scroll interno conciliação — **média** | Casos específicos de 4A/4B/3D | Não reprovocados por este percurso; reflow padrão sem overflow não os encerra |
| Roteamento OFX manual / consentimento secundário Open Finance — **média** | Riscos anteriores; integração OF desativada localmente | NOT TESTED no backend real; gates não modificados |
| Competência histórica / amortização sintética — **média**, dependente dos dados | Antiga fixture incoerente tentou PATCH em ambos os baselines antes do tema, negado | Nenhuma regressão de aparência demonstrada; não inferir bug financeiro a partir da fixture incoerente |
| Efeito de investimentos dependente de `user` — **baixa** | 12 GETs em perfil/abas; zero GETs de transações/escritas | Acoplamento legado; aparência não deve passar a recarregar transações |
| Contraste novo da mensagem de banco / foco do GoalForm — **média** | Reproduzidos e corrigidos neste ciclo | PASS nos retestes; duas exceções exatas e documentadas |

Referências de origem: [3A–3D](ciclo-3-telas-financeiras.md), [4A](ciclo-4a-dashboard.md), [4B](ciclo-4b-investimentos.md), [4C](ciclo-4c-cobertura-final.md). Os riscos sem reprodução atual permanecem pendentes, não são novos PASS. Não se observou vazamento A→B, gravação duplicada, divergência financeira ou regressão de PDF no transporte sintético acessível; isso não aprova o backend remoto.

## Testes e reprodutibilidade

Execução local completa: **3.428 PASS e uma falha do novo verificador CRLF/LF**, em 212 arquivos (211 PASS, um FAIL). A falha não era financeira; os hashes brutos originais foram preservados. Após correção: **316 testes focais / 18 arquivos PASS**. Não apresentar essa sequência como uma segunda suíte completa local verde de 3.429 testes. Os 20 ensaios locais de faturas privadas preexistentes não estão no Git/CI e não entram no pacote.

TypeScript: **14 diagnósticos conhecidos, zero novos**, conforme baseline. Build padrão: **PASS, 49 entradas PWA**, avisos preexistentes de tamanho de bundle/import misto. Resultado do CI final fica na [aba de checks da PR](https://github.com/CassMach13/FinElo/pull/97/checks), vinculado ao HEAD exato na descrição da PR; não reutilizar o selo 56afa73 para aprovar mudanças posteriores.

Scripts versionados `integrated-validate-{navigation,auth,accessibility,pwa,print,export,risks}.py` usam Playwright Python **1.64.1**, PyMuPDF **1.26.7** e Node **22.20.0**. São ferramentas temporárias, sem dependências novas do produto. Instalar ferramentas em diretório isolado, exportar `PYTHONPATH`/`PLAYWRIGHT_BROWSERS_PATH` para esse diretório e preparar as duas cópias imutáveis das fontes pelos commits indicados. Iniciar `serve-integrated-preview.ps1 -Port 5209` (flag/backend fictício somente no processo), executar os runners a partir da raiz e por último `integrated-summarize.py`. O runner PWA possui servidor/build separado e encerra seu filho. Não expor os servidores na rede nem apontar o backend para Supabase real. O probe é somente diagnóstico inicial, não conta para os 208 frames aceitos.

Resultados de navegação/contraste em `navigation-validation.json`; sessão final em `auth-canonical.json`; síntese em `summary.json`; acessibilidade, PWA, riscos, PDFs e exportação nos relatórios específicos. As falhas preliminares do harness permanecem identificadas, sem somar aos conjuntos finais.

## Evidências e próximos gates

Evidências compactas e manifesto: [evidencias-ciclo-4d](evidencias-ciclo-4d/README.md). O pacote externo contém os frames completos, resultados, PDFs, exportações, fontes congeladas e scripts, com índice por SHA-256 e objetos deduplicados. Arquivos privados de faturas, credenciais, perfis de navegador e dependências temporárias ficam excluídos. Pacotes 3A–4C preservados. Os hashes e a dupla verificação estão no manifesto compacto.

Pacote final: **17.566.332 bytes; 1.382 caminhos / 882 objetos**. SHA-256 `69925a0cfc868c0b924bf99d9378417a1b9961894a8107f39e82ec914e180bf4`; índice `b514534939f04240827dc7809365a1f99e97330132dd464f62c6dd78f6a9c4a4`. As duas verificações completas de CRC e todos os hashes deram resultados idênticos. Seis imagens versionadas: **605.053 bytes**. Fontes de produto no checkpoint `b6929e4bbe7457575122c6dd765dfbc7c9e08f9a`; o fechamento acrescenta documentação e empacotamento.

Roteiro executável por operador: [ciclo-4d-roteiro-manual.md](ciclo-4d-roteiro-manual.md), com plataformas, passos, resultados esperados e campos de evidência. Para liberar um **piloto QA restrito**, exigir cumulativamente:

1. Staging autorizado com commit exato, backend comprovadamente isolado, contas A/B e papéis já elegíveis, sem ampliar coorte e com acesso seguro.
2. Executar os 16 casos de Auth remotamente; investigar Firefox e comprovar isolamento de respostas tardias, Termos, abas e preferência confirmada.
3. Isolar o FAIL de atualização PWA e executar instalação, atualização, cache anterior, logout/login e reinstalação em aparelhos reais, inclusive offline/reconexão.
4. Deliberar/corrigir em escopo próprio os riscos de feedback financeiro essencial e primeira carga de Investimentos, acessibilidade de paisagem/movimento e demais pendências aplicáveis. Interromper diante de qualquer critério NO-GO do pedido.
5. Preencher Safari/iPhone, Android/Chrome, desktop, zoom nativo e leitor de tela; repetir dados/temas/print sem divergências e obter autorização explícita para o piloto.

Rollback visual: manter a flag desligada e retirar a entrada diagnóstica do uso; nenhum schema exige rollback. Não reverter as correções de privacidade autorizadas no 4C. Não iniciar piloto, merge ou deploy automaticamente a partir deste relatório.
