-- ===========================================================================
-- Endurecimento da autorização de public.family_members
-- ===========================================================================
--
-- `public.has_family_access(uuid)` (055) é a base da autorização familiar de dezenas de policies. Ela confia
-- nas linhas de `family_members` com status 'accepted'. Esta migration impede que essas linhas sejam forjadas
-- ou mantidas depois de revogadas, SEM alterar `has_family_access` (contrato bidirecional preservado).
--
-- O que muda
--   1. INSERT: o vínculo nasce 'pending'. Única exceção: o vínculo RECÍPROCO legítimo (o usuário aceitou um
--      convite e cria a volta como 'accepted'), validado contra o e-mail CANÔNICO do dono do convite em
--      auth.users (nunca contra `owner_email`, que é texto do cliente).
--   2. `owner_email` passa a ser preenchido pelo banco com o e-mail canônico de `owner_id` (sessões com JWT).
--   3. UPDATE: o membro continua respondendo ao convite, mas id, owner_id, owner_email, member_email e created_at
--      ficam imutáveis e o status só pode ir para 'accepted' ou 'declined' (nunca voltar a 'pending' ou NULL).
--   4. Revogação efetiva: ao APAGAR um vínculo 'accepted' ou tirá-lo de 'accepted', o vínculo recíproco
--      'accepted' correspondente também é removido (sem isso o recíproco mantinha o acesso depois da revogação).
--   5. Privilégios: authenticated só SELECT/INSERT/UPDATE/DELETE; anon e PUBLIC nada; service_role inalterado.
--
-- O que NÃO muda: has_family_access, policies das demais tabelas, dados existentes.
-- Sessões sem JWT (auth.uid() IS NULL: service_role/postgres) seguem fora das guardas 2 e 3, como já estão fora da RLS.
--
-- Recuperação segura (fail-closed): supabase/rollbacks/20261012180000_family_members_authorization_hardening_recovery_*.sql
-- NÃO existe "rollback" que reabra a falha. Para voltar atrás de verdade é necessária decisão explícita à parte.

-- VARIANTE PARA apply_migration: sem BEGIN/COMMIT próprios. O executor já envolve o arquivo numa única transação
-- (comprovado pela migration-sonda 20261009170756: mesmo xid em todos os checkpoints e SET LOCAL efetivo).
-- Um COMMIT interno encerraria a transação do executor antes do registro no histórico.
-- A tabela é lida por has_family_access em quase toda requisição: um lock exclusivo ENFILEIRADO bloquearia o app.
-- Falha rápida (a migration é atômica: nada fica aplicado) em vez de esperar.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Guarda fail-closed: se NÃO houver bloco de transação, SET LOCAL não tem efeito e a migration aborta aqui.
DO $guard$
BEGIN
  IF current_setting('lock_timeout') <> '3s' OR current_setting('statement_timeout') <> '30s' THEN
    RAISE EXCEPTION 'FAMILY_HARDENING_NO_TRANSACTION_CONTEXT' USING ERRCODE = 'P0001';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1) Vínculo recíproco legítimo (SECURITY DEFINER mínimo: só lê auth.users e family_members)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.family_link_accepted_from(p_owner_email text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_link uuid;
BEGIN
  IF COALESCE(btrim(auth.jwt() ->> 'email'), '') = '' THEN
    RETURN false;
  END IF;
  -- FOR SHARE: enquanto o recíproco é inserido, o vínculo original não pode ser apagado/alterado por outra
  -- transação sem esperar. Sem isso, um recíproco inserido durante a revogação sobreviveria a ela.
  SELECT f.id INTO v_link
    FROM public.family_members f
    JOIN auth.users u ON u.id = f.owner_id
   WHERE f.status = 'accepted'
     AND lower(btrim(f.member_email)) = lower(btrim(auth.jwt() ->> 'email'))
     AND lower(btrim(u.email)) = lower(btrim(COALESCE(p_owner_email, '')))
   LIMIT 1
     FOR SHARE OF f;
  RETURN v_link IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.family_link_accepted_from(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.family_link_accepted_from(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Guarda de INSERT/UPDATE (SECURITY DEFINER apenas para ler o e-mail canônico em auth.users)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.family_members_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_real_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- sessão privilegiada sem JWT (já fora da RLS)
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT lower(btrim(u.email)) INTO v_real_email FROM auth.users u WHERE u.id = NEW.owner_id;
    IF v_real_email IS NULL OR v_real_email = '' THEN
      RAISE EXCEPTION 'Dono do vínculo sem identidade canônica.' USING ERRCODE = '42501';
    END IF;
    NEW.owner_email := v_real_email;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR lower(btrim(COALESCE(NEW.owner_email, ''))) IS DISTINCT FROM lower(btrim(COALESCE(OLD.owner_email, '')))
     OR lower(btrim(COALESCE(NEW.member_email, ''))) IS DISTINCT FROM lower(btrim(COALESCE(OLD.member_email, ''))) THEN
    RAISE EXCEPTION 'A identidade do vínculo familiar (id, owner_id, e-mails) é imutável.' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND (NEW.status IS NULL OR NEW.status NOT IN ('accepted', 'declined')) THEN
    RAISE EXCEPTION 'Transição de status do vínculo familiar não permitida.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.family_members_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_family_members_guard ON public.family_members;
CREATE TRIGGER trg_family_members_guard
  BEFORE INSERT OR UPDATE ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.family_members_guard();

-- ---------------------------------------------------------------------------
-- 3) Revogação efetiva: o vínculo recíproco 'accepted' acompanha o encerramento do vínculo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.family_members_revoke_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_email text;
BEGIN
  IF OLD.status IS DISTINCT FROM 'accepted' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM 'accepted' THEN
    RETURN NULL;
  END IF;

  -- E-mail canônico do dono; se a conta já foi removida (cascata), usa o e-mail gravado (só para REMOVER acesso).
  SELECT lower(btrim(u.email)) INTO v_owner_email FROM auth.users u WHERE u.id = OLD.owner_id;
  v_owner_email := COALESCE(NULLIF(v_owner_email, ''), NULLIF(lower(btrim(COALESCE(OLD.owner_email, ''))), ''));

  IF v_owner_email IS NOT NULL THEN
    -- Remove SOMENTE o vínculo recíproco exato: dono = conta do membro, membro = e-mail do dono original, 'accepted'.
    DELETE FROM public.family_members r
     WHERE r.status = 'accepted'
       AND lower(btrim(r.member_email)) = v_owner_email
       AND r.owner_id IN (
         SELECT m.id FROM auth.users m WHERE lower(btrim(m.email)) = lower(btrim(OLD.member_email))
       );
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.family_members_revoke_mirror() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_family_members_revoke_mirror ON public.family_members;
CREATE TRIGGER trg_family_members_revoke_mirror
  AFTER DELETE OR UPDATE OF status ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.family_members_revoke_mirror();

-- ---------------------------------------------------------------------------
-- 4) Policies de INSERT e UPDATE (as demais permanecem como estão)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Dono adiciona membros" ON public.family_members;
CREATE POLICY "Dono adiciona membros" ON public.family_members
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = owner_id
    AND (
      status = 'pending'
      OR (status = 'accepted' AND public.family_link_accepted_from(member_email))
    )
  );

DROP POLICY IF EXISTS "Membro responde ao convite" ON public.family_members;
CREATE POLICY "Membro responde ao convite" ON public.family_members
  FOR UPDATE TO authenticated
  USING (lower(btrim(member_email)) = lower(btrim(COALESCE(auth.jwt() ->> 'email', ''))))
  WITH CHECK (lower(btrim(member_email)) = lower(btrim(COALESCE(auth.jwt() ->> 'email', ''))));

-- ---------------------------------------------------------------------------
-- 5) Privilégios mínimos
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.family_members FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_members TO authenticated;
