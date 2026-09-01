import { readFileSync } from 'node:fs';

/**
 * Lê um arquivo `.sql` de migration/rollback normalizando as quebras de linha.
 *
 * O repositório não tem `.gitattributes` e o Git roda com `core.autocrlf=true` no
 * Windows, então os `.sql` chegam ao disco com CRLF. As asserções destes testes
 * procuram trechos multilinha escritos com `\n` — por exemplo
 * `'grant create on schema finelo_internal\n  to ...'` — e tanto `indexOf` quanto
 * `toContain` falham por causa do `\r` intercalado.
 *
 * Normalizar na leitura mantém os testes verdes em qualquer plataforma, sem depender
 * de configuração de checkout e sem renormalizar os `.sql` versionados.
 */
export function readSqlFixture(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}
