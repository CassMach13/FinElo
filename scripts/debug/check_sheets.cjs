const XLSX = require('xlsx');
const filePath = 'c:\\Users\\cassi\\Downloads\\personal-finance-manager\\modelos de fatura\\Extrato_Santander.xls';
const workbook = XLSX.readFile(filePath);
console.log('Sheets:', workbook.SheetNames);
const worksheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true });
console.log('Total Rows:', rows.length);
rows.slice(0, 10).forEach((r, i) => console.log(`Row ${i}:`, JSON.stringify(r)));
