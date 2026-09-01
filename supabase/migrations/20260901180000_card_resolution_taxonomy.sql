-- Taxonomia simétrica e resoluções parciais no livro de reconciliação.
--
-- Puramente aditiva sobre `credit_card_reconciliation_resolutions`, que ainda não
-- tem nenhuma linha nem leitor — o PR que a criou entregou só o schema.
--
-- Duas mudanças estruturais:
--
-- 1. `economic_debt` entra na taxonomia. O livro de reconciliação é assinado por
--    desenho, então classificar uma diferença como obrigação econômica real
--    precisa de representação própria; forçá-la em `authoritative_total` ou
--    `reconciliation_write_off` seria mentir sobre o que o usuário afirmou.
--
-- 3. `written_off` é renomeado para `reconciliation_write_off`. O nome antigo
--    dizia apenas «baixa», que em contabilidade também designa baixa ECONÔMICA —
--    exatamente o que esta resolução NÃO faz. A tabela não tem nenhuma linha e
--    nenhum leitor, então o rename é gratuito agora e caro depois.
--
--    Registro honesto do estado atual: com a regra vigente — déficit inexplicado
--    vira dívida econômica na hora —, o saldo de reconciliação NUNCA fica
--    negativo, e portanto `economic_debt` ainda não tem entrada alcançável. Ela
--    existe aqui para a taxonomia ficar simétrica e para o domínio poder rejeitar
--    sinal incompatível de forma explícita, em vez de por omissão.
--
-- 2. `resolved_amount` permite resolução PARCIAL. Um suspense de R$ 100 pode ser
--    classificado como R$ 30 de crédito econômico e R$ 70 de ajuste do banco, em
--    dois eventos. Nada obriga uma competência a ter classificação única.

begin;

alter table public.credit_card_reconciliation_resolutions
  add column if not exists resolved_amount numeric(15, 2) null,
  add column if not exists authoritative_source text null,
  add column if not exists authoritative_at timestamptz null,
  add column if not exists authoritative_by uuid null references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Taxonomia
-- ---------------------------------------------------------------------------

alter table public.credit_card_reconciliation_resolutions
  drop constraint if exists credit_card_reconciliation_resolutions_resolution_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cc_reconciliation_resolution_kind_check'
  ) then
    alter table public.credit_card_reconciliation_resolutions
      add constraint cc_reconciliation_resolution_kind_check
      check (resolution in ('economic_credit', 'economic_debt', 'bank_adjustment',
                            'authoritative_total', 'reconciliation_write_off'));
  end if;
end $$;

comment on column public.credit_card_reconciliation_resolutions.resolution is
  'economic_credit = o excedente é crédito/prepagamento econômico real: sai do livro 2 e vira carry no livro 1, pelo mesmo valor. '
  'economic_debt = a diferença é obrigação econômica real: sai do livro 2 e vira saldo em aberto no livro 1, pelo mesmo valor absoluto. '
  'bank_adjustment = é arredondamento/divergência do emissor ou do arquivo e NÃO representa dinheiro: encerra a diferença sem crédito, sem dívida e sem carry. '
  'authoritative_total = o usuário informou o valor oficial da fatura: a competência é RECALCULADA a partir da fonte superior, e saldo, carry e diferença são derivados de novo — não é mascarar o delta. '
  'reconciliation_write_off = o usuário encerra conscientemente uma divergência de reconciliação SEM classificá-la como crédito, dívida, total oficial ou ajuste bancário: encerra no livro 2 e não move o livro econômico.';

-- ---------------------------------------------------------------------------
-- Sinal e completude por tipo de resolução
-- ---------------------------------------------------------------------------

do $$
begin
  -- `economic_credit` só resolve diferença POSITIVA; `economic_debt` só NEGATIVA.
  -- Sinal incompatível é rejeitado pelo banco, não só pelo domínio.
  if not exists (
    select 1 from pg_constraint where conname = 'cc_reconciliation_resolution_sign_check'
  ) then
    alter table public.credit_card_reconciliation_resolutions
      add constraint cc_reconciliation_resolution_sign_check
      check (
        (resolution = 'economic_credit' and resolved_amount is not null and resolved_amount > 0)
        or (resolution = 'economic_debt' and resolved_amount is not null and resolved_amount < 0)
        or (resolution in ('bank_adjustment', 'reconciliation_write_off')
            and resolved_amount is not null and resolved_amount <> 0)
        or (resolution = 'authoritative_total' and resolved_amount is null)
      );
  end if;

  -- Informar o total oficial exige dizer de onde ele veio, como no statement.
  if not exists (
    select 1 from pg_constraint where conname = 'cc_reconciliation_resolution_provenance_check'
  ) then
    alter table public.credit_card_reconciliation_resolutions
      add constraint cc_reconciliation_resolution_provenance_check
      check (
        resolution <> 'authoritative_total'
        or (authoritative_total is not null and authoritative_source is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'cc_reconciliation_resolution_source_check'
  ) then
    alter table public.credit_card_reconciliation_resolutions
      add constraint cc_reconciliation_resolution_source_check
      check (authoritative_source is null
             or authoritative_source in ('bank_app', 'bank_pdf', 'bank_api', 'user_declared'));
  end if;
end $$;

comment on column public.credit_card_reconciliation_resolutions.resolved_amount is
  'Porção ASSINADA da diferença classificada por este evento, permitindo resolução parcial: um suspense de 100 pode virar 30 de crédito e 70 de ajuste, em dois registros. Nulo para authoritative_total, que recalcula a competência em vez de consumir uma porção. O domínio impede que a soma das resoluções ultrapasse a diferença disponível no sinal correspondente.';
comment on column public.credit_card_reconciliation_resolutions.authoritative_source is
  'Procedência do total oficial informado nesta resolução. NUNCA preenchido a partir de totais manuais legados.';

-- ---------------------------------------------------------------------------
-- Legado: nada é convertido aqui
-- ---------------------------------------------------------------------------
--
-- Produção tem 5 `manual_totals_json->>'micro_divergence_feedback'` preenchidos
-- (credit = 2, offset_prior_credit = 2, bank_adjustment = 1). NENHUM é migrado
-- para esta tabela, nem agora nem por efeito colateral desta migração.
--
-- `credit` e `bank_adjustment` nunca participaram de cálculo algum; convertê-los
-- em resolução ativa mudaria retroativamente competências já fechadas.
-- `offset_prior_credit` é ainda mais sensível: ele JÁ produz efeito através de
-- `prior_credit_abatement`, e materializá-lo aqui duplicaria esse efeito.
--
-- O blob legado permanece intocado como evidência histórica. A migração
-- semântica, se acontecer, é etapa própria e explícita.

commit;
