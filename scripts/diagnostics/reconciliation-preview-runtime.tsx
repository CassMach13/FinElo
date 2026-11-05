import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import '../../src/components/appearance/appearance.css';
import {createReconciliationFixture,RECONCILIATION_ACCOUNT,RECONCILIATION_SECOND,RECONCILIATION_OWNER} from './reconciliation-fixtures';

const params=new URLSearchParams(location.search),baseline=params.get('baseline');
const prefix=baseline==='main'||baseline==='reviewed'?`/scripts/diagnostics/theme-reconciliation-${baseline}-baseline/src`:'/src';
const load=(path:string)=>(window as any).__reconciliationModule(location.origin+prefix+path);
const {supabase}=await load('/supabaseClient.ts');
const {ReconciliationFlow}=await load('/components/modals/ReconciliationFlow.tsx');
const {default:Modal}=await load('/components/ui/Modal.tsx');
const {GlobalDialog}=await load('/components/ui/GlobalDialog.tsx');
const {projectCardTwoLedger}=await load('/domain/credit-card/twoLedgerProjection.ts');
const {groupActiveCardResolutions}=await load('/services/cardReconciliationService.ts');
const {isCreditCardEngineEnabled}=await load('/services/featureFlagService.ts');
const fixture=createReconciliationFixture(params.get('case')??'positive');
if(params.get('view')==='entry'){
 fixture.facts=fixture.facts.filter(f=>f.accountId===RECONCILIATION_ACCOUNT&&f.referenceMonth==='2026-09');
 fixture.accounts=fixture.accounts.filter(a=>a.id===RECONCILIATION_ACCOUNT);
}
const wire=(v:any):any=>JSON.parse(JSON.stringify(v));
const rows:any[]=[],reversals:any[]=[],events:any[]=[],uuidCalls:string[]=[],pending=new Map<string,Array<()=>void>>(),released=new Set<string>(),dedupe=new Map<string,any>();
let sequence=0,renderCommits=0,resolveAttempts=0,sessionActive=true,initialCompute=true;
const engine=params.get('engine')??'new';
const user={id:RECONCILIATION_OWNER,email:'reconciliation-fixture@example.invalid',app_metadata:{credit_card_engine_enabled:engine==='new',credit_card_engine_disabled:engine!=='new',card_v2_enabled:engine==='v2',card_v2_disabled:engine!=='v2',card_v2_shadow_disabled:true},user_metadata:{}};
supabase.auth.getUser=async()=>({data:{user:sessionActive?user:null},error:null});
// IDs are deterministic for cross-variant payload equality, never credentials.
crypto.randomUUID=()=>{const id=`70000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;uuidCalls.push(id);return id as `${string}-${string}-${string}-${string}-${string}`;};
const response=(v:any,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
const wait=(key:string)=>new Promise<void>(resolve=>pending.set(key,[...(pending.get(key)??[]),resolve]));
const active=()=>rows.filter(row=>!reversals.some(r=>r.resolution_id===row.id));
function projection(accountId:string){
 const resolutions=groupActiveCardResolutions(rows.map(row=>({...row,credit_card_reconciliation_resolution_reversals:reversals.filter(r=>r.resolution_id===row.id)})));
 return projectCardTwoLedger(fixture.facts.filter(f=>f.accountId===accountId).map(f=>({referenceMonth:f.referenceMonth,dueDate:f.dueDate,statementTotal:f.statementCents/100,totalPayments:f.paymentCents/100})),{asOf:'2026-11-05',resolutionsByMonth:resolutions[accountId]??{}});
}
function computation(accountId:string,referenceMonth:string){
 const p=projection(accountId),c=p.competences.find((c:any)=>c.referenceMonth===referenceMonth);
 if(!c)throw Error('Competência fora da fixture');
 return {referenceMonth,deltaCents:accountId===fixture.accountId&&fixture.legacyDeltaCents!==null?fixture.legacyDeltaCents:c.unresolvedReconciliationDeltaCents,economicOpenBalanceCents:c.economicOpenBalanceCents,economicStatus:c.economicStatus,reconciliationStatus:c.reconciliationStatus,economicUsedCents:p.economicUsedCents,economicCarryCents:p.economicCarryCents};
}
function seed(accountId=fixture.accountId,referenceMonth=fixture.referenceMonth){
 const delta=computation(accountId,referenceMonth).deltaCents;
 rows.push({id:'80000000-0000-4000-8000-'+String(rows.length+1).padStart(12,'0'),account_id:accountId,user_id:RECONCILIATION_OWNER,reference_month:referenceMonth,resolution:'bank_adjustment',resolved_amount:delta/100,delta_amount:delta/100,authoritative_statement_total:null,authoritative_source:null,created_at:'2026-11-01T12:00:00Z'});
}
if(['active','reverse-blocked','long-active'].includes(fixture.scenario)){
 seed();if(fixture.scenario==='long-active')for(let i=0;i<11;i++)seed();
}
(window as any).__reconciliationTransport=async(url:URL,method:string,body:any,headers:Headers)=>{
 const resource=url.pathname.split('/').at(-1);
 const relevant=resource==='card-reconciliation'||resource==='credit_card_reconciliation_resolutions';
 if(relevant&&(!sessionActive||fixture.scenario==='authorization'))return response({error:'Acesso sintético negado. Sessão sem autorização.'},403);
 if(resource==='credit_card_reconciliation_resolutions'&&method==='GET'){
  const selected=rows.filter(row=>[...url.searchParams].every(([key,value])=>!value.startsWith('eq.')||String(row[key])===value.slice(3)));
  return response(selected.map(row=>({...row,credit_card_reconciliation_resolution_reversals:reversals.filter(r=>r.resolution_id===row.id)})));
 }
 if(resource==='card-reconciliation'&&method==='POST'){
  events.push({action:body.action,payload:wire(body)});
  if(body.action==='compute'){
   if(fixture.scenario==='load-error'&&initialCompute){initialCompute=false;return response({error:'Falha sintética antes do cálculo'},503);}
   if((fixture.scenario==='loading'||fixture.scenario==='late-compute'&&body.accountId===fixture.accountId)&&!released.has('compute'))await wait('compute');
   const result=computation(body.accountId,body.referenceMonth);events.push({action:'compute-result',accountId:body.accountId,result:wire(result)});return response(result);
  }
  if(body.action==='resolve'){
   resolveAttempts++;
   if(fixture.scenario==='refused'||fixture.scenario==='reverse-blocked')return response({error:'Resolução sintética bloqueada por autorização'},403);
   if(fixture.scenario==='fail-before'&&resolveAttempts===1)return response({error:'Recusa sintética antes de gravar'},422);
   if(['pending','switch-pending'].includes(fixture.scenario)&&!released.has('resolve'))await wait('resolve');
   if(!sessionActive)return response({error:'Sessão sintética encerrada'},401);
   if(dedupe.has(body.idempotencyKey)){
    if(fixture.scenario==='double-timeout'&&resolveAttempts<=2)return response({error:'upstream request timeout'},504);
    return response({...dedupe.get(body.idempotencyKey),idempotent_replay:true});
   }
   const d=computation(body.accountId,body.referenceMonth).deltaCents;
   const row={id:'80000000-0000-4000-8000-'+String(rows.length+1).padStart(12,'0'),account_id:body.accountId,user_id:RECONCILIATION_OWNER,reference_month:body.referenceMonth,resolution:body.resolution,resolved_amount:body.resolution==='authoritative_total'?null:d/100,delta_amount:d/100,authoritative_statement_total:body.authoritativeTotalCents==null?null:body.authoritativeTotalCents/100,authoritative_source:body.authoritativeSource,created_at:'2026-11-05T12:00:00Z'};
   rows.push(row);const result={id:row.id,idempotent_replay:false,resolved_amount:row.resolved_amount};dedupe.set(body.idempotencyKey,result);
   if(['timeout-after','double-timeout'].includes(fixture.scenario))return response({error:'upstream request timeout'},504);
   return response(result);
  }
  if(body.action==='reverse'){
   if(fixture.scenario==='reverse-blocked')return response({error:'Reversão sintética não permitida'},403);
   if(dedupe.has(body.idempotencyKey))return response({...dedupe.get(body.idempotencyKey),idempotent_replay:true});
   const result={id:'90000000-0000-4000-8000-'+String(reversals.length+1).padStart(12,'0'),idempotent_replay:false};
   reversals.push({...result,resolution_id:body.resolutionId});dedupe.set(body.idempotencyKey,result);return response(result);
  }
 }
 const fallback=(window as any).__cardTransport;
 return fallback?fallback(url,method,body,headers):response({error:'Operação fora da fixture'},403);
};
let navigation:(a:string,m:string)=>void=()=>{};
function snapshot(){return wire({fixture,rows,reversals,active:active(),projections:fixture.accounts.map(a=>({accountId:a.id,limitCents:a.limitCents,availableCents:Math.max(a.limitCents-projection(a.id).economicUsedCents,0),...projection(a.id)})),events,uuidCalls,requests:(window as any).__reconciliationRequests,sessionActive});}
(window as any).__reconciliationPreview={snapshot,profile:()=>({renderCommits,requests:(window as any).__reconciliationRequests.length,events:events.length,uuidCalls:uuidCalls.length,card:(window as any).__cardPreview?.profile()??null}),release:(key:string)=>{released.add(key);const queue=pending.get(key)??[];pending.delete(key);queue.forEach(resolve=>resolve());},navigate:(accountId:string,month:string)=>navigation(accountId,month),endSession:()=>{sessionActive=false;},eligible:()=>isCreditCardEngineEnabled(user)};
const theme=params.get('theme')==='light'?'light':'dark';
function Preview(){
 const [target,setTarget]=React.useState({accountId:fixture.accountId,month:fixture.referenceMonth}),[open,setOpen]=React.useState(false);
 navigation=(accountId,month)=>setTarget({accountId,month});
 return <div data-finelo-theme={theme} className="bg-theme-canvas text-theme-content min-h-screen p-4 sm:p-6"><React.Profiler id="reconciliation-reference" onRender={()=>{renderCommits++;}}>
  <button type="button" onClick={()=>setOpen(true)}>Abrir referência sintética</button>
  {open&&<Modal manageFocus key={`${target.accountId}-${target.month}`} isOpen title="Conciliar diferença" className="max-w-lg" onClose={()=>setOpen(false)}>
   <ReconciliationFlow accountId={target.accountId} referenceMonth={target.month} onClose={()=>setOpen(false)} onResolved={()=>events.push({action:'resolved-callback',accountId:target.accountId,referenceMonth:target.month})}/>
  </Modal>}<GlobalDialog/>
 </React.Profiler></div>;
}
if(params.get('view')==='entry'){
 await import('./card-preview-runtime');
 const {useAppStore}=await load('/hooks/useAppStore.ts');
 const state=useAppStore.getState();
 useAppStore.setState({transactions:state.transactions.map((row:any)=>String(row.Nome_Fantasia).includes('Pagamento')?{...row,Valor:row.Valor>0?100.22:-100.22}:row)});
}else createRoot(document.getElementById('root')!).render(<Preview/>);
