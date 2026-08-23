# Recipient público de backup

Esta pasta receberá, após a cerimônia de chaves, somente o recipient público
híbrido `age1pq1...` usado nos backups do FinElo.

Regras:

- a identidade privada `AGE-SECRET-KEY-PQ-1...` nunca entra neste repositório;
- o SHA-256 canônico é calculado sobre a linha do recipient em UTF-8, sem BOM
  e sem quebra de linha;
- esse SHA-256 não é versionado ao lado do recipient;
- a automação deve recebê-lo pela configuração protegida
  `FINELO_BACKUP_RECIPIENT_SHA256_CANONICAL`;
- uma segunda cópia do SHA-256 fica no registro offline do responsável;
- trocar o recipient exige uma cerimônia explícita e um teste real de
  descriptografia/restauração.

Nenhuma chave real foi criada nesta branch.
