-- ===========================================================================
-- Reconciliação (somente versionamento) da policy familiar de `public.investments`.
-- ===========================================================================
--
-- CONTEXTO. Em staging e produção existe a policy "Family Access Investments" em `public.investments`
-- (FOR ALL, TO public, USING e WITH CHECK `has_family_access(user_id)`), confirmada por auditoria read-only, mas
-- ela NUNCA esteve nas migrations do repositório: uma instalação nova ficaria sem acesso familiar a investimentos.
-- Esta migration torna o contrato reproduzível. NÃO redefine acesso familiar: não toca em `family_members`,
-- `has_family_access`, statuses, bidirecionalidade, nem em policies de outras tabelas.
--
-- COMPORTAMENTO (idempotente e FAIL-CLOSED):
--   A. policy ausente             → cria a policy canônica.
--   B. policy existente EQUIVALENTE → não altera nada (NOTICE).
--   C. policy existente DIFERENTE   → RAISE EXCEPTION. Nunca substitui, amplia nem remove automaticamente.
--   D. `public.has_family_access(uuid)` ausente → RAISE EXCEPTION. Nunca cria função substituta.
--
-- COMPARAÇÃO SEMÂNTICA (catálogo `pg_policy`, não o texto do CREATE POLICY): comando, permissiva × restritiva,
-- papéis, USING e WITH CHECK. As expressões são comparadas pela ÁRVORE interna (`pg_node_tree`) contra a de uma
-- policy-sonda canônica criada e removida na mesma transação, com as posições de texto (`:location N`) descartadas:
-- diferenças só de formatação são ignoradas, e qualquer diferença semântica (outra função, OR extra, outro papel...)
-- falha. Uma policy ALL sem WITH CHECK explícito também é tratada como divergente (fail-closed), embora o PostgreSQL
-- aplique o USING nesse caso: o contrato versionado exige as duas cláusulas.
-- Se a equivalência não puder ser provada, a migration PARA sem modificar a policy existente.
--
-- ROLLBACK: não há remoção. A policy já existe nos ambientes atuais; um rollback que a apagasse eliminaria uma
-- autorização preexistente. Ver supabase/rollbacks/20261008115900_reconcile_investments_family_policy_down.sql.

DO $reconcile$
DECLARE
  c_policy constant text := 'Family Access Investments';
  c_probe constant text := 'finelo_family_policy_probe_tmp';
  v_rel constant regclass := 'public.investments'::regclass;
  v_found pg_policy%ROWTYPE;
  v_probe pg_policy%ROWTYPE;
  v_diffs text[] := ARRAY[]::text[];
  v_tree_found text;
  v_tree_probe text;
BEGIN
  IF to_regprocedure('public.has_family_access(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Reconciliação abortada: a função public.has_family_access(uuid) não existe (migration 055). Nenhuma função substituta será criada.';
  END IF;

  SELECT * INTO v_found FROM pg_policy WHERE polrelid = v_rel AND polname = c_policy;

  IF NOT FOUND THEN
    -- CASO A: cria a policy canônica (FOR ALL, TO public, permissiva).
    EXECUTE format(
      'CREATE POLICY %I ON public.investments FOR ALL TO public USING (public.has_family_access(user_id)) WITH CHECK (public.has_family_access(user_id))',
      c_policy
    );
    RAISE NOTICE 'Policy "%" criada em public.investments.', c_policy;
    RETURN;
  END IF;

  -- Sonda canônica: mesma definição que seria criada no CASO A, sob outro nome, removida em seguida.
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.investments', c_probe);
  EXECUTE format(
    'CREATE POLICY %I ON public.investments FOR ALL TO public USING (public.has_family_access(user_id)) WITH CHECK (public.has_family_access(user_id))',
    c_probe
  );
  SELECT * INTO v_probe FROM pg_policy WHERE polrelid = v_rel AND polname = c_probe;
  EXECUTE format('DROP POLICY %I ON public.investments', c_probe);

  IF v_found.polcmd IS DISTINCT FROM v_probe.polcmd THEN
    v_diffs := v_diffs || format('comando: encontrado %L, esperado %L (ALL = *)', v_found.polcmd, v_probe.polcmd);
  END IF;
  IF v_found.polpermissive IS DISTINCT FROM v_probe.polpermissive THEN
    v_diffs := v_diffs || format('permissiva: encontrado %L, esperado %L', v_found.polpermissive, v_probe.polpermissive);
  END IF;
  IF v_found.polroles IS DISTINCT FROM v_probe.polroles THEN
    v_diffs := v_diffs || format('papéis: encontrado %L, esperado %L (0 = PUBLIC)', v_found.polroles, v_probe.polroles);
  END IF;

  v_tree_found := regexp_replace(COALESCE(v_found.polqual::text, '<ausente>'), ':location -?[0-9]+', '', 'g');
  v_tree_probe := regexp_replace(COALESCE(v_probe.polqual::text, '<ausente>'), ':location -?[0-9]+', '', 'g');
  IF v_tree_found IS DISTINCT FROM v_tree_probe THEN
    v_diffs := v_diffs || format('USING: encontrado %L, esperado %L', pg_get_expr(v_found.polqual, v_rel), pg_get_expr(v_probe.polqual, v_rel));
  END IF;

  v_tree_found := regexp_replace(COALESCE(v_found.polwithcheck::text, '<ausente>'), ':location -?[0-9]+', '', 'g');
  v_tree_probe := regexp_replace(COALESCE(v_probe.polwithcheck::text, '<ausente>'), ':location -?[0-9]+', '', 'g');
  IF v_tree_found IS DISTINCT FROM v_tree_probe THEN
    v_diffs := v_diffs || format('WITH CHECK: encontrado %L, esperado %L', COALESCE(pg_get_expr(v_found.polwithcheck, v_rel), '<ausente>'), pg_get_expr(v_probe.polwithcheck, v_rel));
  END IF;

  IF array_length(v_diffs, 1) IS NOT NULL THEN
    -- CASO C: divergente. Nada é substituído, ampliado ou removido.
    RAISE EXCEPTION 'Reconciliação abortada: a policy "%" de public.investments difere do contrato esperado. %', c_policy, array_to_string(v_diffs, '; ');
  END IF;

  -- CASO B: equivalente.
  RAISE NOTICE 'Policy "%" já existe e é equivalente ao contrato esperado; nada foi alterado.', c_policy;
END
$reconcile$;
