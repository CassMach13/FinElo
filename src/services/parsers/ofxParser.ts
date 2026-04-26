import { Transaction } from '../../types';

/**
 * Basic OFX/OFC parser using regex.
 * Handles SGML-style tags (unclosed) commonly found in bank exports.
 */
export const parseOFX = (text: string, fileName: string = 'OFX Import'): Omit<Transaction, 'ID_Transacao'>[] => {
  const transactions: Omit<Transaction, 'ID_Transacao'>[] = [];
  
  // Extract all <STMTTRN> blocks
  const stmttrnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match;

  while ((match = stmttrnRegex.exec(text)) !== null) {
    const block = match[1];

    // Helper to extract value from tag (handles both closed and unclosed tags)
    const getTagValue = (tag: string) => {
      const regex = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i');
      const m = block.match(regex);
      return m ? m[1].trim() : '';
    };

    const rawDate = getTagValue('DTPOSTED');
    const rawAmount = getTagValue('TRNAMT');
    const rawMemo = getTagValue('MEMO');
    const rawName = getTagValue('NAME');

    // Parse Date: YYYYMMDD...
    let date: Date | null = null;
    if (rawDate && rawDate.length >= 8) {
      const y = parseInt(rawDate.substring(0, 4), 10);
      const m = parseInt(rawDate.substring(4, 6), 10) - 1;
      const d = parseInt(rawDate.substring(6, 8), 10);
      date = new Date(y, m, d);
    }

    // Parse Amount
    const amount = parseFloat(rawAmount.replace(',', '.'));

    // Combine Name and Memo for description
    const description = [rawName, rawMemo].filter(Boolean).join(' - ') || 'Transação OFX';

    if (date && !isNaN(date.getTime()) && !isNaN(amount)) {
      transactions.push({
        Data: date,
        Data_Pagamento: date,
        Descricao_Original: description,
        Nome_Fantasia: description,
        Valor: amount,
        Tipo: amount >= 0 ? 'Renda' : 'Despesa',
        Categoria: '-',
        Fonte: fileName,
        Origem: fileName,
        Portador: undefined
      });
    }
  }

  return transactions;
};
