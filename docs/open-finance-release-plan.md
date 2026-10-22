# Open Finance — candidata e publicação independente

## Recomendação

**GO técnico para revisão da candidata local. A execução da publicação permanece
BLOCKED até autorização específica, CI/Preview aprovados no SHA imutável e
aceite das verificações de contenção abaixo.** A produção atual ainda não contém a pausa.

A candidata fica em `codex/open-finance-pause`, com base na main remota
`224f608dfde41a97229b4baca22ee4ff75020e18`, reconfirmada nesta preparação.
Não foi necessário merge, rebase ou resolução de conflitos.

O **SHA exato do commit local final**, sua árvore e seus arquivos são registrados,
após a criação do commit, em `.local-qa/open-finance-release-lock.json` e na entrega.
Esse lock permanece fora do Git para evitar que um commit tente conter seu próprio SHA.
A aprovação futura deve citar esse SHA; alterações posteriores invalidam a aprovação.

## Escopo fechado

[Allowlist exata de 24 arquivos](open-finance-release-allowlist.json).

- Cinco entrypoints de API, handler comum e middleware Vite da pausa.
- Dois arquivos de regressão e o harness HTTP/Auth local já aprovados.
- Arquivo histórico não executável, documentação e evidências da pausa/release.

Excluídos: `src/**`, `supabase/**`, migrations, RLS, Billing, Stripe,
Patrimônio V2, manifests de dependências, `vercel.json`, workflows e snapshots
de cartões. O snapshot sinalizado inicialmente pelo status foi comparado:
seu conteúdo e hash são idênticos à main. Foi preservado, sem inclusão na candidata.

A branch `codex/stripe-billing-hardening` não foi integrada nem modificada.
Seus 1.033 arquivos continuam iguais ao baseline monitorado. Não incluir seus
guards, writers, journal, migrations, evidências ou configurações nesta publicação.

Os dez blobs de código/testes executáveis são idênticos aos aprovados na etapa
anterior. Somente documentos/inventário foram acrescentados nesta preparação.
Portanto foram reutilizados, sem repetição da suíte:
**3.100 testes aprovados, 1 ignorado em 194 arquivos; 29 focais; 240 HTTP/Auth QA
local; zero SDK/credenciais/fetch para provedores; baseline TypeScript com
14 diagnósticos conhecidos e nenhum novo; build/PWA com 49 entradas.**
O teste ignorado depende de fixture privada ausente; dados reais não foram usados.

## Inventário atualizado, somente leitura

[Inventário completo por deployment, alias, domínio e rota](open-finance-release-inventory.json).

Projeto `finelo-br / prj_bI6N0vwlVIxhltexdO6V4pswXNKG`;
team `team_ayglpViWJHVv9dTg6Dx85SvI`. Produção:
`dpl_AjC2ixtSgTeyStFYnD7Jede89ZeT`, SHA da main indicado acima, READY.

| Objeto | Resultado |
| --- | --- |
| Deployments | 120 READY: 50 production e 70 preview; 119 anteriores ao atual |
| Aliases | 105, apontando para 100 deployments distintos |
| Domínios cadastrados | 4 |
| URLs únicas consultadas | 225, somente HEAD na raiz, sem cookies/bypass |
| Exigem autenticação | 171: as 120 URLs de deployment e 51 aliases |
| Indisponíveis | 50 aliases com HTTP 410 / GONE |
| Redirecionam para o canônico | 3 domínios |
| Raiz pública | Apenas www.finelo.app.br, HTTP 200 |

Domínios públicos/redirecionados:

- `www.finelo.app.br`: raiz pública, deployment de produção atual.
- `finelo.app.br`: redirecionamento 307 para o canônico.
- `app-de-controle-financeiro-finelo-br.vercel.app`: redirecionamento 308.
- `app-de-controle-financeiro-financehub-br.vercel.app`: redirecionamento 308.

A configuração retornada é `all_except_custom_domains`. Os probes observaram
exigência de autenticação nas raízes históricas. **Não foram chamadas as cinco
APIs remotas nem usados bypasses.** Cobertura por caminho é inferida da proteção
do deployment e deve ser verificada explicitamente na janela autorizada.
Campos ausentes sobre share links, bypass de automação e exceções são desconhecidos;
não foram interpretados como confirmação de ausência.

Os 120 commits estão disponíveis no Git local. Em todos eles as cinco fontes
de API estão presentes e sem pausa: 600 observações, cinco blobs distintos.
Assim, as versões históricas preservam código funcional de provedor que pode
executar se a proteção for atravessada legitimamente ou por bypass e se houver
credenciais utilizáveis. Proteção de acesso e correção do código são controles distintos.
Não foi inspecionado o binário de cada função nem testada usabilidade de credenciais.

O conector Vercel retornou 403. O fallback CLI autenticado consultou o mesmo
team/projeto, sempre com GET e escopo explícito. Foram descartados valores de
ambiente, cookies e queries de redirecionamento; nenhum segredo foi exportado.

## Matriz de prontidão

| Gate | Estado | Evidência / ação necessária |
| --- | --- | --- |
| Main remota sem avanço e pacote exclusivo | PASS | Base acima; allowlist e diff fechado |
| Código/testes equivalentes aos aprovados | PASS | Dez blobs iguais; evidência anterior reutilizada |
| Billing, Patrimônio, SQL e configurações preservados | PASS | Diff permitido e hashes do Billing |
| Inventário atual e acesso anônimo às raízes | PASS | GETs paginados e 225 HEADs, sem invocar APIs |
| Fonte da produção vigente contém a pausa | FAIL | Produção ainda usa a base sem correção; publicação futura necessária |
| Acesso às raízes históricas | PASS | 171 exigem autenticação; 50 aliases GONE; três redirects ao canônico |
| Contenção por caminho e controle de exceções/bypasses | BLOCKED | Verificar cinco caminhos por host, exceções e acessos existentes, com autorização |
| CI e Vercel Preview do SHA candidato | BLOCKED | Nenhum push/PR autorizado nesta etapa |
| Cinco APIs publicadas e smoke funcional de produção | BLOCKED | Depende da publicação e verificação autorizadas |
| Estado real de tokens, consentimentos e sincronização externa | BLOCKED | Sem consulta às contas dos provedores; avaliação operacional separada |

Não houve falha nova de código identificada nesta preparação. O FAIL descreve
a versão ainda vigente em produção; os resultados locais da candidata são PASS.

## Controle de CI e efeito do merge

Foi consultado o ruleset ativo `main protegida`, ID `21977362`:

- Exige PR e branch atualizada para o check `Type baseline, tests and build`.
- Bloqueia exclusão e non-fast-forward; nenhum bypass actor listado.
- Permite merge, squash e rebase. Recomenda-se merge commit para preservar a
  rastreabilidade da candidata, se essa continuar sendo a política aprovada.
- A API de proteção clássica retornou 403; o ruleset ativo foi consultado com sucesso.
- O ruleset não exige aprovação humana quantitativa nem Vercel Preview.
  A autorização do usuário e o gate Preview permanecem obrigatórios operacionalmente.

O workflow atual executa `npm ci`, baseline TypeScript, `npm test` e
`npm run build`, em Node da `.node-version` (20), com placeholders públicos.
Exigir SUCCESS desse check e Vercel Preview READY/SUCCESS para **o mesmo SHA**,
sem checks pendentes/cancelados ou mudanças posteriores.

Exigir também diff-check completo, revisão de segredos, allowlist sem extras e
atestado dos dez blobs aprovados. Não adicionar migrations, flags ou credenciais
para obter aprovação. O harness nativo opcional utiliza `registerHooks`;
executá-lo em Node 24 compatível com a Vercel, usando QA isolado, quando necessário.

A integração Git aponta para GitHub/CassMach13/FinElo, production branch `main`,
com `autoAssignCustomDomains=true`, sem ignore command ou deploy hook configurado.
O campo específico `gitDeploymentEnabled` não foi exposto; considerando a integração
vigente e o fluxo documentado, **o merge na main deve ser tratado como gatilho
de deploy automático de produção**, com atribuição dos domínios.
CI pós-merge pode rodar em paralelo ao deploy e não substitui o gate pré-merge.
Não executar deploy manual como alternativa.

## Checklist da janela futura — nada abaixo foi executado

### A. Congelar a candidata

- [ ] Aprovação humana cita o SHA do lock local.
- [ ] Main remota reconfirmada. Se avançou, preparar compatibilidade local e
      renovar lock/aprovação; preservar integralmente o Billing.
- [ ] Diff base..candidata contém somente os 24 arquivos permitidos.
- [ ] Dez blobs de código/testes correspondem ao atestado aprovado.
- [ ] `api/stripe-webhook.js`, `src/**`, `supabase/**`, flags, dependências,
      workflows, routing e snapshots continuam idênticos à base.
- [ ] Autorizar separadamente push/PR. Push dessa branch pode gerar Preview;
      não equivale a autorização para merge/produção.

### B. Validar Preview e contenção

- [ ] Quality baseline SUCCESS e Preview READY/SUCCESS no SHA congelado.
- [ ] Verificar empacotamento real das cinco funções na Vercel Node 24.
- [ ] Acessar o Preview com autenticação Vercel normal autorizada; não desativar
      proteção nem criar share link/bypass para testar.
- [ ] Com acesso ao deployment, testar app anônimo, JWT inválido e identidade
      QA autenticada. A camada externa Vercel pode responder 401 sem sua sessão;
      a aplicação, quando alcançada, deve responder 503.
- [ ] Reconsultar inventário e conferir proteção, exceções OPTIONS, share links,
      automação, cookies de bypass e escopo dos acessos administrativos existentes.
      Não revelar/copiar valores desses segredos.
- [ ] Antes de qualquer POST histórico, testar HEAD dos cinco caminhos. A fonte
      antiga rejeita métodos não POST antes do provedor; expectativa do perímetro:
      401/403 por autenticação, 410 por indisponibilidade ou 503 por contenção.
      405/200/500 de aplicação antiga exige investigar e interromper o avanço.
- [ ] Confirmar que redirects de domínios antigos preservam destino seguro para
      os cinco caminhos e não encaminham a deployments antigos públicos.
- [ ] Escolher e aprovar a contenção: manter autenticação com exceções controladas,
      bloquear os cinco caminhos no perímetro com abrangência comprovada, ou
      retirar deployments/aliases obsoletos explicitamente aprovados.
- [ ] Bloqueios em DNS/proxy do domínio canônico não protegem automaticamente
      URLs `.vercel.app`. Não pressupor abrangência de WAF entre produção,
      previews e URLs imutáveis: comprovar para cada classe antes de usá-lo.
- [ ] Não repontar todos os aliases para produção nem retirar deployments
      indiscriminadamente; preservar isolamento de ambientes.

### C. Autorizar merge e acompanhar automação

- [ ] Obter GO humano final, com SHA e estratégia histórica aceitos.
- [ ] PR pronto, sem conflitos, CI e Preview ainda aprovados e HEAD inalterado.
- [ ] Merge somente pelo método permitido, sem force push.
- [ ] Registrar SHA final da main e demonstrar equivalência com a candidata.
- [ ] Acompanhar apenas o deploy automático. READY deve corresponder ao novo
      SHA; se não houver deploy, interromper e diagnosticar sem deploy manual.
- [ ] Conferir atribuição dos quatro domínios e aliases de produção.
- [ ] Acrescentar o deployment de produção anterior ao conjunto histórico.
      O ID `dpl_AjC2ixtSgTeyStFYnD7Jede89ZeT` também precisará permanecer contido.

### D. Smoke tests das cinco APIs

| Caminho canônico | POST/GET/OPTIONS | HEAD |
| --- | --- | --- |
| /api/pluggy-token | 503 + OPEN_FINANCE_PAUSED | 503, sem corpo |
| /api/pluggy-sync | 503 + OPEN_FINANCE_PAUSED | 503, sem corpo |
| /api/belvo-token | 503 + OPEN_FINANCE_PAUSED | 503, sem corpo |
| /api/belvo-consent | 503 + OPEN_FINANCE_PAUSED | 503, sem corpo |
| /api/belvo-sync | 503 + OPEN_FINANCE_PAUSED | 503, sem corpo |

- [ ] Usar HTTP sem service worker/cookies de bypass. POST pode levar apenas
      `{}`; não usar IDs, CPFs ou conexões reais.
- [ ] Repetir com app anônimo, JWT inválido e sessão existente autorizada,
      mantendo o token somente em memória e fora de logs.
- [ ] Conferir JSON público estável, `Cache-Control: no-store`, tipo JSON e
      ausência de stack, configuração, token ou dado financeiro.
- [ ] Verificar canônico e redirects dos demais domínios sem encaminhar a host
      não inventariado. Na versão publicada, PUT/PATCH/DELETE também são 503.
- [ ] Correlacionar versão, requests e erros da Vercel sem registrar bodies,
      tokens ou dados financeiros. Logs HTTP isolados não provam ausência de
      tráfego de saída: combinar evidência do handler sem dependências com os
      testes instrumentados e metadados de execução.
- [ ] Confirmar que nenhuma requisição dessas rotas chega a Belvo/Pluggy.
      Atividade externa autônoma ou tokens anteriores precisa da avaliação abaixo.

### E. Demais funções e encerramento

- [ ] Em QA isolado, verificar Dashboard, criação manual sintética, preview/
      importação de arquivo sintético e consulta de investimentos.
- [ ] Em produção, somente smoke de leitura: login autorizado, Dashboard,
      navegação, abrir/cancelar lançamento manual e preview de arquivo sem
      confirmar gravação; consultar investimentos sem recalcular/alterar posições.
- [ ] Confirmar contratos e valores existentes com evidências não sensíveis,
      sem inserir/remover dados reais nem ligar flags.
- [ ] Confirmar blob do webhook Stripe e ausência de migrations/writers novos.
      Não criar pagamentos, alterar Stripe ou publicar o Billing hardenizado.
- [ ] Repetir HEAD histórico e confirmar contenção após o deploy, incluindo D0.
- [ ] Encerrar somente com os cinco critérios do pedido atendidos. Qualquer
      endpoint funcional, host público antigo não contido, divergência de SHA,
      alteração financeira ou erro crítico impede a conclusão.

## Tokens e conexões anteriores

Os tokens de widget têm janelas documentadas: Pluggy Connect, 30 minutos;
Belvo OFDA, 10 minutos, com invalidação após conexão bem-sucedida.
A apiKey Pluggy é uma credencial distinta, documentada como válida por duas horas.
[Pluggy FAQ](https://docs.pluggy.ai/en/docs/get-started/faq) e
[Belvo OFDA](https://developers.belvo.com/products/aggregation_brazil/ofda-widget-introduction).
Esses tempos não comprovam quando a FinElo emitiu seu último token.

O `stale_in: 300d` da fonte Belvo é retenção de dados, não validade do token.
[Referência Belvo](https://developers.belvo.com/apis/belvoopenapispec/widget-access-token/generatewidgetaccesstoken).
Links e consentimentos podem sobreviver ao token de widget; consentimentos
podem inclusive ter prazo indeterminado.
[Consentimentos Belvo](https://developers.belvo.com/apis/belvoopenapispec/consents).
Pausar as cinco APIs não os revoga,
não apaga histórico e não encerra automaticamente sincronização no provedor.

Ação operacional proposta:

1. Registrar o corte T0 somente após conter todas as origens capazes de emitir
   tokens, incluindo acessos/bypasses históricos. Se houver nova emissão, reabrir T0.
2. Confirmar com metadados/logs autorizados a última emissão, escopos e existência
   de links recorrentes; não exportar tokens nem consultar dados financeiros.
3. Se não houver indício de exposição ou atividade indevida, avaliar aceitar
   expiração natural após a janela apropriada. A decisão precisa ser registrada;
   não existe confirmação de expiração de tokens reais nesta etapa.
4. Se houver emissão abusiva, segredo exposto ou uso continuado, preparar
   revogação/rotação e interrupção de recorrência com o provedor, mediante
   autorização específica e análise de impacto. Não revogar consentimentos,
   apagar links ou rotacionar credenciais automaticamente.
5. Registrar separadamente custos/rotinas externas: ausência de novas chamadas
   FinElo não comprova ausência de atividade autônoma no provedor.

Fontes oficiais consultadas:

- [Pluggy FAQ: apiKey e connectToken](https://docs.pluggy.ai/en/docs/get-started/faq).
- [Belvo Hosted Widget OFDA](https://developers.belvo.com/products/aggregation_brazil/ofda-widget-introduction).
- [Belvo token e significado de stale_in](https://developers.belvo.com/apis/belvoopenapispec/widget-access-token/generatewidgetaccesstoken).
- [Belvo consentimentos e expiração](https://developers.belvo.com/apis/belvoopenapispec/consents).
- [Vercel Deployment Protection e exceções](https://vercel.com/kb/guide/locking-down-deployments).

## Interrupção e recuperação

Interromper diante de CI/Preview não aprovado, SHA/diff divergente, flags/dados
alterados, API antiga alcançável sem contenção ou regressão crítica nos demais módulos.

Preferir reparo para frente mantendo os cinco handlers 503. Nunca promover
automaticamente o deployment anterior, restaurar os arquivos .disabled,
proxies funcionais ou usar a branch Billing como fallback.
O deployment anterior contém as APIs funcionais.

Recuperação de assets/frontend só pode usar uma versão que mantenha a pausa
do servidor, ou um perímetro previamente comprovado que bloqueie os cinco
caminhos em todos os alvos, inclusive com autenticação/bypass.
Sem essa garantia, interromper e solicitar decisão operacional.
Conflitos futuros com as mudanças Open Finance existentes no Billing devem
preservar a pausa incondicional, sem transportar código funcional por engano.

Não há banco a restaurar nesta release. Não executar rollback de migrations,
backfill, mudanças de RLS ou alterações financeiras como parte da recuperação.

## Critério final para autorização

A candidata pode seguir para revisão independente. A autorização futura deve
abranger explicitamente PR/CI, o efeito automático do merge e a contenção
histórica escolhida. A publicação só estará concluída com 503 nas cinco APIs,
zero chamadas aos provedores, caminhos históricos contidos, demais funções
operacionais e Billing inalterado. Esta preparação não executa essas etapas.
