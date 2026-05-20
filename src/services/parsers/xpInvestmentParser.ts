import * as xlsx from 'xlsx';
import { Investment } from '../../types';

export interface XpReconciliation {
    /** Official total from the broker's report header (includes cash + all positions) */
    brokerTotal: number;
    /** Cash available in the brokerage account (not invested in any product) */
    availableCash: number;
    /** Sum of all individual positions parsed by the FinElo importer */
    positionsTotal: number;
    /** brokerTotal - positionsTotal (accrued interest, custody adjustments, etc.) */
    unmatchedAmount: number;
}

export interface XpParseResult {
    investments: Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'>[];
    reconciliation: XpReconciliation | null;
}

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
    async parseExcel(fileBuffer: ArrayBuffer, referenceMonth: string): Promise<XpParseResult> {
        const workbook = xlsx.read(fileBuffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rawData = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });

        const investments: Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [];

        // ── Extract broker-level reconciliation data from the header rows ────────
        // Row 2: column labels. Row 3: values
        // Col 0 = total patrimony, Col 1 = total invested, Col 2 = available cash
        let reconciliation: XpReconciliation | null = null;
        try {
            const headerValues = rawData[3];
            if (headerValues && headerValues[0] && String(headerValues[0]).includes('R$')) {
                const brokerTotal = this.parseCurrency(String(headerValues[0] || '0'));
                const availableCash = this.parseCurrency(String(headerValues[2] || '0'));
                reconciliation = { brokerTotal, availableCash, positionsTotal: 0, unmatchedAmount: 0 };
            }
        } catch { /* ignore if header structure is different */ }

        let currentCategory = '';
        let colMap = {
            value: -1,
            yield: -1,
            maturity: -1,
            principal: -1,
            originalPrincipal: -1,
            grossReturn: -1,
            application: -1,
            monthlyYield: -1,
        };

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
            const map = {
                value: -1,
                yield: -1,
                maturity: -1,
                principal: -1,
                originalPrincipal: -1,
                grossReturn: -1,
                application: -1,
                monthlyYield: -1,
            };
            for (let i = 0; i < row.length; i++) {
                const cell = String(row[i] || '').trim();
                const normCell = normalize(cell);

                // Balance/position value column
                if (normCell === 'posicao' || normCell === 'posicao a mercado') {
                    if (map.value === -1) map.value = i;
                } else if (normCell === 'reserva bruta' || normCell === 'saldo') {
                    if (map.value === -1) map.value = i;
                }

                // Application date
                if (
                    normCell === 'data da aplicacao' ||
                    normCell === 'data aplicacao' ||
                    normCell === 'data de aplicacao' ||
                    normCell === 'data aplicacao inicial' ||
                    normCell === 'dt aplicacao'
                ) {
                    map.application = i;
                }

                // Monthly yield (separate from index / accumulated yield)
                if (
                    normCell === 'rentabilidade mensal' ||
                    normCell === 'rentabilidade no mes' ||
                    normCell === 'rentabilidade mes' ||
                    normCell === 'juros mensal' ||
                    normCell === 'juros no mes'
                ) {
                    map.monthlyYield = i;
                }

                // Yield/rentabilidade column (exclude monthly variants)
                const isMonthlyYieldCol =
                    normCell.includes('mensal') ||
                    normCell.includes('no mes') ||
                    normCell.endsWith(' mes');
                if (
                    !isMonthlyYieldCol &&
                    (normCell === 'taxa a mercado' ||
                        normCell === 'rentabilidade liquida' ||
                        normCell === 'rentabilidade' ||
                        normCell === 'rentabilidade (%)' ||
                        normCell === 'rentabilidade acumulada (%)' ||
                        normCell === 'indexador' ||
                        normCell === 'taxa')
                ) {
                    map.yield = i;
                }

                // Maturity date column
                if (normCell === 'data vencimento' || normCell === 'vencimento') {
                    map.maturity = i;
                }

                // Rendimento bruto (valor em R$, não confundir com valor aplicado)
                if (
                    normCell === 'rendimento bruto' ||
                    normCell === 'rentabilidade bruta' ||
                    normCell === 'rendimento liquido'
                ) {
                    map.grossReturn = i;
                }

                // Principal invested column (primeira coluna "valor aplicado")
                if (normCell === 'valor aplicado' || normCell === 'valor investido' || normCell === 'investimento inicial') {
                    if (map.principal === -1) map.principal = i;
                }

                // Total aplicado original (renda fixa XP — pode refletir aportes acumulados)
                if (normCell === 'valor aplicado original') {
                    map.originalPrincipal = i;
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
                colMap = {
                    value: -1,
                    yield: -1,
                    maturity: -1,
                    principal: -1,
                    originalPrincipal: -1,
                    grossReturn: -1,
                    application: -1,
                    monthlyYield: -1,
                };
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
                    inv.yield_rate = String(row[colMap.yield]).trim();
                }
                if (colMap.monthlyYield !== -1 && row[colMap.monthlyYield]) {
                    inv.monthly_yield_rate = String(row[colMap.monthlyYield]).trim();
                }
                if (colMap.application !== -1 && row[colMap.application]) {
                    inv.application_date = this.parseDateCell(row[colMap.application]);
                }
                if (colMap.maturity !== -1 && row[colMap.maturity]) {
                    inv.maturity_date = this.parseDateCell(row[colMap.maturity]);
                }
                if (colMap.principal !== -1 && row[colMap.principal]) {
                    inv.invested_principal = this.parseCurrency(String(row[colMap.principal]));
                }
                if (colMap.originalPrincipal !== -1 && row[colMap.originalPrincipal]) {
                    const original = this.parseCurrency(String(row[colMap.originalPrincipal]));
                    if (original > 0) inv.original_applied_amount = original;
                }
                if (colMap.grossReturn !== -1 && row[colMap.grossReturn]) {
                    const gross = this.parseCurrency(String(row[colMap.grossReturn]));
                    if (gross > 0) inv.gross_return_amount = gross;
                }

                investments.push(inv);
            }
        }

        // ── Finalize reconciliation ───────────────────────────────────────────
        if (reconciliation) {
            const positionsTotal = investments.reduce((s, inv) => s + inv.balance, 0);
            reconciliation.positionsTotal = positionsTotal;
            reconciliation.unmatchedAmount = reconciliation.brokerTotal - positionsTotal;
        }

        return { investments, reconciliation };
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
     * Converts Excel cell (string, serial number or Date) to YYYY-MM-DD
     */
    parseDateCell(cell: unknown): string | undefined {
        if (cell == null || cell === '') return undefined;
        if (cell instanceof Date && !isNaN(cell.getTime())) {
            return cell.toISOString().slice(0, 10);
        }
        return this.parseDate(String(cell));
    },

    /**
     * Converts DD/MM/YYYY or Excel serial to YYYY-MM-DD
     */
    parseDate(dateString: string): string | undefined {
        if (!dateString) return undefined;
        const trimmed = dateString.trim();

        const serial = Number(trimmed.replace(',', '.'));
        if (!isNaN(serial) && serial > 25000 && serial < 120000) {
            const utc = new Date(Math.round((serial - 25569) * 86400 * 1000));
            if (!isNaN(utc.getTime())) return utc.toISOString().slice(0, 10);
        }

        const parts = trimmed.split('/');
        if (parts.length === 3) {
            const [d, m, y] = parts;
            const year = y.length === 2 ? `20${y}` : y;
            return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }

        if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
            return trimmed.slice(0, 10);
        }

        return undefined;
    },
};
