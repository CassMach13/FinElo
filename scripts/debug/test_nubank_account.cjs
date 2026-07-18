// Standalone test for NuBank Account parsing logic
const parseMonetaryValue = (valueStr, format = 'US') => {
  if (typeof valueStr !== 'string' || valueStr.trim() === '') return null;
  const cleaned = valueStr.replace(/[^\d,.-]/g, '');
  if (format === 'BR') return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  return parseFloat(cleaned.replace(/,/g, ''));
};

const bankConfig = {
    dateColIndex: 0,
    descColIndices: [3],
    valueColIndex: 1,
    numberFormat: 'US',
    invertValues: false
};

const rows = [
    ["01/02/2026","866.00","697f2f23-aa79-46c0-9f7b-ff2cf8164838","Transferência recebida pelo Pix - FABIO"],
    ["02/02/2026","-293.15","6980a797-0962-4637-859d-4574f0519836","Pagamento de fatura"],
];

console.log('--- TESTING NUBANK ACCOUNT PARSER LOGIC ---');
rows.forEach((row, i) => {
    const rawDate = row[bankConfig.dateColIndex];
    const rawValue = row[bankConfig.valueColIndex];
    const rawDesc = row[bankConfig.descColIndices[0]];
    
    const parsedValue = parseMonetaryValue(rawValue, bankConfig.numberFormat);
    const finalValue = bankConfig.invertValues ? -parsedValue : parsedValue;
    const type = finalValue >= 0 ? 'Renda' : 'Despesa';

    console.log(`[Row ${i}] Date: ${rawDate} | Val: ${finalValue} | Type: ${type} | Desc: ${rawDesc.substring(0, 30)}...`);
});
