
import Papa from 'papaparse';

const csvContent = `Data,Descrição,Valor
"02/01/2026,PANIFICADORA E CONFEITARIA FAMILIA QUEIROZ LTDA,""-R$101,77"""
"02/01/2026,PANIFICADORA E CONFEITARIA FAMILIA QUEIROZ LTDA,""-R$105,64"""
"05/01/2026,BIG SALGADOS,""-R$6,00"""
`;

console.log("--- Testing Auto-Detect ---");
Papa.parse(csvContent, {
    header: false,
    delimiter: "", // Auto-detect
    complete: (results) => {
        console.log("Rows:", results.data);
    }
});

console.log("\n--- Testing Comma Delimiter ---");
Papa.parse(csvContent, {
    header: false,
    delimiter: ",",
    complete: (results) => {
        console.log("Rows:", results.data);
    }
});
