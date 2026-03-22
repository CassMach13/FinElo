const XLSX = require('xlsx');
const path = require('path');

const filePath = 'c:\\Users\\cassi\\Downloads\\personal-finance-manager\\modelos de fatura\\Extrato_Santander.xls';

try {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // Convert to JSON ignoring empty rows to see the structure
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  
  console.log('--- SANTANDER XLS STRUCTURE ---');
  data.forEach((row, index) => {
    console.log(`Row ${index}:`, JSON.stringify(row));
  });
  console.log('--- END OF STRUCTURE ---');

} catch (error) {
  console.error('Error reading the file:', error.message);
}
