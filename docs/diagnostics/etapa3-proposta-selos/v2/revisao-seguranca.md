# FinElo · revisão da integração de contas, proposta 2

**GO técnico para aprovação específica do patch de SHA-256 `10ebb2c4f322c8ac46670fdb8a19004b750b41de349f7bacbf305486d5063a01`.** A decisão abrange as mudanças propostas em `src/App.tsx`, `src/components/views/AuthView.tsx` e `src/components/views/UserAccountWidget.tsx`. A PR mantém as fontes seladas nos hashes originais e a funcionalidade desativada por padrão. A aplicação depende da autorização do responsável. A homologação final continua pendente.

Com A ativa, o formulário integrado solicitou a recuperação de B. O backend de teste conferiu o desafio PKCE e identificou o portador no envio da senha. Registrou **um PUT autorizado para B e zero para A**. A aba permaneceu em A. O ensaio de substituição da sessão entre a última consulta de identidade e o envio registrou **zero PUTs autorizados**. [Teste de segurança](../../../../tests/security/multiAccount/deviceAuth.spec.ts) · [Ensaio no navegador](./navegador.py)

## Identificação da proposta

| Artefato | SHA-256 anterior | SHA-256 desta revisão |
| --- | --- | --- |
| Patch | `8a3954c564f26b16fc66da5e6ee5cef6b3254a1675bbbe3e5a9d8a7d7657284d` | `10ebb2c4f322c8ac46670fdb8a19004b750b41de349f7bacbf305486d5063a01` |
| Manifesto LF | `882896c8ed519c6edd335f4d4871e594c8b502fd1e4b91a74fbac12b3cb85775` | `6c2f8520f756b9434e2095f3c29b447b59ff6e692013a6a2b4f9cd4b5d5b3389` |

A referência para revisão é `afc4fb95ec1d2a6cc85f53de2ec6032de36f40c4`. O manifesto lista, por arquivo, o hash original, o da primeira proposta e o da proposta atual. A mudança proposta para o widget coincide com a primeira versão. A revisão do patch e do manifesto encontrou código de interface, caminhos e hashes. Nenhum deles contém valores de senha, tokens, credenciais ou dados financeiros pessoais. [Patch revisado](./etapa3-integracao-selada.patch) · [Manifesto completo](./sha256-lf.json) · [Auditoria anterior](../revisao-seguranca.md)

## Matriz de riscos

| Risco | Situação para esta aprovação | Controle e evidência |
| --- | --- | --- |
| Adição de B substituir A ou uma sessão já lembrada | Resolvido no caminho integrado | O formulário usa `authForAddingAccount()` para senha, OAuth e recuperação. O cliente temporário confirma `getUser(token)`. A gravação da conta confirmada preserva a chave já ocupada. Os testes compararam os bytes da sessão de A e da duplicata de B e verificaram a ausência de logout. |
| Reautenticação dirigida aceitar outra identidade | Resolvido | O ID confirmado pelo Auth deve coincidir com o ID selecionado. O retorno de C ao solicitar B foi recusado. Na recuperação também se confere o e-mail solicitado. |
| Retorno de OAuth usar tentativa antiga, repetida ou de outra aba | Resolvido nos cenários exercitados | Cada tentativa tem UUID, finalidade, validade, conta de origem, nome aleatório do contexto e verificador PKCE da aba. O popup transmite o código, e a aba de origem faz a troca sob Web Lock. A confirmação usa o servidor. Os testes cobriram ambos os provedores, código inválido, ID divergente, replay e cópia de armazenamento de aba. |
| Recuperação de B conceder poderes ao cliente de A | Resolvido | O SDK instalado marca o verificador gerado por recuperação. A troca manual exige essa finalidade e devolve uma sessão temporária. A identidade confirmada e o token exato ficam em memória. O cliente de recuperação faz nova consulta ao Auth antes de enviar. A camada de transporte autoriza um único PUT com esse portador no endpoint de usuário do projeto. |
| Cancelamento, expiração, troca de sessão ou perda de rede | Resolvido para o isolamento | Fechar o painel invalida a tentativa. O cliente verifica origem, fase e validade antes da adoção e das requisições. A permissão de envio é consumida. Sessão revogada, troca iniciada e resposta recebida depois de cancelar não autorizaram gravação. Um resultado de rede ambíguo exige uma nova tentativa. |
| Recarga da PWA, PIN e acesso direto | Resolvido no Edge exercitado | A aba mantém o verificador antes do callback e limpa o código da URL antes da inicialização dos clientes. A tela aguarda o desbloqueio. A rota direta recusou a atualização. Uma recarga depois da confirmação exige um novo link porque a autorização reside em memória. |
| Exposição visual ou operação financeira tardia durante troca | Resolvido nos cenários locais | A integração remove as rotas durante a troca e usa o protocolo da Etapa 2. Os testes do protocolo e das operações vinculadas cobriram a requisição atrasada e a troca recusada. O navegador conferiu a identidade da aba após a recarga explícita. |
| Regressão de conta única e integridade dos selos | Resolvido nos cenários locais | No build candidato com a flag desligada, login por senha e logout confirmados, sem registro de contas. Os testes de selos passaram sobre as fontes do commit. Os três candidatos foram reconstruídos e revertidos em memória. |
| Configuração dos provedores e diversidade de navegadores | Pendente para homologação | O backend emitiu códigos e sessões sintéticos. Redirects permitidos no Supabase, entrega real do e-mail, consentimento dos provedores, políticas de popups, Safari/iOS e PWA instalada em aparelho físico precisam de validação em ambiente autorizado. |

## Evidência do código da branch

- Baseline TypeScript com 13 diagnósticos conhecidos e nenhum novo. Build padrão e geração do service worker concluídos.
- Suíte completa com **3.630 testes aprovados e um ignorado**. O grupo dirigido de selos, sessões e concorrência aprovou **92 testes** em oito arquivos, incluindo **18 de Device Auth**. Os testes usaram o SDK instalado e implementações locais do servidor e do armazenamento.
- O caso de troca de portador exercita o próprio `updateUser` do SDK após mudar a sessão no cliente temporário. O backend observa a identidade efetiva de cada PUT autorizado.

## Evidência exclusiva da proposta selada

- `git apply --check` aceitou o patch. O verificador conferiu os hashes de entrada e saída, reverteu cada candidato em memória e executou o TypeScript com a resolução de módulos do projeto. Os diagnósticos corresponderam ao baseline completo.
- O Vite carregou as três fontes candidatas em memória nos builds com a flag ligada e desligada. Ambos geraram o service worker e o precache de 49 entradas.
- O Edge headless abriu a aplicação compilada em loopback. O fluxo de recuperação passou pelo formulário real, por uma segunda janela com armazenamento copiado, pela recarga da aba original, pelo PIN e pelo envio da nova senha. O retorno limpou o código da URL. Os dois fluxos OAuth passaram pelo popup e voltaram à aba original. O registro continha A e B ao final.
- Com o service worker controlando a página, a recarga manteve A. Selecionar B no menu provocou nova navegação do tipo reload e selecionou B na aba. No build candidato com a flag desligada, o mesmo ensaio confirmou login e logout de conta única. [Verificador TypeScript e build](./verificar.mjs) · [Teste reproduzível no Edge](./navegador.py)

## Reprodução

Na raiz da worktree, com as dependências do lockfile instaladas, use Node 22.20 ou compatível, Python com Playwright e Edge. Os endereços e as chaves abaixo são placeholders do backend simulado. O ensaio de navegador intercepta o Auth e restringe a resolução de rede ao loopback.

```powershell
$env:VITE_SUPABASE_URL = 'https://example.supabase.co'
$env:VITE_SUPABASE_PUBLISHABLE_KEY = 'ci-public-placeholder'
$env:VITE_MULTI_ACCOUNT_SESSIONS = 'true'
node --experimental-strip-types docs/diagnostics/etapa3-proposta-selos/v2/verificar.mjs ../qa-candidato-on
$env:VITE_MULTI_ACCOUNT_SESSIONS = 'false'
node --experimental-strip-types docs/diagnostics/etapa3-proposta-selos/v2/verificar.mjs ../qa-candidato-off
python docs/diagnostics/etapa3-proposta-selos/v2/navegador.py ../qa-candidato-on ../qa-candidato-off
```

Ambos os pacotes instalados, `@supabase/supabase-js` e `@supabase/auth-js`, estão na versão **2.86.0**. Na implementação instalada, `resetPasswordForEmail` gera o verificador de recuperação e `exchangeCodeForSession` o lê da chave do cliente e o consome. A proposta conserva esse comportamento no cliente temporário. A validade local máxima é de 15 minutos para a tentativa e de cinco minutos após o callback de recuperação. O servidor também verifica a validade do código. [Documentação do PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow) · [Troca do código por sessão](https://supabase.com/docs/reference/javascript/auth-exchangecodeforsession)
