import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { Transaction, ImportConfig, MappingRule } from '../types';
import { parseOFX } from './parsers/ofxParser';

interface ParseResult {
  newTransactions: Omit<Transaction, 'ID_Transacao'>[];
  successCount: number;
  duplicateCount: number;
  ignoredCount: number;
  ignoredItems: any[];
}

// Helper to parse dates like "DD/MM/YYYY" or "DD/MM/YY ..." or "Raw Excel Serials" (Universal handling)
const parseDate = (dateStrInput: string | number): Date | null => {
  if (dateStrInput === null || dateStrInput === undefined) return null;
  
  const dateStr = String(dateStrInput).trim();
  if (dateStr === '') return null;

  // 1. Resiliência Universal: Tratamento de Datas Cruas do Excel.
  // Bancos frequentemente emitem arquivos .xlsx com formatações atípicas que quebram o visual "DD/MM/YYYY".
  // Em vez de adivinhar cada banco, identificamos o Núcleo Matemático do Excel:
  // Datas no Excel são números contínuos desde 1900-01-01. (30000 = 1982 | 90000 = 2146)
  const numericDate = Number(dateStr.replace(',', '.')); // Lida com casos de vírgula injetados via parser CSV -> number("45901,00")
  if (!isNaN(numericDate) && numericDate > 10000 && numericDate < 90000) {
    // É uma data do Excel (Serial Date)
    const utcDays = Math.floor(numericDate) - 25569;
    const utcDate = new Date(utcDays * 86400 * 1000); // Unix timestamp equivalente (em UTC)
    // Extraímos em UTC e reconstruímos na timezone local para evitar shifts de 1 dia na troca de fusos.
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

// Helper to parse monetary values like "-R$ 1.234,56" or "1234.56"
const parseValue = (valueStr: string): number | null => {
  if (typeof valueStr !== 'string' || valueStr.trim() === '') return null;
  
  // Extrai apenas números, ',', '.' e o sinal de '-'
  const cleaned = valueStr.replace(/[^\d,.-]/g, '');
  
  // Heurística para identificar o separador decimal:
  // Se houver vírgula e ponto, o último é o decimal (estilo 1.234,56 ou 1,234.56)
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  
  let normalized = cleaned;
  if (lastComma > lastDot) {
    // Estilo Brasileiro: 1.234,56
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    // Estilo Americano: 1,234.56
    normalized = cleaned.replace(/,/g, '');
  } else {
    // Apenas um tipo de separador (ou nenhum)
    if (lastComma !== -1) {
      // "1234,56" -> "1234.56"
      normalized = cleaned.replace(',', '.');
    } else if (lastDot !== -1) {
      // Pode ser decimal "1234.56" ou milhar "1.234"
      // Se houver 2 dígitos após o ponto no final da string, assumimos decimal
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

// Helper to find and extract installment info like "1/12" from a string
const extractInstallments = (description: string, transactionDate?: Date): { current?: number, total?: number, cleanedDescription: string } => {
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

// Helper to normalize date for comparison, handling YYYY-MM-DD string as Local time
const getNormalizedTime = (dateInput: string | Date): number => {
  if (!dateInput) return 0;
  if (dateInput instanceof Date) return dateInput.getTime();

  // Handle YYYY-MM-DD specifically to ensure Local time interpretation (matching how cleanedDate is created)
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const [y, m, d] = dateInput.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }

  const d = new Date(dateInput);
  return isNaN(d.getTime()) ? 0 : d.getTime();
};

export const parseContent = (content: string, skipLines: number = 0): Promise<{ previewRows: string[][] }> => {
  return new Promise((resolve, reject) => {
    let contentToParse = content;

    // PRE-PROCESS: Handle "Double Quoted" CSVs
    const lines = content.split(/[\r\n]+/);
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
    contentToParse = cleanedContent;

    if (skipLines > 0) {
      const lines = cleanedContent.split(/[\r\n]+/);
      if (lines.length > skipLines) {
        contentToParse = lines.slice(skipLines).join('\n');
      } else {
        contentToParse = "";
      }
    }

    Papa.parse(contentToParse, {
      header: false,
      skipEmptyLines: true,
      delimiter: '', // Auto-detect
      complete: (results) => {
        let data = results.data as string[][];

        // Retry Logic: If only 1 column found, try explicit delimiters
        if (data.length > 0 && data[0].length === 1) {
          // Try Comma
          if (contentToParse.includes(',')) {
            const commaResult = Papa.parse(contentToParse, { header: false, skipEmptyLines: true, delimiter: ',' });
            if (commaResult.data && (commaResult.data[0] as string[]).length > 1) {
              data = commaResult.data as string[][];
            }
          }
          // Try Semicolon
          if (data.length > 0 && data[0].length === 1 && contentToParse.includes(';')) {
            const semiResult = Papa.parse(contentToParse, { header: false, skipEmptyLines: true, delimiter: ';' });
            if (semiResult.data && (semiResult.data[0] as string[]).length > 1) {
              data = semiResult.data as string[][];
            }
          }
        }

        resolve({ previewRows: data });
      },
      error: (error: Error) => {
        reject(error);
      }
    });
  });
};

/**
 * Converts an Excel serial date number to a DD/MM/YYYY string.
 * Excel serial dates count days from 1900-01-01 (with the Lotus 1-2-3 bug).
 */
const excelSerialToDateStr = (serial: number): string => {
  // Excel epoch is 1900-01-01, but serial 1 = Jan 1, 1900.
  // Also, Excel wrongly counts Feb 29, 1900, so serials > 59 need -1 adjustment.
  const utcDays = serial - 25569; // Days since Unix epoch (1970-01-01)
  const date = new Date(utcDays * 86400 * 1000);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
};

/**
 * Converts an Excel file (XLSX, XLS, etc.) to a CSV string.
 * Uses sheet_to_json with raw values to avoid locale-dependent formatting issues.
 * Dates (Excel serial numbers) are converted to DD/MM/YYYY.
 * Numbers are output as plain decimals (e.g. 174.5 → "174,50").
 */
export const convertExcelToCSV = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' }); // NO cellDates
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // Get raw JSON rows (array of arrays)
                const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, raw: true });

                // Detect which columns are dates by checking the header row and cell formats
                const dateColIndices = new Set<number>();
                const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
                
                // Check first data row to find date-formatted cells
                for (let c = range.s.c; c <= range.e.c; c++) {
                    const addr = XLSX.utils.encode_cell({ r: 1, c }); // Row 1 = first data row
                    const cell = worksheet[addr];
                    if (cell && cell.t === 'n' && cell.w) {
                        if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(cell.w) || /^\d{4}-\d{2}-\d{2}/.test(cell.w)) {
                            dateColIndices.add(c);
                        }
                    }
                }

                // Convert rows to CSV lines
                const csvLines = rows.map((row: any[]) => {
                    return row.map((cell: any, colIdx: number) => {
                        if (cell === null || cell === undefined) return '';
                        
                        if (dateColIndices.has(colIdx) && typeof cell === 'number') {
                            return excelSerialToDateStr(cell);
                        }
                        
                        if (typeof cell === 'number') {
                            // Round to 2 decimal places FIRST to avoid IEEE 754 precision issues
                            // e.g. 29.6199999999997 → 29.62, not 29.61
                            const rounded = Math.round(cell * 100) / 100;
                            return rounded.toFixed(2).replace('.', ',');
                        }
                        
                        const str = String(cell);
                        if (str.includes(';') || str.includes(',') || str.includes('"') || str.includes('\n')) {
                            return '"' + str.replace(/"/g, '""') + '"';
                        }
                        return str;
                    }).join(';');
                });

                resolve(csvLines.join('\n'));
            } catch (error) {
                reject(new Error('Falha ao converter arquivo Excel. Verifique se o formato é válido.'));
            }
        };
        reader.onerror = () => reject(new Error('Erro ao ler arquivo Excel.'));
        reader.readAsArrayBuffer(file);
    });
};

export const parsePreview = (file: File): Promise<{ headers: string[], previewRows: string[][], fullContent: string }> => {
  return new Promise(async (resolve, reject) => {
    try {
        const fileName = file.name.toLowerCase();
        let text = '';

        if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            text = await convertExcelToCSV(file);
        } else {
            // Read the file as text for CSV/OFX
            text = await new Promise<string>((res, rej) => {
                const reader = new FileReader();
                reader.onload = (event) => res(event.target?.result as string);
                reader.onerror = () => rej(new Error('Erro ao ler arquivo.'));
                reader.readAsText(file);
            });
        }

      // PRE-PROCESS: Handle "Double Quoted" CSVs (Ticket)
      const lines = text.split(/[\r\n]+/);
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
      text = cleanedLines.join('\n');

      Papa.parse(text, {
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          let data = results.data as string[][];

          // Retry Logic: If only 1 column found, try explicit delimiters
          if (data.length > 0 && data[0].length === 1) {
            console.warn('Parser Service: Auto-detect failed (1 column). Retrying with known delimiters...');

            // Try Comma
            if (text.includes(',')) {
              const commaResult = Papa.parse(text, { header: false, skipEmptyLines: true, delimiter: ',' });
              if (commaResult.data && (commaResult.data[0] as string[]).length > 1) {
                console.log('Parser Service: Retry with comma successful.');
                data = commaResult.data as string[][];
              }
            }

            // Try Semicolon (if still 1 column)
            if (data.length > 0 && data[0].length === 1 && text.includes(';')) {
              const semiResult = Papa.parse(text, { header: false, skipEmptyLines: true, delimiter: ';' });
              if (semiResult.data && (semiResult.data[0] as string[]).length > 1) {
                console.log('Parser Service: Retry with semicolon successful.');
                data = semiResult.data as string[][];
              }
            }
          }

          resolve({
            headers: [],
            previewRows: data,
            fullContent: text
          });
        },
        error: (error: Error) => {
          reject(error);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
};

export const processStatementFile = (
  file: File,
  config: ImportConfig | null,
  existingTransactions: Transaction[],
  mappingRules: MappingRule[],
  paymentDate?: Date,
  manualMapping?: {
    hasHeader: boolean;
    dateColumnIndex: number;
    descriptionColumnIndicies: number[];
    amountColumnIndex: number;
    installmentsColumnIndex?: number;
    skipLines: number;
    ignoredIndices?: number[];
    fileContent: string;
    sourceType?: 'Conta' | 'Cartao';
    invertValues?: boolean;
  }
): Promise<ParseResult> => {
  console.log('Parser Service v1.2 loaded - Smart Import Support');
  return new Promise((resolve, reject) => {

    const parsingLogic = (text: string) => {
      // PRE-PROCESS: Handle "Double Quoted" CSVs (like Ticket)
      // Some exports wrap the entire line in quotes: "Data,Desc,Val"
      // We need to unwrap them: Data,Desc,Val
      const lines = text.split(/[\r\n]+/);
      const cleanedLines = lines.map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 2) {
          // Check if it's really a full-line quote by seeing if there are delimiters *inside* that are not respected otherwise?
          // Actually, if it starts and ends with quote, and contains commas, it's likely a wrapped line.
          // But be careful of a single column file that is just "Value".
          // Heuristic: If we unwrap it and find commas, it was likely a wrapped CSV line.
          const unwrapped = trimmed.slice(1, -1).replace(/""/g, '"');
          if (unwrapped.includes(',') || unwrapped.includes(';')) {
            return unwrapped;
          }
        }
        return line;
      });

      let contentToParse = cleanedLines.join('\n');
      // let contentToParse = text; // Old logic replaced

      // ... (skip lines logic is fine) ...
      const skipLines = manualMapping ? manualMapping.skipLines : (config?.Linhas_Ignorar_Inicio || 0);

      if (skipLines > 0) {
        const lines = text.split(/[\r\n]+/);
        contentToParse = lines.slice(skipLines).join('\n');
      }

      const shouldUseHeader = config ? config.Tem_Cabecalho : false;

      Papa.parse(contentToParse, {
        header: shouldUseHeader,
        skipEmptyLines: true,
        delimiter: '',
        complete: (results) => {
          // ... (counters) ...
          let successCount = 0;
          let duplicateCount = 0;
          let ignoredCount = 0;
          const newTransactions: Omit<Transaction, 'ID_Transacao'>[] = [];
          const ignoredItems: any[] = [];
          let stopProcessing = false;

          let startIndex = 0;
          if (manualMapping && manualMapping.hasHeader) {
            startIndex = 1;
          }

          const rows = results.data as any[];

          for (let i = startIndex; i < rows.length; i++) {
            const row = rows[i];
            if (stopProcessing) break;

            if (manualMapping && manualMapping.ignoredIndices && manualMapping.ignoredIndices.includes(i)) {
              ignoredItems.push({
                Data: null,
                Valor: null,
                Descricao: `Linha ${i + 1} ignorada manualmente`,
                Motivo: 'Ignorado pelo usuário'
              });
              ignoredCount++;
              continue;
            }

            let dataBruta: { date: any; desc1: any; desc2: any; installments: any; value: any; holder: any };
            let rawRowValues = '';

            if (config) {
              // ... existing config logic ...
              dataBruta = {
                date: row[config.Coluna_Data!],
                desc1: row[config.Coluna_Descricao_1!] || '',
                desc2: config.Coluna_Descricao_2 ? row[config.Coluna_Descricao_2] : '',
                installments: config.Coluna_Parcelas ? row[config.Coluna_Parcelas] : '',
                value: row[config.Coluna_Valor!],
                holder: config.Coluna_Portador ? row[config.Coluna_Portador] : undefined,
              };
              rawRowValues = Object.values(row).map(v => String(v)).join(' ').toUpperCase();
            } else if (manualMapping) {
              const rowArray = Array.isArray(row) ? row : Object.values(row);

              if (rowArray.length <= manualMapping.dateColumnIndex || rowArray.length <= manualMapping.amountColumnIndex) {
                continue;
              }

              dataBruta = {
                date: rowArray[manualMapping.dateColumnIndex],
                desc1: manualMapping.descriptionColumnIndicies.map(idx => rowArray[idx]).join(' '),
                desc2: '',
                installments: manualMapping.installmentsColumnIndex !== undefined && manualMapping.installmentsColumnIndex >= 0 ? rowArray[manualMapping.installmentsColumnIndex] : '',
                value: rowArray[manualMapping.amountColumnIndex],
                holder: undefined // Not supporting holder mapping yet
              };
              rawRowValues = rowArray.map(v => String(v)).join(' ').toUpperCase();
            } else {
              continue;
            }

            // Robust description handling
            let combinedDescription = dataBruta.desc2 ? `${dataBruta.desc1} - ${dataBruta.desc2}` : dataBruta.desc1;
            combinedDescription = combinedDescription ? String(combinedDescription).trim() : '';

            const stopText = config?.Texto_Parar_Leitura_Contendo || '';

            if (stopText && rawRowValues.includes(stopText.toUpperCase())) {
              stopProcessing = true;
              continue;
            }

            const cleanedDate = parseDate(dataBruta.date);
            const cleanedValue = parseValue(dataBruta.value);

            if (!cleanedDate || cleanedValue === null || !combinedDescription) {
              continue;
            }

            // Check for ignore rules
            const ignoreRules = config?.Texto_Ignorar_Linha_Contendo || [];
            const matchedIgnoreRule = ignoreRules.find(rule => combinedDescription.toUpperCase().includes(rule.toUpperCase()));

            if (matchedIgnoreRule) {
              ignoredItems.push({
                Data: cleanedDate,
                Valor: cleanedValue,
                Descricao: combinedDescription,
                Motivo: `Regra de Ignorar: "${matchedIgnoreRule}"`
              });
              ignoredCount++;
              continue;
            }

            // Installments
            let installmentInfo = extractInstallments(dataBruta.installments || '', cleanedDate);

            const SINGLE_PAYMENT_KEYWORDS = ['PIX', 'TRANSF', 'TED', 'DOC', 'RESGATE', 'APLICACAO', 'DEBITO', 'SALDO'];
            const isSinglePayment = SINGLE_PAYMENT_KEYWORDS.some(kw => combinedDescription.toUpperCase().includes(kw));

            if (isSinglePayment) {
              installmentInfo = { cleanedDescription: combinedDescription };
            } else if (!installmentInfo.current) {
              installmentInfo = extractInstallments(combinedDescription, cleanedDate);
            }

            const descriptionForMapping = installmentInfo.cleanedDescription || combinedDescription;

            let finalValue = cleanedValue;
            let finalType: 'Renda' | 'Despesa';

            let isCreditCardSource = false;
            if (manualMapping) {
              isCreditCardSource = manualMapping.sourceType === 'Cartao' || manualMapping.sourceType === 'Cartão de Crédito';
            } else if (config) {
              isCreditCardSource = config.Tipo_Fonte === 'Cartao' || config.Tipo_Fonte === 'Cartão de Crédito';
            }

            let shouldInvert = false;
            if (manualMapping && typeof manualMapping.invertValues === 'boolean') {
              shouldInvert = manualMapping.invertValues;
            } else if (isCreditCardSource) {
              shouldInvert = true;
            }

            if (shouldInvert) {
              finalValue = -cleanedValue;
              finalType = finalValue >= 0 ? 'Renda' : 'Despesa';
            } else {
              finalType = cleanedValue >= 0 ? 'Renda' : 'Despesa';
            }

            // Apply mapping rules
            let suggestedName = descriptionForMapping;
            let suggestedCategory = '-';

            for (const rule of mappingRules) {
              if (suggestedName.toUpperCase().includes(rule.Texto_Contido_Descricao.toUpperCase())) {
                suggestedName = rule.Nome_Fantasia_Sugerido;
                suggestedCategory = rule.Categoria_Sugerida;
                break;
              }
            }

            // Special handling for Credit Card payments
            const CREDIT_CARD_PAYMENT_KEYWORDS = ['PAGAMENTO', 'PAGTO', 'LIQUIDACAO', 'CREDITO', 'DEPOSITO', 'ESTORNO'];
            const CREDIT_CARD_REFUND_KEYWORDS = ['ESTORNO', 'REEMBOLSO', 'DEVOLUCAO', 'CANCELAMENTO', 'AJUSTE CREDOR', 'CREDITO ESTORNADO'];
            const normalizedDescription = combinedDescription
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toUpperCase();
            const isExplicitRefund = CREDIT_CARD_REFUND_KEYWORDS.some(kw => normalizedDescription.includes(kw));
            const isPotentialPayment = isCreditCardSource && finalValue > 0 && !isExplicitRefund &&
              CREDIT_CARD_PAYMENT_KEYWORDS.some(kw => normalizedDescription.includes(kw));

            if (isPotentialPayment && (suggestedCategory === '-' || suggestedCategory === 'Outros')) {
              suggestedCategory = 'Pagamento de Fatura';
              suggestedName = 'Pagamento de Fatura';
            }

            newTransactions.push({
              Data: cleanedDate,
              Data_Pagamento: paymentDate || cleanedDate,
              Descricao_Original: combinedDescription,
              Nome_Fantasia: suggestedName || combinedDescription,
              Parcela_Atual: installmentInfo.current,
              Total_Parcelas: installmentInfo.total,
              Portador: dataBruta.holder,
              Valor: finalValue,
              Tipo: finalType,
              Categoria: suggestedCategory,
              Fonte: config ? config.Nome_Fonte : (file.name + ' (Import)'),
              Origem: file.name,
            });

            successCount++;
          }
          resolve({ newTransactions, successCount, duplicateCount, ignoredCount, ignoredItems });
        },
        error: (error: Error) => {
          reject(new Error(`Erro ao processar o conteúdo do CSV: ${error.message}`));
        },
      });
    }

    // 1. If manualMapping provides content, use it. Else read file.
    if (manualMapping && manualMapping.fileContent) {
      parsingLogic(manualMapping.fileContent);
    } else {
      (async () => {
        try {
          const fileName = file.name.toLowerCase();
          let content = '';
          
          if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            content = await convertExcelToCSV(file);
          } else {
            content = await new Promise<string>((res, rej) => {
                const reader = new FileReader();
                reader.onload = (event) => res(event.target?.result as string);
                reader.onerror = () => rej(new Error('Erro ao ler arquivo.'));
                reader.readAsText(file, 'UTF-8');
            });
          }

          // IF OFX/OFC: Use dedicated parser and bypass standard CSV mapping
          if (fileName.endsWith('.ofx') || fileName.endsWith('.ofc')) {
            const ofxTransactions = parseOFX(content, file.name);
            
            // Apply mapping rules to OFX transactions
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
              return { ...tx, Nome_Fantasia: suggestedName, Categoria: suggestedCategory };
            });

            resolve({
              newTransactions: mappedTransactions,
              successCount: mappedTransactions.length,
              duplicateCount: 0,
              ignoredCount: 0,
              ignoredItems: []
            });
            return;
          }

          parsingLogic(content);
        } catch (error) {
          reject(error);
        }
      })();
    }
  });
};
