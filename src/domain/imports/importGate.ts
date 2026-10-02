/**
 * Decide o que a tela Importar mostra em relação à cota mensal do plano gratuito.
 *
 * A regra comercial não muda: sem plano pago, 1 importação por mês. O que este módulo resolve é a
 * ordem: usar a última importação do mês não pode apagar o aviso de sucesso da importação que
 * acabou de acontecer. O bloqueio volta a valer assim que a pessoa sai da tela.
 */
export const FREE_MONTHLY_IMPORT_LIMIT = 1;

export interface ImportSuccessSummary {
  imported: number;
  ignored: number;
}

export interface ImportGateInput {
  isPremium: boolean;
  /** Importações do mês corrente, já contando a que acabou de ser gravada. */
  importsThisMonth: number;
  /** Resultado da importação feita agora nesta tela; nulo se nada foi importado desde que abriu. */
  lastSuccess?: ImportSuccessSummary | null;
}

export interface ImportGate {
  /** Sem plano pago e sem importações restantes no mês. */
  quotaExhausted: boolean;
  /** Mostra o cartão "Limite Gratuito Atingido" no lugar da tela. */
  showLimitBlock: boolean;
  /** A cota acabou de ser usada: só o painel de sucesso aparece, não a lista de bancos. */
  successOnly: boolean;
  /** "Importar outro arquivo" só faz sentido se ainda dá para importar. */
  canImportAnother: boolean;
}

/** Só conta como sucesso quando entrou ao menos uma transação. */
export const hasImportSucceeded = (summary?: ImportSuccessSummary | null): boolean =>
  Boolean(summary && summary.imported > 0);

export function getImportGate({ isPremium, importsThisMonth, lastSuccess }: ImportGateInput): ImportGate {
  const quotaExhausted = !isPremium && importsThisMonth >= FREE_MONTHLY_IMPORT_LIMIT;
  const succeeded = hasImportSucceeded(lastSuccess);
  return {
    quotaExhausted,
    showLimitBlock: quotaExhausted && !succeeded,
    successOnly: quotaExhausted && succeeded,
    canImportAnother: !quotaExhausted,
  };
}
