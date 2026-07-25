# Sprint 0 — Baseline de segurança operacional

Data do levantamento: 25/07/2026

Base Git: `139c1982110ec491d656e0534d0e37a800555e89`

Branch isolada: `codex/sprint-0-safety-baseline`

## Objetivo

Registrar o estado conhecido do projeto e instalar proteções de desenvolvimento sem alterar o
comportamento do aplicativo, dados de usuários ou infraestrutura de produção.

## Limites desta Sprint

- Nenhuma chamada de escrita ao Supabase hospedado.
- Nenhuma migration aplicada.
- Nenhum deploy criado ou promovido.
- Nenhuma feature flag alterada.
- Nenhum dado histórico recalculado.
- Nenhum arquivo preexistente do usuário incluído nos commits da Sprint.

## Estado-base do workspace

Antes da Sprint já existiam estes itens locais, que não pertencem a ela:

- `.gitignore` marcado como modificado apenas por metadado/terminação de linha;
- `build_output_utf8.txt` não rastreado;
- `scripts/diagnose_user.ts` não rastreado.

Esses itens devem permanecer fora dos commits da Sprint 0.

## Topologia observável

| Item | Estado observado | Consequência |
|---|---|---|
| Git | `main` alinhada a `origin/main` no início | Base reproduzível |
| Vercel | Um projeto local vinculado | Não comprova staging separado |
| Supabase local | `.env.local` aponta para instância hospedada | Não usar para testes de escrita |
| Staging | Nenhum arquivo de ambiente de staging encontrado | Staging ainda precisa ser criado ou informado |
| Service role local | Não configurada | Positivo para reduzir escrita administrativa acidental |
| Supabase CLI | Não instalado localmente | Schema remoto não foi consultado nesta Sprint |
| Vercel CLI | Não instalado localmente | Deploy remoto não foi alterado/consultado por CLI |
| Backups locais | Dois arquivos antigos, de novembro/2025 | Não são proteção suficiente para a base atual |
| Migrations | 59 arquivos; prefixos 002, 008, 009 e 010 duplicados | Ordem precisa ser normalizada antes de automação |
| Schema inicial | Tabelas centrais não são criadas pelas migrations encontradas | `db reset` não é uma restauração confiável hoje |
| CI | Nenhum workflow preexistente | PRs não tinham barreira automatizada |

## Baseline executável

| Verificação | Resultado |
|---|---|
| Node | `v22.20.0` |
| npm | `10.9.3` |
| Testes | 22 arquivos, 109 testes aprovados |
| TypeScript | 17 diagnósticos conhecidos |
| Build | Aprovado em diretório temporário |
| Bundle JS principal | aproximadamente 1,76 MB minificado |
| PWA precache | 47 entradas, aproximadamente 7,1 MB |

O build foi direcionado para `C:\tmp`, sem alterar o diretório `dist` do projeto.

## Proteção adicionada

O comando `npm run typecheck:baseline` compara os diagnósticos atuais com
`tests/baselines/typescript-errors.txt`.

Comportamento:

- erro novo: falha;
- erro conhecido removido: falha até o baseline ser reduzido conscientemente;
- conjunto idêntico: passa;
- baseline vazio e TypeScript limpo: passa.

Isso impede crescimento silencioso do passivo enquanto os erros históricos são corrigidos em PRs
separados.

O workflow `.github/workflows/quality-baseline.yml` executa em pull requests e manualmente:

1. instalação pelo `package-lock.json`;
2. verificação do baseline TypeScript;
3. 109+ testes;
4. build de produção com variáveis públicas fictícias.

O workflow não executa migrations, não usa segredos e não acessa produção.

## Riscos encontrados, não corrigidos nesta Sprint

1. Não há evidência local de um ambiente de staging isolado.
2. O playbook existente assume backup manual; não há evidência de PITR.
3. O repositório não reconstrói o schema completo do banco a partir do zero.
4. Há arquivos versionados de diagnóstico com dados financeiros identificáveis.
5. O ambiente local aponta para Supabase hospedado, tornando perigoso qualquer teste de escrita.
6. Há 17 erros TypeScript, incluindo o parser Bradesco.

## Gate antes da Sprint 1

Antes de qualquer alteração que envolva banco, autenticação ou dados:

- identificar se existe staging real;
- confirmar o plano do Supabase e a capacidade de backup/restauração;
- obter um schema-only dump ou inventário remoto, sem dados pessoais;
- ensaiar restauração em ambiente isolado;
- confirmar o método atual de aplicação de migrations;
- obter aprovação explícita para qualquer acesso remoto.
