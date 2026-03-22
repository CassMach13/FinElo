// Standalone test for Santander parsing logic
const parseMonetaryValue = (valueStr, format = 'BR') => {
  if (typeof valueStr !== 'string' || valueStr.trim() === '') return null;
  const cleaned = valueStr.replace(/[^\d,.-]/g, '');
  if (format === 'BR') {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  }
  return parseFloat(cleaned.replace(/,/g, ''));
};

const bankConfig = {
    creditColIndex: 4,
    debitColIndex: 5,
    valueColIndex: 5, 
    numberFormat: 'BR'
};

const rows = [
    ["20/03/2026 ", "PAGAMENTO CARTAO CREDITO BCE 20/03 13:25 CARTAO MASTER", "132526", "", "", "-577,64", "19.851,03"],
    ["20/03/2026 ", "PIX RECEBIDO FILIPPINI CORTINAS", "000000", "", "3.000,00", "", "21.810,79"],
    ["19/03/2026 ", "SALDO ANTERIOR", "", "", "", "", "20.950,79"]
];

console.log('--- TESTING SANTANDER PARSER LOGIC ---');
rows.forEach((row, i) => {
    let rawValue = (row[bankConfig.valueColIndex] || '').trim();
    const rawCredit = (row[bankConfig.creditColIndex] || '').trim();
    const rawDebit = (row[bankConfig.debitColIndex] || '').trim();
    
    if (rawCredit && rawCredit !== '0,00' && rawCredit !== '0') {
      rawValue = rawCredit;
    } else if (rawDebit && rawDebit !== '0,00' && rawDebit !== '0') {
      rawValue = rawDebit;
    }
    
    const parsed = parseMonetaryValue(rawValue, bankConfig.numberFormat);
    console.log(`[Row ${i}]`);
    console.log(`   Description: ${row[1].trim()}`);
    console.log(`   Raw Value:   "${rawValue}"`);
    console.log(`   Parsed:      ${parsed}`);
});
