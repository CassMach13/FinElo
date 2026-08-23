# Disaster recovery do FinElo

## Escopo recuperável

| Componente | Fonte de recuperação | Entra no `.7z.age`? |
|---|---|---|
| Banco e dados | dumps lógicos validados | sim |
| Histórico de migrations | schema e dados de `supabase_migrations` | sim |
| Customizações `auth`/`storage` | diff gerado pelo Supabase CLI | sim |
| Objetos do Storage | export binário separado, com hashes | sim, somente quando configurado |
| Edge Functions | fonte versionada e hashes por commit | fonte no Git; inventário no backup |
| APIs Vercel | fonte versionada e hashes por commit | fonte no Git; inventário no backup |
| Valores de secrets | cofre/configurações protegidas do responsável | não |
| Auth/OAuth/SMTP | dashboards + registro offline | não |
| Stripe/webhooks | Stripe + registro offline | não |
| DNS/domínio | registrador/DNS + runbook offline | não |
| Sentry/PostHog | respectivos serviços + configuração protegida | não |

O inventário atual detecta as Edge Functions `check-retention` e `pluggy-token`,
além das APIs Vercel. Ele registra nomes de variáveis necessários, nunca valores.
O código usa o bucket `images` para anexos de suporte; portanto Storage é parte
real do DR mesmo quando a contagem de objetos de um backup específico for zero.

## Procedimento de recuperação real

Este procedimento exige presença do responsável e a chave privada. Nunca é
executado contra produção sem nova aprovação.

1. Criar um projeto Supabase descartável e isolado, de preferência em uma
   organização sem integrações produtivas.
2. Copiar o `.7z.age` e o receipt para uma máquina controlada.
3. Validar o SHA-256 e o tamanho do artefato contra o receipt.
4. Descriptografar localmente:

   ```powershell
   age.exe --decrypt --identity X:\custodia\finelo-backup-identity.txt `
     --output FinElo-Restore.7z FinElo-Production-AAAA.7z.age
   ```

5. Executar `7z t`, extrair e validar todos os hashes de `manifest.json`.
   O verificador `scripts/backup/Test-FinEloPrivateKeyRecovery.ps1` automatiza
   os passos 3 a 5 e produz uma evidência sem registrar a chave ou seu caminho.
6. Revisar o inventário: extensões, publications, Auth, Storage, Edge Functions,
   Vercel, DNS e integrações externas.
7. Restaurar banco usando `psql --single-transaction` e
   `--variable ON_ERROR_STOP=1`, na ordem oficial `roles.sql`, `schema.sql`,
   `SET session_replication_role = replica` e `data.sql`.
8. Restaurar `history_schema.sql` e `history_data.sql` em uma transação separada.
9. Revisar e aplicar apenas as customizações necessárias de `auth`/`storage`.
10. Restaurar objetos binários do Storage e comparar quantidade, caminho,
    tamanho e hash.
11. Reimplantar Edge Functions a partir do commit registrado e reconfigurar
    secrets diretamente nos serviços, sem copiá-los do dump.
12. Recriar configurações externas e executar smoke tests: login, dashboard,
    transações, importação, cartão, suporte/anexos, webhook e observabilidade.
13. Comparar contagens e invariantes do manifest; registrar commit, projeto de
    ensaio, horário, resultados e hashes.
14. Excluir o projeto descartável somente após aprovação e preservação das
    evidências. Apagar com segurança os arquivos descriptografados temporários.

## Periodicidade

- primeiro ciclo: logo após a cerimônia e o primeiro backup real;
- estabilização: a cada três meses e após qualquer rotação de chave;
- após dois ciclos consecutivos íntegros: pode passar a cada seis meses;
- incidente, alteração relevante de schema/Storage/Auth ou mudança do runner:
  realizar novo ensaio antes do prazo regular.

`age-inspect` nunca substitui esse ensaio.

## Critérios de sucesso

- SHA-256 e manifest íntegros;
- `psql` termina sem erro e sem transação parcial;
- contagens e invariantes financeiras correspondem ao backup;
- nenhum dado aparece em competência/data incorreta;
- login e RLS isolam usuários;
- objetos do Storage abrem com hash correto;
- Edge Functions e webhooks funcionam com secrets recriados;
- Sentry/PostHog recebem apenas eventos do ambiente de ensaio;
- nenhum endpoint produtivo é acionado.
