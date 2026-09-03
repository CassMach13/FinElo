/**
 * Leitura da competência a partir do NOME do arquivo de fatura.
 *
 * Função pura de string, sem I/O. Morava em `creditCardEngineService`, que
 * importa o cliente Supabase — e por isso arrastava o browser para dentro do
 * núcleo de cálculo. Mora aqui para que o mesmo núcleo rode no app e num
 * contexto server-side confiável.
 */

export const parseCreditCardReferenceFromFileName = (fileName: string): { dueYear: number; dueMonth: number } | null => {
  const normalized = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const monthMap: Record<string, number> = {
    jan: 1,
    fev: 2,
    mar: 3,
    abr: 4,
    mai: 5,
    jun: 6,
    jul: 7,
    ago: 8,
    set: 9,
    out: 10,
    nov: 11,
    dez: 12,
  };

  const monthTextMatch = normalized.match(/(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[_-]?(\d{4})/);
  if (monthTextMatch) {
    return {
      dueYear: Number(monthTextMatch[2]),
      dueMonth: monthMap[monthTextMatch[1]],
    };
  }

  const numericMatch = normalized.match(/(\d{1,2})[_-](\d{4})/);
  if (!numericMatch) return null;
  const month = Number(numericMatch[1]);
  const year = Number(numericMatch[2]);
  if (month < 1 || month > 12) return null;
  return { dueYear: year, dueMonth: month };
};

/**
 * Vencimento DECLARADO pelo nome do arquivo, no formato ISO (ex.:
 * `Nubank_2026-06-18.csv`). Alguns emissores nomeiam o export pela data de
 * vencimento da fatura, não pela competência — e essa data é autoritativa
 * quando presente: não é inferência sobre o conteúdo, é o que o emissor
 * declarou. `parseCreditCardReferenceFromFileName` acima não reconhece este
 * formato (procura `mmm-aaaa` ou `mm-aaaa`); esta função existe só para o
 * padrão `aaaa-mm-dd`, sem disputar com aquela.
 */
export const parseDueDateFromIsoFileName = (fileName: string): string | null => {
  const match = /(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/.exec(fileName);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valido =
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
  return valido ? `${y}-${m}-${d}` : null;
};
