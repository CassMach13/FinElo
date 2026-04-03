import * as xlsx from 'xlsx';
import { Investment } from '../../types';

export const xpInvestmentParser = {
    /**
     * Parses an XP Investimentos Excel file (.xlsx) and extracts the investment positions.
     * Note: This does NOT save to the database. It only parses the file into memory.
     * 
     * @param fileBuffer The raw ArrayBuffer of the uploaded Excel file
     * @param referenceMonth The user-selected month these balances belong to (e.g. '2026-02-01')
     * @returns Array of partial Investments valid for database insertion
     */
    async parseExcel(fileBuffer: ArrayBuffer, referenceMonth: string): Promise<Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'>[]> {
        const workbook = xlsx.read(fileBuffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // We use { header: 1 } to get a raw array of arrays (rows and columns)
        const rawData = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });

        const investments: Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [];

        let currentCategory = '';
        let colMap = { value: -1, yield: -1, maturity: -1, principal: -1 };
        let isInsideBlock = false;

        // Iterate through all rows
        for (let rowIndex = 0; rowIndex < rawData.length; rowIndex++) {
            const row = rawData[rowIndex];

            // Skip empty arrays or arrays with only empty strings
            if (!row || row.length === 0 || row.every(cell => !cell || String(cell).trim() === '')) {
                continue;
            }

            const firstCell = String(row[0] || '').trim();

            // Ignore top headers
            if (firstCell === 'Cassio Marques, este é o seu patrimônio' || firstCell.includes('Total') || firstCell.includes('Cassio')) {
                continue;
            }

            // Detect Category Header
            if (
                !firstCell.includes('%') &&
                (firstCell === 'Fundos de Investimentos' || firstCell === 'Renda Fixa' || firstCell === 'Previdência Privada' || firstCell === 'Ações' || firstCell === 'Tesouro Direto')
            ) {
                currentCategory = firstCell;
                isInsideBlock = true;
                colMap = { value: -1, yield: -1, maturity: -1, principal: -1 };
                continue;
            }

            if (isInsideBlock && colMap.value === -1) {
                // Find header row that declares columns
                const rowString = row.join(' ').toLowerCase();
                if (rowString.includes('valor líq') || rowString.includes('valor liq') || rowString.includes('posição')) {
                    for (let i = 0; i < row.length; i++) {
                        const cellLower = String(row[i] || '').toLowerCase().trim();

                        if (cellLower.includes('valor líq') || cellLower.includes('valor liq') || cellLower.includes('posição')) {
                            // First match wins to mimic V1 behavior which correctly aligned with the spreadsheet's total
                            if (colMap.value === -1) {
                                colMap.value = i;
                            }
                        }
                        if (cellLower === 'taxa a mercado' || cellLower === 'rentabilidade líquida' || cellLower === 'rentabilidade') {
                            colMap.yield = i;
                        }
                        if (cellLower === 'data vencimento') {
                            colMap.maturity = i;
                        }
                        if (cellLower === 'valor aplicado') {
                            colMap.principal = i;
                        }
                    }
                }
                continue;
            }

            // Inside a block, we know the value column, skip sub-headers like "12,9% | Pós-Fixado"
            if (isInsideBlock && colMap.value !== -1 && firstCell.includes('%')) {
                continue;
            }

            // Actually parse the product
            if (isInsideBlock && colMap.value !== -1 && firstCell) {
                const rawValue = String(row[colMap.value] || '');
                const numericValue = this.parseCurrency(rawValue);

                if (numericValue > 0) {
                    const inv: Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
                        institution: 'XP',
                        product_type: currentCategory,
                        product_name: firstCell,
                        balance: numericValue,
                        reference_month: referenceMonth,
                    };

                    if (colMap.yield !== -1 && row[colMap.yield]) {
                        inv.yield_rate = String(row[colMap.yield]);
                    }
                    if (colMap.maturity !== -1 && row[colMap.maturity]) {
                        inv.maturity_date = this.parseDate(String(row[colMap.maturity]));
                    }
                    if (colMap.principal !== -1 && row[colMap.principal]) {
                        inv.invested_principal = this.parseCurrency(String(row[colMap.principal]));
                    }

                    investments.push(inv);
                }
            }
        }

        return investments;
    },

    /**
     * Converts a pt-BR currency string to a float number.
     * E.g. "R$ 2.768,41" -> 2768.41
     */
    parseCurrency(value: string): number {
        if (!value) return 0;

        // Remove "R$", spaces, and dots (thousands separator)
        let cleaned = value.replace(/R\$/g, '').replace(/\s/g, '').replace(/\./g, '');
        // Replace comma (decimal separator) with dot
        cleaned = cleaned.replace(/,/g, '.');

        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
    },

    /**
     * Converts a DD/MM/YYYY string to YYYY-MM-DD
     */
    parseDate(dateString: string): string | undefined {
        if (!dateString) return undefined;
        const parts = dateString.trim().split('/');
        if (parts.length === 3) {
            return `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
        return undefined;
    }
};
