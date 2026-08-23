# Material público do backup

Esta pasta contém exclusivamente o recipient público usado para criptografar
novos backups do FinElo.

- `finelo-backup-recipient.txt` deve conter exatamente uma linha `age1pq1...`;
- a identidade privada correspondente nunca entra neste repositório;
- o SHA-256 canônico não é versionado aqui: ele vem da segunda fonte protegida
  fora do Git (arquivo com ACL exclusiva ou configuração protegida) e também
  existe no registro offline sob custódia do responsável;
- qualquer alteração do recipient exige nova cerimônia, novo pinning independente
  e teste de recuperação antes de uso real.

O runner recusa recipients clássicos, múltiplos recipients, fingerprint
divergente e qualquer arquivo com marcador de chave privada.
