
import fs from 'fs';
import Papa from 'papaparse';

const filePath = 'c:\\Users\\cassi\\Downloads\\personal-finance-manager\\modelos de fatura\\transacoes_2025-12-31.csv';
const outPath = 'c:\\Users\\cassi\\Downloads\\personal-finance-manager\\scripts\\backup_analysis.txt';

// Target Range: 2025-11-27 to 2025-11-30
const startTs = new Date('2025-11-27T00:00:00').getTime();
const endTs = new Date('2025-11-30T23:59:59').getTime();

const log = (msg: string, buffer: string[]) => {
    console.log(msg);
    buffer.push(msg);
};

const processFile = () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    const buffer: string[] = [];

    Papa.parse(content, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
            log(`--- ANALYZING BACKUP FILE (${results.data.length} rows) ---`, buffer);

            const relevant = results.data.filter((row: any) => {
                const source = row['Fonte'] || '';
                const dateStr = row['Data'];
                if (!source.includes('XP') && !source.includes('Conta XP')) return false;

                const d = new Date(dateStr).getTime();
                return d >= startTs && d <= endTs;
            });

            log(`Found ${relevant.length} transactions for XP in Nov 27-30.`, buffer);

            let sum = 0;
            relevant.forEach((t: any) => {
                const val = parseFloat(t['Valor']);
                sum += val;
                log(`${t['Data'].split('T')[0]} | ${t['Descricao_Original']} | ${val}`, buffer);
            });

            log('-----------------------------------', buffer);
            log(`TOTAL SUM FOUND: R$ ${sum.toFixed(2)}`, buffer);
            fs.writeFileSync(outPath, buffer.join('\n'));
        }
    });
};

processFile();
