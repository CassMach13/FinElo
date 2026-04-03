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
            const cellLower = firstCell.toLowerCase();

            // Skip top noise and general headers
            if (rowIndex < 10 && (cellLower === '' || cellLower.includes('patrimônio') || cellLower.includes('este é o seu') || cellLower.includes('conta:'))) {
                continue;
            }

            if (cellLower.includes('total') || cellLower.includes('subtotal')) {
                continue;
            }

            // Detect Category Header - Use includes for flexibility
            const isCategory = 
                (cellLower.includes('fundos de investimentos') || 
                 cellLower.includes('renda fixa') || 
                 cellLower.includes('previdência privada') || 
                 cellLower.includes('ações') || 
                 cellLower.includes('tesouro direto') || 
                 cellLower.includes('coe') || 
                 cellLower.includes('coi') || 
                 cellLower.includes('imobiliário') || 
                 cellLower.includes('fii') || 
                 cellLower.includes('alternativos'));

            if (isCategory) {
                // Determine a clean name for the category
                if (cellLower.includes('fundos de investimentos')) currentCategory = 'Fundos de Investimentos';
                else if (cellLower.includes('renda fixa')) currentCategory = 'Renda Fixa';
                else if (cellLower.includes('previdência privada')) currentCategory = 'Previdência Privada';
                else if (cellLower.includes('ações')) currentCategory = 'Ações';
                else if (cellLower.includes('tesouro direto')) currentCategory = 'Tesouro Direto';
                else if (cellLower.includes('coe') || cellLower.includes('coi')) currentCategory = 'COE';
                else if (cellLower.includes('imobiliário') || cellLower.includes('fii')) currentCategory = 'Fundos Imobiliários';
                else if (cellLower.includes('alternativos')) currentCategory = 'Alternativos';
                else currentCategory = firstCell;
                
                isInsideBlock = true;
                colMap = { name: 0, value: -1, yield: -1, maturity: -1, principal: -1 };
                continue;
            }

            // Detect Column Headers within a category block
            const rowString = row.join(' ').toLowerCase();
            const looksLikeHeader = rowString.includes('posição') || rowString.includes('saldo') || rowString.includes('valor líquido') || rowString.includes('reserva bruta');

            if (isInsideBlock && looksLikeHeader) {
                for (let i = 0; i < row.length; i++) {
                    const cellValue = String(row[i] || '').trim();
                    const cellLowerInner = cellValue.toLowerCase();

                    if (cellValue === 'Posição' || cellValue === 'Saldo' || cellValue === 'Valor líquido' || cellValue === 'Reserva bruta' || cellValue === 'Vl. bruto') {
                        // Priority to Posição, followed by Reserva Bruta (for Previdência)
                        if (colMap.value === -1 || cellValue === 'Posição' || cellValue === 'Reserva bruta') {
                            colMap.value = i;
                        }
                    }
                    
                    if (cellLowerInner === 'taxa a mercado' || cellLowerInner === 'rentabilidade líquida' || cellLowerInner === 'rentabilidade' || cellLowerInner === 'rentabilidade (%)' || cellLowerInner === 'rendimento liq' || cellLowerInner === 'rentabilidade acumulada (%)') {
                        colMap.yield = i;
                    }

                    // For COE, "Rendimento bruto" often refers to the total amount or principal in some exports,
                    // so we only map it to yield if it's NOT a COE section, or use it as a fallback.
                    if (cellLowerInner === 'rendimento bruto' && currentCategory !== 'COE') {
                        colMap.yield = i;
                    }
                    
                    if (cellLowerInner === 'data vencimento' || cellLowerInner === 'vencimento') {
                        colMap.maturity = i;
                    }
                    if (cellLowerInner === 'valor aplicado' || cellLowerInner === 'valor investido' || cellLowerInner === 'investimento inicial' || cellLowerInner === 'aplicado') {
                        colMap.principal = i;
                    }
                }

                // Special case for COE where columns might be shifted or headers named differently
                if (currentCategory === 'COE' && colMap.principal === -1) {
                    if (row.length > 3) colMap.principal = 3;
                }
                continue;
            }

            // Actually parse the product
            // Avoid rows that repeated the header name or total keyword
            if (isInsideBlock && colMap.value !== -1) {
                const productName = firstCell || (row[1] ? String(row[1]).trim() : '');
                
                // Final checks to avoid noise
                if (!productName || productName.includes('Posição') || productName.includes('Saldo') || productName.toLowerCase().includes('total')) {
                    continue;
                }

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
