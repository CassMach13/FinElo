import Papa from 'papaparse';
import { Transaction, MappingRule } from '../../types';

export interface NativeBankConfig {
  id: string;
  name: string;
  description: string;
  sourceType: 'Conta' | 'Cartao';
  isSupported: boolean;
  comingSoon?: boolean;
  // Visual branding (CSS, no external images needed)
  brandColor: string;        // e.g. '#FF8C00'
  brandColorSecondary: string;
  logoText: string;          // Short text or initials for the visual badge
  logoUrl?: string;          // Optional: URL to an official logo image
  // Parsing config
  delimiter: string;         // ',' | ';' | '' (auto)
  skipLines: number;
  hasHeader: boolean;
  dateColIndex: number;
  descColIndices: number[];
  valueColIndex: number;
  installmentsColIndex?: number;
  portadorColIndex?: number;
  invertValues: boolean;
  numberFormat?: 'US' | 'BR'; // BR: 1.234,56 | US: 1,234.56
  // Optional post-parse filters
  stopAtTextContaining?: string;
  ignoreRowsContaining?: string[];
  // Signature detection: unique header strings to auto-detect this bank's CSV
  signatureStrings?: string[];
}

export const NATIVE_BANK_CONFIGS: NativeBankConfig[] = [
  {
    id: 'banco-inter',
    name: 'Inter',
    description: 'Extrato de Conta Corrente / Conta Digital',
    sourceType: 'Conta',
    isSupported: true,
    brandColor: '#FF6B25',
    brandColorSecondary: '#FF8C4D',
    logoText: 'inter',
    delimiter: ';',
    skipLines: 5,
    hasHeader: true,
    // Row 5 (after skip): Data Lançamento;Histórico;Descrição;Valor;Saldo
    dateColIndex: 0,
    descColIndices: [1, 2],
    valueColIndex: 3,
    invertValues: false,
    ignoreRowsContaining: [],
    signatureStrings: ['Extrato Conta Corrente', 'Data Lançamento;Histórico;Descrição;Valor;Saldo'],
  },
  {
    id: 'banco-itau',
    name: 'Itaú',
    description: 'Extrato de Conta Corrente',
    sourceType: 'Conta',
    isSupported: true,
    brandColor: '#30338B',
    brandColorSecondary: '#EC7000',
    logoText: 'i',
    logoUrl: '/bank-logos/itau.png',
    delimiter: ';',
    skipLines: 9,
    hasHeader: true,
    // Row after skip: data;lançamento;ag./origem;valor (R$);saldos (R$)
    // But row 10 = "lançamentos;;;;", row 11 = SALDO ANTERIOR etc.
    // We skip 9 lines (rows 0-8), then row 9 = "lançamentos" header (used as hasHeader), then data
    dateColIndex: 0,
    descColIndices: [1],
    valueColIndex: 3,
    invertValues: false,
    stopAtTextContaining: 'lançamentos futuros',
    ignoreRowsContaining: ['SALDO', 'lançamentos', 'saídas'],
    signatureStrings: ['Logotipo Itaú', 'data;lançamento;ag./origem;valor (R$)'],
  },
  {
    id: 'banco-itau-personnalite',
    name: 'Itaú Personnalité',
    description: 'Extrato de Conta Corrente',
    sourceType: 'Conta',
    isSupported: true,
    brandColor: '#141414',
    brandColorSecondary: '#3a3a3a',
    logoText: 'P',
    logoUrl: '/bank-logos/itau-personnalite.svg',
    delimiter: ';',
    skipLines: 9,
    hasHeader: true,
    dateColIndex: 0,
    descColIndices: [1],
    valueColIndex: 3,
    invertValues: false,
    stopAtTextContaining: 'lançamentos futuros',
    ignoreRowsContaining: ['SALDO', 'lançamentos', 'saídas'],
    signatureStrings: ['Logotipo Itaú', 'data;lançamento;ag./origem;valor (R$)'],
  },
  {
    id: 'xp-conta',
    name: 'XP Investimentos',
    description: 'Extrato de Conta Corrente (XP)',
    sourceType: 'Conta',
    isSupported: true,
    brandColor: '#000000',
    brandColorSecondary: '#1A1A2E',
    logoText: 'XP',
    delimiter: ',',
    skipLines: 0,
    hasHeader: true,
    // Data;Hora;Descricao;Valor;Saldo
    dateColIndex: 0,
    descColIndices: [2],
    valueColIndex: 3,
    invertValues: false,
    ignoreRowsContaining: [],
    signatureStrings: ['Data;Hora;Descricao;Valor;Saldo'],
  },
  {
    id: 'caju',
    name: 'Caju',
    description: 'Extrato de Benefício (VA/VR)',
    sourceType: 'Conta',
    isSupported: true,
    brandColor: '#FF7500',
    brandColorSecondary: '#FF7500',
    logoText: 'caju',
    logoUrl: '/bank-logos/caju-icon.svg',
    delimiter: ',',
    skipLines: 0,
    hasHeader: true,
    // Data,Descrição,Valor
    dateColIndex: 0,
    descColIndices: [1],
    valueColIndex: 2,
    invertValues: false,
    ignoreRowsContaining: [],
    signatureStrings: ['Data,Descrição,Valor'],
  },
  {
    id: 'ticket',
    name: 'Ticket',
    description: 'Extrato de Benefício (VA/VR/Refeição)',
    sourceType: 'Conta',
    isSupported: true,
    brandColor: '#E31E2C',
    brandColorSecondary: '#FF4455',
    logoText: 'ticket',
    delimiter: ',',
    skipLines: 1,  // Skip the "Data,Descrição,Valor" header line (rows are double-quote wrapped, parsed by unwrapper)
    hasHeader: false,
    // After unwrapping: Data,Descrição,Valor
    dateColIndex: 0,
    descColIndices: [1],
    valueColIndex: 2,
    invertValues: false,
    ignoreRowsContaining: [],
    signatureStrings: ['Data,Descrição,Valor'],  // Same as Caju, differentiated by double-quote wrapping
  },
  {
    id: 'cartao-xp',
    name: 'Cartão de Crédito XP',
    description: 'Fatura do Cartão de Crédito XP',
    sourceType: 'Cartao',
    isSupported: true,
    brandColor: '#1A1A2E',
    brandColorSecondary: '#2D2D44',
    logoText: 'XP',
    delimiter: ';',
    skipLines: 0,
    hasHeader: true,
    // Data;Estabelecimento;Portador;Valor;Parcela
    dateColIndex: 0,
    descColIndices: [1],
    valueColIndex: 3,
    installmentsColIndex: 4,
    portadorColIndex: 2,
    invertValues: true,  // Positive values in bill = expenses
    ignoreRowsContaining: [],
    signatureStrings: ['Data;Estabelecimento;Portador;Valor;Parcela'],
  },
  {
    id: 'nubank-cartao',
    name: 'Cartão de Crédito Nubank',
    description: 'Fatura do Cartão de Crédito Nubank',
    sourceType: 'Cartao',
    isSupported: true,
    brandColor: '#8A05BE',
    brandColorSecondary: '#610188',
    logoText: 'Nu',
    logoUrl: '/bank-logos/nubank.png',
    delimiter: ',',
    skipLines: 0,
    hasHeader: true,
    // date,title,amount
    dateColIndex: 0,
    descColIndices: [1],
    valueColIndex: 2,
    invertValues: true, // Values in CSV: Positive = Expense, Negative = Payment/Refund
    numberFormat: 'US', // Uses 1234.56 format instead of 1.234,56
    ignoreRowsContaining: [],
    signatureStrings: ['date,title,amount'],
  },
];

// --- Helpers (duplicated from parserService to keep parsers self-contained) ---

const parseDate = (dateStr: string): Date | null => {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim().split(' ')[0];

  // Try DD/MM/YYYY or DD/MM/YY
  let parts = s.split('/');
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    let year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
    const date = new Date(year, month, day);
    if (!isNaN(date.getTime())) return date;
  }

  // Try YYYY-MM-DD
  parts = s.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const date = new Date(year, month, day);
    if (!isNaN(date.getTime())) return date;
  }

  return null;
};

const parseMonetaryValue = (valueStr: string, format: 'US' | 'BR' = 'BR'): number | null => {
  if (typeof valueStr !== 'string' || valueStr.trim() === '') return null;
  // Remove currency symbols, spaces, plus signs, "R$", etc.
  // Keep digits, comma, period, and leading minus
  const cleaned = valueStr
    .replace(/\+/g, '')
    .replace(/R\$/g, '')
    .replace(/\s/g, '')
    .trim();

  let withDecimalDot = cleaned;

  if (format === 'BR') {
    // Handle Brazilian format: 1.234,56 → 1234.56
    const withoutThousands = cleaned.replace(/\./g, '');
    withDecimalDot = withoutThousands.replace(',', '.');
  } else if (format === 'US') {
    // Handle US format: 1,234.56 → 1234.56
    withDecimalDot = cleaned.replace(/,/g, '');
  }

  const value = parseFloat(withDecimalDot);
  return isNaN(value) ? null : value;
};

const extractInstallments = (
  installStr: string,
  transactionDate?: Date
): { current?: number; total?: number; cleanedDesc: string } => {
  if (!installStr || installStr === '-' || installStr.trim() === '') {
    return { cleanedDesc: '' };
  }
  // Matches "X de Y" or "X/Y"
  const regex = /(\d{1,2})\s*(?:de|\/)\s*(\d{1,2})/i;
  const match = installStr.match(regex);
  if (match) {
    const current = parseInt(match[1], 10);
    const total = parseInt(match[2], 10);
    if (current > 0 && total > 0 && current <= total) {
      if (transactionDate) {
        const day = transactionDate.getDate();
        const month = transactionDate.getMonth() + 1;
        if (current === day && total === month) return { cleanedDesc: installStr };
      }
      return { current, total, cleanedDesc: installStr };
    }
  }
  return { cleanedDesc: installStr };
};

// --- Signature-based auto detection ---

/**
 * Given the raw text of a CSV file, tries to find a matching NativeBankConfig
 * by looking for signature strings in the first 15 lines.
 */
export function detectBankFromContent(content: string): NativeBankConfig | null {
  const firstLines = content.split(/[\r\n]+/).slice(0, 15).join('\n').toLowerCase();

  // Ticket has a very specific double-quote wrapping pattern, check first
  if (content.includes('"02/') || content.includes('"01/') || content.includes('"03/')) {
    // Ticket wraps full rows in outer quotes like: "02/01/2026,LOJA,...,"-R$101,77""
    const ticketPattern = /^"(\d{2}\/\d{2}\/\d{4}),/m;
    if (ticketPattern.test(content)) {
      return NATIVE_BANK_CONFIGS.find(b => b.id === 'ticket') || null;
    }
  }

  // Banco Inter: distinct header "Extrato Conta Corrente"
  if (firstLines.includes('extrato conta corrente')) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'banco-inter') || null;
  }

  // Banco Itaú: "Logotipo Itaú"
  if (firstLines.includes('logotipo itaú') || firstLines.includes('logotipo itau')) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'banco-itau') || null;
  }

  // Cartão XP: header "Data;Estabelecimento;Portador;Valor;Parcela"
  if (firstLines.includes('estabelecimento') && firstLines.includes('portador') && firstLines.includes('parcela')) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'cartao-xp') || null;
  }

  // XP Conta: header "Data;Hora;Descricao;Valor;Saldo"
  if (firstLines.includes('hora') && firstLines.includes('descricao')) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'xp-conta') || null;
  }

  // Caju: "Data,Descrição,Valor" with Portuguese accentuation + "Caiu Caju" or no double-quote rows
  if (firstLines.includes('descrição') && !ticketLinePattern(content)) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'caju') || null;
  }

  // Nubank: exact header "date,title,amount"
  if (firstLines.includes('date,title,amount')) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'nubank-cartao') || null;
  }

  return null;
}

function ticketLinePattern(content: string): boolean {
  return /^"(\d{2}\/\d{2}\/\d{4}),/m.test(content);
}

// --- Result types (match parserService) ---

interface ParseResult {
  newTransactions: Omit<Transaction, 'ID_Transacao'>[];
  successCount: number;
  ignoredCount: number;
  ignoredItems: any[];
}

// --- Main native parser ---

/**
 * Parses a CSV file using a pre-configured NativeBankConfig.
 * Returns the same ParseResult shape as parserService.processStatementFile.
 */
export function parseNativeBankCSV(
  rawContent: string,
  bankConfig: NativeBankConfig,
  existingTransactions: Transaction[],
  mappingRules: MappingRule[],
  paymentDate?: Date,
  fileName?: string
): ParseResult {
  const newTransactions: Omit<Transaction, 'ID_Transacao'>[] = [];
  const ignoredItems: any[] = [];
  let successCount = 0;
  let ignoredCount = 0;

  // Step 1: Pre-process — unwrap double-quoted lines (Ticket format)
  const lines = rawContent.split(/\r?\n/);
  const cleanedLines = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 2) {
      const unwrapped = trimmed.slice(1, -1).replace(/""/g, '"');
      if (unwrapped.includes(',') || unwrapped.includes(';')) {
        return unwrapped;
      }
    }
    return line;
  });
  const cleanedContent = cleanedLines.join('\n');

  // Step 2: Skip header lines
  const bodyLines = cleanedContent.split(/\r?\n/);
  const contentAfterSkip = bodyLines.slice(bankConfig.skipLines).join('\n');

  // Step 3: Parse CSV
  let delimiter = bankConfig.delimiter;

  // For XP Conta (comma-delimited), the actual values contain "R$ 1.234,56" which
  // needs careful handling — use Papa's auto-detect for comma files
  const parseResult = Papa.parse(contentAfterSkip, {
    header: false,
    skipEmptyLines: true,
    delimiter: delimiter || undefined,
  });

  let data = parseResult.data as string[][];

  // Retry if only 1 column detected
  if (data.length > 0 && data[0].length === 1) {
    const altDelimiter = delimiter === ';' ? ',' : ';';
    const retry = Papa.parse(contentAfterSkip, {
      header: false,
      skipEmptyLines: true,
      delimiter: altDelimiter,
    });
    if (retry.data && (retry.data[0] as string[]).length > 1) {
      data = retry.data as string[][];
    }
  }

  // Step 4: Determine start row (skip column headers if hasHeader=true)
  const startRow = bankConfig.hasHeader ? 1 : 0;
  let stopProcessing = false;

  for (let i = startRow; i < data.length; i++) {
    if (stopProcessing) break;

    const row = data[i];
    if (!row || row.length === 0) continue;

    // Row as concatenated string for filter checks
    const rowStr = row.map(c => String(c || '')).join(' ').toUpperCase();

    // Check stop condition
    if (bankConfig.stopAtTextContaining) {
      const stopUpper = bankConfig.stopAtTextContaining.toUpperCase();
      if (rowStr.includes(stopUpper)) {
        stopProcessing = true;
        continue;
      }
    }

    // Check ignore row conditions
    const shouldIgnore = (bankConfig.ignoreRowsContaining || []).some(pattern =>
      rowStr.includes(pattern.toUpperCase())
    );
    if (shouldIgnore) {
      ignoredCount++;
      ignoredItems.push({ Motivo: 'Linha ignorada (padrão de exclusão)', RawRow: rowStr });
      continue;
    }

    // Extract fields
    const rawDate = (row[bankConfig.dateColIndex] || '').trim();
    const rawValue = (row[bankConfig.valueColIndex] || '').trim();
    const rawDesc = bankConfig.descColIndices
      .map(idx => (row[idx] || '').trim())
      .filter(Boolean)
      .join(' - ');

    const rawPortador = bankConfig.portadorColIndex !== undefined
      ? (row[bankConfig.portadorColIndex] || '').trim()
      : undefined;

    const rawInstallments = bankConfig.installmentsColIndex !== undefined
      ? (row[bankConfig.installmentsColIndex] || '').trim()
      : '';

    // Parse
    const cleanedDate = parseDate(rawDate);
    const cleanedValue = parseMonetaryValue(rawValue, bankConfig.numberFormat);

    // Skip rows that can't be parsed as valid transactions
    if (!cleanedDate || cleanedValue === null || !rawDesc) {
      continue;
    }

    // Installments
    const installInfo = extractInstallments(rawInstallments, cleanedDate);

    // Value direction
    let finalValue = cleanedValue;
    let finalType: 'Renda' | 'Despesa';

    if (bankConfig.invertValues) {
      finalValue = -cleanedValue;
    }
    finalType = finalValue >= 0 ? 'Renda' : 'Despesa';

    // Apply mapping rules
    let suggestedName = rawDesc;
    let suggestedCategory = '-';
    for (const rule of mappingRules) {
      if (rawDesc.toUpperCase().includes(rule.Texto_Contido_Descricao.toUpperCase())) {
        suggestedName = rule.Nome_Fantasia_Sugerido;
        suggestedCategory = rule.Categoria_Sugerida;
        break;
      }
    }

    newTransactions.push({
      Data: cleanedDate,
      Data_Pagamento: paymentDate || cleanedDate,
      Descricao_Original: rawDesc,
      Nome_Fantasia: suggestedName,
      Parcela_Atual: installInfo.current,
      Total_Parcelas: installInfo.total,
      Portador: rawPortador || undefined,
      Valor: finalValue,
      Tipo: finalType,
      Categoria: suggestedCategory,
      Fonte: bankConfig.name,
      Origem: fileName || bankConfig.name,
    });

    successCount++;
  }

  return { newTransactions, successCount, ignoredCount, ignoredItems };
}
