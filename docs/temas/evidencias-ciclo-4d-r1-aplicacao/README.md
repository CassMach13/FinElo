# Evidências — aplicação autorizada do 4D-R1

**`skipWaiting:false` aplicado; NO-GO mantido.** [Relatório atual](../ciclo-4d-r1-pwa.md) · [Histórico anterior à autorização](../evidencias-ciclo-4d-r1/README.md).

**Matriz de aceitação: 48 cenários, 24 PASS / 24 FAIL; código de saída 1.** Zero falhas inesperadas do validador. A mudança melhora a confirmação, mas não protege trabalho pendente de outra aba depois de um clique na aba ociosa. Não confundir a suíte/CI verde com aprovação desse fluxo.

| Prova, A(true) instalado → B(false), Claro | Antes de confirmar em outra aba | Depois |
| --- | --- | --- |
| Edge, formulário não salvo | [Rascunho preservado enquanto B espera](applied-final-msedge-legacy-to-current-light-tabs-dirty-waiting-1.png) | [Formulário descartado pela recarga](applied-final-msedge-legacy-to-current-light-tabs-dirty-1.png) |
| Chrome, POST sintético pendente | [Formulário com POST retido; worker aguardando](applied-final-chrome-legacy-to-current-light-tabs-pending-waiting-1.png) | [Contexto da operação descartado](applied-final-chrome-legacy-to-current-light-tabs-pending-1.png) |

Quatro PNGs, **225.927 bytes**. São evidências dos FAILs, não exemplos de aprovação. A operação é um Objetivo sintético; o transporte retém e recusa o POST, sem persistência financeira real. Isso demonstra perda de estado/feedback do cliente, não perda de dados em servidor real.

[metrics.json](metrics.json) contém os 48 resultados e as fases separadas: **48 PASS antes da confirmação**, 48 PASS de versões/bytes e equivalência financeira, **24 FAIL de proteção da outra aba**. Há 24 transições entre políticas distintas e 24 sob a política atual, nos três temas em Edge/Chrome. Foram feitos 12 POSTs intencionais, um por cenário pendente; nenhum duplicado ou persistido.

Workers brutos, sem mensagem diagnóstica acrescentada ao SW. A identificação combina eventos de ciclo de vida, hashes de disco/HTTP/cache, HTML e runtime executado. O favicon, cujo evento de resposta não é exposto por página, é comprovadamente idêntico nos quatro builds e tem SHA do cache verificado. A/B são perfis descartáveis locais com HTTP sintético; **não são PWA instalado no sistema nem Auth/RLS remoto**.

[manifest.json](manifest.json) registra duas verificações completas CRC/SHA. Pacote externo **`finelo-ciclo-4d-r1-aplicacao-evidencias.zip`**, **8.250.113 bytes**, **765 caminhos / 485 objetos**.

- SHA-256: `12d8c7fa215cbb828eb0dd251898e12f0683371a0f08fc1dc731d10d26126456`.
- Índice: `14c5f5717ede6ca24ef0ae8b5ec8405fac82f09367d99e96f31fda86c1ce1631`.
- Checkpoint de código: `d83154e0e90910944b27c15576ce94642295a151`; fechamento posterior acrescenta embalagem/documentação.

Contém relatórios finais, todos os controles preliminares identificados, antes/depois, manifestos e artefatos precached brutos A/B, prova de igualdade dos artefatos históricos revisados, fontes e overlays exatos da suíte completa. Exclui `.env`, credenciais, perfis, faturas privadas, logs brutos, vídeos e dependências temporárias. Os pacotes históricos não foram regravados.

Verificar sem extração: `python scripts/diagnostics/verify-theme-evidence.py <caminho-do-zip>`. Remoto **BLOCKED**, PWA instalado/aparelhos/leitores/zoom nativo **NOT TESTED**. Nenhum merge, comando de deploy, migration, ampliação de coorte ou Claro global.
