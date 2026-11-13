import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {reverseSessionPatch} from './reverseSessionPatch';
import {functionalSourceHash,SESSION_STORE_APPROVED,SESSION_STORE_BEFORE,SESSION_STORE_C1_APPROVED,AUTH_CLIENT_APPROVED,AUTH_CLIENT_BEFORE} from './functionalSourceHash';

const m=vi.hoisted(()=>({user:null as any,hold:false,pending:[] as Array<()=>void>,calls:[] as any[]}));
vi.mock('../../src/supabaseClient',()=>({persistAppearanceTheme:vi.fn(),supabase:{
 auth:{getUser:async()=>({data:{user:m.user},error:null})},
 from:(table:string)=>{
  let operation='select',body:any;
  const chain:any=new Proxy({},{get:(_,key)=>key==='then'?(resolve:any,reject:any)=>{
   const actor=m.user?.id;
   const data=table==='support_tickets'?[{id:`ticket-${actor}`,user_id:actor}]:[{id:`goal-${actor}`,user_id:actor,name:'Private goal',target_amount:'10000.01',current_amount:'1250.01',...body?.[0]}];
   m.calls.push({table,operation,body});
   const value={data,error:null};
   return (m.hold?new Promise(r=>m.pending.push(()=>r(value))):Promise.resolve(value)).then(resolve,reject);
  }:(...args:any[])=>{if(['insert','update','delete'].includes(String(key))){operation=String(key);body=args[0]}return chain}});
  return chain;
 },
 rpc:async(name:string)=>{const value={data:{crm_users:[{id:m.user?.id}]},error:null};m.calls.push({rpc:name});return m.hold?new Promise(r=>m.pending.push(()=>r(value))):value},
}}));
import {useAppStore as store} from '../../src/hooks/useAppStore';
import {useDialogStore} from '../../src/hooks/useDialogStore';
const A={id:'synthetic-a',email:'cassiomq@gmail.com',user_metadata:{},app_metadata:{}},B={...A,id:'synthetic-b',email:'b@example.invalid'};
const auth=(user:any)=>{m.user=user;store.getState().setUser(user)};
const tick=async()=>{await Promise.resolve();await Promise.resolve()};
beforeEach(()=>{m.hold=false;m.pending=[];m.calls=[];auth(null);auth(A)});

describe('4C exceção de sessão autorizada, sem rede ou dados reais',()=>{
 it('limpa os caches identificados atomicamente antes de expor B',()=>{
  store.setState({goals:[{id:'a',user_id:A.id}] as any,goalsStatus:'success',goalsUserId:A.id,supportTickets:[{id:'a'}] as any,adminMetrics:{crm_users:[{id:A.id}]} as any,helpIntent:{tab:'history'} as any,isLoading:true});
  const renders:any[]=[];const off=store.subscribe(s=>renders.push({id:s.user?.id,goals:s.goals,tickets:s.supportTickets,metrics:s.adminMetrics}));
  auth(B);off();
  expect(renders.filter(r=>r.id===B.id).every(r=>!r.goals.length&&!r.tickets.length&&r.metrics===null)).toBe(true);
  expect(store.getState()).toMatchObject({goals:[],goalsStatus:'idle',goalsUserId:null,supportTickets:[],adminMetrics:null,helpIntent:null,isLoading:false});
 });
 it.each(['fetchSupportTickets','fetchAllTickets','fetchAdminMetrics'] as const)('%s descarta resposta de A concluída em B',async action=>{
  m.hold=true;const request=store.getState()[action]();await tick();expect(m.pending).toHaveLength(1);
  auth(B);const sentinel:any=[{id:'only-b',user_id:B.id}];store.setState({supportTickets:sentinel,adminMetrics:null});m.pending.splice(0).forEach(r=>r());await request;
  expect(store.getState().supportTickets).toEqual(sentinel);expect(store.getState().adminMetrics).toBeNull();expect(store.getState().isLoading).toBe(false);
 });
 it.each(['switch','logout-login'] as const)('criação tardia: %s não acrescenta objetivo de A à nova sessão',async mode=>{
  m.hold=true;const request=store.getState().createGoal({name:'Private goal',target_amount:10000.01,current_amount:1250.01,target_date:'2027-12-31'});await tick();
  expect(m.pending).toHaveLength(1);if(mode==='logout-login'){auth(null);auth(A)}else auth(B);
  m.pending.splice(0).forEach(r=>r());expect(await request).toBe(false);expect(store.getState().goals).toEqual([]);
  expect(m.calls).toEqual([{table:'financial_goals',operation:'insert',body:[{user_id:A.id,name:'Private goal',target_amount:10000.01,current_amount:1250.01,target_date:'2027-12-31'}]}]);
 });
 it('cancela confirmação de A com false e remove texto, sem executar a ação',async()=>{
  const pending=useDialogStore.getState().openDialog({title:'Private A',message:'Private A'});auth(B);
  expect(await pending).toBe(false);expect(useDialogStore.getState()).toMatchObject({isOpen:false,options:null});expect(m.calls).toEqual([]);
 });
 it('mesmo ID mantém cache e confirmação durante metadata/renovação',async()=>{
  store.setState({goals:[{id:'retained'}] as any});const pending=useDialogStore.getState().openDialog({title:'Same account'});auth({...A,user_metadata:{appearance_theme:'light'}});
  expect(store.getState().goals).toEqual([{id:'retained'}]);expect(useDialogStore.getState().isOpen).toBe(true);useDialogStore.getState().closeDialog(false);await pending;
 });
 it('recusa criação quando o SDK retorna outro titular antes da escrita',async()=>{
  m.user=B;expect(await store.getState().createGoal({name:'x',target_amount:1,current_amount:0,target_date:null})).toBe(false);expect(m.calls).toEqual([]);
 });
 it('preserva resultado normal e normalização monetária do objetivo',async()=>{
  expect(await store.getState().createGoal({name:'Private goal',target_amount:10000.01,current_amount:1250.01,target_date:null})).toBe(true);
  expect(store.getState().goals[0]).toMatchObject({user_id:A.id,target_amount:10000.01,current_amount:1250.01});expect(m.calls.map(c=>c.table)).toEqual(['financial_goals']);
 });
});

describe('exceção exata mantém todos os selos anteriores auditáveis',()=>{
 const sha=(s:string)=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
 it('reverte somente o patch aprovado e reconstrói o SHA original do store',()=>{
  const current=readFileSync('src/hooks/useAppStore.ts','utf8').replaceAll('\r\n','\n');
  expect(sha(current)).toBe(SESSION_STORE_APPROVED);
  const authPatch=readFileSync('docs/temas/proposta-preferencias-auth-4c.patch','utf8');
  const c1=reverseSessionPatch(current,authPatch,'src/hooks/useAppStore.ts');expect(sha(c1)).toBe(SESSION_STORE_C1_APPROVED);
  const original=reverseSessionPatch(c1,readFileSync('docs/temas/proposta-isolamento-4c.patch','utf8'),'src/hooks/useAppStore.ts');expect(sha(original)).toBe(SESSION_STORE_BEFORE);
  const client=readFileSync('src/supabaseClient.ts','utf8');expect(sha(client)).toBe(AUTH_CLIENT_APPROVED);expect(sha(reverseSessionPatch(client,authPatch,'src/supabaseClient.ts'))).toBe(AUTH_CLIENT_BEFORE);
 });
 it('qualquer alteração adicional no store continua quebrando o selo',()=>{
  const source=readFileSync('src/hooks/useAppStore.ts','utf8');expect(functionalSourceHash('src/hooks/useAppStore.ts',source+'\n// unrelated')).not.toBe(SESSION_STORE_BEFORE);
 });
 it('a única exceção de estrutura é a chave exata do shell por titular',()=>{
  const source=readFileSync('src/App.tsx','utf8');expect(source.match(/<MainLayout key=\{user\?\.id\} \/>/g)).toHaveLength(1);
 });
});
