
import fs from 'fs';
import Papa from 'papaparse';

const filePath = 'c:\\Users\\cassi\\Downloads\\personal-finance-manager\\modelos de fatura\\Banco XP\\Extrato_XP_Cassio_Dez_2025.csv';

console.log('--- STARTING DEBUG SCRIPT v2 ---');
console.log(`Reading file: ${filePath}`);

if (!fs.existsSync(filePath)) {
    console.error('ERROR: File not found!');
    process.exit(1);
}

const fileContent = fs.readFileSync(filePath, 'utf-8');
// Also try latin1 just in case
// const fileContent = fs.readFileSync(filePath, 'latin1'); 

Papa.parse(fileContent, {
    header: true,
    delimiter: ';',
    skipEmptyLines: true,
    complete: (results) => {
        console.log(`Parsed ${results.data.length} rows.`);
        console.log('--- HEADERS (Keys) ---');
        if (results.data.length > 0) {
            // Log headers to check encoding
            console.log(Object.keys(results.data[0]));
        }
        console.log('----------------------');

        let robertoFound = false;
        let val24Found = false;

        results.data.forEach((row: any, index) => {
            const rawRowValues = Object.values(row).join(' ').toUpperCase();

            if (rawRowValues.includes('ROBERTO')) {
                robertoFound = true;
                console.log(`\n[MATCH "ROBERTO"] Row ${index + 2}:`);
                console.log('Raw Row:', row);
            }

            if (rawRowValues.includes('24,00') || rawRowValues.includes('24.00')) {
                val24Found = true;
                console.log(`\n[MATCH "24,00"] Row ${index + 2}:`);
                console.log('Raw Row:', row);
            }
        });

        if (!robertoFound) console.log('\n[WARNING] "ROBERTO" NOT FOUND in parsed data.');
        if (!val24Found) console.log('\n[WARNING] "24,00" NOT FOUND in parsed data.');
    }
});
