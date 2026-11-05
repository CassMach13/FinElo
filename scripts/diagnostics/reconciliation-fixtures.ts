export const RECONCILIATION_ACCOUNT='20000000-0000-4000-8000-000000000001';
export const RECONCILIATION_SECOND='20000000-0000-4000-8000-000000000003';
export const RECONCILIATION_OWNER='10000000-0000-4000-8000-000000000001';

/** All amounts declared as integer cents; no customer/account data. */
export function createReconciliationFixture(scenario:string){
 const month=scenario==='open'?'2026-11':'2026-09';
 const zero=scenario==='zero'||scenario==='resolved';
 const cents=scenario==='long'?123456789:10000;
 const facts=[
  {accountId:RECONCILIATION_ACCOUNT,referenceMonth:'2026-08',dueDate:'2026-09-20',statementCents:5000,paymentCents:1000},
  {accountId:RECONCILIATION_ACCOUNT,referenceMonth:month,dueDate:month==='2026-11'?'2026-12-20':'2026-10-20',statementCents:cents,paymentCents:cents+(zero?0:22)},
  {accountId:RECONCILIATION_SECOND,referenceMonth:'2026-10',dueDate:'2026-11-28',statementCents:90000,paymentCents:90123},
 ];
 return {scenario,accountId:RECONCILIATION_ACCOUNT,referenceMonth:month,facts,
  accounts:[{id:RECONCILIATION_ACCOUNT,limitCents:500000},{id:RECONCILIATION_SECOND,limitCents:80000}],
  // Defensive rendering of an inconsistent legacy server response. The current
  // domain does not manufacture this negative reconciliation delta.
  legacyDeltaCents:scenario==='negative'||scenario==='legacy'?-3456:null};
}
