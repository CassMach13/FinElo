# Cerimônia da chave privada de backup

Status em 2026-08-23: concluída pelo responsável. Duas cópias independentes em
cofres VeraCrypt foram testadas, a identidade privada permaneceu exclusivamente
offline e não foi disponibilizada ao agente. O recipient público foi integrado
sem acesso à chave privada.

## Preparação

- máquina atualizada e sem compartilhamento de tela;
- `age` oficial 1.3.1 ou superior, com checksum validado;
- duas mídias removíveis criptografadas e identificadas;
- uma configuração protegida da automação para o fingerprint canônico;
- nenhum gerenciador de clipboard ou sincronização contendo a chave privada.

## Geração

Com a primeira mídia montada como exemplo em `X:`:

```powershell
age-keygen.exe -pq -o X:\FinElo-Custodia\finelo-backup-identity.txt
age-keygen.exe -y -o finelo-production-recipient.txt `
  X:\FinElo-Custodia\finelo-backup-identity.txt
```

O primeiro arquivo é privado. O segundo é público e, após revisão, passa a ser
`security/backup/finelo-backup-recipient.txt`.

Não abrir, colar, enviar ou registrar a linha `AGE-SECRET-KEY-PQ-1...` no chat.
Copiar a identidade para a segunda mídia por operação local, validar as duas
cópias e guardar em locais físicos separados.

## Pinning independente

Calcular o SHA-256 canônico sobre a linha pública normalizada usando o módulo do
runner. Guardar o mesmo valor em:

1. segunda fonte protegida da automação, fora do Git e com ACL exclusiva;
2. registro offline sob custódia do responsável.

O Git contém apenas o recipient público. O fingerprint não será adicionado ao
mesmo commit.

## Prova inicial

1. criar um backup novo usando somente o recipient público;
2. validar estruturalmente com `age-inspect`;
3. em sessão local controlada, descriptografar com uma das cópias privadas;
4. testar e extrair o `.7z`;
5. validar o manifest;
6. repetir a abertura com a segunda mídia;
7. restaurar em projeto Supabase descartável conforme o runbook de DR.

A cerimônia só termina depois das duas cópias privadas e do fingerprint offline
serem comprovados. O receipt automático continua indicando apenas validação
estrutural; o ensaio real recebe evidência separada.

## Rotação ou perda

Nunca substituir a chave pública silenciosamente. Uma rotação cria nova versão
de recipient, novo pinning independente e ao menos um backup de transição. Os
backups antigos permanecem vinculados à identidade anterior até decisão explícita.

Se todas as cópias privadas forem perdidas, os backups `age` correspondentes são
irrecuperáveis. Por isso a disponibilidade das duas mídias é verificada em cada
ensaio periódico, sem expor a identidade à automação.
