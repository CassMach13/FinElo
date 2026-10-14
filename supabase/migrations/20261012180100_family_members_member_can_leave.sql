-- ===========================================================================
-- Membro pode sair do plano familiar (DELETE do próprio vínculo recebido)
-- ===========================================================================
--
-- O botão "Sair do plano" do aplicativo apaga a linha de `public.family_members` em que a pessoa é MEMBRO.
-- A única policy de DELETE existente cobre o DONO (auth.uid() = owner_id): para o membro a chamada afeta 0 linhas,
-- sem erro, e o vínculo permanece ativo.
--
-- Esta migration adiciona uma policy de DELETE para o membro, restrita às linhas em que o e-mail do JWT é o
-- `member_email` da linha. Ela só REDUZ acesso: o trigger `trg_family_members_revoke_mirror` (migration
-- 20261012180000) remove também o vínculo recíproco 'accepted', então o compartilhamento termina nos dois sentidos.
--
-- O que NÃO muda: has_family_access, triggers, demais policies, privilégios (authenticated já tem DELETE na tabela),
-- dados existentes. Depende da migration de endurecimento (20261012180000): sem o trigger de revogação do
-- recíproco, apagar o vínculo deixaria o acesso nos dois sentidos intacto, então a guarda abaixo aborta.
--
-- Recuperação: supabase/rollbacks/20261012180100_family_members_member_can_leave_down.sql (DROP da policy;
-- volta ao DELETE somente pelo dono).

-- VARIANTE PARA apply_migration: sem BEGIN/COMMIT próprios (o executor envolve o arquivo numa única transação).
-- CREATE/DROP POLICY exige lock exclusivo na tabela, lida por has_family_access em quase toda requisição:
-- falha rápida (nada fica aplicado) em vez de enfileirar o lock.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Guarda fail-closed: sem bloco de transação o SET LOCAL não tem efeito; sem o trigger de revogação recíproca a
-- policy não pode ser criada.
DO $guard$
BEGIN
  IF current_setting('lock_timeout') <> '3s' OR current_setting('statement_timeout') <> '30s' THEN
    RAISE EXCEPTION 'FAMILY_LEAVE_NO_TRANSACTION_CONTEXT' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
     WHERE t.tgrelid = 'public.family_members'::regclass
       AND t.tgname = 'trg_family_members_revoke_mirror'
       AND t.tgenabled = 'O'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'FAMILY_LEAVE_REQUIRES_REVOKE_MIRROR_TRIGGER' USING ERRCODE = 'P0001';
  END IF;
END
$guard$;

DROP POLICY IF EXISTS "Membro sai do vínculo" ON public.family_members;
CREATE POLICY "Membro sai do vínculo" ON public.family_members
  FOR DELETE TO authenticated
  USING (lower(btrim(member_email)) = lower(btrim(COALESCE(auth.jwt() ->> 'email', ''))));
