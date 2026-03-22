const XLSX = require('xlsx');

// Simplified excelSerialToDateStr from parserService.ts
const excelSerialToDateStr = (serial) => {
  const utcDays = serial - 25569;
  const date = new Date(utcDays * 86400 * 1000);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
};

// Simulation of convertExcelToCSV logic
const simulateConvertExcelToCSV = (filePath) => {
    const workbook = XLSX.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true });
    
    // In the real app, it detects date columns. Let's assume col 0 is date.
    const dateColIndices = new Set([0]);

    const csvLines = rows.map((row) => {
        if (!row) return '';
        const cols = row.map((cell, colIdx) => {
            if (cell === null || cell === undefined) return '';
            if (dateColIndices.has(colIdx) && typeof cell === 'number') {
                return excelSerialToDateStr(cell);
            }
            if (typeof cell === 'number') {
                const rounded = Math.round(cell * 100) / 100;
                return rounded.toFixed(2).replace('.', ',');
            }
            const str = String(cell);
            if (str.includes(';') || str.includes(',') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        });
        // Semicolon delimiter used in convertExcelToCSV
        return cols.join(';');
    });
    return csvLines.join('\n');
};

const filePath = 'c:\\Users\\cassi\\Downloads\\personal-finance-manager\\modelos de fatura\\Extrato_Santander.xls';
const csvContent = simulateConvertExcelToCSV(filePath);

console.log('--- CONVERTED CSV CONTENT (FIRST 50 LINES) ---');
const lines = csvContent.split('\n');
lines.slice(0, 50).forEach((line, i) => {
    console.log(`Line ${i}: ${line}`);
});

console.log('--- TESTING DETECTION ---');
const firstLines = lines.slice(0, 15).join('\n').toLowerCase();
console.log(`First lines contain 'extrato de conta corrente': ${firstLines.includes('extrato de conta corrente')}`);
console.log(`First lines contain 'descrição': ${firstLines.includes('descrição')}`);

console.log('--- TESTING PARSE (skipLines: 38) ---');
const skipLines = 38;
const contentAfterSkip = lines.slice(skipLines).join('\n');
console.log(`Header row (after skip): ${lines[skipLines]}`);

// Simulating Papa.parse
const data = contentAfterSkip.split('\n').filter(l => l.trim() !== '').map(l => l.split(';'));
const startRow = 1; // hasHeader: true

let successCount = 0;
for (let i = startRow; i < data.length; i++) {
    const row = data[i];
    const date = row[0]; // dateColIndex: 0
    const cred = row[4]; // creditColIndex: 4
    const deb = row[5];  // debitColIndex: 5
    const desc = row[1]; // descColIndex: 1
    
    console.log(`Row ${i}: Date="${date}", Desc="${desc}", Cred="${cred}", Deb="${deb}"`);
    if (date && desc && (cred || deb)) successCount++;
}

console.log(`Simulation finished. Success Count: ${successCount}`);
