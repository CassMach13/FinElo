import Papa from 'papaparse';
import { Transaction, MappingRule } from '../../types';
import { parseCreditCardFileTotals } from '../../utils/parseCreditCardFileTotals';
import { parseOFX } from './ofxParser';

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
  typeColIndex?: number;      // NEW: Index for Type column (C/D or similar)
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
    brandColor: '#0F172A',      // Premium dark navy background
    brandColorSecondary: '#1E293B',
    logoText: 'itaú',
    logoUrl: '/bank-logos/itau-personnalite.png',
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
    description: 'Extrato de Conta Corrente',
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
    description: 'Extrato de Benefício',
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
    description: 'Fatura do Cartão de Crédito',
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
    description: 'Fatura do Cartão de Crédito',
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
    description: 'Extrato de Conta Corrente',
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
    description: 'Extrato de Conta Corrente / Conta Digital',
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
    description: 'Extrato de Conta Digital',
    sourceType: 'Conta',
    isSupported: true,
    brandColor: '#009EE3',      // Mercado Pago blue (app icon)
    brandColorSecondary: '#0088CC',
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
  {
    id: 'picpay',
    name: 'PicPay',
    description: 'Extrato de Conta Corrente / Carteira Digital',
    sourceType: 'Conta',
    isSupported: true,
    brandColor: '#38B160',      // Vibrant green PicPay
    brandColorSecondary: '#2E914F',
    logoText: 'PP',
    logoUrl: '/bank-logos/picpay.png',
    delimiter: ',',
    skipLines: 0,
    hasHeader: true,
    // Header format from Gemini conversion: Data,Hora,Tipo,Origem/Destino,Forma de pagamento,Valor
    dateColIndex: 0,
    descColIndices: [2, 3],     // Tipo + Origem/Destino combine well for description
    valueColIndex: 5,
    invertValues: false,        // Expenses are already negative format "-R$110,00"
    ignoreRowsContaining: [],
    signatureStrings: ['Data,Hora,Tipo,Origem/Destino,Forma de pagamento,Valor', 'picpay'],
  },
  {
    // Bradesco: detecta automaticamente CSV/XLSX (col R$=3) e XLS Internet Banking (col R$=4)
    // Múltiplos portadores num mesmo arquivo — o parser faz auto-seek de header
    id: 'bradesco-cartao',
    name: 'Cartão de Crédito Bradesco',
    description: 'Fatura do Cartão de Crédito Bradesco',
    sourceType: 'Cartao',
    isSupported: true,
    brandColor: '#CC092F',           // Vermelho oficial Bradesco
    brandColorSecondary: '#B81570',  // Magenta do gradiente do header
    logoText: 'bradesco',
    logoUrl: '/bank-logos/bradesco.png',
    delimiter: ';',
    skipLines: 0,
    hasHeader: true,
    // Layout CSV/XLSX: Data | Histórico | Valor(US$) | Valor(R$)
    // Layout XLS:      Data | Histórico | (vazio)    | Valor (US$) | Valor(R$)
    // O parser deteta dinamicamente o índice correto via auto-seek de header
    dateColIndex: 0,
    descColIndices: [1],
    valueColIndex: 3,               // Default para CSV/XLSX; XLS será ajustado pelo parser
    invertValues: true,             // Positivo na fatura = despesa
    numberFormat: 'BR',
    ignoreRowsContaining: [
      'SALDO ANTERIOR',
      'PAGTO. POR DEB',
      'Total da fatura',
      'Total para',
      'Bradesco Internet Banking',
      'Resumo das Despesas',
      'Saldo Anterior',
      'Pagamentos',
      'Despesas locais',
      'Despesas no exterior',
      'Cotação do dólar',
      'Fatura em Aberto',
      'Situação da Fatura',
      'Taxas',
      'Descrição',
      'Pagamento de contas',
      'Parcelamento de fatura',
      'Compras parceladas',
      'Rotativo',
      'Saque',
      'Crediário',
      'Pagamento Mínimo',
    ],
    signatureStrings: ['Situação da Fatura', 'Valor(US$)', 'Bradesco Internet Banking'],
  },
  {
    id: 'banco-do-brasil',
    name: 'Banco do Brasil',
    description: 'Extrato de Conta Corrente',
    sourceType: 'Conta',
    isSupported: true,
    brandColor: '#FBCA00',
    brandColorSecondary: '#0038A8',
    logoText: 'BB',
    logoUrl: '/bank-logos/banco-do-brasil.png',
    delimiter: ',',
    skipLines: 0,
    hasHeader: true,
    dateColIndex: 0,
    descColIndices: [2],
    valueColIndex: 5,
    invertValues: false,
    ignoreRowsContaining: ['SALDO ANTERIOR', 'S A L D O'],
    signatureStrings: ['dependencia origem', 'data do balancete', 'banco do brasil'],
  },
  {
    id: 'caixa',
    name: 'Caixa Econômica Federal',
    description: 'Extrato de Conta Corrente / Poupança',
    sourceType: 'Conta',
    isSupported: true,
    brandColor: '#005CA9',      // Official Caixa Blue
    brandColorSecondary: '#F58220', // Official Caixa Orange
    logoText: 'caixa',
    logoUrl: '/bank-logos/caixa.png',
    delimiter: ';',
    skipLines: 0,
    hasHeader: true,
    dateColIndex: 1,
    descColIndices: [3],
    valueColIndex: 4,
    typeColIndex: 5,            // Column with 'C' (Credit) or 'D' (Debit)
    invertValues: false,
    signatureStrings: ['CAIXA ECONOMICA FEDERAL', '<STMTTRN>', 'ofx', 'Data_Mov', 'Nr_Doc'],
  },
];

// --- Helpers (duplicated from parserService to keep parsers self-contained) ---

const parseDate = (dateStrInput: string | number): Date | null => {
  if (dateStrInput === null || dateStrInput === undefined) return null;
  
  const dateStr = String(dateStrInput).trim();
  if (dateStr === '') return null;

  // 1. Resiliência Universal: Tratamento de Datas Cruas do Excel.
  const numericDate = Number(dateStr.replace(',', '.'));
  if (!isNaN(numericDate) && numericDate > 10000 && numericDate < 90000) {
    const utcDays = Math.floor(numericDate) - 25569;
    const utcDate = new Date(utcDays * 86400 * 1000);
    const year = utcDate.getUTCFullYear();
    const month = utcDate.getUTCMonth();
    const day = utcDate.getUTCDate();
    return new Date(year, month, day);
  }

  const s = dateStr.split(' ')[0];

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

const parseMonetaryValue = (valueStr: string, format?: 'US' | 'BR'): number | null => {
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

  // Caso contrário, usamos a heurística inteligente (Melhorada para evitar erros em "4.70" no padrão BR)
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  
  let normalized = cleaned;
  if (lastComma > lastDot) {
    // Estilo Brasileiro completo: 1.234,56
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    // Estilo Americano completo: 1,234.56
    normalized = cleaned.replace(/,/g, '');
  } else {
    // Apenas um tipo de separador (ou nenhum)
    if (lastComma !== -1) {
      // "1234,56" -> "1234.56"
      normalized = cleaned.replace(',', '.');
    } else if (lastDot !== -1) {
      // Pode ser decimal "1234.56" ou milhar "1.234"
      // Se houver exatamente 2 dígitos após o ponto no final da string, assumimos que é decimal
      const parts = cleaned.split('.');
      if (parts[parts.length - 1].length === 2) {
        normalized = cleaned; // Já é decimal
      } else {
        // Provavelmente milhar ou formato sem centavos (ex: "1.000")
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

  // Bradesco: detecta ambos os formatos (XLS Internet Banking e CSV/XLSX padrão)
  if (
    firstLines.includes('bradesco internet banking') ||
    (firstLines.includes('situação da fatura') && (firstLines.includes('valor(us$)') || firstLines.includes('valor(r$)')))
  ) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'bradesco-cartao') || null;
  }

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

  // XP Conta: header "Data;Hora;Descricao;Valor;Saldo" (CSV) ou "Movimentação;Liquidação;Lançamento" (XLSX)
  if ((firstLines.includes('hora') && firstLines.includes('descricao')) || (firstLines.includes('movimentação') && firstLines.includes('lançamento') && firstLines.includes('conta xp'))) {
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

  // PicPay: unique header from Gemini conversion
  if (firstLines.includes('data,hora,tipo,origem/destino,forma de pagamento,valor') || firstLines.includes('picpay')) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'picpay') || null;
  }

  // Banco do Brasil: "Dependência Origem" or "Data do Balancete"
  if (firstLines.includes('dependencia origem') || firstLines.includes('data do balancete') || firstLines.includes('banco do brasil')) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'banco-do-brasil') || null;
  }

  // Caixa Econômica Federal: "CAIXA ECONOMICA FEDERAL" or OFX signature
  if (firstLines.includes('caixa economica federal') || firstLines.includes('<stmttrn>') || firstLines.includes('<ofx>')) {
    return NATIVE_BANK_CONFIGS.find(b => b.id === 'caixa') || null;
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
  /** Totais do rodapé da fatura (cartão), quando detectados no arquivo. */
  creditCardFileTotals?: { statementTotal?: number; totalPayments?: number };
}

// --- Main native parser ---

/**
 * Parses a CSV file using a pre-configured NativeBankConfig.
 * Returns the same ParseResult shape as parserService.processStatementFile.
 */
export function parseNativeBankCSV(
  rawContent: string,
  bankConfigParam: NativeBankConfig,
  existingTransactions: Transaction[],
  mappingRules: MappingRule[],
  paymentDate?: Date,
  fileName?: string
): ParseResult {
  // Copia segura para podermos sobrescrever as regras dinamicamente sem alterar a global
  const bankConfig = { ...bankConfigParam };

  const newTransactions: Omit<Transaction, 'ID_Transacao'>[] = [];
  const ignoredItems: any[] = [];
  let successCount = 0;
  let ignoredCount = 0;
  let data: string[][] = [];

  // Step 1: Detect if it's an OFX/OFC file and handle it with dedicated parser
  const isOFX = rawContent.includes('<STMTTRN>') || (fileName && (fileName.toLowerCase().endsWith('.ofx') || fileName.toLowerCase().endsWith('.ofc')));
  
  if (isOFX) {
    const ofxTransactions = parseOFX(rawContent, fileName || bankConfig.name);
    
    // Apply mapping rules
    const mappedTransactions = ofxTransactions.map(tx => {
      let suggestedName = tx.Descricao_Original;
      let suggestedCategory = '-';
      for (const rule of mappingRules) {
        if (tx.Descricao_Original.toUpperCase().includes(rule.Texto_Contido_Descricao.toUpperCase())) {
          suggestedName = rule.Nome_Fantasia_Sugerido;
          suggestedCategory = rule.Categoria_Sugerida;
          break;
        }
      }
      return { ...tx, Nome_Fantasia: suggestedName, Categoria: suggestedCategory, Fonte: bankConfig.name };
    });

    return { 
      newTransactions: mappedTransactions, 
      successCount: mappedTransactions.length, 
      ignoredCount: 0, 
      ignoredItems: [] 
    };
  }

  // Step 2: Pre-process CSV — unwrap double-quoted lines (Ticket format)
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

  // IMPORTANT: Se o arquivo veio convertido do Excel (.xlsx/.xls), 
  // o nosso `convertExcelToCSV` sempre gera um CSV separado por `;` com decimais em `,`.
  // Devemos forçar o PapaParse a respeitar o `;`, independentemente do que o bankConfig pede (pois o original não era CSV).
  if (fileName && (fileName.toLowerCase().endsWith('.xlsx') || fileName.toLowerCase().endsWith('.xls'))) {
    delimiter = ';';
  }

  const parseResult = Papa.parse(contentAfterSkip, {
    header: false,
    skipEmptyLines: true,
    delimiter: delimiter || undefined,
  });

  data = parseResult.data as string[][];


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

  // AUTO-SEEK HEADER: If bank is Santander, look for the row that contains "Data" and "Descrição"
  if (bankConfig.id === 'banco-santander') {
    const headerIdx = data.findIndex(row =>
      row.some(cell => String(cell).toLowerCase().includes('data')) &&
      row.some(cell => String(cell).toLowerCase().includes('descrição'))
    );
    if (headerIdx !== -1) {
      startRow = headerIdx + 1;
    }
  }

  // AUTO-SEEK HEADER: XP Conta can be CSV (Data, Descrição) or XLSX (Movimentação, Lançamento)
  if (bankConfig.id === 'xp-conta') {
    const headerIdx = data.findIndex(row =>
      row.some(cell => String(cell).toLowerCase().includes('movimentação')) &&
      row.some(cell => String(cell).toLowerCase().includes('lançamento'))
    );
    if (headerIdx !== -1) {
      startRow = headerIdx + 1;
      const headerRow = data[headerIdx];
      const movIdx = headerRow.findIndex(cell => String(cell).toLowerCase().includes('movimentação'));
      const lanIdx = headerRow.findIndex(cell => String(cell).toLowerCase().includes('lançamento'));
      const valIdx = headerRow.findIndex(cell => String(cell).toLowerCase().includes('valor'));
      if (movIdx !== -1) bankConfig.dateColIndex = movIdx;
      if (lanIdx !== -1) bankConfig.descColIndices = [lanIdx];
      if (valIdx !== -1) bankConfig.valueColIndex = valIdx;
    }
  }

  // BRADESCO: Parser especial multi-portador.
  // O arquivo contém múltiplos blocos de portador, cada um com sua própria linha de header.
  // Percorremos TODAS as linhas e rastreamos o portador atual dinamicamente.
  // O índice da coluna de valor (R$) é ajustado dinamicamente: CSV/XLSX=3, XLS Internet Banking=4
  if (bankConfig.id === 'bradesco-cartao') {
    const bradTransactions: Omit<Transaction, 'ID_Transacao'>[] = [];
    let currentPortador: string | undefined = undefined;

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      const rowStr = row.map(c => String(c || '')).join(' ').toUpperCase();

      // Detecta linha de header (contém 'Histórico')
      const isHeaderRow = row.some(cell =>
        String(cell).toLowerCase().includes('histórico') || String(cell).toLowerCase().includes('historico')
      );
      if (isHeaderRow) {
        // Ajusta dinamicamente o índice da coluna de valor (R$) com base no header real
        const valRidx = row.findIndex(cell => {
          const c = String(cell);
          return c.includes('Valor(R$)') || c.includes('Valor (R$)') || c.toLowerCase().includes('valor(r$)') || c.toLowerCase().includes('valor (r$)');
        });
        if (valRidx !== -1) bankConfig.valueColIndex = valRidx;
        continue;
      }

      // Detecta linha de portador: primeira célula é texto (sem data) e demais células são vazias ou números do cartão
      const firstCell = String(row[0] || '').trim();
      const isDateLike = /^\d{2}[/\-.]/.test(firstCell) || (typeof row[0] === 'number' && row[0] > 10000);
      const hasPortadorMarker = firstCell.length > 3 && !isDateLike &&
        row.slice(1).every(c => !String(c).trim() || /^\d+$/.test(String(c).trim()));
      if (hasPortadorMarker && firstCell !== '') {
        const portadorMatch = firstCell.match(/^(.+?)(?:\s*[-;]+\s*|\s+)(\d{3,4})\s*$/);
        if (portadorMatch) {
          currentPortador = `${portadorMatch[1].trim()} (${portadorMatch[2]})`;
        } else if (!/^\d/.test(firstCell)) {
          currentPortador = firstCell;
        }
        continue;
      }

      // Verifica linhas que devem ser ignoradas
      const shouldIgnore = (bankConfig.ignoreRowsContaining || []).some(pattern =>
        rowStr.includes(pattern.toUpperCase())
      );
      if (shouldIgnore) {
        ignoredCount++;
        ignoredItems.push({ Motivo: 'Linha ignorada (padrão de exclusão)', RawRow: rowStr });
        continue;
      }

      const rawDate = String(row[bankConfig.dateColIndex] || '').trim();
      const rawDesc = bankConfig.descColIndices
        .map(idx => String(row[idx] || '').trim())
        .filter(Boolean)
        .join(' - ');
      const rawValue = String(row[bankConfig.valueColIndex] || '').trim();

      const cleanedDate = parseDate(rawDate);
      const cleanedValue = parseMonetaryValue(rawValue, bankConfig.numberFormat);

      if (!cleanedDate || cleanedValue === null || !rawDesc) {
        const hasSignals = row.some((c) => String(c ?? '').trim().length > 0);
        if (hasSignals) {
          ignoredCount++;
          ignoredItems.push({
            Motivo: [
              '[Bradesco]',
              !rawDesc ? 'sem descrição' : '',
              !cleanedDate ? 'data inválida ou vazia' : '',
              cleanedValue === null ? 'valor não interpretado pelo parser (formato/decimais)' : '',
              'esta linha NÃO gerou lançamento no FinElo.',
            ]
              .filter(Boolean)
              .join(' · '),
            RawRow: rowStr.slice(0, 450),
          });
        }
        continue;
      }
      const finalValue = bankConfig.invertValues ? -cleanedValue : cleanedValue;
      const finalType: 'Renda' | 'Despesa' = finalValue >= 0 ? 'Renda' : 'Despesa';

      let suggestedName = rawDesc;
      let suggestedCategory = '-';
      for (const rule of mappingRules) {
        if (rawDesc.toUpperCase().includes(rule.Texto_Contido_Descricao.toUpperCase())) {
          suggestedName = rule.Nome_Fantasia_Sugerido;
          suggestedCategory = rule.Categoria_Sugerida;
          break;
        }
      }

      bradTransactions.push({
        Data: cleanedDate,
        Data_Pagamento: paymentDate || cleanedDate,
        Descricao_Original: rawDesc,
        Nome_Fantasia: suggestedName,
        Parcela_Atual: installInfo.current,
        Total_Parcelas: installInfo.total,
        Portador: currentPortador,
        Valor: finalValue,
        Tipo: finalType,
        Categoria: suggestedCategory,
        Fonte: bankConfig.name,
        Origem: fileName || bankConfig.name,
      });
      successCount++;
    }

    return { newTransactions: bradTransactions, successCount, ignoredCount, ignoredItems };
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
    let cleanedValue = parseMonetaryValue(rawValue, bankConfig.numberFormat);

    // Handle Type column (C/D)
    if (bankConfig.typeColIndex !== undefined && cleanedValue !== null) {
      const type = (row[bankConfig.typeColIndex] || '').trim().toUpperCase();
      if (type === 'D' || type === 'DEBITO' || type === 'DEBIT') {
        cleanedValue = -Math.abs(cleanedValue);
      } else if (type === 'C' || type === 'CREDITO' || type === 'CREDIT') {
        cleanedValue = Math.abs(cleanedValue);
      }
    }

    // Linhas ilegíveis: gravar como ignoradas (histórico) — nunca omitir ao silêncio
    if (!cleanedDate || cleanedValue === null || !rawDesc) {
      const hasSignals = row.some((c) => String(c ?? '').trim().length > 0);
      if (hasSignals) {
        ignoredCount++;
        ignoredItems.push({
          Motivo: [
            !rawDesc ? 'sem descrição' : '',
            !cleanedDate ? 'data inválida ou vazia' : '',
            cleanedValue === null ? 'valor não interpretado pelo parser (formato/decimais)' : '',
            'linha omitida ao importar; confira especialmente Pagamentos/agregados de fatura (XP).',
          ]
            .filter(Boolean)
            .join(' · '),
          RawRow: rowStr.slice(0, 450),
          Descricao: rawDesc || '(vazio)',
          DataTextoBruto: rawDate || '(vazio)',
          ValorTextoBruto: rawValue || '(vazio)',
        });
      }
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

    // Pagamentos/agregados de fatura viram entrada (Renda) após invertValues — alinhar rótulos ao parserService
    if (
      bankConfig.sourceType === 'Cartao' &&
      bankConfig.invertValues &&
      finalValue > 0
    ) {
      const CREDIT_CARD_PAYMENT_KEYWORDS = [
        'PAGAMENTO',
        'PAGTO',
        'LIQUIDACAO',
        'CREDITO',
        'DEPOSITO',
        'ESTORNO',
        'VALIDOS NORMAIS',
        'PAGAMENTOS VALIDOS',
      ];
      const isPotentialPayment = CREDIT_CARD_PAYMENT_KEYWORDS.some((kw) =>
        rawDesc.toUpperCase().includes(kw)
      );
      if (isPotentialPayment && (suggestedCategory === '-' || suggestedCategory === 'Outros')) {
        suggestedCategory = 'Pagamento de Fatura';
        suggestedName = 'Pagamento de Fatura';
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

  const creditCardFileTotals =
    bankConfig.sourceType === 'Cartao' ? parseCreditCardFileTotals(rawContent) : undefined;

  return { newTransactions, successCount, ignoredCount, ignoredItems, creditCardFileTotals };
}
