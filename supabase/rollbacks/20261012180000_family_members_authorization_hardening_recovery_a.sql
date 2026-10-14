-- Recuperação fail-closed (nível A) da migration 20261012180000_family_members_authorization_hardening.
-- Desliga SOMENTE a exceção do vínculo recíproco: passa a ser possível inserir apenas vínculos 'pending'.
-- Convite, aceite, recusa e revogação seguem funcionando. Não relaxa nenhuma outra verificação.
-- Para sair deste nível, reaplique a migration (idempotente).
DROP POLICY IF EXISTS "Dono adiciona membros" ON public.family_members;
CREATE POLICY "Dono adiciona membros" ON public.family_members
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id AND status = 'pending');

DROP FUNCTION IF EXISTS public.family_link_accepted_from(text);
