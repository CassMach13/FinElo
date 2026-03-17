import * as fs from 'fs';
import { xpInvestmentParser } from './src/services/parsers/xpInvestmentParser';

async function test() {
    const fileBuffer = fs.readFileSync('C:/Users/cassi/Downloads/personal-finance-manager/modelos de fatura/Investimentos XP/PosicaoDetalhada_XP_Cassio_Jan_2026.xlsx');

    // Convert Node Buffer to ArrayBuffer
    const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);

    const results = await xpInvestmentParser.parseExcel(arrayBuffer, '2026-02-01');
    console.log('Found:', results.length, 'investments');
    console.log(results);
}

test().catch(console.error);
