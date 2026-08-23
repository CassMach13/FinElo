# Backup assimétrico do FinElo — arquitetura aprovada

## Estado

Esta implementação está restrita à branch e aos testes locais/staging. Ela não
substitui o fluxo atual, não altera produção e não modifica os backups legados.

O formato-alvo é:

```text
produção --credencial DB somente leitura--> dumps validados
                                              |
                                              v
                                      7-Zip (compressão)
                                              |
                                              v
                                 age 1.3+ / age1pq1 público
                                              |
                                              v
                              .7z.age + receipt.json
                                  |             |
                               OneDrive      cópia offline

identidade AGE-SECRET-KEY-PQ-1...: somente com o responsável
```

O `age` 1.3 ou superior usa recipient híbrido ML-KEM-768 + X25519. A chave
pública pode permanecer no Git; a chave privada nunca entra no repositório, na
automação, no Chrome, no OneDrive ou na sessão do agente.

## Duplo pinning da chave pública

O arquivo versionado contém apenas uma linha `age1pq1...`. Seu fingerprint é:

```text
SHA-256(UTF-8(recipient sem quebra de linha e sem BOM))
```

O valor canônico não é salvo ao lado dessa chave. O runner exige
`FINELO_BACKUP_RECIPIENT_SHA256_CANONICAL`, vindo de configuração protegida da
automação, e o responsável mantém outra cópia offline. A comparação é feita em
tempo constante. Alterar simultaneamente a chave e um hash no repositório não é
suficiente para produzir um backup.

## Isolamento da credencial de produção

O processo de backup aceita somente `FINELO_BACKUP_DB_URL_RO`, usando o papel
dedicado `finelo_backup_reader`. Antes de qualquer dump, o preflight exige:

- papel e project ref exatos;
- `default_transaction_read_only=on` fixado no papel e na sessão;
- ausência de `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION` e
  `BYPASSRLS`;
- zero privilégio efetivo de `INSERT`, `UPDATE`, `DELETE` ou `TRUNCATE`;
- zero função não sistêmica `SECURITY DEFINER` executável por esse papel.

A sessão também é recusada se contiver credenciais conhecidas de management,
escrita de banco, GitHub ou Vercel. O runner não possui comandos de migration,
deploy, merge ou alteração de configuração.

O SQL de criação do papel fica em
`scripts/backup/sql/provision_finelo_backup_reader.sql`. Ele não é migration e
deve ser validado primeiro em staging. Aplicá-lo em produção continua sendo uma
fronteira protegida e exigirá aprovação específica.

## Conteúdo criptografado

O arquivo compactado contém:

- `database/roles.sql`;
- `database/schema.sql`;
- `database/data.sql`;
- `database/history_schema.sql` e `history_data.sql`;
- `database/auth_storage_changes.sql`;
- `recovery/dr-inventory.json`;
- `manifest.json` com tamanho e SHA-256 de cada arquivo, project ref e commit.

Valores de segredos externos e chaves privadas são proibidos. O dump de dados
exclui `vault.secrets`. Se houver objetos no Storage, o runner para com
`STORAGE_OBJECT_EXPORT_REQUIRED` até receber um export binário somente leitura
com inventário correspondente; metadados SQL de `storage.objects` não substituem
os arquivos binários.

## Validações e significado do receipt

Antes de publicar o artefato, o runner:

1. valida a credencial somente leitura;
2. valida os arquivos lógicos obrigatórios;
3. testa o `.7z` ainda dentro de diretório temporário restrito;
4. criptografa para a chave pública pinada;
5. executa `age-inspect --json`;
6. exige envelope age v1, recipient `mlkem768x25519`, PQ ativo e payload;
7. calcula o SHA-256 do `.7z.age` e publica um receipt sem dados financeiros;
8. remove os dumps e o `.7z` não criptografado.

`age-inspect` é chamado exclusivamente de **validação estrutural**. O receipt
sempre registra `recovery_tested: false`. Apenas uma descriptografia com a chave
privada seguida de restauração completa pode mudar essa evidência em um registro
separado de ensaio de recuperação. O script
`scripts/backup/Test-FinEloPrivateKeyRecovery.ps1` faz a abertura real, testa o
7-Zip e todos os hashes do manifest, mas ainda registra a restauração Supabase
como não executada; isso evita transformar um teste local em uma alegação maior.

## Migração gradual

Os backups v5–v8 continuam intocados, com as senhas correspondentes preservadas.
O v9 interrompido também não é convertido automaticamente.

O fluxo antigo só poderá ser aposentado depois de:

1. cerimônia real da chave privada e duplo pinning concluídos;
2. papel de backup validado em staging e depois aprovado em produção;
3. pelo menos três backups novos `.7z.age` íntegros em datas diferentes;
4. uma descriptografia real e restauração completa em Supabase descartável;
5. comparação de contagens, login, importação, cartão, Storage e funções;
6. aprovação explícita do responsável.

Mesmo após o corte, nenhuma exclusão ou conversão de backup legado é automática.

## Fontes técnicas

- [age: recipients híbridos e age-inspect](https://github.com/FiloSottile/age)
- [Supabase: backup e restore por CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
