
import fs from 'fs';
import Papa from 'papaparse';

const filePath = 'c:\\Users\\cassi\\Downloads\\personal-finance-manager\\modelos de fatura\\transacoes_2026-01-01.csv';

const processFile = () => {
    if (!fs.existsSync(filePath)) { console.error('File not found'); return; }

    const content = fs.readFileSync(filePath, 'utf-8');

    Papa.parse(content, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
            console.log(`--- ACCOUNT MAPPING CHECK (${results.data.length} rows) ---`);

            // Look for transactions from "Fatura..." sources
            const cardTx = results.data.filter((r: any) =>
                (r['Fonte'] || '').toLowerCase().includes('fatura') ||
                (r['Fonte'] || '').toLowerCase().includes('cartao')
            );

            if (cardTx.length === 0) {
                console.log('No Credit Card transactions found in file? Check keywords.');
                return;
            }

            console.log(`Found ${cardTx.length} transactions from Fatura/Card sources.`);

            // Group by "Conta" (Target Account)
            const accountMap = new Map<string, number>();
            cardTx.forEach((r: any) => {
                const acc = r['Conta'] || r['Nome_Conta'] || 'Active Account (Unknown)'; // CSV column might rely on export format
                const count = accountMap.get(acc) || 0;
                accountMap.set(acc, count + 1);
            });

            console.log('\nDistribution of Card Transactions by Target Account:');
            accountMap.forEach((count, acc) => {
                console.log(`- [${acc}]: ${count} transactions`);
            });

            // Also check duplicates for "Pagamento de Fatura" specifically in Dec
            const payments = results.data.filter((r: any) =>
                (r['Descricao_Original'] || '').toUpperCase().includes('PAGAMENTO') &&
                (r['Descricao_Original'] || '').toUpperCase().includes('FATURA') &&
                r['Data']?.includes('2025-12')
            );

            console.log('\n"Pagamento de Fatura" in Dec 2025:');
            payments.forEach((p: any) => {
                console.log(` ${p['Data'].split('T')[0]} | ${p['Valor']} | ${p['Descricao_Original']} | Acc: ${p['Conta']}`);
            });

        }
    });
};

processFile();
