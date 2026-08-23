Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-FinEloSha256Hex {
    [CmdletBinding(DefaultParameterSetName = 'File')]
    param(
        [Parameter(Mandatory, ParameterSetName = 'File')]
        [string]$LiteralPath,

        [Parameter(Mandatory, ParameterSetName = 'Text')]
        [AllowEmptyString()]
        [string]$Text
    )

    if ($PSCmdlet.ParameterSetName -eq 'File') {
        return (Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }

    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Text)
    try {
        return [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
    }
    finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
    }
}

function Test-FinEloFixedTimeHexEqual {
    param(
        [Parameter(Mandatory)]
        [string]$Left,

        [Parameter(Mandatory)]
        [string]$Right
    )

    if ($Left -notmatch '^[0-9a-fA-F]{64}$' -or $Right -notmatch '^[0-9a-fA-F]{64}$') {
        return $false
    }

    $leftBytes = [Convert]::FromHexString($Left)
    $rightBytes = [Convert]::FromHexString($Right)
    try {
        return [System.Security.Cryptography.CryptographicOperations]::FixedTimeEquals($leftBytes, $rightBytes)
    }
    finally {
        [Array]::Clear($leftBytes, 0, $leftBytes.Length)
        [Array]::Clear($rightBytes, 0, $rightBytes.Length)
    }
}

function Get-FinEloRecipientInfo {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$RecipientFile,

        [Parameter(Mandatory)]
        [string]$CanonicalSha256
    )

    if (-not (Test-Path -LiteralPath $RecipientFile -PathType Leaf)) {
        throw 'O arquivo público de recipients não foi encontrado.'
    }

    if ($CanonicalSha256 -notmatch '^[0-9a-fA-F]{64}$') {
        throw 'O fingerprint canônico protegido deve ser um SHA-256 hexadecimal de 64 caracteres.'
    }

    $recipients = @(
        Get-Content -LiteralPath $RecipientFile |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ -and -not $_.StartsWith('#') }
    )

    if ($recipients.Count -ne 1) {
        throw 'O arquivo deve conter exatamente um recipient público ativo.'
    }

    $recipient = $recipients[0]
    if (-not $recipient.StartsWith('age1pq1', [StringComparison]::Ordinal)) {
        throw 'O recipient precisa ser híbrido pós-quântico (prefixo age1pq1).'
    }

    $actualSha256 = Get-FinEloSha256Hex -Text $recipient
    if (-not (Test-FinEloFixedTimeHexEqual -Left $actualSha256 -Right $CanonicalSha256)) {
        throw 'O recipient público não corresponde ao fingerprint canônico da fonte protegida.'
    }

    [pscustomobject]@{
        Recipient = $recipient
        Sha256 = $actualSha256
        Type = 'mlkem768x25519'
        PostQuantum = $true
    }
}

function Get-FinEloCanonicalRecipientSha256 {
    [CmdletBinding()]
    param(
        [string]$ExplicitSha256 = '',

        [string]$ProtectedSha256File = '',

        [Parameter(Mandatory)]
        [string]$RepositoryRoot
    )

    $fileSha256 = ''
    if (-not [string]::IsNullOrWhiteSpace($ProtectedSha256File)) {
        if (-not (Test-Path -LiteralPath $ProtectedSha256File -PathType Leaf)) {
            throw 'A fonte protegida do fingerprint não foi encontrada.'
        }

        $fileItem = Get-Item -LiteralPath $ProtectedSha256File -Force
        if ($fileItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'A fonte protegida do fingerprint não pode ser um link ou reparse point.'
        }

        $repository = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $RepositoryRoot).Path)
        $repositoryWithSeparator = $repository.TrimEnd(
            [IO.Path]::DirectorySeparatorChar,
            [IO.Path]::AltDirectorySeparatorChar
        ) + [IO.Path]::DirectorySeparatorChar
        $protectedFile = [IO.Path]::GetFullPath($fileItem.FullName)
        if ($protectedFile.StartsWith($repositoryWithSeparator, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'O fingerprint canônico deve permanecer fora do repositório.'
        }

        if ($IsWindows) {
            $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
            $acl = Get-Acl -LiteralPath $protectedFile
            $ownerSid = try {
                ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
                    [System.Security.Principal.SecurityIdentifier]
                ).Value
            }
            catch {
                [string]$acl.Owner
            }
            if (-not $acl.AreAccessRulesProtected -or $ownerSid -cne $currentSid.Value) {
                throw 'A fonte do fingerprint não possui owner e herança protegidos para o usuário atual.'
            }
            foreach ($rule in $acl.Access) {
                $ruleSid = try {
                    $rule.IdentityReference.Translate(
                        [System.Security.Principal.SecurityIdentifier]
                    ).Value
                }
                catch {
                    [string]$rule.IdentityReference.Value
                }
                if ($ruleSid -cne $currentSid.Value -or
                    $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
                    throw 'A fonte do fingerprint possui uma regra de acesso não aprovada.'
                }
            }
        }

        $lines = @(
            Get-Content -LiteralPath $protectedFile |
                ForEach-Object { $_.Trim() } |
                Where-Object { $_ -and -not $_.StartsWith('#') }
        )
        if ($lines.Count -ne 1 -or $lines[0] -notmatch '^[0-9a-fA-F]{64}$') {
            throw 'A fonte protegida deve conter exatamente um SHA-256 hexadecimal.'
        }
        $fileSha256 = $lines[0].ToLowerInvariant()
    }

    if (-not [string]::IsNullOrWhiteSpace($ExplicitSha256)) {
        if ($ExplicitSha256 -notmatch '^[0-9a-fA-F]{64}$') {
            throw 'O fingerprint explícito deve ser um SHA-256 hexadecimal.'
        }
        $explicitNormalized = $ExplicitSha256.ToLowerInvariant()
        if (-not [string]::IsNullOrWhiteSpace($fileSha256) -and
            -not (Test-FinEloFixedTimeHexEqual -Left $explicitNormalized -Right $fileSha256)) {
            throw 'As duas fontes protegidas do fingerprint divergem.'
        }
        return $explicitNormalized
    }

    if ([string]::IsNullOrWhiteSpace($fileSha256)) {
        throw 'O fingerprint canônico deve vir de uma segunda fonte protegida fora do Git.'
    }

    return $fileSha256
}

function Get-FinEloCurrentUserProtectedText {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$ProtectedFile,

        [Parameter(Mandatory)]
        [string]$RepositoryRoot
    )

    if (-not $IsWindows) {
        throw 'A leitura DPAPI está disponível somente no host Windows da automação.'
    }
    if (-not (Test-Path -LiteralPath $ProtectedFile -PathType Leaf)) {
        throw 'O arquivo protegido por DPAPI não foi encontrado.'
    }

    $fileItem = Get-Item -LiteralPath $ProtectedFile -Force
    if ($fileItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'O arquivo protegido por DPAPI não pode ser um link ou reparse point.'
    }

    $repository = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $RepositoryRoot).Path)
    $repositoryWithSeparator = $repository.TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ) + [IO.Path]::DirectorySeparatorChar
    $protectedPath = [IO.Path]::GetFullPath($fileItem.FullName)
    if ($protectedPath.StartsWith($repositoryWithSeparator, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'O segredo DPAPI deve permanecer fora do repositório.'
    }

    $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = Get-Acl -LiteralPath $protectedPath
    $ownerSid = try {
        ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
    }
    catch {
        [string]$acl.Owner
    }
    if (-not $acl.AreAccessRulesProtected -or $ownerSid -cne $currentSid.Value) {
        throw 'O segredo DPAPI não possui owner e herança protegidos para o usuário atual.'
    }
    foreach ($rule in $acl.Access) {
        $ruleSid = try {
            $rule.IdentityReference.Translate(
                [System.Security.Principal.SecurityIdentifier]
            ).Value
        }
        catch {
            [string]$rule.IdentityReference.Value
        }
        if ($ruleSid -cne $currentSid.Value -or
            $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
            throw 'O segredo DPAPI possui uma regra de acesso não aprovada.'
        }
    }

    $cipherText = (Get-Content -LiteralPath $protectedPath -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($cipherText)) {
        throw 'O segredo DPAPI está vazio.'
    }

    $secureText = ConvertTo-SecureString -String $cipherText
    try {
        return [System.Net.NetworkCredential]::new('', $secureText).Password
    }
    catch {
        throw 'O segredo DPAPI não pôde ser aberto pela conta Windows atual.'
    }
    finally {
        $secureText.Dispose()
        $cipherText = ''
    }
}

function Get-FinEloDatabaseConnectionInfo {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$DatabaseUrl,

        [Parameter(Mandatory)]
        [string]$ExpectedProjectRef,

        [string]$ExpectedRole = 'finelo_backup_reader'
    )

    if ($ExpectedProjectRef -notmatch '^[a-z0-9]{20}$') {
        throw 'Project ref inválido.'
    }

    try {
        $uri = [Uri]$DatabaseUrl
    }
    catch {
        throw 'FINELO_BACKUP_DB_URL_RO não é uma URI PostgreSQL válida.'
    }

    if ($uri.Scheme -notin @('postgresql', 'postgres')) {
        throw 'A conexão de backup deve usar o esquema postgresql://.'
    }

    if (-not $uri.Host.EndsWith('.supabase.com', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'A conexão de backup deve apontar para um host oficial do Supabase.'
    }

    $userInfoParts = $uri.UserInfo.Split(':', 2)
    $userName = [Uri]::UnescapeDataString($userInfoParts[0])
    $password = if ($userInfoParts.Count -eq 2) { [Uri]::UnescapeDataString($userInfoParts[1]) } else { '' }

    $forbiddenRoles = @('postgres', 'supabase_admin', 'service_role', 'cli_login_postgres')
    if ($forbiddenRoles -contains $userName) {
        throw 'A credencial informada é privilegiada e foi recusada pelo processo de backup.'
    }

    $baseUserName = $userName.Split('.', 2)[0]
    if ($baseUserName -cne $ExpectedRole) {
        throw "A conexão deve usar exclusivamente o papel dedicado '$ExpectedRole'."
    }

    $projectInHost = $uri.Host.Contains($ExpectedProjectRef, [StringComparison]::OrdinalIgnoreCase)
    $projectInUser = $userName.EndsWith(".$ExpectedProjectRef", [StringComparison]::OrdinalIgnoreCase)
    if (-not $projectInHost -and -not $projectInUser) {
        throw 'A conexão não corresponde ao project ref explicitamente permitido.'
    }

    if ([string]::IsNullOrWhiteSpace($password)) {
        throw 'A conexão somente leitura não contém senha.'
    }

    $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
    if ($query['sslmode'] -and $query['sslmode'] -notin @('require', 'verify-ca', 'verify-full')) {
        throw 'sslmode deve exigir TLS.'
    }

    [pscustomobject]@{
        Host = $uri.Host
        Port = if ($uri.IsDefaultPort) { 5432 } else { $uri.Port }
        Database = $uri.AbsolutePath.TrimStart('/')
        UserName = $userName
        Password = $password
        ProjectRef = $ExpectedProjectRef
        OriginalUrl = $DatabaseUrl
    }
}

function Test-FinEloReadOnlyPreflightResult {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [object]$Result,

        [Parameter(Mandatory)]
        [string]$ExpectedRole,

        [Parameter(Mandatory)]
        [string]$ExpectedProjectRef
    )

    $failures = [System.Collections.Generic.List[string]]::new()
    $baseUserName = ([string]$Result.current_user).Split('.', 2)[0]

    if ($baseUserName -cne $ExpectedRole) { $failures.Add('current_user inesperado') }
    if ([string]$Result.project_ref -cne $ExpectedProjectRef) { $failures.Add('project_ref inesperado') }
    if ([string]$Result.transaction_read_only -cne 'on') { $failures.Add('transaction_read_only não está on') }
    if (-not [bool]$Result.role_default_read_only) { $failures.Add('default_transaction_read_only não está fixado no papel') }
    if ([bool]$Result.is_superuser) { $failures.Add('papel é superuser') }
    if ([bool]$Result.can_create_db) { $failures.Add('papel pode criar bancos') }
    if ([bool]$Result.can_create_role) { $failures.Add('papel pode criar papéis') }
    if ([bool]$Result.can_replicate) { $failures.Add('papel possui replication') }
    if ([bool]$Result.can_bypass_rls) { $failures.Add('papel pode ignorar RLS') }
    if ([int]$Result.writable_table_count -ne 0) { $failures.Add('papel possui privilégios DML') }
    if ([int]$Result.executable_security_definer_count -ne 0) { $failures.Add('papel executa funções SECURITY DEFINER não aprovadas') }

    if ($failures.Count -ne 0) {
        throw ('A credencial não é tecnicamente somente leitura: ' + ($failures -join '; ') + '.')
    }

    [pscustomobject]@{
        Valid = $true
        StorageObjectCount = [long]$Result.storage_object_count
        StorageBucketCount = [long]$Result.storage_bucket_count
        ServerVersionNum = [int]$Result.server_version_num
    }
}

function Invoke-FinEloProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$FilePath,

        [Parameter(Mandatory)]
        [string[]]$ArgumentList,

        [Parameter(Mandatory)]
        [string]$Operation,

        [hashtable]$Environment = @{},

        [string[]]$SensitiveValues = @()
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    foreach ($argument in $ArgumentList) {
        $null = $startInfo.ArgumentList.Add($argument)
    }
    foreach ($entry in $Environment.GetEnumerator()) {
        $startInfo.Environment[[string]$entry.Key] = [string]$entry.Value
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        $null = $process.Start()
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()

        foreach ($sensitiveValue in $SensitiveValues) {
            if (-not [string]::IsNullOrEmpty($sensitiveValue)) {
                $stdout = $stdout.Replace($sensitiveValue, '[REDACTED]', [StringComparison]::Ordinal)
                $stderr = $stderr.Replace($sensitiveValue, '[REDACTED]', [StringComparison]::Ordinal)
            }
        }

        if ($process.ExitCode -ne 0) {
            $safeError = if ([string]::IsNullOrWhiteSpace($stderr)) { 'sem diagnóstico seguro' } else { $stderr.Trim() }
            throw "$Operation falhou (código $($process.ExitCode)): $safeError"
        }

        [pscustomobject]@{
            ExitCode = $process.ExitCode
            StdOut = $stdout
            StdErr = $stderr
        }
    }
    finally {
        $process.Dispose()
    }
}

function Invoke-FinEloReadOnlyPreflight {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$PsqlPath,

        [Parameter(Mandatory)]
        [object]$ConnectionInfo,

        [string]$ExpectedRole = 'finelo_backup_reader',

        [string[]]$PsqlArgumentPrefix = @()
    )

    $sql = @"
select json_build_object(
  'current_user', current_user,
  'project_ref', '$($ConnectionInfo.ProjectRef)',
  'transaction_read_only', current_setting('transaction_read_only'),
  'role_default_read_only', coalesce((
    select exists (
      select 1 from unnest(coalesce(r.rolconfig, array[]::text[])) setting
      where setting = 'default_transaction_read_only=on'
    )
    from pg_roles r where r.rolname = current_user
  ), false),
  'is_superuser', (select rolsuper from pg_roles where rolname = current_user),
  'can_create_db', (select rolcreatedb from pg_roles where rolname = current_user),
  'can_create_role', (select rolcreaterole from pg_roles where rolname = current_user),
  'can_replicate', (select rolreplication from pg_roles where rolname = current_user),
  'can_bypass_rls', (select rolbypassrls from pg_roles where rolname = current_user),
  'writable_table_count', (
    select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema')
      and (has_table_privilege(current_user, c.oid, 'INSERT')
        or has_table_privilege(current_user, c.oid, 'UPDATE')
        or has_table_privilege(current_user, c.oid, 'DELETE')
        or has_table_privilege(current_user, c.oid, 'TRUNCATE'))
  ),
  'executable_security_definer_count', (
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname not in ('pg_catalog','information_schema')
      and has_function_privilege(current_user, p.oid, 'EXECUTE')
  ),
  'storage_object_count', coalesce((select count(*) from storage.objects), 0),
  'storage_bucket_count', coalesce((select count(*) from storage.buckets), 0),
  'server_version_num', current_setting('server_version_num')::integer
)::text;
"@

    $environment = @{
        PGHOST = $ConnectionInfo.Host
        PGPORT = [string]$ConnectionInfo.Port
        PGDATABASE = $ConnectionInfo.Database
        PGUSER = $ConnectionInfo.UserName
        PGPASSWORD = $ConnectionInfo.Password
        PGSSLMODE = 'require'
        PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=60000'
    }

    try {
        $psqlArguments = @($PsqlArgumentPrefix) + @(
            '--no-psqlrc', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--command', $sql
        )
        $result = Invoke-FinEloProcess -FilePath $PsqlPath -ArgumentList $psqlArguments -Operation 'Preflight somente leitura' -Environment $environment
        $parsed = $result.StdOut.Trim() | ConvertFrom-Json
        return Test-FinEloReadOnlyPreflightResult -Result $parsed -ExpectedRole $ExpectedRole -ExpectedProjectRef $ConnectionInfo.ProjectRef
    }
    finally {
        $environment['PGPASSWORD'] = ''
        $ConnectionInfo.Password = ''
        $ConnectionInfo.OriginalUrl = ''
    }
}

function Test-FinEloAgeEnvelope {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$AgeInspectPath,

        [Parameter(Mandatory)]
        [string]$EncryptedFile
    )

    $inspectResult = Invoke-FinEloProcess -FilePath $AgeInspectPath -ArgumentList @('--json', $EncryptedFile) -Operation 'Validação estrutural age-inspect'
    $inspection = $inspectResult.StdOut | ConvertFrom-Json

    if ($inspection.version -cne 'age-encryption.org/v1') {
        throw 'O envelope não usa o formato estável age v1.'
    }
    if ($inspection.postquantum -cne 'yes') {
        throw 'O envelope não declara proteção pós-quântica.'
    }
    if (@($inspection.stanza_types) -notcontains 'mlkem768x25519') {
        throw 'O envelope não contém o recipient híbrido ML-KEM-768 + X25519.'
    }
    if ([long]$inspection.sizes.min_payload -le 0 -or [long]$inspection.sizes.max_payload -le 0) {
        throw 'O envelope age não contém payload estruturalmente válido.'
    }

    [pscustomobject]@{
        Version = [string]$inspection.version
        PostQuantum = $true
        StanzaTypes = @($inspection.stanza_types)
        MinimumPayloadBytes = [long]$inspection.sizes.min_payload
        MaximumPayloadBytes = [long]$inspection.sizes.max_payload
        ValidationScope = 'structural-only-no-private-key'
    }
}

function Assert-FinEloStorageRecoveryReady {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [long]$StorageObjectCount,

        [string]$StorageObjectExportDirectory
    )

    if ($StorageObjectCount -eq 0) {
        return
    }

    if ([string]::IsNullOrWhiteSpace($StorageObjectExportDirectory) -or
        -not (Test-Path -LiteralPath $StorageObjectExportDirectory -PathType Container)) {
        throw 'STORAGE_OBJECT_EXPORT_REQUIRED: o banco referencia objetos no Storage, mas nenhum export binário somente leitura foi fornecido.'
    }

    $inventoryPath = Join-Path $StorageObjectExportDirectory 'storage-object-inventory.json'
    if (-not (Test-Path -LiteralPath $inventoryPath -PathType Leaf)) {
        throw 'STORAGE_OBJECT_EXPORT_REQUIRED: o inventário verificável dos objetos não foi encontrado.'
    }

    $inventory = Get-Content -LiteralPath $inventoryPath -Raw | ConvertFrom-Json
    if ([long]$inventory.object_count -ne $StorageObjectCount) {
        throw 'STORAGE_OBJECT_EXPORT_REQUIRED: a quantidade exportada não corresponde ao banco.'
    }

    $objects = @($inventory.objects)
    if ($objects.Count -ne $StorageObjectCount) {
        throw 'STORAGE_OBJECT_EXPORT_REQUIRED: o inventário não descreve individualmente todos os objetos.'
    }

    $exportRoot = [IO.Path]::GetFullPath($StorageObjectExportDirectory)
    $exportRootWithSeparator = $exportRoot.TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ) + [IO.Path]::DirectorySeparatorChar
    $seenPaths = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)

    foreach ($object in $objects) {
        $relativePath = [string]$object.path
        $expectedSha256 = [string]$object.sha256
        $expectedBytes = [long]$object.bytes

        if ([string]::IsNullOrWhiteSpace($relativePath) -or
            [IO.Path]::IsPathRooted($relativePath) -or
            $expectedSha256 -notmatch '^[0-9a-fA-F]{64}$' -or
            $expectedBytes -lt 0) {
            throw 'STORAGE_OBJECT_EXPORT_REQUIRED: o inventário contém uma entrada inválida.'
        }
        if (-not $seenPaths.Add($relativePath.Replace('\', '/'))) {
            throw 'STORAGE_OBJECT_EXPORT_REQUIRED: o inventário contém caminhos duplicados.'
        }

        $platformPath = $relativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)
        $objectPath = [IO.Path]::GetFullPath((Join-Path $StorageObjectExportDirectory $platformPath))
        if (-not $objectPath.StartsWith($exportRootWithSeparator, [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $objectPath -PathType Leaf)) {
            throw 'STORAGE_OBJECT_EXPORT_REQUIRED: um objeto inventariado está ausente ou fora do export.'
        }

        $item = Get-Item -LiteralPath $objectPath -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            [long]$item.Length -ne $expectedBytes -or
            (Get-FinEloSha256Hex -LiteralPath $objectPath) -cne $expectedSha256.ToLowerInvariant()) {
            throw 'STORAGE_OBJECT_EXPORT_REQUIRED: tamanho ou SHA-256 de um objeto não confere.'
        }
    }
}

Export-ModuleMember -Function @(
    'Get-FinEloSha256Hex',
    'Test-FinEloFixedTimeHexEqual',
    'Get-FinEloRecipientInfo',
    'Get-FinEloCanonicalRecipientSha256',
    'Get-FinEloCurrentUserProtectedText',
    'Get-FinEloDatabaseConnectionInfo',
    'Test-FinEloReadOnlyPreflightResult',
    'Invoke-FinEloProcess',
    'Invoke-FinEloReadOnlyPreflight',
    'Test-FinEloAgeEnvelope',
    'Assert-FinEloStorageRecoveryReady'
)
