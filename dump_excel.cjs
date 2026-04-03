const xlsx = require('xlsx');
const path = require('path');

const filePath = 'c:\\Users\\cassi\\Downloads\\personal-finance-manager\\modelos de fatura\\Bancos_Configurados\\Investimentos_XP.xlsx';

try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    rawData.slice(50, 61).forEach((row, i) => {
        console.log(`Row ${50+i}:`, JSON.stringify(row));
    });
    console.log('--- END DUMP ---');
} catch (err) {
    console.error('Error reading file:', err);
}
