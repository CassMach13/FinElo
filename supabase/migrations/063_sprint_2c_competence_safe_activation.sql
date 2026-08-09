-- Sprint 2C stabilization: keep the user-confirmed competence as the statement
-- identity while allowing its civil due date to fall in the following month.
--
-- The v1 RPC remains untouched. This wrapper validates the new invariant,
-- delegates every existing lock/snapshot/exact-set guard to v1 and corrects
-- the civil due dates inside the same PostgreSQL transaction.

create or replace function public.activate_credit_card_projection_atomic_v2(
  p_account_id uuid,
  p_expected_revision text,
  p_shadow_checksum text,
  p_statements jsonb,
  p_entries jsonb,
  p_payments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_compat_statements jsonb;
  v_result jsonb;
  v_snapshot_id uuid;
  v_after_revision text;
begin
  if jsonb_typeof(p_statements) <> 'array' then
    raise exception 'A projeção de faturas deve ser uma lista.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_statements) row
    where coalesce(row->>'statementKey', '') !~ '^\d{4}-(0[1-9]|1[0-2])$'
       or coalesce(row->>'purchaseReferenceMonth', '') !~ '^\d{4}-(0[1-9]|1[0-2])$'
       or coalesce(row->>'dueDate', '') !~ '^\d{4}-(0[1-9]|1[0-2])-\d{2}$'
  ) then
    raise exception 'A projeção contém competência ou vencimento inválido.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_statements) row
    where left(row->>'dueDate', 7) not in (
      row->>'statementKey',
      to_char(((row->>'statementKey') || '-01')::date + interval '1 month', 'YYYY-MM')
    )
       or (row->>'purchaseReferenceMonth') <> (row->>'statementKey')
       or (row->>'dueYear')::integer <> left(row->>'statementKey', 4)::integer
       or (row->>'dueMonth')::integer <> right(row->>'statementKey', 2)::integer
  ) then
    raise exception 'O vencimento deve pertencer ao mês da competência ou ao mês seguinte.' using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_set(
        row,
        '{dueDate}',
        to_jsonb(
          to_char(
            make_date(
              left(row->>'statementKey', 4)::integer,
              right(row->>'statementKey', 2)::integer,
              least(
                right(row->>'dueDate', 2)::integer,
                extract(
                  day from (
                    date_trunc('month', ((row->>'statementKey') || '-01')::date)
                    + interval '1 month - 1 day'
                  )
                )::integer
              )
            ),
            'YYYY-MM-DD'
          )
        ),
        false
      )
      order by row->>'statementKey'
    ),
    '[]'::jsonb
  )
  into v_compat_statements
  from jsonb_array_elements(p_statements) row;

  v_result := public.activate_credit_card_projection_atomic(
    p_account_id,
    p_expected_revision,
    p_shadow_checksum,
    v_compat_statements,
    p_entries,
    p_payments
  );

  with desired as (
    select *
    from jsonb_to_recordset(p_statements) as x(
      "statementKey" text,
      "dueDate" date
    )
  )
  update public.credit_card_statements statement
  set due_date = desired."dueDate"
  from desired
  where statement.user_id = auth.uid()
    and statement.account_id = p_account_id
    and statement.reference_label = desired."statementKey";

  v_after_revision := public.get_credit_card_projection_revision(p_account_id);
  v_snapshot_id := nullif(v_result->>'snapshot_id', '')::uuid;

  update public.credit_card_atomic_rebuild_snapshots
  set after_revision = v_after_revision
  where id = v_snapshot_id
    and user_id = auth.uid()
    and account_id = p_account_id;

  return v_result || jsonb_build_object('after_revision', v_after_revision);
end;
$$;

revoke all on function public.activate_credit_card_projection_atomic_v2(
  uuid, text, text, jsonb, jsonb, jsonb
) from public;
revoke all on function public.activate_credit_card_projection_atomic_v2(
  uuid, text, text, jsonb, jsonb, jsonb
) from anon;
grant execute on function public.activate_credit_card_projection_atomic_v2(
  uuid, text, text, jsonb, jsonb, jsonb
) to authenticated;

comment on function public.activate_credit_card_projection_atomic_v2(
  uuid, text, text, jsonb, jsonb, jsonb
) is
  'Sprint 2C: ativa competências confirmadas com vencimento no mesmo mês ou no mês seguinte, preservando snapshot e atomicidade da v1.';
