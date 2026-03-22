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
  creditColIndex?: number;    // NEW: Index for Credit column (if separate)
  debitColIndex?: number;     // NEW: Index for Debit column (if separate)
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
    logoUrl: '/bank-logos/inter.png',
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
    logoUrl: '/bank-logos/xp.png',
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
    logoUrl: '/bank-logos/caju.png',
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
    id: 'flash-beneficios',
    name: 'Flash Benefícios',
    description: 'Extrato de Benefício (VA/VR/Flex)',
    sourceType: 'Conta',
    isSupported: true,
    brandColor: '#FE2E8D',          // Vibrant hot pink/magenta from website
    brandColorSecondary: '#E81A78',
    logoText: 'FL',
    logoUrl: '/bank-logos/flash.png',
    delimiter: ',',
    skipLines: 0,
    hasHeader: true,
    // Same Data,Descrição,Valor structure as Caju
    dateColIndex: 0,
    descColIndices: [1],
    valueColIndex: 2,
    invertValues: false,
    ignoreRowsContaining: [],
    // Flash exports include "Flash" or "flash" in the filename or first lines
    signatureStrings: ['flash', 'Data,Descrição,Valor'],
  },
  {
    id: 'ifood-beneficios',
    name: 'iFood Benefícios',
    description: 'Extrato de Benefício iFood',
    sourceType: 'Conta',
    isSupported: true,
    brandColor: '#5b0b1a',          // Official dark wine/burgundy from website
    brandColorSecondary: '#8a1428',
    logoText: 'iF',
    logoUrl: '/bank-logos/ifood.png',
    delimiter: ',',
    skipLines: 0,
    hasHeader: true,
    // Same Data,Descrição,Valor structure as Caju
    dateColIndex: 0,
    descColIndices: [1],
    valueColIndex: 2,
    invertValues: false,
    ignoreRowsContaining: [],
    signatureStrings: ['ifood', 'Data,Descrição,Valor'],
  },
  {
    id: 'vr-beneficios',
    name: 'VR Benefícios',
    description: 'Extrato de Benefício (VA/VR/Refeição)',
    sourceType: 'Conta',
    isSupported: true,
    brandColor: '#00BE28',          // Vibrant green
    brandColorSecondary: '#00A623',
    logoText: 'VR',
    logoUrl: '/bank-logos/vr.png',
    delimiter: ',',
    skipLines: 0,
    hasHeader: true,
    // Same Data,Descrição,Valor structure as Caju
    dateColIndex: 0,
    descColIndices: [1],
    valueColIndex: 2,
    invertValues: false,
    ignoreRowsContaining: [],
    signatureStrings: ['vr beneficios', 'vr refeição', 'Data,Descrição,Valor'],
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
    logoUrl: '/bank-logos/ticket.png',
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
    logoUrl: '/bank-logos/xp.png',
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
  {
    id: 'banco-santander',
    name: 'Santander',
    description: 'Extrato de Conta Corrente (XLS)',
    sourceType: 'Conta',
    isSupported: true,
    brandColor: '#EC0000',      // Santander Red
    brandColorSecondary: '#CC0000',
    logoText: 'S',
    logoUrl: '/bank-logos/santander.png',
    delimiter: ';',
    skipLines: 0,               // Changed to 0: will seek for header instead
    hasHeader: true,
    dateColIndex: 0,
    descColIndices: [1],
    valueColIndex: 5,           // Default to debit col
    creditColIndex: 4,
    debitColIndex: 5,
    invertValues: false,
    signatureStrings: ['EXTRATO DE CONTA CORRENTE', 'Crédito (R$)', 'Débito (R$)'],
  },
  {
    id: 'nubank-conta',
    name: 'NuBank',
    description: 'Extrato de Conta Corrente / NuConta',
    sourceType: 'Conta',
    isSupported: true,
    brandColor: '#8A05BE',
    brandColorSecondary: '#610188',
    logoText: 'Nu',
    logoUrl: '/bank-logos/nubank.png',
    delimiter: ',',
    skipLines: 0,
    hasHeader: true,
    dateColIndex: 0,
    descColIndices: [3],
    valueColIndex: 1,
    invertValues: false,
    numberFormat: 'US',
    signatureStrings: ['Data,Valor,Identificador,Descrição'],
  },
  {
    id: 'mercado-pago',
    name: 'Mercado Pago',
    description: 'Extrato de Conta Digital Mercado Pago',
    sourceType: 'Conta',
    isSupported: true,
    brandColor: '#00B1EA',      // Mercado Pago blue
    brandColorSecondary: '#009ECC',
    logoText: 'MP',
    logoUrl: '/bank-logos/mercadopago.png',
    delimiter: ';',
    skipLines: 3,               // Skip 2 summary rows + 1 blank row; row 4 = header
    hasHeader: true,
    // Header: RELEASE_DATE;TRANSACTION_TYPE;REFERENCE_ID;TRANSACTION_NET_AMOUNT;PARTIAL_BALANCE
    dateColIndex: 0,
    descColIndices: [1],
    valueColIndex: 3,
    invertValues: false,        // Values already signed: positive = credit, negative = debit
    numberFormat: 'US',         // Integer values in this sample, but treat as US to be safe
    ignoreRowsContaining: [],
    signatureStrings: ['INITIAL_BALANCE', 'RELEASE_DATE', 'TRANSACTION_NET_AMOUNT'],
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
  
  // Extrai apenas números, ',', '.' e o sinal de '-'
  const cleaned = valueStr.replace(/[^\d,.-]/g, '');
  
  // Se o formato for explicitamente US ou BR, seguimos a regra fixa
  if (format === 'BR') {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  }
  if (format === 'US') {
    return parseFloat(cleaned.replace(/,/g, ''));
  }

  // Caso contrário, usamos a heurística inteligente
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  
  let normalized = cleaned;
  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    normalized = cleaned.replace(/,/g, '');
  } else {
    if (lastComma !== -1) {
      normalized = cleaned.replace(',', '.');
    } else if (lastDot !== -1) {
      const parts = cleaned.split('.');
      if (parts[parts.length - 1].length === 2) {
        normalized = cleaned;
      } else {
        normalized = cleaned.replace(/\./g, '');
      }
    }
  }

  const value = parseFloat(normalized);
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

  // 1. Santander: "EXTRATO DE CONTA CORRENTE" (Very specific)
  if (firstLines.includes('extrato de conta corrente') || (firstLines.includes('crédito (r$)') && firstLines.includes('débito (r$)'))) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'banco-santander') || null;
  }

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

  // Flash / iFood / VR / Caju all share "Data,Descrição,Valor" format.
  // Detect by brand keyword first (from filename hints embedded in content or row data).
  const fullContentLower = content.toLowerCase();

  // Flash Benefícios: content or filename mentions "flash"
  if ((firstLines.includes('flash') || fullContentLower.includes('flash beneficios') || fullContentLower.includes('flash benefícios'))) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'flash-beneficios') || null;
  }

  // iFood Benefícios: content mentions "ifood"
  if (firstLines.includes('ifood') || firstLines.includes('ifood beneficios') || firstLines.includes('ifood benefícios')) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'ifood-beneficios') || null;
  }

  // VR Benefícios: content mentions "vr" in a benefits context
  if (firstLines.includes('vr beneficios') || firstLines.includes('vr refeição') || firstLines.includes('vr alimentacao')) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'vr-beneficios') || null;
  }

  // Caju: fallback for generic Data,Descrição,Valor (also handles Ticket via double-quote detection above)
  if (firstLines.includes('data,descrição,valor') || firstLines.includes('data,descricão,valor') || (firstLines.includes('descrição') && firstLines.includes('caju'))) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'caju') || null;
  }

  // Nubank Account: "Data,Valor,Identificador,Descrição"
  if (firstLines.includes('data,valor,identificador,descrição') || firstLines.includes('data,valor,identificador,descricao')) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'nubank-conta') || null;
  }

  // Mercado Pago: unique headers "INITIAL_BALANCE" and "RELEASE_DATE;TRANSACTION_TYPE"
  if (firstLines.includes('initial_balance') && firstLines.includes('release_date')) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'mercado-pago') || null;
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

  // Step 4: Determine start row
  let startRow = bankConfig.hasHeader ? 1 : 0;
  let dataToProcess = data;

  // AUTO-SEEK HEADER: If bank is Santander or has many skip lines potentially, verify the header row
  if (bankConfig.id === 'banco-santander') {
    // Look for the row that contains "Data" and "Descrição"
    const headerIdx = data.findIndex(row => 
      row.some(cell => String(cell).toLowerCase().includes('data')) && 
      row.some(cell => String(cell).toLowerCase().includes('descrição'))
    );
    if (headerIdx !== -1) {
      startRow = headerIdx + 1;
    }
  }

  let stopProcessing = false;

  for (let i = startRow; i < dataToProcess.length; i++) {
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

    // Handle single vs separate credit/debit columns
    let rawValue = (row[bankConfig.valueColIndex] || '').trim();
    if (bankConfig.creditColIndex !== undefined || bankConfig.debitColIndex !== undefined) {
      const rawCredit = bankConfig.creditColIndex !== undefined ? (row[bankConfig.creditColIndex] || '').trim() : '';
      const rawDebit = bankConfig.debitColIndex !== undefined ? (row[bankConfig.debitColIndex] || '').trim() : '';
      
      // Heuristic: Use whichever has a value (non-zero/non-empty)
      if (rawCredit && rawCredit !== '0,00' && rawCredit !== '0.00' && rawCredit !== '0') {
        rawValue = rawCredit;
      } else if (rawDebit && rawDebit !== '0,00' && rawDebit !== '0.00' && rawDebit !== '0') {
        rawValue = rawDebit;
      }
    }

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
