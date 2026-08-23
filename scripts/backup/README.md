# Runner de backup assimétrico

Status: implementado e testado com identidade efêmera; recipient definitivo
integrado, ainda não ativado em produção e sem identidade privada no repositório.

## Componentes

- `Invoke-FinEloAsymmetricBackup.ps1`: fluxo completo e limpeza dos dumps;
- `Invoke-FinEloAsymmetricBackupDocker.ps1`: entrada Windows com psql pinado em Docker;
- `Export-FinEloReadOnlyLogicalBackup.ps1`: preflight e export lógico;
- `New-FinEloEncryptedBackup.ps1`: compressão, criptografia e receipt;
- `Test-FinEloPrivateKeyRecovery.ps1`: abertura real e evidência sem restaurar banco;
- `New-FinEloDrInventory.ps1`: Storage, Edge Functions, APIs e nomes de secrets;
- `Install-FinEloAgeTool.ps1`: instala o `age` oficial com checksum pinado;
- `Install-FinEloProtectedRecipientFingerprint.ps1`: cria a segunda fonte fora do Git;
- `Set-FinEloProtectedReadOnlyDatabaseUrl.ps1`: guarda a URL leitora via DPAPI;
- `FinElo.Backup.psm1`: validações fail-closed;
- `sql/provision_finelo_backup_reader.sql`: instalação manual do papel dedicado;
- `sql/rollback_finelo_backup_installation.sql`: retorno ao estado anterior;
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
executa também o verificador real de chave privada, testa/extrai o 7z, compara o
manifest e elimina a identidade efêmera. Isso comprova o software; não comprova
a chave privada definitiva.

Para validar o recipient definitivo sem acessar a chave privada, instale uma vez
a segunda fonte fora do Git e execute:

```powershell
$fingerprintConfirmadoOffline = '<fingerprint conferido pelo responsável>'
pwsh -NoProfile -File scripts/backup/Install-FinEloProtectedRecipientFingerprint.ps1 `
  -RecipientFile 'security/backup/finelo-backup-recipient.txt' `
  -ExpectedSha256 $fingerprintConfirmadoOffline

$env:FINELO_BACKUP_RECIPIENT_SHA256_FILE = `
  "$env:LOCALAPPDATA\FinElo\Backup\recipient-fingerprint.sha256"
npm run backup:test-recipient
```

Esse teste criptografa um pacote lógico sintético para o recipient definitivo,
valida `.partial`, receipt, hashes e `age-inspect`, e elimina o artefato ao fim.

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
$env:FINELO_BACKUP_RECIPIENT_SHA256_FILE = `
  "$env:LOCALAPPDATA\FinElo\Backup\recipient-fingerprint.sha256"

pwsh -NoProfile -File scripts/backup/Invoke-FinEloAsymmetricBackup.ps1 `
  -OutputDirectory '<destino>' `
  -RecipientFile 'security/backup/finelo-backup-recipient.txt' `
  -ProjectRef '<project-ref permitido>' `
  -PsqlPath '<psql.exe>' `
  -AgePath '<age.exe>' `
  -AgeInspectPath '<age-inspect.exe>'
```

Não use `supabase db dump --dry-run`: esse modo pode imprimir material de
conexão temporário. O runner também não usa `--linked` nem tokens de management,
migration ou deploy.

No host Windows homologado, o wrapper Docker usa somente o cliente `psql` da
imagem oficial PostgreSQL 17.6 pinada pelo digest, sem instalar PostgreSQL no
Windows. A imagem precisa ser baixada uma única vez antes da automação.

A URL do papel leitor pode ser fornecida por variável apenas na primeira
homologação ou instalada uma única vez em
`%LOCALAPPDATA%\FinElo\Backup\readonly-db-url.dpapi`. O arquivo usa DPAPI da
conta Windows atual, ACL sem herança e nunca é enviado ao Git, logs ou receipt.
A senha do papel nunca é passada como argumento de processo: a instalação
administrativa termina com `\password finelo_backup_reader` no prompt oculto do
`psql`, e só depois a URL resultante é instalada por `SecureString` no DPAPI.
