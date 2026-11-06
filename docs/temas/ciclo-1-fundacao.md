# FinElo · Ciclo 1 de aparência

Atualização: a limitação de sincronização da sessão descrita neste registro foi tratada no [Ciclo 2](ciclo-2-compartilhados.md), que também amplia os componentes, as capturas e as verificações de impressão. Este documento conserva os resultados históricos do primeiro ciclo.

A fundação oferece Escuro, Claro e Automático em uma amostra autenticada de Configurações. A referência reúne Card, Modal, Button, Input e Select, inclusive data nativa e botão desabilitado. A amostra tem dados fictícios. O restante do aplicativo conserva a apresentação escura enquanto as telas são convertidas nos ciclos seguintes.

## Arquitetura e disponibilidade

`src/domain/appearance/theme.ts` resolve a escolha validada. A ausência de preferência, um valor inválido e o modo Automático sem suporte à consulta de mídia resultam em Escuro. Apenas Automático assina as mudanças de `prefers-color-scheme`. O valor efetivo é calculado na primeira renderização da amostra após a sessão estar pronta. A assinatura é removida ao trocar para uma opção explícita ou sair da amostra.

A entrada em Configurações exige os três critérios abaixo.

- Vite executado com `--mode staging`.
- `VITE_APPEARANCE_PILOT=true`.
- `app_metadata.appearance_pilot === true` na conta autenticada, configurado administrativamente.

O build padrão de produção mantém o piloto indisponível, inclusive se receber a variável por engano. Para retirar o acesso em staging, desligue a flag do build ou remova a inscrição administrativa e atualize a sessão. A preferência já salva continua disponível para quando a amostra voltar.

`updateUserPreferences` usa uma gravação confirmada para `user_metadata.appearance_theme`. Uma única operação por conta pode estar em andamento. A requisição envia somente a chave de aparência ao mesmo recurso Auth do SDK. Ela usa o token da sessão conferida antes do envio para impedir que uma troca de conta redirecione a escrita. A resposta só atualiza o estado local se a mesma sessão continuar ativa. Em falha, o modo confirmado permanece e a interface permite nova tentativa. As demais preferências continuam no caminho existente. A restauração usa o usuário devolvido pelo Auth. Como essa escrita não atualiza a cópia de sessão do SDK, uma abertura totalmente offline pode usar a escolha anterior até consultar o servidor. [Supabase Auth](https://supabase.com/docs/reference/javascript/auth-updateuser)

## Tokens e estilos

| Papel | Escuro de referência | Claro |
| --- | --- | --- |
| Fundo e superfície | `#1A202C`, `#2D3748` | `#F5F7FA`, `#FFFFFF` |
| Texto principal e secundário | `#F7FAFC`, `#94A3B8` | `#172334`, `#526175` |
| Campo e borda de controle | `#020617`, `#475569` | `#FFFFFF`, `#6B7A8A` |
| Divisor decorativo e foco | `#475569`, `#38BDF8` | `#D8E0E8`, `#1D4ED8` |
| Ação | Gradiente ciano–azul existente | `#0E7490` a `#1D4ED8`, texto branco |
| Sucesso, alerta, erro e informação | Papéis separados de texto e superfície | `#166534`, `#854D0E`, `#B42318`, `#1E40AF` |
| Séries | Teal, azul, violeta, âmbar e vermelho | `#0F766E`, `#1D4ED8`, `#7E22CE`, `#92400E`, `#B91C1C` |

[Tokens RGB e seletores](../../src/components/appearance/appearance.css) · [Utilitários Tailwind com alfa](../../tailwind.config.cjs)

Os estilos claros só valem no escopo `data-finelo-theme="light"` da amostra e em mídia de tela. Os componentes compartilhados receberam pontos de aplicação, mantendo suas classes existentes. Em Claro, os controles usam `color-scheme: light` e o indicador de data WebKit usa a aparência nativa. A amostra está fora da impressão. A folha de impressão, o manifesto, o splash e as cores de lançamento da PWA continuam com as regras atuais. A inspeção física de iOS, Android e instalação PWA fica para a homologação das superfícies.

## Evidências e verificação

| Viewport | Escuro | Claro |
| --- | --- | --- |
| Desktop 1440 × 900 | [Formulário](evidencias-ciclo-1/desktop-escuro-formulario.png) · [Modal](evidencias-ciclo-1/desktop-escuro-modal.png) | [Formulário](evidencias-ciclo-1/desktop-claro-formulario.png) · [Modal](evidencias-ciclo-1/desktop-claro-modal.png) |
| Mobile 390 × 844 | [Formulário](evidencias-ciclo-1/mobile-escuro-formulario.png) · [Modal](evidencias-ciclo-1/mobile-escuro-modal.png) | [Formulário](evidencias-ciclo-1/mobile-claro-formulario.png) · [Modal](evidencias-ciclo-1/mobile-claro-modal.png) |

Os quatro PNGs em Escuro são idênticos byte a byte aos obtidos com os cinco componentes de `main` em `6fa1188`, mantendo fixture, motor, escala e viewport. O ensaio também passou na ausência de rolagem horizontal, foco do modal, Escape, retorno do foco e troca de preferência do sistema com a página aberta. Para reproduzir, sirva o repositório com Vite em loopback e execute `python scripts/diagnostics/validate-theme-preview.py --port 5198 --out-dir <diretório>` com Playwright Python e Edge. O script bloqueia tráfego externo. [Harness](../../scripts/diagnostics/validate-theme-preview.py)

- **Staging autenticado.** O frontend local, ligado apenas ao projeto de staging, gravou os três valores, restaurou Claro após recarregar, reagiu a Automático, manteve o estado após falha de rede e retirou a amostra no logout. A gravação preservou um metadado independente e não recarregou transações. A identidade descartável retornou ao estado bloqueado, sem senha, sem sessões e sem transações.
- **Vitest.** Passaram 13 casos de resolução, flag, sessão, falha e preservação de saldo, mais 23 pares de contraste da paleta clara. O contrato de impressão também passou. Os testes de contraste cobrem os pares previstos, sem certificar WCAG para telas ainda não convertidas. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- **TypeScript e build.** O baseline manteve os 14 diagnósticos conhecidos, sem novos. O build padrão e o precache da PWA foram gerados.

## Arquivos e próximo ciclo

- Estado, flag e persistência em `src/domain/appearance/theme.ts`, `src/hooks/useAppStore.ts` e `src/supabaseClient.ts`.
- Integração e amostra em `src/components/views/SettingsView.tsx` e `src/components/appearance/`.
- Pontos de estilo em `src/components/ui/{Button,Card,Input,Modal,Select}.tsx` e utilitários em `tailwind.config.cjs`.
- Verificação em `tests/appearance/`, `scripts/diagnostics/theme-preview.*`, `scripts/diagnostics/validate-theme-preview.py` e nas capturas deste relatório.

1. Fotografar o shell autenticado e os estados dos componentes antes da conversão compartilhada. Usar as mesmas fixtures em desktop, mobile e PDF para permitir comparação direta.
2. Converter navegação, Card, Button, Input, Select, MultiSelect, SummaryCard, Skeleton, ProgressBar, GlobalDialog e overlays. Separar marcações de impressão das classes de cor antes de mudar os seletores usados pelo PDF. Revisar controles diretos, estados inválidos, foco e sobreposições de cada consumidor.
3. Aplicar tokens aos consumidores em lotes. Priorizar Transações, Importação, faturas e conciliação, depois gráficos, Dashboard e Investimentos. Repetir a comparação em Escuro em cada lote.
4. Manter o acesso em staging enquanto houver superfícies pendentes. A homologação posterior cobre PWA instalada, preferências offline, troca de conta, PDF e contraste dos componentes realmente renderizados.
