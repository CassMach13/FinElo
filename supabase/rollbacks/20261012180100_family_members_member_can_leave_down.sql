-- Recuperação da migration 20261012180100_family_members_member_can_leave.
-- Remove SOMENTE a policy "Membro sai do vínculo": o DELETE volta a ser permitido apenas ao dono do vínculo.
-- Fail-closed: reduz permissão, não relaxa nenhuma verificação e não altera dados, triggers nem has_family_access.
DROP POLICY IF EXISTS "Membro sai do vínculo" ON public.family_members;
