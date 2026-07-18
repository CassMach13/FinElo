const XLSX = require('xlsx');
const fs = require('fs');

const filePath = 'c:\\Users\\cassi\\Downloads\\personal-finance-manager\\modelos de fatura\\Extrato_Santander.xls';

try {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  
  const filteredData = data.filter(row => row.some(cell => cell.toString().trim() !== ''));
  
  fs.writeFileSync('santander_structure.json', JSON.stringify(filteredData, null, 2));
  console.log('Structure saved to santander_structure.json');

} catch (error) {
  console.error('Error:', error.message);
}
