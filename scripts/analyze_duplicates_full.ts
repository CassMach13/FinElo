
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

const filePath = './modelos de fatura/transacoes_2026-01-01.csv';
const outPath = './scripts/dup_report_full.txt';

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
            log(`--- ANALYZING FULL CSV EXPORT (${results.data.length} rows) ---`, buffer);

            // Filter: Just try to find duplicates across the board for XP
            // Or maybe just ALL accounts to see if there's massive duplication
            const relevant = results.data;

            log(`Scanning ${relevant.length} transactions for duplicates...`, buffer);

            const map = new Map<string, any[]>();

            relevant.forEach((t: any) => {
                const rawDate = t['Data'] || '';
                const dateYMD = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate;
                const val = parseFloat(t['Valor'] || '0').toFixed(2);
                const desc = (t['Descricao_Original'] || '').trim().toUpperCase();

                // Key: Data + Valor + Descr
                const key = `${dateYMD}|${val}|${desc}`;

                if (!map.has(key)) map.set(key, []);
                map.get(key)?.push(t);
            });

            let dupSets = 0;
            let excessValueSum = 0;
            let excessValueSumPos = 0;
            let excessValueSumNeg = 0;

            log('\n--- POTENTIAL DUPLICATES (Top 20 by Value) ---', buffer);

            const duplicates: any[] = [];

            map.forEach((rows, key) => {
                if (rows.length > 1) {
                    dupSets++;
                    const val = parseFloat(rows[0]['Valor']);
                    const excessCount = rows.length - 1;
                    const excessVal = val * excessCount;

                    excessValueSum += excessVal;
                    if (val > 0) excessValueSumPos += excessVal;
                    else excessValueSumNeg += excessVal;

                    duplicates.push({ key, excessVal, count: rows.length, first: rows[0] });
                }
            });

            // Sort by absolute excess value desc
            duplicates.sort((a, b) => Math.abs(b.excessVal) - Math.abs(a.excessVal));

            duplicates.slice(0, 50).forEach(d => {
                log(`[${d.count}x] ${d.key} -> Excess: R$ ${d.excessVal.toFixed(2)} (${d.first['Conta'] || d.first['Origem'] || '?'})`, buffer);
            });

            log('-----------------------------------', buffer);
            log(`Sets with Duplicates: ${dupSets}`, buffer);
            log(`Total Excess Value (Net): R$ ${excessValueSum.toFixed(2)}`, buffer);
            log(`Total Excess Positive: R$ ${excessValueSumPos.toFixed(2)}`, buffer);
            log(`Total Excess Negative: R$ ${excessValueSumNeg.toFixed(2)}`, buffer);

            log(`Discrepancy Target: ~ -851 (or +851)`, buffer);

            fs.writeFileSync(outPath, buffer.join('\n'));
        }
    });
};

processFile();
