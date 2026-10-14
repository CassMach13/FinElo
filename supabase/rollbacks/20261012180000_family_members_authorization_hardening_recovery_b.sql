-- Recuperação fail-closed (nível B) da migration 20261012180000_family_members_authorization_hardening.
-- Congela a criação e a alteração de vínculos familiares: `authenticated` mantém SELECT e DELETE (continua podendo
-- revogar). Vínculos 'accepted' existentes seguem valendo. Não relaxa nenhuma verificação.
-- Para sair deste nível, reaplique a migration (idempotente).
REVOKE INSERT, UPDATE ON public.family_members FROM authenticated;
