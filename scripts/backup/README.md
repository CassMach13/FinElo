# Runner de backup assimétrico

Status: implementado e testado com identidade efêmera; ainda não ativado em
produção e sem chave real no repositório.

## Componentes

- `Invoke-FinEloAsymmetricBackup.ps1`: fluxo completo e limpeza dos dumps;
- `Export-FinEloReadOnlyLogicalBackup.ps1`: preflight e export lógico;
- `New-FinEloEncryptedBackup.ps1`: compressão, criptografia e receipt;
- `Test-FinEloPrivateKeyRecovery.ps1`: abertura real e evidência sem restaurar banco;
- `New-FinEloDrInventory.ps1`: Storage, Edge Functions, APIs e nomes de secrets;
- `FinElo.Backup.psm1`: validações fail-closed;
- `sql/provision_finelo_backup_reader.sql`: instalação manual do papel dedicado;
- `tests/Test-FinEloAsymmetricBackup.ps1`: teste ponta a ponta sintético.

## Teste local

Instale `age` em uma pasta temporária ou de ferramentas do usuário, nunca no
repositório:

```powershell
pwsh -NoProfile -File scripts/backup/Install-FinEloAgeTool.ps1 `
  -DestinationDirectory "$env:LOCALAPPDATA\FinElo\Tools\age-1.3.1"

$env:FINELO_TEST_AGE_BIN = "$env:LOCALAPPDATA\FinElo\Tools\age-1.3.1"
pwsh -NoProfile -File scripts/backup/tests/Test-FinEloAsymmetricBackup.ps1
```

O teste cria uma identidade PQ efêmera, criptografa, executa `age-inspect`,
executa também o verificador real de chave privada, testa/extrai o 7z, compara o manifest e elimina a identidade
efêmera. Isso comprova o software; não comprova a chave privada definitiva.

## Uso futuro

O processo real requer:

1. cerimônia da chave e recipient público versionado;
2. fingerprint canônico na configuração protegida;
3. `finelo_backup_reader` aprovado no preflight;
4. `psql`, Docker e Supabase CLI 2.115.0 validados;
5. destino de backup e cópia offline;
6. export de Storage separado quando `storage.objects > 0`.

Exemplo estrutural, sem valores reais:

```powershell
$env:FINELO_BACKUP_DB_URL_RO = '<credencial dedicada somente leitura>'
$env:FINELO_BACKUP_RECIPIENT_SHA256_CANONICAL = '<fingerprint da fonte protegida>'

pwsh -NoProfile -File scripts/backup/Invoke-FinEloAsymmetricBackup.ps1 `
  -OutputDirectory '<destino>' `
  -RecipientFile 'scripts/backup/recipients/finelo-production-recipient.txt' `
  -ProjectRef '<project-ref permitido>' `
  -PsqlPath '<psql.exe>' `
  -AgePath '<age.exe>' `
  -AgeInspectPath '<age-inspect.exe>'
```

Não use `supabase db dump --dry-run`: esse modo pode imprimir material de
conexão temporário. O runner também não usa `--linked` nem tokens de management,
migration ou deploy.
