// Explicit local PostgreSQL 17 probe; never targets a remote database.
// Run: node tests/importScopeConcurrencyPostgres.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const fingerprintModule={exports:{}};
new Function('exports','require','module',ts.transpileModule(readFileSync('src/utils/importBatchIntegrity.ts','utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(fingerprintModule.exports,require,fingerprintModule);
const {buildStructuredImportFingerprint}=fingerprintModule.exports;
const ids={U:'11111111-1111-4111-8111-111111111111',V:'22222222-2222-4222-8222-222222222222',
  A:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',OTHER:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
const fixture=readFileSync('tests/importBatchIdentityPostgres.spec.ts','utf8').match(/const schema = `([\s\S]*?)`;/)?.[1];
assert(fixture,'Missing local schema fixture');
const schema=fixture.replace(/\$\{(U|V|A|B|OTHER)\}/g,(_,key)=>ids[key]);
const files=readdirSync('supabase/migrations').filter(f=>/^\d+_scope_import_idempotency.sql$/.test(f));
assert.equal(files.length,1);
const container=`finelo-pr64-idempotency-${process.pid}`;
function docker(args,input) {
  const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:60000});
  if(r.error || r.status!==0) throw new Error(r.error?.message || r.stderr || r.stdout);
  return r.stdout;
}
const psql=['exec','-i',container,'psql','-h','127.0.0.1','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'];
const query=sql=>docker(psql,sql);
const row={Data:'2026-08-10',Nome_Fantasia:'Fixture',Valor:-10,Fonte:'XP',Parcela_Atual:2,Total_Parcelas:3};
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
async function call(name,data=[row],account=ids.A,route='scoped') {
  const fingerprint=await buildStructuredImportFingerprint(data,account);
  return `select public.import_transactions_${route}(${literal(fingerprint)},${literal(name)},${literal(account)}::uuid,${literal(JSON.stringify(data))}::jsonb,${data.length})::text;`;
}
const auth=`set role authenticated;select set_config('request.jwt.claim.sub','${ids.U}',false);`;
let created=false;
try {
  docker(['run','--rm','-d','--network','none','--label','finelo.pr64.synthetic=true','--name',container,
    '-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine']); created=true;
  for(let attempt=0;attempt<30;attempt++) {
    const r=spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],{encoding:'utf8'});
    if(r.status===0) break;
    if(attempt===29) throw new Error('Local PostgreSQL did not become ready');
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  query(schema);
  query(readFileSync('supabase/migrations/20261004154539_persist_import_batch_identity.sql','utf8'));
  query(readFileSync(`supabase/migrations/${files[0]}`,'utf8'));
  // Session A keeps the unique reservation uncommitted. B must wait on it.
  const a=spawn('docker',psql,{stdio:['pipe','pipe','pipe']});
  let aText='',aError='';
  const aDone=new Promise((resolve,reject)=>{
    a.stdout.on('data',b=>{aText+=b;}); a.stderr.on('data',b=>{aError+=b;});
    a.on('error',reject); a.on('close',code=>code===0?resolve():reject(new Error(aError)));
  });
  a.stdin.write(`begin;${auth}${await call('same.csv')}select 'SESSION_A_READY';\n`);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Session A barrier timeout')),10000);
    const check=()=>{if(aText.includes('SESSION_A_READY')){clearTimeout(timer);a.stdout.off('data',check);resolve();}};
    a.stdout.on('data',check);check();
  });
  const b=spawn('docker',psql,{stdio:['pipe','pipe','pipe']});
  let bText='',bError='';
  const bDone=new Promise((resolve,reject)=>{
    b.stdout.on('data',x=>{bText+=x;});b.stderr.on('data',x=>{bError+=x;});
    b.on('error',reject);b.on('close',code=>code===0?resolve():reject(new Error(bError)));
  });
  b.stdin.end(`${auth}${await call('renamed.csv',[row],ids.A,'atomic')}`);
  let blocked=false;
  for(let attempt=0;attempt<30;attempt++) {
    blocked=query("select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%import_transactions_atomic%');").trim()==='t';
    if(blocked) break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  a.stdin.end('commit;\n');
  await Promise.all([aDone,bDone]);
  assert(blocked,'Second session did not contend for the unique reservation');
  const first=JSON.parse(aText.split('\n').find(s=>s.startsWith('{')));
  const second=JSON.parse(bText.split('\n').find(s=>s.startsWith('{')));
  assert.equal(first.duplicate,false);assert.equal(second.duplicate,true);
  assert.equal(first.import_log.id,second.import_log.id);
  assert.equal(query('select count(*) from public.transactions;').trim(),'1');
  assert.equal(query('select count(*) from public.import_logs;').trim(),'1');
  assert.equal(query('select count(*) from public.import_batches;').trim(),'1');
  const different=JSON.parse(query(`${auth}${await call('same.csv',[{...row,Valor:-20}])}`).split('\n').find(s=>s.startsWith('{')));
  const otherAccount=JSON.parse(query(`${auth}${await call('same.csv',[row],ids.B)}`).split('\n').find(s=>s.startsWith('{')));
  assert.equal(different.duplicate,false);assert.equal(otherAccount.duplicate,false);
  assert.equal(query('select count(*) from public.import_logs;').trim(),'3');
  console.log(JSON.stringify({result:'PASS',postgres:query('select version();').trim(),
    uniqueReservationWaitObserved:blocked,concurrentLogs:1,concurrentTransactions:1,concurrentBatches:1,
    renamedDuplicate:true,differentContent:true,differentAccount:true}));
} finally {
  if(created) docker(['rm','-f',container]);
}
