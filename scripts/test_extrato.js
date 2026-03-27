import { readFileSync, writeFileSync } from 'fs';
import * as XLSX from 'xlsx';
const workbook = XLSX.read(readFileSync('c:/Users/cassi/Downloads/personal-finance-manager/modelos de fatura/Extrato_XP.xlsx'), {type: 'buffer'});
const sheetName = workbook.SheetNames[0];
const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true });
writeFileSync('c:/Users/cassi/Downloads/personal-finance-manager/scripts/extrato_out.json', JSON.stringify(data.slice(0, 15), null, 2));
