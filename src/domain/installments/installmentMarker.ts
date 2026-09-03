/**
 * Lê o marcador de parcela que vem escrito na própria descrição — "2/6",
 * "(2/6)", "2 de 6".
 *
 * ===========================================================================
 * DE ONDE ISTO VEIO
 * ===========================================================================
 *
 * Esta função é a que já existia em `parserService`, movida para cá sem uma
 * vírgula de diferença. O regex e as duas validações são os mesmos que vinham
 * classificando parcelas na importação manual; o que mudou foi só o endereço,
 * para que o parser nativo possa usar exatamente a mesma leitura em vez de
 * ganhar um segundo regex concorrente.
 *
 * ===========================================================================
 * POR QUE ANCORAR NO FIM É O QUE TORNA ISTO SEGURO
 * ===========================================================================
 *
 * `X/Y` aparece o tempo todo em descrição de extrato — e quase sempre é DATA,
 * não parcela: "SPOTIFY 10/12", "PIX FULANO 15/07". Medido na base real, em
 * conta corrente 416 descrições terminam em algo com essa forma, e a enorme
 * maioria é data. O que segura isso são três coisas, nesta ordem:
 *
 *   1. o marcador tem que estar no FIM da descrição (casar em qualquer
 *      posição multiplicaria os falsos positivos);
 *   2. `atual > total` derruba a data comum — "15/07" vira 15 > 7 e cai;
 *   3. se os números baterem exatamente com dia/mês da própria transação,
 *      é data repetida na descrição, não parcela.
 *
 * Mesmo assim isto NÃO é confiável em conta corrente: 39 descrições reais
 * passariam pelas três guardas e 34 delas têm cara de data. Em fatura de
 * cartão o quadro se inverte — nas 103 descrições reais de cartão que casam,
 * as guardas derrubaram 1, e onde o emissor também informa a parcela em
 * campo próprio o texto concordou com o campo em 35 de 35 casos.
 *
 * Por isso quem chama decide: o parser nativo só usa isto quando a config do
 * emissor declara `installmentsFromDescription`, e nunca por cima de um campo
 * explícito que o próprio arquivo já trouxe.
 */

export interface InstallmentMarker {
  current?: number;
  total?: number;
  cleanedDescription: string;
}

// Helper to find and extract installment info like "1/12" from a string
export const extractInstallments = (
  description: string,
  transactionDate?: Date
): InstallmentMarker => {
  const regex = /\s*\(?(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\)?\s*$/; // Matches (X/Y) or (X de Y) at the end of the string
  const match = description.match(regex);

  if (match) {
    const current = parseInt(match[1], 10);
    const total = parseInt(match[2], 10);

    // Validação 1: Parcela atual não pode ser maior que o total, e ambos devem ser > 0.
    if (current > total || current === 0 || total === 0) {
      return { cleanedDescription: description };
    }

    // Validação 2: Se os números correspondem exatamente ao Dia/Mês da transação,
    // é muito provável que seja a data repetida na descrição (ex: 01/04 em 01 de Abril), e não uma parcela.
    if (transactionDate) {
      const day = transactionDate.getDate();
      const month = transactionDate.getMonth() + 1; // 0-indexed
      if (current === day && total === month) {
        return { cleanedDescription: description };
      }
    }

    return {
      current,
      total,
      cleanedDescription: description.replace(regex, '').trim()
    };
  }
  return { cleanedDescription: description };
}
