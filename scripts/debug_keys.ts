
import fs from 'fs';
import Papa from 'papaparse';

const filePath = 'c:\\Users\\cassi\\Downloads\\personal-finance-manager\\modelos de fatura\\Banco XP\\Extrato_XP_Cassio_Dez_2025.csv';

const fileContent = fs.readFileSync(filePath, 'utf-8'); // Read as UTF-8 to see the breakage if any

Papa.parse(fileContent, {
    header: true,
    delimiter: ';',
    skipEmptyLines: true,
    complete: (results) => {
        if (results.data.length > 0) {
            console.log('--- KEYS FOUND (UTF-8 Parsing) ---');
            const keys = Object.keys(results.data[0]);
            keys.forEach(k => console.log(`"${k}"`));

            const expected = "Lançamento";
            const match = keys.find(k => k === expected);
            console.log(`Match for "${expected}":`, match ? 'YES' : 'NO');

            if (!match) {
                console.log('Likely Encoding Issue. Keys look like:', keys);
            }
        } else {
            console.log('No data found.');
        }
    }
});
