
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

const filePath = './modelos de fatura/transacoes_2026-01-01.csv';
const outPath = './scripts/dup_report.txt';

// Target Range: Dec 2025
const startTs = new Date('2025-12-01T00:00:00').getTime();
const endTs = new Date('2025-12-31T23:59:59').getTime();

const log = (msg: string, buffer: string[]) => {
    console.log(msg);
    buffer.push(msg);
};

const processFile = () => {
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const buffer: string[] = [];

    Papa.parse(content, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
            log(`--- ANALYZING CSV EXPORT (${results.data.length} rows) ---`, buffer);

            // Filter for XP and Dec 2025
            const relevant = results.data.filter((row: any) => {
                const source = (row['Fonte'] || '').toUpperCase();
                // loose match for XP account context
                const isXP = source.includes('XP') || source.includes('CONTA XP') || (row['Origem'] || '').toUpperCase().includes('XP');

                if (!isXP) return false;

                const dateStr = row['Data'];
                if (!dateStr) return false;

                const d = new Date(dateStr).getTime();
                return d >= startTs && d <= endTs;
            });

            log(`Filtered: ${relevant.length} transactions for Conta XP in Dec 2025.`, buffer);

            // Grouping for Duplicates
            const map = new Map<string, any[]>();

            relevant.forEach((t: any) => {
                const dateYMD = t['Data'].split('T')[0];
                const val = parseFloat(t['Valor']).toFixed(2);
                const desc = (t['Descricao_Original'] || '').trim().toUpperCase();

                const key = `${dateYMD}|${val}|${desc}`;

                if (!map.has(key)) map.set(key, []);
                map.get(key)?.push(t);
            });

            let dupSets = 0;
            let excessValueSum = 0;

            log('\n--- POTENTIAL DUPLICATES ---', buffer);

            map.forEach((rows, key) => {
                if (rows.length > 1) {
                    dupSets++;
                    const val = parseFloat(rows[0]['Valor']);
                    const excessCount = rows.length - 1;
                    const excessVal = val * excessCount;

                    excessValueSum += excessVal;

                    log(`[${rows.length}x] ${key} -> Excess: R$ ${excessVal.toFixed(2)}`, buffer);
                }
            });

            log('-----------------------------------', buffer);
            log(`Sets with Duplicates: ${dupSets}`, buffer);
            log(`Total Excess Value (Sum of Duplicates): R$ ${excessValueSum.toFixed(2)}`, buffer);

            fs.writeFileSync(outPath, buffer.join('\n'));
        }
    });
};

processFile();
