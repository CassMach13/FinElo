# Release de aparência em produção

Base verificada: `main` / `6fa1188b1864e85da587e61c7e46009a5e82adb4`.
Origem visual homologada: `bcb0c7bc98e683eebcd7925cd0312300af5c23cd`.
Branch exclusiva: `codex/finelo-theme-release`.

## Comportamento e flags

| Ambiente Vite | Condição | Resultado |
| --- | --- | --- |
| production | Usuário autenticado e `VITE_APPEARANCE_RELEASE=true` | Seletor disponível sem metadata piloto |
| production | Flag ausente, false ou outro valor | Escuro, mesmo com preferência clara previamente salva |
| staging | `VITE_APPEARANCE_PILOT=true` e `app_metadata.appearance_pilot=true` | Piloto anterior mantido |
| Outros modos / usuário ausente | Qualquer flag | Sem habilitação de aparência |

As flags são incorporadas ao build. O comando produtivo continua `npm run build` → `vite build`, em modo **production**. Não compilar produção com `--mode staging`. A flag de release não substitui as duas condições do piloto staging.

Sem preferência válida a resolução é **Escuro**, independentemente do tema do sistema. `dark`, `light` e `system` permanecem em `user_metadata.appearance_theme`, por conta. Desligar a release não apaga escolhas. As páginas públicas não recebem o tema autenticado.

## Isolamento do escopo

A release foi reconstruída por arquivos sobre a main verificada; não contém os commits da foundation posteriores à candidata. Os arquivos de produto aprovados foram mantidos; a alteração nova de produto se restringe ao gate e ao nome acessível do seletor.

Permanecem as dependências homologadas de escrita de metadata vinculada ao bearer da conta, invalidação de respostas antigas, limpeza de caches de interface por titular e foco/portais. A guarda já homologada de Objetivos cancela respostas de uma sessão encerrada; payloads, normalização monetária e regras econômicas não foram alterados nesta release.

Não há alteração em `vite.config.ts`, Service Worker, política PWA, dependências, lockfile, APIs financeiras, domínio econômico, RLS ou migrations. Os dois componentes de aviso/instalação PWA receberam somente a apresentação já homologada; não há nova coordenação de abas/worker. A sincronização entre abas adicionada ao produto é exclusivamente da preferência de aparência.

Evidências binárias antigas e runners diagnósticos/experimentais não são transportados. Conservam-se os testes de aparência e os três arquivos auxiliares necessários aos seus selos históricos. O manifesto adjacente documenta cada inclusão e exclusão.

Os selos históricos não foram regravados: o helper de teste reverte somente os trechos exatos do novo gate e do nome do seletor antes da comparação histórica. Testes separados verificam a semântica de produção e rejeitam qualquer alteração adicional nesse gate.

## PR e efeito do push

No pré-voo de 11/11/2026, `finelo-br` está conectado a `CassMach13/FinElo`, production branch `main`, com criação automática de deployments habilitada. Um push desta branch pode gerar **Preview no projeto compartilhado**; esse ambiente não deve ser chamado de staging.

O Preview herda o par Supabase Preview configurado no projeto. Os valores são sensitive e sua associação a um backend não foi certificada nesta release. Nenhum teste autenticado ou operação financeira deve ser executado nele com dados reais. A nova flag de release não está cadastrada, portanto esse build mantém Escuro. Não haverá ajuste remoto de variáveis para abrir o tema no Preview compartilhado.

O workflow `quality-baseline.yml` executa testes, baseline TypeScript e build em PR; não possui passo de deploy ou migration. O CI utiliza valores públicos fictícios de Supabase. A PR deve continuar separada da #97 e em draft até a decisão final de publicação.

## Publicação futura — requer autorização final

1. Revalidar main, árvore da PR aprovada, CI, projeto e deployment produtivo ativo. Se a main mudar, atualizar e revalidar a release antes do aceite.
2. Aprovar uma janela sem outras publicações. Concluir formulários, importações e gravações pendentes antes da atualização PWA; não forçar recarga sobre trabalho em andamento.
3. No projeto **`finelo-br` / `prj_bI6N0vwlVIxhltexdO6V4pswXNKG`**, cadastrar `VITE_APPEARANCE_RELEASE=true` somente em **Production**, mantendo o backend e as credenciais existentes. Essa ação não foi executada neste ciclo.
4. Autorizar conjuntamente merge e publicação: a integração atual publica automaticamente pushes/merges em `main`. Não há garantia de que o CI pós-merge termine antes do deploy Vercel. A base de aprovação precisa ser a PR e seu CI concluído.
5. Registrar o SHA final da main após merge, que pode diferir do SHA da branch conforme o método de merge. O deployment efetivamente lançado será o build desse SHA final, não a candidata staging nem a foundation. Conferir `meta.githubCommitSha`, modo production, flag e atribuição dos domínios antes do aceite.
6. Fazer smoke com sessão e conta autorizadas: padrão Escuro, seletor, três modos, recarga, duas abas, páginas públicas e downloads. Comparar saldos/valores somente por leitura; nenhuma transação de teste real é necessária.

Não executar `vercel promote`, merge ou publicação a partir deste documento sem autorização. Uma simples alteração de flag não modifica o bundle já servido; exige novo build.

## Rollback futuro — âncora verificada

No pré-voo, o target Production atribuído é:

- ID `dpl_7uAtcVDvJtjQrVGBnP4fW2mAYZHH`;
- URL `https://finelo-i9f0xjkhy-cassios-projects-a7e9d592.vercel.app`;
- SHA `6fa1188b1864e85da587e61c7e46009a5e82adb4`, READY.

Revalidar essa âncora imediatamente antes do lançamento; se houver outra publicação aprovada, registrar a nova âncora. Em regressão relevante, com autorização operacional, usar o rollback do projeto correto para esse deployment imutável, sem rebuild e sem migration. Exemplo a executar apenas na janela autorizada:

```powershell
$env:VERCEL_ORG_ID = 'team_ayglpViWJHVv9dTg6Dx85SvI'
$env:VERCEL_PROJECT_ID = 'prj_bI6N0vwlVIxhltexdO6V4pswXNKG'
vercel rollback https://finelo-i9f0xjkhy-cassios-projects-a7e9d592.vercel.app --scope team_ayglpViWJHVv9dTg6Dx85SvI
```

Conferir API do target produtivo e resolução dos domínios para o deployment anterior. Restaurar a configuração anterior da flag (ausente) para impedir que um futuro rebuild reative a release inadvertidamente. Não apagar preferências dos usuários.

Verificar em navegador novo e em cliente PWA existente, após recarga normal sem trabalho pendente: login, Escuro legado, ausência de chunks faltantes, navegação, modais, PDFs/exportações e igualdade dos valores financeiros lidos antes/depois. Confirmar que nenhuma escrita financeira foi emitida. A reversão do servidor não substitui a verificação da versão efetivamente controlada pelo worker no cliente.

O rollback Vercel altera o comportamento de atribuição automática dos próximos builds. Não retomar promoções ou publicações automaticamente: exigir nova decisão após o diagnóstico. [Documentação de rollback](https://vercel.com/docs/instant-rollback)
