# Auditoria somente leitura — credencial de backup em staging

Data: 2026-08-22

Projeto confirmado: `finelo-staging` (`sxmmrnwbxntccscojmfh`)

Alterações executadas: nenhuma

## Resultado agregado

- buckets do Storage: 0;
- objetos do Storage: 0;
- funções `public.SECURITY DEFINER`: 15;
- funções desse tipo ainda executáveis via `PUBLIC`: 5.

As cinco assinaturas são:

- `get_admin_crm_users()`;
- `get_admin_metrics()`;
- `get_founder_count()`;
- `has_family_access(uuid)`;
- `is_premium(uuid)`.

O código versionado indica que hoje elas apenas leem dados, mas todas estão
declaradas `VOLATILE`. Para impedir que uma futura alteração transforme a
credencial de backup em caminho indireto de escrita, o preflight foi mantido
fail-closed: ele exige zero função `SECURITY DEFINER` executável pelo papel.

Antes de criar a credencial real, será necessário preparar e homologar uma
alteração de grants que preserve exatamente os acessos de `anon` e
`authenticated`, remova a herança de `PUBLIC` e deixe o papel de backup sem
`EXECUTE`. Isso será uma mudança de schema/permissão separada; não foi aplicada
por esta branch.

O candidato reversível foi preparado em
`scripts/backup/sql/harden_security_definer_for_backup.sql`. Ele preserva acesso
explícito de `anon`/`authenticated`, mas ainda precisa de regressão funcional no
staging antes de virar uma migration candidata.

## Ensaio transacional com rollback

O candidato foi executado dentro de `BEGIN ... ROLLBACK` junto com um papel de
prova descartável. Dentro da transação, o resultado foi:

- `default_transaction_read_only`: configurado;
- privilégios DML efetivos: 0;
- funções `SECURITY DEFINER` executáveis: 0;
- `anon` continuou com acesso a `get_founder_count()`;
- `authenticated` continuou com acesso a `get_admin_crm_users()`;
- `PUBLIC` deixou de herdar `get_admin_crm_users()`.

Após o rollback, foi confirmado que o papel de prova não existe, o grant
original de `PUBLIC` foi restaurado e a contagem do Storage permaneceu zero.
Nenhuma alteração persistiu no staging.
