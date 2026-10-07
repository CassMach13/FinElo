-- Este hardening de segurança não é revertido automaticamente.
--
-- Reverter reabriria: acesso de `anon`, TRUNCATE/TRIGGER/REFERENCES para `authenticated` e a
-- gravação de lançamentos em nome de outro membro da família. Nada disso deve voltar por rollback.
-- Se um cliente legítimo realmente precisar de algum desses acessos, conceda-o de forma pontual e
-- revisada, nunca restaurando o estado anterior.
--
-- (arquivo documental: intencionalmente sem comandos)
SELECT 1;
