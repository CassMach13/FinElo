
import Papa from 'papaparse';

const brokenCsv = `Data,Descrição,Valor
"02/01/2026,PANIFICADORA E CONFEITARIA FAMILIA QUEIROZ LTDA,""-R$101,77"""
"05/01/2026,BIG SALGADOS,""-R$6,00"""`;

console.log("--- Original Broken Content ---");
console.log(brokenCsv);

// Strategy: Unwrap outer quotes if present
const cleanLine = (line: string) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        // Remove first and last char
        let content = trimmed.slice(1, -1);
        // Unescape double double-quotes to single double-quotes
        content = content.replace(/""/g, '"');
        return content;
    }
    return line;
};

const processedCsv = brokenCsv.split('\n').map(cleanLine).join('\n');

console.log("\n--- Processed Content ---");
console.log(processedCsv);

console.log("\n--- Parsing Processed Content ---");
Papa.parse(processedCsv, {
    header: false, // We'll detect header manually usually, but here testing structure
    complete: (results) => {
        console.log("Rows found:", results.data.length);
        console.log("Row 1 (Header):", results.data[0]);
        console.log("Row 2 (Data):", results.data[1]);
        console.log("Column Count:", results.data[1].length);
    }
});
