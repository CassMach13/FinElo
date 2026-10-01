-- ===========================================================================
-- Eventos de produto — a tabela. Nada além dela.
-- ===========================================================================
--
-- POR QUE EXISTE
--
-- O onboarding V1 já está no ar, mas não dá para medir se ele funciona: criação
-- de conta, primeira transação e primeira importação não têm timestamps
-- reconstruíveis de forma consistente (`transactions` e `contas` não guardam
-- quando a linha nasceu; `import_logs` só tem a data do arquivo), e o
-- `user_activity` guarda apenas o último acesso. Sem isso não há tempo até o
-- primeiro valor, abandono por etapa nem retorno D1/D7.
--
-- O QUE GUARDA
--
-- Um log append-only de EVENTOS DE PRODUTO: quem (user_id), o quê (event_name),
-- quando (occurred_at, do banco) e um objeto pequeno de propriedades que o
-- TypeScript restringe a poucas chaves de lista fechada. Nenhum valor
-- financeiro, descrição, banco, nome de arquivo, e-mail, conta, IP ou
-- user-agent. O `user_id` vai só na coluna, nunca dentro de `properties`.
--
-- O QUE NÃO GUARDA
--
-- `signup_completed` e `email_confirmed` não são eventos: já existem, com
-- timestamp confiável, em `auth.users` (`created_at`, `email_confirmed_at`).
-- "Ativado" também não é coluna nem evento: é derivado em consulta.
--
-- CONTRATO DE ESCRITA
--
-- * `occurred_at` vem do relógio do banco. O cliente NÃO consegue enviá-lo: o
--   privilégio de INSERT é por coluna e só cobre as quatro colunas abaixo.
-- * O cliente só insere linhas do próprio usuário (RLS) e não lê, não atualiza
--   e não apaga: não há privilégio nem policy para isso. A leitura agregada é
--   administrativa, fora da UI.
-- * Milestones são idempotentes por `(user_id, dedupe_key)`. Eventos repetíveis
--   usam `dedupe_key` nulo.
-- * Sem backfill: a coleta começa no deploy desta migration.
-- * O CONTRATO V1 É IMPOSTO PELO BANCO, não só pelo app: só os 12 eventos oficiais são aceitos, e
--   cada um só com as properties previstas. Quem chamar o PostgREST direto, contornando o
--   frontend, não consegue gravar evento novo nem propriedade fora do contrato (e-mail, arquivo,
--   valor…). Sem enum nem tabela de tipos: é uma constraint CHECK, fácil de ampliar numa V2.

CREATE TABLE IF NOT EXISTS public.product_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT product_events_event_name_format
    CHECK (event_name ~ '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT product_events_dedupe_key_length
    CHECK (dedupe_key IS NULL OR char_length(dedupe_key) BETWEEN 1 AND 120),
  CONSTRAINT product_events_properties_object
    CHECK (jsonb_typeof(properties) = 'object'),
  -- Defesa em profundidade: objeto e pequeno. O que é aceito de fato é o contrato V1 abaixo.
  CONSTRAINT product_events_properties_small
    CHECK (octet_length(properties::text) <= 1024)
);

-- Contrato V1 (autoridade do que é aceito). Dropar antes de criar mantém a migration reaplicável
-- também onde a tabela já existia sem esta constraint (ex.: staging).
--   * 8 eventos sem properties           -> exatamente {}
--   * 3 eventos de onboarding            -> exatamente {"version": 1}
--   * import_failed                      -> exatamente {"stage": <lista fechada>}
ALTER TABLE public.product_events DROP CONSTRAINT IF EXISTS product_events_contract_v1;
ALTER TABLE public.product_events ADD CONSTRAINT product_events_contract_v1 CHECK (
  (event_name IN (
     'app_session_started', 'account_created', 'import_started', 'import_completed',
     'manual_transaction_created', 'open_finance_started', 'open_finance_completed',
     'first_dashboard_with_real_data'
   ) AND properties = '{}'::jsonb)
  OR (event_name IN ('onboarding_viewed', 'onboarding_dismissed', 'onboarding_resumed')
      AND properties = '{"version": 1}'::jsonb)
  OR (event_name = 'import_failed'
      AND properties ? 'stage'
      AND (properties - 'stage') = '{}'::jsonb
      AND jsonb_typeof(properties -> 'stage') = 'string'
      AND (properties ->> 'stage') IN ('file', 'parse', 'mapping', 'persist', 'quota', 'unknown'))
);

COMMENT ON TABLE public.product_events IS
  'Log append-only de eventos de produto (funil de ativação). Sem valores financeiros, descrições, banco, arquivo ou e-mail. occurred_at vem do banco.';

-- Quem: linha do tempo de um usuário (tempo até o primeiro valor, D1, D7).
CREATE INDEX IF NOT EXISTS product_events_user_occurred_idx
  ON public.product_events (user_id, occurred_at);

-- O quê: contagem de um evento ao longo do tempo (abandono por etapa).
CREATE INDEX IF NOT EXISTS product_events_name_occurred_idx
  ON public.product_events (event_name, occurred_at);

-- Milestones idempotentes: no máximo uma linha por (usuário, chave).
CREATE UNIQUE INDEX IF NOT EXISTS product_events_user_dedupe_key
  ON public.product_events (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

-- Só INSERT, e só do próprio usuário. Sem policy de SELECT, UPDATE ou DELETE: a
-- linha sai junto com o usuário, pelo ON DELETE CASCADE.
DROP POLICY IF EXISTS "usuario registra o proprio evento" ON public.product_events;
CREATE POLICY "usuario registra o proprio evento"
  ON public.product_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Privilégios por coluna: o cliente escolhe o quê, não o quando nem o id.
REVOKE ALL ON public.product_events FROM PUBLIC, anon, authenticated;
GRANT INSERT (user_id, event_name, dedupe_key, properties)
  ON public.product_events TO authenticated;
