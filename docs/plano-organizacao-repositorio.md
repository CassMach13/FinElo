# Plano de organização do repositório FinElo

**Objetivo:** deixar a raiz do GitHub limpa e profissional, sem quebrar o app.  
**Princípio:** o que o visitante vê primeiro deve ser produto + como rodar; o resto vai para pastas ou sai do Git.

**Não fazer neste passo:** refactor de `src/`, mudança de stack, rewrite de features.

---

## 1. Estado desejado da raiz

### Permanecem na raiz (padrão de mercado)

| Arquivo | Motivo |
| --- | --- |
| `README.md` | Porta de entrada |
| `package.json` / `package-lock.json` | Dependências |
| `index.html` | Entry Vite |
| `tsconfig.json` | TypeScript |
| `vite.config.ts` / `vitest.config.ts` | Tooling |
| `tailwind.config.cjs` / `postcss.config.cjs` | CSS |
| `vercel.json` / `.vercelignore` | Deploy |
| `.gitignore` / `.env.example` / `.node-version` | Ops |
| `metadata.json` | Só se o app depender; senão mover para `docs/` |

### Pastas que já estão certas

- `src/` — aplicação
- `api/` — serverless
- `public/` — estáticos
- `supabase/` — backend Supabase
- `docs/` — documentação (expandir)
- `scripts/` — utilitários (expandir)
- `tests/` — testes formais (se houver)

---

## 2. Mapa de movimentação

### A) → `docs/` (negócio, planos, marca)

```text
analise_concorrentes_marketing.md
Apresentacao_Parcerias.pptx
business_progression_plan.md
PLANO-MIGRACAO-DADOS-HISTORICOS.md
Melhorias Personal Finance Manager.txt
info.txt
slides.txt
trilha-vibecoding.docx
FinElo - Resumo Técnico de Segurança e Arquitetura.pdf
briefing-finelo-landing.md          # se for versionar (hoje está untracked)
```

Opcional: subpastas

```text
docs/negocio/
docs/seguranca/
docs/prints/          # já existe
```

### B) → `docs/assets/` ou `docs/marketing/` (mídia de apresentação)

```text
finelo_story.gif
finelo_story_final.webp
```

### C) → `scripts/debug/` (scripts avulsos de investigação)

```text
check_investments.ts
check_sheets.cjs
debug_full_import.cjs
debug_santander.cjs
debug_santander.js
test-belvo.js
test_nubank_account.cjs
test_parser.ts
test_santander_logic.cjs
```

### D) → `scripts/fixtures/` ou `docs/fixtures/` (amostras)

```text
demo_transactions.csv
santander_structure.json
t.ID_Conta
```

### E) Remover do Git (lixo / artefato local) — manter no PC se quiser, mas fora do remoto

Usar `git rm --cached` (não apaga do disco) + reforçar `.gitignore`:

```text
build_output.txt
build_output_utf8.txt
error_log.txt
filtered_tsc_errors.txt
full_tsc_errors.txt
sim_result.txt
ts_errors.txt
tsc_errors.txt
tsc_output.txt
tsc_output_final.txt
~$ilha-vibecoding.docx
```

Também garantir no `.gitignore` (se ainda não estiver):

```gitignore
*.log
*_output.txt
*_errors.txt
tsc_*.txt
ts_errors.txt
~$*
.DS_Store
Thumbs.db
```

Arquivos locais sensíveis que **nunca** devem entrar no Git (já devem estar ignorados):

```text
.env.local
belvo_sandbox_api_keys.txt
Backup/
instagram_strategy/
audios/
videos_promocionais/
```

E **não versionar** (se ainda untracked):

```text
scripts/sql/diagnose_marcelo_*.sql
scripts/diagnose_user.ts   # revisar se tem dado de cliente antes de subir
```

---

## 3. Ordem de execução (segura)

### Passo 0 — backup mental
- Repo já está público ou privado? Se público, fazer a limpeza em um commit claro (`chore: organize repository root`).
- Garantir working tree entendida: mudanças da landing podem ficar de fora deste commit.

### Passo 1 — criar pastas

```powershell
cd C:\Users\cassi\OneDrive\Cassio\Programacao\personal-finance-manager
mkdir docs\negocio, docs\seguranca, docs\assets, scripts\debug, scripts\fixtures -Force
```

### Passo 2 — mover com Git (preserva histórico)

```powershell
# Docs de negócio
git mv "analise_concorrentes_marketing.md" docs/negocio/
git mv "Apresentacao_Parcerias.pptx" docs/negocio/
git mv "business_progression_plan.md" docs/negocio/
git mv "PLANO-MIGRACAO-DADOS-HISTORICOS.md" docs/negocio/
git mv "Melhorias Personal Finance Manager.txt" docs/negocio/
git mv "info.txt" docs/negocio/
git mv "slides.txt" docs/negocio/
git mv "trilha-vibecoding.docx" docs/negocio/

# Segurança
git mv "FinElo - Resumo Técnico de Segurança e Arquitetura.pdf" docs/seguranca/

# Assets
git mv finelo_story.gif docs/assets/
git mv finelo_story_final.webp docs/assets/

# Scripts debug
git mv check_investments.ts scripts/debug/
git mv check_sheets.cjs scripts/debug/
git mv debug_full_import.cjs scripts/debug/
git mv debug_santander.cjs scripts/debug/
git mv debug_santander.js scripts/debug/
git mv test-belvo.js scripts/debug/
git mv test_nubank_account.cjs scripts/debug/
git mv test_parser.ts scripts/debug/
git mv test_santander_logic.cjs scripts/debug/

# Fixtures
git mv demo_transactions.csv scripts/fixtures/
git mv santander_structure.json scripts/fixtures/
git mv t.ID_Conta scripts/fixtures/
```

> Se algum `git mv` falhar por path com acento no Windows, use aspas como acima ou renomeie antes.

### Passo 3 — tirar lixo do índice Git

```powershell
git rm --cached build_output.txt build_output_utf8.txt error_log.txt `
  filtered_tsc_errors.txt full_tsc_errors.txt sim_result.txt `
  ts_errors.txt tsc_errors.txt tsc_output.txt tsc_output_final.txt `
  "~`$ilha-vibecoding.docx" 2>$null
```

### Passo 4 — atualizar `.gitignore`

Acrescentar regras da seção 2E.

### Passo 5 — atualizar README (1 linha)

Na seção de estrutura, refletir:

```text
docs/          # docs, prints, negócio, segurança
scripts/debug/ # utilitários locais (não são a API de produção)
scripts/fixtures/
```

### Passo 6 — validar que o app não quebrou

```powershell
npm run build
# se algum script interno importava path antigo na raiz, ajustar
```

### Passo 7 — commit único e push

```powershell
git add -A
git status   # revisar: sem .env.local, sem diagnose_marcelo
git commit -m "chore: organize repository root for a cleaner public portfolio"
git push
```

---

## 4. Critério de “pronto”

Na página do GitHub, a raiz deve mostrar basicamente:

- README + configs de build/deploy  
- pastas `src`, `api`, `public`, `supabase`, `docs`, `scripts`, `tests`  

Sem dezenas de `.txt` de erro e scripts `debug_*` soltos.

---

## 5. O que NÃO mover agora

- `src/`, `api/`, `public/`, `supabase/`
- configs Vite/Tailwind/TS
- `package.json`
- variáveis na Vercel
- limpeza de histórico Git antigo (Belvo) — já mitigado com rotação de chave

---

## 6. Depois (opcional / P2)

1. Profile README no GitHub (`CassMach13/CassMach13`)
2. Pin: FinElo + DevClub + Skat
3. Organizar Skat (sem `Apps_versoes_excluidas` / credentials)
4. Subir DevClub público com README de entrega
5. Decidir Filippini público sanitizado vs privado

---

## 7. Como pedir ajuda na execução

Mensagem sugerida para a próxima conversa:

> Execute o plano em `docs/plano-organizacao-repositorio.md` no FinElo: faça os `git mv`, atualize `.gitignore` e README, rode `npm run build`, e prepare o commit (sem push até eu confirmar).
