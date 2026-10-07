-- Rollback de 20261007120000_budget_months.sql
--
-- Remove a tabela `budget_months` (e, com ela, índice, trigger e policies) e as linhas mensais.
-- É destrutivo para os orçamentos mensais gravados: exporte antes, se forem necessários.
--
-- O HARDENING DE `public.budgets` É INTENCIONAL E MONOTÔNICO: este rollback NÃO o desfaz.
-- Reabrir TRUNCATE/TRIGGER/REFERENCES ou acesso anônimo exigiria uma migration própria e explícita,
-- nunca o rollback da feature.
-- Não remove `public.handle_updated_at()` nem `public.has_family_access()` (compartilhadas).

DROP TABLE IF EXISTS public.budget_months;
