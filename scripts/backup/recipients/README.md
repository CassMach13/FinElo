# Recipient público de backup

O recipient público aprovado está em
`security/backup/finelo-backup-recipient.txt`. Esta pasta permanece somente como
documentação de compatibilidade.

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

A identidade privada correspondente permanece exclusivamente offline.
