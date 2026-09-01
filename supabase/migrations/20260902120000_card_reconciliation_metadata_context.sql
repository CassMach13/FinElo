-- `metadata_context`: token determinístico das palavras-chave de classificação.
--
-- ===========================================================================
-- POR QUE ESTE TOKEN EXISTE
-- ===========================================================================
--
-- `user_metadata.cardPaymentKeywords` e `cardCreditKeywords` são ENTRADA
-- financeira: decidem se uma linha importada é pagamento, estorno ou compra, e
-- portanto mudam o total da competência. Um snapshot calculado com um conjunto
-- de palavras e validado com outro estaria mentindo.
--
-- As duas moram em `auth.users`, schema gerenciado pelo Supabase. Instalar
-- gatilho ali foi DESCARTADO: um upgrade da plataforma pode derrubá-lo em
-- silêncio, e o snapshot ficaria stale sem aviso. Em vez de contador, um TOKEN
-- calculado sobre o estado ATUAL da tabela, no momento da verificação.
--
-- O token nunca vem do JWT. Um JWT é emitido uma vez e carregado por horas: as
-- palavras podem ter mudado depois. Ler o JWT provaria apenas o que o usuário
-- tinha quando entrou.
--
-- O token não devolve as palavras — só um sha256 delas. Quem compara não
-- precisa saber o conteúdo, só se mudou.
--
-- ===========================================================================
-- POR QUE A FUNÇÃO PERTENCE A `postgres`, E NÃO A UM PAPEL DEDICADO
-- ===========================================================================
--
-- Todo o resto deste sistema segue o padrão das migrations `sprint_2*`: papel
-- dedicado, `nologin noinherit nobypassrls connection limit 0`, dono de uma
-- função e de mais nada. Aqui esse padrão foi TENTADO e é impossível. O que foi
-- medido em staging, nesta ordem:
--
--   1. `auth.users` tem RLS ATIVA e ZERO políticas. Um leitor sem `bypassrls`
--      enxerga zero linhas — e uma função que apenas normalizasse o que leu
--      devolveria o mesmo token para todo mundo, para sempre. Um valor que
--      nunca muda parece «nada mudou», e todo snapshot passaria na validação.
--   2. Criar `finelo_metadata_reader` com `bypassrls` e dar-lhe
--      `select (id, raw_user_meta_data) on auth.users` funciona — o grant de
--      coluna é aceito e aparece em `information_schema.column_privileges`.
--   3. Mas o papel também precisa de `usage` no schema `auth`, e `postgres` NÃO
--      pode concedê-lo: tem USAGE sem grant option. O comando não falha; o
--      PostgreSQL emite um WARNING, a migration reporta SUCESSO e o privilégio
--      não existe. Outra operação que diz ter feito e não fez.
--   4. As rotas restantes — herdar de `authenticated`, `anon` ou `service_role`,
--      que têm USAGE em `auth` — combinariam `bypassrls` com os grants amplos
--      desses papéis. Um leitor que ignora RLS e herda o alcance de
--      `authenticated` lê a base inteira. É pior que o problema.
--
-- Então: `postgres`, que já tem SELECT em `auth.users` e `bypassrls`. O custo é
-- real e fica declarado — SECURITY DEFINER de `postgres` tem alcance total. As
-- contenções são a FORMA da função, não a confiança nela:
--
--   * corpo fixo, sem SQL dinâmico, sem `execute`, sem interpolação;
--   * uma coluna, de uma linha, escolhida por igualdade de uuid;
--   * devolve um hash — nunca as palavras, nunca outra coluna;
--   * `search_path = ''`, tudo qualificado;
--   * EXECUTE revogado de `public`, `anon`, `authenticated` e `service_role`,
--     concedido só a `finelo_reconciliation_executor`.
--
-- A superfície é: entra um uuid, sai um sha256.
--
-- ===========================================================================
-- A SAÍDA ESTRUTURAL
-- ===========================================================================
--
-- Nada disto seria necessário se a configuração morasse numa tabela nossa.
-- Movê-la elimina de uma vez o `bypassrls`, o SECURITY DEFINER de `postgres` e
-- o próprio token: as palavras passariam a ser cobertas por contador de
-- revisão, como toda outra entrada financeira. Fica registrado como dívida
-- deliberada — é mudança de produto, fora do escopo do 4B1.

begin;

-- ---------------------------------------------------------------------------
-- Normalização — pura, sem ler tabela nenhuma
-- ---------------------------------------------------------------------------
--
-- Separada de propósito: assim a regra pode ser testada contra qualquer entrada
-- sem privilégio algum, e o teste não precisa de um usuário real.
--
-- Espelha `parseClassifierKeywords` em `src/hooks/useAppStore.ts`:
--
--   não-array              -> lista vazia
--   elemento não-string    -> descartado
--   string                 -> `trim`
--   string vazia após trim -> descartada
--   duplicatas             -> preservadas (o cliente também não deduplica)
--
-- A ORDEM é preservada. O classificador provavelmente não depende dela, mas
-- preservar ordem só pode causar invalidação a mais; normalizar a ordem poderia
-- esconder uma mudança real. Na dúvida, o erro cai para o lado seguro.
--
-- O prefixo `v1` versiona a própria normalização: se a regra do cliente mudar,
-- o prefixo muda junto e todo snapshot anterior é considerado stale.
--
-- A lista é montada elemento a elemento com `string_agg`, e não com
-- `to_jsonb(array)::text`. Este último rende `["a", "b"]` — COM espaço depois
-- da vírgula — e esse espaço é detalhe de implementação do PostgreSQL, não
-- parte de contrato nenhum. Se um upgrade mudasse a renderização, todo token
-- mudaria de uma vez. O token tem de depender só das palavras.
--
-- `to_jsonb(k)::text` por elemento ainda faz o escape de aspas e barras, então
-- uma palavra que contenha `","` não consegue fingir ser duas.

create or replace function finelo_reconciliation_internal.metadata_keywords(
  p_value jsonb
)
returns table (keyword text, ord integer)
language sql
immutable
set search_path = ''
as $kw$
  select k, ord
    from (
      select pg_catalog.btrim(e.value #>> '{}') as k, e.ord::integer as ord
        from pg_catalog.jsonb_array_elements(
               case when pg_catalog.jsonb_typeof(p_value) = 'array'
                    then p_value else '[]'::jsonb end
             ) with ordinality as e(value, ord)
       where pg_catalog.jsonb_typeof(e.value) = 'string'
    ) filtrados
   where k <> '';
$kw$;

create or replace function finelo_reconciliation_internal.metadata_canonical(
  p_meta jsonb
)
returns text
language sql
immutable
set search_path = ''
as $canon$
  select 'v1|p:[' || coalesce(
           (select pg_catalog.string_agg(pg_catalog.to_jsonb(k)::text, ',' order by ord)
              from finelo_reconciliation_internal.metadata_keywords(
                     p_meta -> 'cardPaymentKeywords') as t(k, ord)),
           '')
      || ']|c:[' || coalesce(
           (select pg_catalog.string_agg(pg_catalog.to_jsonb(k)::text, ',' order by ord)
              from finelo_reconciliation_internal.metadata_keywords(
                     p_meta -> 'cardCreditKeywords') as t(k, ord)),
           '')
      || ']';
$canon$;

-- ---------------------------------------------------------------------------
-- O token
-- ---------------------------------------------------------------------------

create or replace function finelo_reconciliation_internal.metadata_context(
  p_user_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $meta_ctx$
declare
  v_meta jsonb;
begin
  if p_user_id is null then
    raise exception 'metadata_context: user_id nulo. A identidade tem de vir do servidor, nunca do cliente.'
      using errcode = '22004';
  end if;

  select u.raw_user_meta_data into v_meta
    from auth.users u
   where u.id = p_user_id;

  -- `not found` cobre os dois casos indistinguiveis daqui: o usuario nao
  -- existe, ou a linha ficou ilegivel porque o dono desta funcao perdeu acesso
  -- a `auth.users` — o que uma mudanca de plataforma pode fazer sem aviso.
  -- Devolver um token nesse estado seria afirmar «nada mudou» sobre uma entrada
  -- que nem chegou a ser lida. Falhar alto custa uma requisicao; falhar baixo
  -- custa dinheiro do usuario.
  if not found then
    raise exception 'metadata_context: usuario % invisivel. Sem leitura nao ha token.', p_user_id
      using errcode = '42501';
  end if;

  return pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        finelo_reconciliation_internal.metadata_canonical(
          coalesce(v_meta, '{}'::jsonb)), 'UTF8')),
    'hex');
end;
$meta_ctx$;

comment on function finelo_reconciliation_internal.metadata_context(uuid) is
  'Token sha256 das palavras-chave de classificacao no estado ATUAL de auth.users. Nunca do JWT. Levanta excecao se a linha nao for legivel.';

-- ---------------------------------------------------------------------------
-- Limpeza da tentativa anterior
-- ---------------------------------------------------------------------------
--
-- `finelo_metadata_reader` foi criado com `bypassrls` para ser o dono desta
-- função e não consegue ler `auth.users` (item 3 acima). Um papel que ignora
-- RLS e não serve para nada é passivo puro: sai.

-- Um papel só cai depois que TODO privilégio concedido a ele some — inclusive
-- EXECUTE em funções de terceiros, que `drop role` reporta como dependência.
do $finelo_meta_cleanup$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'finelo_metadata_reader') then
    execute 'set local role finelo_reconciliation_executor';
    execute 'revoke all on function finelo_reconciliation_internal.metadata_canonical(jsonb) from finelo_metadata_reader';
    execute 'revoke all on function finelo_reconciliation_internal.metadata_keywords(jsonb) from finelo_metadata_reader';
    execute 'reset role';
    execute 'revoke select (id, raw_user_meta_data) on auth.users from finelo_metadata_reader';
    execute 'revoke usage on schema finelo_reconciliation_internal from finelo_metadata_reader';
    execute 'drop role finelo_metadata_reader';
  end if;
end;
$finelo_meta_cleanup$;

-- ---------------------------------------------------------------------------
-- Privilégios
-- ---------------------------------------------------------------------------
--
-- A posse muda ANTES dos grants, e cada grant é emitido pelo dono: um `grant
-- execute` vindo de quem não é dono é recusado.

grant finelo_reconciliation_executor to postgres with set true, inherit false;
grant create on schema finelo_reconciliation_internal to finelo_reconciliation_executor;

-- As duas funções puras não leem nada e ficam com o executor comum.
alter function finelo_reconciliation_internal.metadata_canonical(jsonb)
  owner to finelo_reconciliation_executor;
alter function finelo_reconciliation_internal.metadata_keywords(jsonb)
  owner to finelo_reconciliation_executor;

set role finelo_reconciliation_executor;
revoke all on function finelo_reconciliation_internal.metadata_canonical(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function finelo_reconciliation_internal.metadata_keywords(jsonb)
  from public, anon, authenticated, service_role;
-- `metadata_context` roda como `postgres`; as duas funções puras que ele chama
-- são SECURITY INVOKER, então quem precisa de EXECUTE nelas é `postgres`.
grant execute on function finelo_reconciliation_internal.metadata_canonical(jsonb)
  to postgres;
grant execute on function finelo_reconciliation_internal.metadata_keywords(jsonb)
  to postgres;
reset role;

-- `metadata_context` permanece com `postgres` — é o único dono capaz de ler.
revoke all on function finelo_reconciliation_internal.metadata_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function finelo_reconciliation_internal.metadata_context(uuid)
  to finelo_reconciliation_executor;

revoke create on schema finelo_reconciliation_internal from finelo_reconciliation_executor;
revoke finelo_reconciliation_executor from postgres;

commit;
