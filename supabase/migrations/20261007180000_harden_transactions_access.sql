-- ===========================================================================
-- Hardening de `public.transactions` (somente segurança; nenhum dado, coluna ou fluxo muda).
-- ===========================================================================
--
-- 1) PRIVILÉGIOS. O Supabase concede ALL a anon/authenticated em tabelas novas; `transactions`
--    estava com TRUNCATE, TRIGGER e REFERENCES abertos (e para `anon`). A RLS não protege TRUNCATE.
--    Ficam só os quatro privilégios de CRUD para `authenticated`; `anon` e PUBLIC perdem tudo.
--    Papéis internos (service_role, finelo_structural_entry_executor) NÃO são tocados.
--
-- 2) INSERT SOMENTE DO DONO. A policy "Family Insert Transactions" (WITH CHECK has_family_access)
--    permitia gravar um lançamento em nome de outro usuário acessível pela família. Ela é removida;
--    a policy "Users can insert their own transactions" (auth.uid() = user_id) é recriada como
--    `TO authenticated`. SELECT/UPDATE/DELETE familiares NÃO são alterados.
--
-- Este hardening é intencional e monotônico: o rollback correspondente não o desfaz.

DROP POLICY IF EXISTS "Family Insert Transactions" ON public.transactions;

DROP POLICY IF EXISTS "Users can insert their own transactions" ON public.transactions;
CREATE POLICY "Users can insert their own transactions"
  ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
