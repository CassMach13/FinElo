# FinElo

Controle financeiro pessoal e familiar — do extrato à clareza de patrimônio, metas e saúde financeira.

**Produto:** [https://www.finelo.app.br/](https://www.finelo.app.br/)  
**Autor:** [Cássio Marques Machado](https://www.linkedin.com/in/cassio-machado-pmo/)

---

## O problema

Planilhas complexas e extratos espalhados em vários bancos dificultam enxergar para onde vai o dinheiro. O FinElo centraliza importação, categorização, visão de fluxo, patrimônio e metas — sozinho ou em família.

## O que o produto faz

- Importação de extratos (CSV/XLS e integrações Open Finance quando configuradas)
- Dashboard de entradas, saídas, resultado e investimentos
- Patrimônio consolidado (contas, investimentos e bens)
- Método 50-30-20 para leitura de saúde financeira
- Metas / tetos de gastos
- Plano Família com painel compartilhado (convites individuais)
- Landing + app web (PWA)

> Algumas integrações (Belvo, Pluggy, Stripe, Supabase) dependem de chaves de ambiente. Sem elas, partes do fluxo podem ficar indisponíveis em desenvolvimento local.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Front-end | React 19, TypeScript, Vite, Tailwind CSS |
| Estado | Zustand |
| Backend serverless | Vercel Functions (`/api`) |
| Dados / auth | Supabase |
| Pagamentos | Stripe |
| Open Finance | Belvo / Pluggy (quando habilitados) |
| Deploy | Vercel |

## Como rodar localmente

**Requisitos:** Node.js 20+

```bash
npm install
cp .env.example .env.local
# Preencha .env.local com suas chaves (nunca commite este arquivo)
npm run dev
```

Outros scripts:

```bash
npm run build    # build de produção
npm run preview  # preview do build
npm test         # testes (Vitest)
```

Variáveis principais estão documentadas em [`.env.example`](.env.example). Em produção, configure as mesmas chaves no painel da Vercel.

## Estrutura (visão geral)

```text
src/           # UI, domínio, serviços e hooks
api/           # funções serverless (tokens, sync, Stripe webhook)
public/        # assets estáticos / landing
supabase/      # funções e artefatos relacionados ao Supabase
```

## Segurança

- Segredos ficam apenas em `.env.local` (local) e nas Environment Variables da Vercel
- Não versionar `.env`, `*_api_keys.txt` ou arquivos de credenciais
- Credenciais de APIs de terceiros devem ser rotacionadas se vazarem

## Status do projeto

Produto em evolução contínua, com landing e app em produção. Este repositório reflete o código da aplicação FinElo usada no dia a dia de desenvolvimento e deploy.

## Licença

Uso privado do autor / FinElo Soluções Tecnológicas. Entre em contato antes de reutilizar trechos em outros produtos comerciais.
