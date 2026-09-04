-- ===========================================================================
-- Última atividade do usuário — a tabela e o registro. Nada além disso.
-- ===========================================================================
--
-- Esta migration NÃO toca em `get_admin_metrics`. A leitura da atividade pelo
-- CRM vem na migration seguinte, construída sobre a definição segura que o
-- hotfix (20260904160000) deixou em produção. Separar as duas é o que garante
-- que nenhum banco — novo, staging ou produção — chegue a executar uma versão
-- desprotegida daquela função, nem por um passo intermediário.
--
-- POR QUE ELA EXISTE
--
-- O CRM mostrava "último acesso" lendo `auth.users.last_sign_in_at`, coluna
-- que só se move num login de verdade. Quem fica logado renova o token e usa o
-- produto sem nunca gerar novo login, e o número congela. Medido em produção:
-- 21 dos 28 usuários que já entraram tinham sessão mais recente que o último
-- login, com atraso médio de 8,8 dias e pior caso de 86.
--
-- `auth.sessions` também acompanharia atividade, mas é transitória: some no
-- logout, e o valor exibido REGREDIRIA. Um indicador que anda para trás é pior
-- que um congelado, porque ninguém desconfia dele. Daí uma tabela própria.
--
-- O QUE ELA GUARDA
--
-- Um timestamp por usuário. Nem página, nem ação, nem IP, nem dispositivo, nem
-- histórico. Metadado operacional, não rastreamento.
--
-- CONVERGÊNCIA
--
-- O staging já recebeu esses objetos numa tentativa anterior, sob outro
-- identificador no ledger. Esta migration precisa então convergir sem mentir:
-- em vez de `IF NOT EXISTS` mudo — que aceitaria calado uma estrutura
-- divergente e deixaria dois ambientes diferentes se achando iguais — ela
-- CONFERE o shape do que encontrou e aborta se não for o esperado.

DO $$
DECLARE
  colunas_inesperadas text;
  tipo_user_id text;
  tipo_atividade text;
BEGIN
  IF to_regclass('public.user_activity') IS NULL THEN
    RETURN; -- não existe: será criada abaixo
  END IF;

  -- Existe. Só seguimos se for exatamente a tabela que esta migration produz.
  SELECT string_agg(column_name, ', ' ORDER BY column_name)
    INTO colunas_inesperadas
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'user_activity'
    AND column_name NOT IN ('user_id', 'last_activity_at');

  IF colunas_inesperadas IS NOT NULL THEN
    RAISE EXCEPTION
      'public.user_activity existe com colunas inesperadas (%). Esta tabela deve guardar apenas user_id e last_activity_at — reconcilie manualmente antes de aplicar.',
      colunas_inesperadas;
  END IF;

  SELECT data_type INTO tipo_user_id FROM information_schema.columns
   WHERE table_schema='public' AND table_name='user_activity' AND column_name='user_id';
  SELECT data_type INTO tipo_atividade FROM information_schema.columns
   WHERE table_schema='public' AND table_name='user_activity' AND column_name='last_activity_at';

  IF tipo_user_id IS DISTINCT FROM 'uuid'
     OR tipo_atividade IS DISTINCT FROM 'timestamp with time zone' THEN
    RAISE EXCEPTION
      'public.user_activity existe com tipos divergentes (user_id=%, last_activity_at=%). Esperado uuid e timestamptz.',
      tipo_user_id, tipo_atividade;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='user_activity'
      AND con.contype='p' AND pg_get_constraintdef(con.oid) = 'PRIMARY KEY (user_id)'
  ) THEN
    RAISE EXCEPTION 'public.user_activity existe sem a chave primária esperada em (user_id).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='user_activity'
      AND con.contype='f'
      AND pg_get_constraintdef(con.oid) ILIKE 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE%'
  ) THEN
    RAISE EXCEPTION 'public.user_activity existe sem a FK esperada para auth.users(id) ON DELETE CASCADE.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_activity (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_activity_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_activity IS
  'Última atividade observada por usuário. Só um timestamp: sem página, ação, IP, dispositivo ou histórico.';

ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

-- Cada um enxerga e escreve apenas a própria linha. Sem policy de DELETE: a
-- linha sai junto com o usuário, pelo ON DELETE CASCADE.
DROP POLICY IF EXISTS "usuario le a propria atividade" ON public.user_activity;
CREATE POLICY "usuario le a propria atividade"
  ON public.user_activity FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "usuario cria a propria atividade" ON public.user_activity;
CREATE POLICY "usuario cria a propria atividade"
  ON public.user_activity FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "usuario atualiza a propria atividade" ON public.user_activity;
CREATE POLICY "usuario atualiza a propria atividade"
  ON public.user_activity FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Registrar atividade
-- ---------------------------------------------------------------------------
--
-- O usuário nunca é parâmetro: sai de `auth.uid()`. Não há forma de registrar
-- atividade em nome de outra pessoa.
--
-- O limite de uma escrita a cada 30 minutos mora no `WHERE` do `DO UPDATE`, e
-- não no cliente: é atômico e vale para todas as abas e dispositivos ao mesmo
-- tempo. O cliente também segura o ping, mas só para poupar rede.
--
-- `search_path = ''` obriga qualificação total, e por isso todos os nomes
-- abaixo são qualificados.

CREATE OR REPLACE FUNCTION public.touch_user_activity()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  registrado timestamptz;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  INSERT INTO public.user_activity AS ua (user_id, last_activity_at)
  VALUES (uid, now())
  ON CONFLICT (user_id) DO UPDATE
    SET last_activity_at = now()
    WHERE ua.last_activity_at < now() - interval '30 minutes';

  SELECT ua.last_activity_at INTO registrado
  FROM public.user_activity ua WHERE ua.user_id = uid;

  RETURN registrado;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_user_activity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.touch_user_activity() FROM anon;
GRANT EXECUTE ON FUNCTION public.touch_user_activity() TO authenticated;
