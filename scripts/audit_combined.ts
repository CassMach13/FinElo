
import fs from 'fs';
import Papa from 'papaparse';

const fileCassio = 'c:\\Users\\cassi\\Downloads\\personal-finance-manager\\modelos de fatura\\Banco XP\\Extrato_XP_Cassio_Dez_2025.csv';
const fileIone = 'c:\\Users\\cassi\\Downloads\\personal-finance-manager\\modelos de fatura\\Banco XP\\Extrato_XP_Ione_Dez_2025.csv';
const outputFile = 'c:\\Users\\cassi\\Downloads\\personal-finance-manager\\scripts\\audit_result.txt';

const TARGET_FINAL_BALANCE = 152.78;
let logBuffer = '';

const log = (msg: string) => {
    console.log(msg);
    logBuffer += msg + '\n';
};

const parseValue = (valueStr: string): number => {
    if (typeof valueStr !== 'string' || valueStr.trim() === '') return 0;
    const essentialChars = valueStr.replace(/[^0-9,.-]/g, '');
    const normalized = essentialChars.replace(/\./g, '').replace(',', '.');
    const value = parseFloat(normalized);
    return isNaN(value) ? 0 : value;
};

let totalSum = 0;

const processFile = (path: string, name: string) => {
    const content = fs.readFileSync(path, 'utf-8');
    Papa.parse(content, {
        header: true,
        delimiter: ';',
        skipEmptyLines: true,
        complete: (results) => {
            log(`\n--- Processing ${name} ---`);
            results.data.forEach((row: any) => {
                const val = parseValue(row['Valor'] || row['VALOR']);
                const date = row['Data'];
                if (!date || !row['Valor']) return;
                totalSum += val;
            });
            log(`Subtotal after ${name}: R$ ${totalSum.toFixed(2)}`);
        }
    });
};

log('--- AUDIT START ---');
if (fs.existsSync(fileCassio)) processFile(fileCassio, 'Cassio');
if (fs.existsSync(fileIone)) processFile(fileIone, 'Ione');

log('\n--- RESULTS ---');
log(`Total "Movement" in December: R$ ${totalSum.toFixed(2)}`);
log(`Target Final Balance: R$ ${TARGET_FINAL_BALANCE.toFixed(2)}`);

const requiredInitial = TARGET_FINAL_BALANCE - totalSum;

log(`\nREQUIRED INITIAL BALANCE (01/12): R$ ${requiredInitial.toFixed(2)}`);
log('-------------------------------------------');

fs.writeFileSync(outputFile, logBuffer);
