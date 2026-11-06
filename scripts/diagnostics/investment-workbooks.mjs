import fs from 'node:fs';
import path from 'node:path';
import xlsx from 'xlsx';
const out=process.argv[2]??'node_modules/.finelo-cycle4b-tools/workbooks';fs.mkdirSync(out,{recursive:true});
const blank=[' ',' ',' '];
function workbook(kind){
 const header=[' ',null,null,null,null,'Conta: 0000000 | Data da Posição Histórica: 30/11/2026'];
 const sections=[['Fundos de Investimentos',null,null,null,null,null,'R$ 10.000,10'],blank,['61,7% | Pós-Fixado',null,null,kind==='invalid'?'Valor desconhecido':'Saldo','% Alocação','Valor aplicado','Saldo líquido'],['Fundo sintético QA','','','R$ 10.000,10','58%','R$ 9.800,00','R$ 9.950,00'],blank,['Renda Fixa',null,null,null,null,null,'R$ 2.135,87'],blank,['13,3% | Pós-Fixado','Saldo a mercado','% Alocação','Valor aplicado','Valor aplicado original','Rentabilidade a mercado','Data aplicação','Data vencimento','Saldo líquido'],['LCA sintética QA','R$ 2.135,87','12%','R$ 2.127,01','R$ 0,00','80,50% CDI','17/08/2026','11/02/2028','R$ 2.135,87'],blank,['Previdência Privada',null,null,null,null,null,'R$ 5.000,00'],blank,['30% | Multimercados',null,null,'Saldo','% Alocação','Rendimento bruto','Valor aplicado'],['Previdência sintética QA','','','R$ 5.000,00','30%','R$ 500,00','R$ 4.500,00']];
 const rows=[header,blank,['Pessoa QA, este é o seu patrimônio','Total investido histórico','Saldo Disponível histórico'],['R$ 17.259,42','R$ 17.259,42','R$ 123,45'],blank,...(kind==='empty'?[]:sections)];
 const wb=xlsx.utils.book_new();xlsx.utils.book_append_sheet(wb,xlsx.utils.aoa_to_sheet(rows),'Sua carteira');xlsx.writeFile(wb,path.join(out,kind+'.xlsx'));
}
for(const kind of ['valid','invalid','empty'])workbook(kind);
fs.writeFileSync(path.join(out,'corrupt.xlsx'),'Arquivo sintético inválido, sem dados de produção.');
console.log('4 arquivos sintéticos gerados.');
