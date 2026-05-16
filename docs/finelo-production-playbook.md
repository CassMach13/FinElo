# FinElo Production Playbook

Guia oficial para mudanças seguras em produção (app + banco), considerando uso de planos gratuitos do Supabase e Vercel.

## 1) Objetivo

Reduzir risco de incidentes com usuários pagos, garantindo:

- validação local antes de deploy;
- execução segura de SQL em produção;
- capacidade de rollback rápido (app e dados);
- rastreabilidade do que foi alterado.

## 2) Classificação de risco (obrigatório antes de iniciar)

Classifique toda mudança em:

- **Baixo risco**
  - ajustes visuais isolados;
  - textos/cópias sem impacto em cálculos.
- **Médio risco**
  - lógica de cálculo em UI;
  - mudanças em importação, filtros, regras de mapeamento.
- **Alto risco**
  - qualquer SQL de update/delete em produção;
  - migração de dados;
  - mudanças de billing, auth, assinaturas, RLS.

Regra:

- **Médio/Alto risco exige backup manual + teste local completo antes de produção.**

## 3) Fluxo padrão de desenvolvimento

1. Criar branch de trabalho (`fix/...`, `feat/...`, `chore/...`).
2. Implementar localmente.
3. Rodar validações mínimas:
   - `npm run build`
   - smoke test das telas afetadas
4. Validar com checklist da mudança.
5. Commit com mensagem clara.
6. Push e deploy controlado.
7. Verificação pós-deploy.

## 4) Checklist pré-deploy (obrigatório)

- [ ] Mudança classificada em risco (baixo/médio/alto)
- [ ] Build local aprovado
- [ ] Teste manual do fluxo principal afetado
- [ ] Se médio/alto risco: backup manual concluído
- [ ] Plano de rollback definido
- [ ] SQL (se houver) validado em `BEGIN ... ROLLBACK` antes de `COMMIT`

## 5) Supabase (free) - protocolo de segurança

### 5.1 Backup manual antes de SQL arriscado

Antes de qualquer update/delete sensível:

- exportar tabelas críticas (SQL editor/export):
  - `transactions`
  - `contas`
  - `import_logs`
  - `subscriptions`
  - demais tabelas tocadas na mudança

Opcional recomendado: snapshot em schema de rescue.

### 5.2 Execução segura de SQL

Sempre seguir sequência:

1. `SELECT` de diagnóstico (o que será alterado)
2. `BEGIN`
3. `UPDATE/DELETE`
4. `SELECT` de validação pós-update
5. `ROLLBACK` para ensaio
6. repetir e finalizar com `COMMIT` somente quando validado

### 5.3 Regras de ouro para SQL

- Sempre filtrar por `user_id` quando aplicável.
- Evitar updates em massa por nome de arquivo sem validação.
- Evitar suposições sobre `Origem`; auditar antes.
- Salvar a query executada e o resultado resumido.

## 6) Vercel (free) - deploy e rollback

### 6.1 Antes do deploy

- confirmar projeto/conta correta (`vercel link` quando necessário).
- garantir `.vercelignore` atualizado para evitar uploads gigantes.

### 6.2 Rollback de aplicação

Se deploy quebrar:

1. ir no painel Vercel do projeto;
2. promover/redeploy da versão anterior estável;
3. registrar incidente e causa.

## 7) Padrão de validação pós-deploy

Após subir:

- [ ] abrir em aba anônima (evitar cache local)
- [ ] validar fluxo principal do release
- [ ] validar logs/erros críticos
- [ ] validar 1 caso real financeiro ponta a ponta (quando aplicável)

## 8) Protocolo de incidentes

Se algo inesperado ocorrer:

1. pausar novas mudanças;
2. coletar evidências (prints, query, horário, usuário impactado);
3. aplicar rollback de app (Vercel) se necessário;
4. aplicar rollback de dados com backup/snapshot;
5. só retomar após validação completa.

## 9) Template de registro de mudança

Use este formato em cada entrega:

- **Escopo:** o que mudou
- **Risco:** baixo/médio/alto
- **Validação:** como foi testado
- **Deploy:** quando e em qual versão
- **Rollback:** como desfazer

## 10) Compromisso operacional

Este playbook deve ser consultado antes de:

- qualquer deploy em produção;
- qualquer SQL que altere dados;
- qualquer mudança em fluxos financeiros.

Se houver conflito entre velocidade e segurança, **priorizar segurança**.
