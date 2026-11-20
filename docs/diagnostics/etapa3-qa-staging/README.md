# Etapa 3 · homologação em staging

**NO-GO para homologação final.** A consulta ao Auth de staging retornou Google e GitHub desativados. O provedor de e-mail está habilitado. Faltam a confirmação dos redirects no painel administrativo, o acesso às contas artificiais e à caixa de teste e a rodada de PWA em aparelho físico. A execução desta rodada usou leitura de configuração em staging e ensaios de interface com identidades sintéticas.

## Identificação e isolamento

| Verificação | Evidência |
| --- | --- |
| Código | PR #102 aberta em rascunho, SHA local e remoto `bed32b049ce5b6e536952b4f6f22c95eae98c171`. [Autorização de staging](https://github.com/CassMach13/FinElo/pull/102#issuecomment-7045726534) |
| CI do SHA | TypeScript, testes e build aprovados. A suíte completa já registrada nessa revisão teve 3.634 aprovações e um teste ignorado. [Quality baseline](https://github.com/CassMach13/FinElo/actions/runs/44779569630) |
| Preview Vercel | Deployment `dpl_AHJB54zcpPrf8sS3a6hBHefTwUd2`, estado READY e SHA correspondente. [Deployment imutável](https://finelo-csktw0bjq-cassios-projects-a7e9d592.vercel.app) · [Alias da branch](https://finelo-br-git-feat-multi-accou-31469d-cassios-projects-a7e9d592.vercel.app) |
| Supabase | O inventário de projetos, a URL do projeto `finelo-staging`, a configuração local de staging e o JavaScript publicado no Preview apontam para `https://sxmmrnwbxntccscojmfh.supabase.co`. O projeto FinElo de produção tem outra referência. |
| Flag | O inventário Vercel contém URL e chave pública específicas de Preview. A flag de múltiplas contas está ausente. A comparação do JavaScript servido com os builds ligados e desligados também identificou no Preview a composição da interface com a flag desligada. |
| Build de QA | Build isolado do SHA com a flag ligada. A varredura do bundle confirmou o host de staging e a ausência do host Supabase de produção. Um build local adicional, em modo staging com opt-in de aparência, permitiu testar o tema claro. Ambos geraram service worker. |
| Redirects e provedores | O endpoint público de configurações de Auth de staging respondeu HTTP 200, com Google e GitHub desativados e e-mail habilitado. Ele não informa a lista de redirects. O painel administrativo solicitou login. A autorização do retorno para o alias de QA e a entrega de e-mail continuam pendentes. |

## Resultados por cenário

| Cenário | Ambiente e resultado |
| --- | --- |
| Google e GitHub reais | Bloqueados no Auth de staging. Adição, cancelamento, replay, retorno em outra aba, expiração, identidade divergente e preservação da sessão ainda exigem prova com contas autorizadas dos provedores. |
| E-mail real de B com A ativa | Pendente. Sem confirmação dos redirects, da caixa e das identidades artificiais A/B, nenhum e-mail de recuperação foi solicitado e nenhuma senha real foi alterada. |
| Recuperação e OAuth simulados | No Edge, o formulário e o SDK reais operaram contra o backend simulado. A recuperação registrou um PUT autorizado para B e zero para A. A outra janela foi recusada. Passaram a recarga antes do retorno, o PIN, a rejeição da rota direta e ambos os provedores simulados. |
| Troca e isolamento | O navegador completou A → B → A sem novo login por senha. Após recarga, as duas abas conservaram identidades distintas. O service worker controlou a página. |
| Encerramento e remoção | No navegador, o logout local de A preservou B na outra aba. A remoção de A e a ação de sair de todas as contas passaram. No build com a flag desligada, login e logout legados passaram sem criar o registro de múltiplas contas. |
| Concorrência, expiração e rede | Nova execução dos seis arquivos de múltiplas contas, com 73 testes aprovados. Incluem operações atrasadas de A, verificação do portador, falha de rede, expiração, cancelamento e exigência de novo link após recarga da autorização de recuperação. Backend simulado, inclusive nas gravações. |
| Apresentação | Desktop claro a 1.440 px com abertura do menu por Enter. Viewport móvel escuro a 390 px com fechamento por Escape e sem transbordamento horizontal. As capturas mostram contas artificiais. |
| PWA física | Pendente. O inventário local não identificou aparelho disponível. O ensaio de service worker ocorreu no Edge de desktop. |

[Desktop claro](./desktop-claro.png) · [Viewport móvel escuro](./mobile-escuro.png)

A retomada dos cenários reais depende de provedores OAuth configurados com clientes de teste no projeto de staging, de confirmar o callback do Supabase nos provedores e o retorno `/device-auth` do endereço estável no Supabase, e de disponibilizar as contas e a caixa de teste por meio seguro. A habilitação de e-mail nas configurações, por si só, não comprova entrega.
