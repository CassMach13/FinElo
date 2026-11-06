# 4D — Roteiro operacional manual

**Estado inicial: NOT TESTED.** Nenhum PASS deste roteiro foi inferido de viewport, SDK sintético ou build. Não executar com contas ou dados de clientes. Não publicar a aplicação para preencher o roteiro sem autorização específica.

## Antes de começar

A execução depende de staging autorizado com backend comprovadamente isolado, commit identificado e contas QA já elegíveis pela flag/coorte existente. É necessário um mecanismo integrado de temas aprovado para esse ambiente. A entrada `integrated-preview.html` deste ciclo é **somente loopback com HTTP sintético fornecido pelo runner**: não funciona como login remoto ou como site de testes para um telefone. Não copiá-la para Vercel, não remover suas guardas e não adicionar contas à coorte para viabilizar este roteiro.

O responsável deve confirmar a versão do frontend, identidade do backend, origem exclusivamente sintética dos dados, isolamento entre A/B e ausência de acesso a produção. A prévia Vercel `56afa73` encontrada no início do 4D usou `vite build` em modo padrão, não modo staging; isso não habilita o piloto. Não inserir credenciais em issue, relatório, screenshot ou chat. Utilizar o acesso QA seguro já aprovado.

| Registro da execução | Preencher |
| --- | --- |
| Operador / data e hora local | |
| URL autorizada / commit / identificação não secreta do backend | |
| Aparelho e modelo / sistema e versão | |
| Navegador e versão / PWA instalado ou aba | |
| Orientação / resolução / zoom / preferências do sistema | |
| Identificadores não sensíveis das contas QA A/B / papéis esperados | |
| Evidências: pasta, nomes e SHA-256 | |

Usar **PASS, FAIL, BLOCKED ou NOT TESTED** em cada passo. Uma linha vazia significa NOT TESTED. Registrar passos, esperado, observado e captura em qualquer FAIL. Se ocorrer exposição entre contas, gravação duplicada, alteração financeira, perda de preferência ou resultado financeiro incerto sem feedback, parar aquele cenário, preservar evidência redigida e recomendar NO-GO; não tentar corrigir dados.

## Navegação, aparência e sessão — repetir por plataforma

Executar em **iPhone/Safari**, **Android/Chrome**, **desktop/Edge** e **desktop/Chrome**; acrescentar outros navegadores efetivamente disponíveis. Repetir a navegação com Escuro, Claro e Automático. Usar as mesmas contas, fixtures, período e filtros; capturar pares com dimensões equivalentes. Não registrar senhas, tokens, e-mails pessoais ou conteúdo real de suporte.

| ID | Ação | Resultado esperado | Estado / observado / evidência |
| --- | --- | --- | --- |
| M01 | Login de A sem preferência salva | Escuro por padrão, sem preferência de outra conta | |
| M02 | Escolher Escuro em Configurações | Confirmação de gravação e Escuro consistente | |
| M03 | Escolher Claro | Confirmação, textos/valores legíveis, sem região Dark residual | |
| M04 | Escolher Automático | Segue a preferência do sistema | |
| M05 | Mudar tema do sistema com a aplicação aberta | Somente Automático acompanha; escolhas explícitas permanecem | |
| M06 | Atualizar a página e abrir novamente | Conta e preferência corretas após autenticação válida | |
| M07 | Abrir duas abas da mesma conta; alternar tema | Preferência confirmada converge nas duas, sem gravar dados financeiros | |
| M08 | Duas escolhas rápidas | Escrita em curso protegida; segunda tentativa não corrompe preferência; repetir após concluir se rejeitada | |
| M09 | Atualizar perfil durante renovação de token | Claro confirmado preservado; perfil converge após refresh normal; nenhum titular antigo restaurado | |
| M10 | Desconectar rede durante gravação | Erro compreensível; conservar a última preferência confirmada | |
| M11 | Reconectar e voltar à aba | Sincronização correta, sem duplicação nem alteração financeira | |
| M12 | Logout de A; login de B | Sem nome, draft, formulário, conteúdo ou preferência de A | |
| M13 | Substituir sessão por B em outra aba | Todas as abas autenticadas refletem a conta correta; modais antigos descartados | |
| M14 | Manter requisição de A pendente e autenticar B; liberar A | Retorno antigo não restaura A nem publica seus dados em B | |
| M15 | Aceite de Termos pendente durante troca A→B | B não aceita por A; diálogo/estado de B preservados; versão legal intacta | |
| M16 | Abrir/fechar modais por teclado e cancelar | Foco inicial visível, Tab contido quando modal, Escape/cancelamento e restauração correta | |
| M17 | Dashboard → Transações → Importação → Investimentos → Objetivos → Configurações → Ajuda → Dashboard | Navegação real, conta/período preservados, sem perda de tema ou região ilegível | |
| M18 | Alterar período, filtros e titular permitido | Mesmos centavos/resultados entre temas, sem ampliar visibilidade | |
| M19 | Voltar, avançar, atualizar e reabrir sessão | Comportamento compatível com o roteador existente; documentar que botões internos usam store e não criam histórico por tela | |
| M20 | Vazio, loading, falha de leitura e recuperação | Estado legível e honesto; resultado incerto exige feedback; nunca inventar saldo zero como sucesso | |
| M21 | Ajuda: artigos, anexos, menus e portais | Rótulos, foco, consentimento e retorno de erro; sem conteúdo anterior ao trocar conta | |
| M22 | Área administrativa com papel autorizado e com B sem papel | Acesso somente conforme autorização real; nenhuma métrica/draft administrativa em B | |
| M23 | Plano/assinatura e aviso de upgrade; cancelar | Preços/links corretos; não confirmar checkout, cobrar ou alterar assinatura | |
| M24 | Imprimir/exportar fixture financeira autorizada | Mesmas páginas, dimensões, competências, sinais, valores e totais nos temas; sem escrita por exportar | |

## Acessibilidade, toque e orientação

| ID | Ação | Resultado esperado | Estado / observado / evidência |
| --- | --- | --- | --- |
| A01 | Percorrer o fluxo por Tab/Shift+Tab/Enter/Escape | Nome acessível, ordem lógica, foco visível e sem bloqueio | |
| A02 | Touch em seletores, menus, tabelas e modais | Alvos utilizáveis, sem clique na ação adjacente ou conteúdo inacessível | |
| A03 | Datas/mês, seleção de arquivo e controles nativos | Texto, seleção, disabled e calendário legíveis; payload/data iguais | |
| A04 | Retrato e paisagem; rolar página, modal e tabelas | Ações continuam alcançáveis; classificar rolagem 2D de tabela separadamente de overflow geral | |
| A05 | Zoom nativo 200% e 400% no desktop; ampliar texto no telefone | Reflow e leitura preservados; nenhum campo/ação crítica perdido | |
| A06 | Ativar redução de movimento no sistema | Operação continua possível; registrar animações legadas que persistirem | |
| A07 | Alto contraste / forced colors disponível | Controles, foco, sinais monetários e informações de gráficos distinguíveis | |
| A08 | VoiceOver no iPhone; TalkBack no Android; leitor disponível no desktop | Ler títulos, totais, sinais positivos/negativos, nomes de controles e alternativas dos gráficos sem depender só de cor | |
| A09 | Abrir tooltip por foco/teclado/touch | Informação acessível sem hover exclusivo; dismissível | |
| A10 | Primeira visita: navegar antes e depois do tutorial automático | Identificar o timer legado que pode abrir o tour da tela anterior; encerrar tour e verificar recuperação | |

Não usar medições de contraste ou inspeção DOM como substituto de leitor de tela real. A automação de largura equivalente a zoom não aprova zoom nativo. Incluir especificamente Personalizado no Dashboard, tabela de Investimentos e conciliação mobile, com os overflows anteriores conhecidos.

## PWA instalado — repetir iPhone e Android, e desktop se disponível

Utilizar instalação QA separada e autorizada. Não limpar cache, service worker, storage ou sessão de uma instalação real do FinElo. A remoção/reinstalação só pode afetar a instalação de teste identificada acima.

| ID | Ação | Resultado esperado | Estado / observado / evidência |
| --- | --- | --- | --- |
| P01 | Primeira instalação QA | Ícone, nome, manifest e origem corretos | |
| P02 | Abrir pelo ícone, fora da aba do navegador | Janela independente; registrar display-mode real | |
| P03 | Salvar Claro, fechar completamente e reabrir | Preferência e titular preservados | |
| P04 | Offline; abrir/recarregar e reconectar | Aparência confirmada preservada; estado de dados/cache/erro explicitado; não afirmar operações financeiras concluídas offline | |
| P05 | Atualização controlada A→B autorizada do QA | Evidência de SW/versão; preferência e valores preservados; feedback compreensível | |
| P06 | Abrir instalação que guardou versão anterior | Cache atualizado sem mistura de dados ou perda de sessão/tema | |
| P07 | Logout A/login B na instalação existente | Nenhum conteúdo pessoal ou preferência de A para B | |
| P08 | Fechar/reabrir após atualização | Versão atual e aparência correta | |
| P09 | Interromper leitura/rede e recuperar | Loading/erro visível, ação de recuperação alcançável e sem gravação duplicada | |
| P10 | Remover e reinstalar apenas o QA | Instalação nova autentica corretamente; aparência restaurada da conta, sem herança de outra pessoa | |

## Registro de falha e decisão

```text
ID do caso:
Ambiente / commit / aparelho / navegador:
Tema / conta QA / período / filtro:
Passos mínimos:
Esperado:
Observado:
Impacto (privacidade, financeiro, permissão, preferência, leitura, navegação):
Severidade e condição de bloqueio:
Reproduz no Escuro anterior? Evidência:
Arquivo(s) redigido(s) / SHA-256:
Recuperação possível sem modificar dados:
Responsável / decisão (aceitar risco, corrigir em escopo separado, bloquear):
```

Parecer por plataforma: ______. Parecer do piloto: **GO / GO condicionado / NO-GO**, acompanhado das condições objetivas e da autorização do responsável. Preencher este formulário não autoriza publicação, deploy, ampliação de coorte, migração ou execução automática de piloto.
