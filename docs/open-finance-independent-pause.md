# Open Finance — pausa técnica independente

## Decisão e isolamento

Implementação exclusivamente local, na branch `codex/open-finance-pause`, a partir
da main remota `224f608dfde41a97229b4baca22ee4ff75020e18`, confirmada por
`git ls-remote`. A referência local `main` estava antiga e não foi movida.
Nenhuma mudança de Billing foi incorporada.

**GO para revisão do pacote local. Publicação e exposição de deployments antigos
continuam pendentes de autorização e verificação.** Não houve push, PR, merge,
deploy, alterações remotas, migrations, mudanças de flags ou credenciais.

## Causa e alcance

| Caminho anterior | Exposição observada por inspeção da main |
| --- | --- |
| `pluggy-token` | Criava SDK e token com credenciais do servidor sem validar identidade/benefício. |
| `pluggy-sync` | Aceitava `itemId` do cliente e consultava contas/transações sem validar propriedade. |
| `belvo-token` | Criava token privilegiado diretamente com credenciais do servidor. |
| `belvo-consent` | Aceitava identificação/fluxo do cliente e criava token/consentimento sem autorização. |
| `belvo-sync` | Aceitava `linkId` do cliente e consultava o provedor sem validar propriedade; também tinha bypass sintético. |
| Proxy Vite | Replicava token e sincronização Pluggy, permitindo contornar um bloqueio feito somente em `api/`. |

Não foram feitas chamadas reais para reproduzir a exposição. O código anterior
foi inspecionado e arquivado; não se reabriu o desenvolvimento desses provedores.

## Correção mínima

As cinco funções públicas apenas reexportam
[`server/open-finance-paused.js`](../server/open-finance-paused.js).
O handler não importa SDK, autenticação, banco ou arquivo histórico; não lê
requisição, sessão, plano, flag, ambiente ou conexão.

Todos os métodos, inclusive OPTIONS e HEAD, recebem HTTP 503. HEAD conserva a
semântica HTTP sem corpo. Nos demais métodos, a resposta é:

```json
{"code":"OPEN_FINANCE_PAUSED","error":"Open Finance está pausado no momento."}
```

A resposta usa `Content-Type: application/json; charset=utf-8` e
`Cache-Control: no-store`. Não inclui stack, detalhes de configuração, tokens,
identificadores ou dados financeiros. A mensagem em `error` mantém o contrato
dos clientes existentes. Não há chave de ambiente ou flag capaz de reativar o serviço.

O Vite usa a mesma resposta para os cinco caminhos, antes de qualquer proxy.
O CORS deixa preflight continuar até o bloqueio; OPTIONS de outros caminhos conserva
204. O loader do config carrega somente Gemini, seu único consumidor restante.
Os arquivos originais estão preservados como `.disabled`, fora de `api/` e
`public/`, com hashes do conteúdo canônico em LF e aviso explícito de que não são fallback seguro.

## Arquivos

- Cinco entrypoints `api/{pluggy-token,pluggy-sync,belvo-token,belvo-consent,belvo-sync}.js`.
- `server/open-finance-paused.js`: resposta pública compartilhada.
- `vite.config.ts`: remoção do proxy funcional e middleware da pausa.
- `tests/security/openFinancePaused.spec.ts`: fronteira, métodos, arquivo histórico e isolamento.
- `tests/security/openFinancePausedClientCompatibility.spec.ts`: cliente antigo sem persistência.
- `scripts/qa/open-finance-pause-http.mjs`: ensaio HTTP nativo e Vite, com Auth local opcional.
- `docs/archive/open-finance-paused/`: cinco fontes, proxy, manifesto e orientações.
- Este relatório e `docs/open-finance-pause-evidence.json`.

Dashboard, importações de arquivo, transações manuais, investimentos, Billing,
contratos, stores, serviços financeiros, SQL e migrations não foram editados.

## Validação

Resultado final: **3100 testes de regressão aprovados, 1 ignorado(s), 0 falhas, cobrindo 194 arquivos** em dois lotes; os 29 testes focais estão incluídos nessa cobertura e foram executados também separadamente. **240 requisições HTTP/Auth local aprovadas**, zero imports de SDK, zero leituras de credenciais pelas rotas e zero fetch para provedores.

Baseline TypeScript: 14 diagnósticos conhecidos, nenhum novo. Build/PWA: PASS, 49 entradas. Diff-check de todo o pacote e revisão de segredos: PASS. Billing: 1033/1033 arquivos comparados sem alteração; índice, branch e HEAD preservados.

A execução ampla inicial sem configuração pública QA foi interrompida. Foram retidos somente 31 arquivos já concluídos com PASS; os 163 restantes foram executados com configuração pública de loopback no processo filho, incluindo o arquivo afetado. Não se alterou nenhum arquivo de ambiente nem credencial persistida. Um teste ignorado por ausência de fixture privada não foi substituído por dados reais.

Os resultados finais, comandos e contagens estão em
[open-finance-pause-evidence.json](open-finance-pause-evidence.json).
A evidência não contém credenciais, tokens, emails nem dados financeiros.

O harness não simula autenticação: usa login normal e `getUser` de uma identidade
QA sintética **no Supabase local**, com sessões descartáveis e logout ao final.
Não usa `service_role`, não consulta tabelas financeiras e rejeita configuração
Auth fora de loopback. O arquivo protegido existente é somente lido, sem cópia para Git.

Em cada servidor, os testes enviam chamadas anônimas, JWT inválido e JWT validado,
com POST/GET/PUT/PATCH/DELETE/HEAD/OPTIONS e JSON malformado. As 105 chamadas
principais são concorrentes; as 15 de corpo inválido são adicionais.
Os handlers de API são carregados nativamente, sem mock do resultado HTTP.

Hooks de resolução rejeitam import de SDKs e clientes de dados. Uma proxy do
ambiente rejeita leituras de credenciais Belvo/Pluggy durante carga/invocação das
APIs. No Vite, a leitura é instrumentada durante as requisições; a cópia genérica
de ambiente feita pelo compilador no startup fica fora dessa contagem. Sentinelas
sintéticas presentes em memória comprovam independência da ausência de configuração.
Qualquer `fetch` após autenticação dispara falha. O teste unitário adicional entrega uma requisição
opaca cujas propriedades lançam erro se acessadas.

Não confundir preservação de Billing com aprovação para publicá-lo: o hardening
e seus gates permanecem independentes. Nesta branch a evidência para Billing
é identidade do código com a main, não um novo ensaio financeiro Stripe.

## Clientes atuais e PWAs antigos

- Os serviços antigos usam `res.ok` e `data.error`; exibem a mensagem de pausa
  e interrompem token/sincronização antes de ler store ou persistir importações.
- `ImportView` também verifica `tokenRes.ok` antes de criar o widget. Não precisa
  conhecer o novo campo `code` para falhar com segurança.
- A interface antiga pode continuar exibindo o botão Open Finance. Isso não
  concede acesso ao servidor nem exige atualização do PWA para efetivar o bloqueio.
- O service worker vigente só possui cache de runtime para fontes; chamadas
  POST dessas rotas não são precacheadas. O 503 não deve ser persistido.
- Navegações GET podem receber o fallback de SPA de um service worker antigo,
  sem chegar à API. Isso não executa o provedor; a resposta 503 é garantida
  quando a requisição chega ao servidor. As chamadas funcionais antigas usam POST.
- Preflight entre origens recebe 503 e falha fechado; navegadores podem mostrar
  erro genérico de rede nesse caso. No mesmo domínio, o cliente recebe o JSON.
- Uma instalação vinculada a **outro deployment antigo** ainda atinge aquele
  servidor antigo. O código desta branch não o protege automaticamente.
- Tokens/conexões previamente emitidos não são revogados por esta mudança.
  Sua validade externa não foi testada nem alterada.
- Não foi executada jornada visual contra dados reais nem chamada a widget/CDN
  ou API de Belvo/Pluggy. A compatibilidade comprovada é de protocolo/cliente,
  middleware e build/PWA, sem reabrir o fluxo funcional.

## Deployments históricos e publicação futura

O inventário operacional anterior, em 2026-10-17 e preservado na branch Billing,
registrou 120 deployments READY e 105 aliases apontando para 100 deployments.
São evidências datadas, **não um novo inventário nesta etapa**.
Não houve inspeção ativa de endpoints remotos ou alteração da Vercel aqui.

| Gate | Estado | Próxima ação autorizável |
| --- | --- | --- |
| Cinco rotas na versão corrigida | Ver evidência local | Revisar pacote mínimo independente. |
| Domínios/aliases atuais após futura publicação | BLOCKED | Após autorização, verificar que todos apontam para a versão com pausa e retornam 503. |
| URLs imutáveis/aliases de deployments antigos | BLOCKED | Inventariar novamente e comprovar bloqueio por proteção/perímetro, restrição de acesso ou desativação aprovada. |
| Tokens emitidos anteriormente | BLOCKED / fora do bloqueio de novas chamadas | Decidir se há necessidade de revogação pelo provedor; não houve operação remota. |
| Retomada funcional | Fora do escopo | Exige nova decisão de produto e segurança; arquivo histórico não é solução pronta. |

Sequência futura, separada de Billing:

1. Revisar somente o diff desta branch sobre a main atual; não integrar migrations
   ou mudanças não publicadas do Billing.
2. Autorizar separadamente PR/integração e publicação. Se a integração na main
   disparar deploy automático, a aprovação deve contemplar essa publicação.
   Revalidar CI, build/PWA e
   testes HTTP das cinco rotas no ambiente autorizado com provedores simulados.
3. Antes de considerar a pausa global concluída, aprovar o tratamento de URLs
   antigas e comprovar que nenhuma delas permite alcançar provedores.
4. Publicar exclusivamente o pacote de pausa pelo fluxo aprovado e verificar
   503/código estável em domínio principal, aliases e variantes históricas.
   Nenhuma flag ou configuração de credenciais é requisito para a pausa.
5. Monitorar erros e confirmar Dashboard, arquivos, lançamentos manuais,
   investimentos e Billing com smoke tests não destrutivos autorizados.

Esta sequência é proposta; **nenhuma etapa remota foi executada**.

## Recuperação sem reativação

A pausa do servidor é o piso de segurança. Preferir reparo para frente mantendo
503/`OPEN_FINANCE_PAUSED`. Se houver regressão de frontend, recuperar os assets
sem remover o handler de pausa. Nunca promover um deployment/commit anterior
com os endpoints funcionais sem que exista um bloqueio equivalente comprovado.

Não restaurar arquivos `.disabled`, proxies antigos ou credenciais como fallback.
Rollback integral para uma versão vulnerável é NO-GO. Uma recuperação que não
consiga preservar o bloqueio deve aguardar contenção aprovada, e não reativar
os provedores automaticamente.

## Encerramento

Implementação local encerrada para revisão. O pacote independe do Billing.
A pausa global em produção só poderá ser declarada após publicação autorizada
e resolução verificável das URLs históricas. Open Finance continua fora da prioridade.
