-- Rollback da taxonomia simétrica e das resoluções parciais.
--
-- Restaura a taxonomia de quatro valores e remove as colunas acrescentadas.
--
-- Atenção: se houver resoluções gravadas com `resolution = 'economic_debt'`, o
-- check restaurado as rejeitaria. Reverter exige que essas linhas sejam tratadas
-- antes — o comando abaixo falha de propósito em vez de descartá-las em silêncio.

begin;

do $$
declare
  v_incompativeis integer;
begin
  -- A taxonomia restaurada nao conhece `economic_debt` nem
  -- `reconciliation_write_off`. Reverter com linhas assim descartaria o que o
  -- usuario afirmou, entao o rollback falha de proposito.
  select count(*) into v_incompativeis
    from public.credit_card_reconciliation_resolutions
   where resolution in ('economic_debt', 'reconciliation_write_off');

  if v_incompativeis > 0 then
    raise exception
      'Existem % resolucoes fora da taxonomia antiga. Reclassifique-as antes de reverter — reverter descartaria a informacao.', v_incompativeis;
  end if;
end $$;

alter table public.credit_card_reconciliation_resolutions
  drop constraint if exists cc_reconciliation_resolution_kind_check,
  drop constraint if exists cc_reconciliation_resolution_sign_check,
  drop constraint if exists cc_reconciliation_resolution_provenance_check,
  drop constraint if exists cc_reconciliation_resolution_source_check;

alter table public.credit_card_reconciliation_resolutions
  drop column if exists resolved_amount,
  drop column if exists authoritative_source,
  drop column if exists authoritative_at,
  drop column if exists authoritative_by;

alter table public.credit_card_reconciliation_resolutions
  add constraint credit_card_reconciliation_resolutions_resolution_check
  check (resolution in ('economic_credit', 'bank_adjustment', 'authoritative_total', 'written_off'));

commit;
