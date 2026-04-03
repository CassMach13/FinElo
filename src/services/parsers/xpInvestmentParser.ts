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
     * 
     * === SPREADSHEET STRUCTURE MAP (based on actual dump) ===
     * Row 0: account/date metadata
     * Row 2: "Vinicius..., este é o seu patrimônio", "Total investido histórico", ...
     * Row 3: "R$ 565.357,57", ... (summary totals - SKIP)
     * Row 5: ["Ações", null, ..., "R$ 19.425,33"]  ← SECTION TITLE (col[1] is null)
     * Row 7: ["3,4% | Alternativos", "Posição", "% Alocação", ...]  ← COLUMN HEADER ROW
     * Row 8: ["RDOR3", "R$ 6.730,10", ...]  ← PRODUCT ROW
     * ...repeat for each section...
     * 
     * Key Rules:
     * - Section titles: col[0] matches a known category name AND col[1] is null/empty
     * - Column header rows: anywhere in the joined row text we find "posição" or "reserva bruta"
     * - Product rows: anything else inside a known section once we have a colMap
     */
    async parseExcel(fileBuffer: ArrayBuffer, referenceMonth: string): Promise<Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'>[]> {
        const workbook = xlsx.read(fileBuffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rawData = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });

        const investments: Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [];

        let currentCategory = '';
        let colMap = { value: -1, yield: -1, maturity: -1, principal: -1 };

        // Known top-level category names exactly as they appear in col[0] of section title rows.
        // Keys are normalized (lowercase, no accents) to avoid encoding issues.
        const CATEGORY_NAMES: Record<string, string> = {
            'acoes': 'Ações',
            'ações': 'Ações',
            'fundos de investimentos': 'Fundos de Investimentos',
            'renda fixa': 'Renda Fixa',
            'previdencia privada': 'Previdência Privada',
            'previdência privada': 'Previdência Privada',
            'tesouro direto': 'Tesouro Direto',
            'coe': 'COE',
            'coi': 'COE',
            'posicao de fundos imobiliarios': 'Fundos Imobiliários',
            'posição de fundos imobiliários': 'Fundos Imobiliários',
            'fundos imobiliarios': 'Fundos Imobiliários',
            'fundos imobiliários': 'Fundos Imobiliários',
        };

        // Normalize a string: lowercase + remove diacritics for robust comparison
        const normalize = (s: string): string => 
            s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        const isSectionTitle = (row: any[]): boolean => {
            const first = normalize(String(row[0] || '').trim());
            if (!Object.keys(CATEGORY_NAMES).some(k => normalize(k) === first)) return false;
            // Section titles always have null/empty col[1]
            const second = String(row[1] || '').trim();
            return second === '';
        };

        const isColumnHeaderRow = (row: any[]): boolean => {
            const joined = normalize(row.map((c: any) => String(c || '').trim()).join('|'));
            return joined.includes('posicao') || joined.includes('reserva bruta');
        };

        const extractColMap = (row: any[]): typeof colMap => {
            const map = { value: -1, yield: -1, maturity: -1, principal: -1 };
            for (let i = 0; i < row.length; i++) {
                const cell = String(row[i] || '').trim();
                const normCell = normalize(cell);

                // Balance/position value column
                if (normCell === 'posicao' || normCell === 'posicao a mercado') {
                    if (map.value === -1) map.value = i;
                } else if (normCell === 'reserva bruta' || normCell === 'saldo') {
                    if (map.value === -1) map.value = i;
                }

                // Yield/rentabilidade column
                if (normCell === 'taxa a mercado' || normCell === 'rentabilidade liquida' ||
                    normCell === 'rentabilidade' || normCell === 'rentabilidade (%)' ||
                    normCell === 'rentabilidade acumulada (%)') {
                    map.yield = i;
                }

                // Maturity date column
                if (normCell === 'data vencimento' || normCell === 'vencimento') {
                    map.maturity = i;
                }

                // Principal invested column
                if (normCell === 'valor aplicado' || normCell === 'valor investido' || normCell === 'investimento inicial') {
                    if (map.principal === -1) map.principal = i;
                }
            }
            return map;
        };

        for (let rowIndex = 0; rowIndex < rawData.length; rowIndex++) {
            const row = rawData[rowIndex];

            // Skip empty rows
            if (!row || row.length === 0 || row.every((cell: any) => !cell || String(cell).trim() === '' || String(cell).trim() === ' ')) {
                continue;
            }

            // 2. Skip top metadata rows (header info, account number, totals summary)
            // Row 5 is the first real section title (Ações), so skip only rows 0-4
            if (rowIndex < 5) continue;

            const first = String(row[0] || '').trim();
            const firstLower = first.toLowerCase();

            // Step 1: Section title → update category, reset column map
            if (isSectionTitle(row)) {
                const firstNorm = normalize(first);
                const matchedKey = Object.keys(CATEGORY_NAMES).find(k => normalize(k) === firstNorm)!;
                currentCategory = CATEGORY_NAMES[matchedKey];
                colMap = { value: -1, yield: -1, maturity: -1, principal: -1 };
                continue;
            }

            // Step 2: Column header row → remap columns (keeps current category intact)
            if (isColumnHeaderRow(row)) {
                colMap = extractColMap(row);
                continue;
            }

            // Step 3: Skip total/subtotal rows
            if (firstLower.includes('total') || firstLower.includes('subtotal')) continue;

            // Step 4: Skip until we have both a category and a column map
            if (!currentCategory || colMap.value === -1) continue;

            // Step 5: Parse product row
            // Product name is in col[0]; if empty (merged cells in some exports), try col[1]
            const productName = first || String(row[1] || '').trim();
            if (!productName) continue;

            const rawValue = String(row[colMap.value] || '').trim();
            const numericValue = this.parseCurrency(rawValue);

            if (numericValue > 0) {
                const inv: Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
                    institution: 'XP',
                    product_type: currentCategory,
                    product_name: productName,
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

        return investments;
    },

    /**
     * Converts a pt-BR currency string to a float number.
     * E.g. "R$ 2.768,41" -> 2768.41
     */
    parseCurrency(value: string): number {
        if (!value) return 0;
        let cleaned = value.replace(/R\$/g, '').replace(/\s/g, '').replace(/\./g, '');
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
