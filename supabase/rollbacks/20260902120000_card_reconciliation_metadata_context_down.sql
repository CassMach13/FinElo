-- Rollback do token `metadata_context`.
--
-- Remove as três funções. Nada de dado é tocado: o token é DERIVADO, calculado
-- na hora a partir de `auth.users`, e não guarda nada.
--
-- Sentido seguro da perda: sem o token, quem valida snapshot perde a capacidade
-- de detectar mudança nas palavras-chave de classificação. Isso NÃO é seguro em
-- si — é justamente o buraco que a migration fecha. Portanto reverter só faz
-- sentido junto com a reversão de quem consome o token; revertê-la sozinha
-- deixaria o consumidor chamando função inexistente, e a chamada falha alto.
-- Falhar alto é o comportamento desejado aqui: melhor recusar a validação do
-- que validar sem checar as palavras.
--
-- `finelo_metadata_reader` não é recriado. Ele foi uma tentativa que não
-- funciona (ver o cabeçalho da migration) e ressuscitá-lo só devolveria um
-- papel com `bypassrls` incapaz de ler o que quer que seja.

begin;

drop function if exists finelo_reconciliation_internal.metadata_context(uuid);
drop function if exists finelo_reconciliation_internal.metadata_canonical(jsonb);
drop function if exists finelo_reconciliation_internal.metadata_keywords(jsonb);

commit;
