import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({users:new Map<string,any>(),stale:false,offline:false,hold:false,release:null as null|(()=>void),calls:[] as any[],transport:null as typeof fetch|null}));
vi.mock('../../src/supabaseClient',async(importOriginal)=>{
 const {createClient}=await import('@supabase/supabase-js');
 const account=(token:string)=>{try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).sub}catch{return null}};
 const transport=async(input:any,init:any={})=>{
  const url=new URL(String(input)),headers=new Headers(init.headers),method=init.method??'GET';
  const body=typeof init.body==='string'?JSON.parse(init.body):{};
  const actor=url.pathname.endsWith('/token')?(body.refresh_token?.replace('synthetic-refresh-','')??body.email?.split('@')[0]):account((headers.get('authorization')??'').replace('Bearer ',''));
  fixture.calls.push({path:url.pathname,method,actor});
  const response=(value:any,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
  if(fixture.offline)return response({msg:'Synthetic offline',code:'fixture_unavailable'},400);
  if(url.pathname.endsWith('/logout'))return response({});
  if(!actor||!fixture.users.has(actor))return response({msg:'Synthetic account required'},401);
  if(method==='PUT'){
   if(fixture.hold)await new Promise<void>(r=>{fixture.release=r});
   const old=fixture.users.get(actor);fixture.users.set(actor,{...old,user_metadata:{...old.user_metadata,...body.data}});
  }
  const stored=fixture.users.get(actor),user=fixture.stale?{...stored,user_metadata:{...stored.user_metadata,appearance_theme:'dark'}}:stored;
  if(url.pathname.endsWith('/token'))return response({access_token:jwt(actor),refresh_token:'synthetic-refresh-'+actor,expires_in:3600,token_type:'bearer',user});
  return response(user);
 };
 function jwt(id:string){const encode=(v:any)=>Buffer.from(JSON.stringify(v)).toString('base64url');return encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'})+'.synthetic-signature'}
 const supabase=createClient('https://auth-fixture.invalid','synthetic-public-key',{global:{fetch:transport},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 fixture.transport=transport as typeof fetch;
 vi.stubEnv('VITE_SUPABASE_URL','https://auth-fixture.invalid');vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY','synthetic-public-key');vi.stubEnv('VITE_SUPABASE_ANON_KEY','synthetic-public-key');vi.stubGlobal('fetch',fixture.transport);
 const original=await importOriginal<typeof import('../../src/supabaseClient')>();await original.supabase.auth.stopAutoRefresh();
 return{...original,supabase};
});
import {supabase} from '../../src/supabaseClient';
import {useAppStore as store} from '../../src/hooks/useAppStore';
const user=(id:string)=>({id,aud:'authenticated',email:id+'@example.invalid',created_at:'2026-01-01T12:00:00Z',app_metadata:{appearance_pilot:true},user_metadata:{appearance_theme:'dark'}});
function jwt(id:string){const e=(v:any)=>Buffer.from(JSON.stringify(v)).toString('base64url');return e({alg:'HS256',typ:'JWT'})+'.'+e({sub:id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'})+'.synthetic-signature'}
async function login(id:string){const{data,error}=await supabase.auth.setSession({access_token:jwt(id),refresh_token:'synthetic-refresh-'+id});expect(error).toBeNull();store.getState().setUser(data.user)}
let subscription:{unsubscribe:()=>void};
beforeEach(async()=>{
 fixture.stale=false;fixture.offline=false;fixture.hold=false;fixture.release=null;fixture.calls=[];fixture.users=new Map([['native-a',user('native-a')],['native-b',user('native-b')]]);
 vi.stubGlobal('fetch',fixture.transport);vi.stubEnv('MODE','staging');vi.stubEnv('VITE_APPEARANCE_PILOT','true');store.getState().setUser(null);await login('native-a');
 subscription=supabase.auth.onAuthStateChange((event,session)=>{if(event!=='INITIAL_SESSION')store.getState().setUser(session?.user??null)}).data.subscription;
});
afterEach(()=>{subscription.unsubscribe();store.getState().setUser(null);vi.unstubAllEnvs();vi.unstubAllGlobals()});
describe('Auth metadata: captured account and FIFO with the real SDK and HTTP helpers',()=>{
 it('records the actual SDK event sequence without exposing credentials',async()=>{
  fixture.hold=true;const pending=store.getState().updateUserPreferences({full_name:'PRIVATE_SYNTHETIC_A'});
  await vi.waitFor(()=>expect(fixture.release).not.toBeNull());
  const signed=await supabase.auth.signInWithPassword({email:'native-b@example.invalid',password:'synthetic-only-password'});
  expect(signed.error).toBeNull();expect(store.getState().user?.id).toBe('native-b');
  fixture.release!();await pending;const actual=(await supabase.auth.getSession()).data.session?.user.id;
  expect(actual).toBe('native-b');expect(store.getState().user?.id).toBe('native-b');
  expect(fixture.users.get('native-a').user_metadata.full_name).toBe('PRIVATE_SYNTHETIC_A');expect(fixture.users.get('native-b').user_metadata.full_name).toBeUndefined();expect(fixture.calls.filter(c=>c.method==='PUT').every(c=>c.actor==='native-a')).toBe(true);
 });
 it('stable account keeps the optimistic metadata and exact financial preference',async()=>{
  await store.getState().updateUserPreferences({full_name:'Synthetic profile',creditCardPaymentCategory:'Synthetic payment category'});
  expect(store.getState().user?.user_metadata).toMatchObject({full_name:'Synthetic profile',creditCardPaymentCategory:'Synthetic payment category'});
  expect(fixture.users.get('native-a').user_metadata).toMatchObject({full_name:'Synthetic profile',creditCardPaymentCategory:'Synthetic payment category'});
  expect((await supabase.auth.getSession()).data.session?.user.id).toBe('native-a');expect(fixture.calls.every(c=>c.path.startsWith('/auth/'))).toBe(true);
 });
 it('same account concurrent writes remain FIFO and merge optimistic fields',async()=>{
  fixture.hold=true;const first=store.getState().updateUserPreferences({full_name:'First'});await vi.waitFor(()=>expect(fixture.release).not.toBeNull());
  const second=store.getState().updateUserPreferences({creditCardPaymentCategory:'Second'});await Promise.resolve();await Promise.resolve();
  expect(fixture.calls.filter(c=>c.method==='PUT')).toHaveLength(1);fixture.hold=false;fixture.release!();await Promise.all([first,second]);
  expect(fixture.users.get('native-a').user_metadata).toMatchObject({full_name:'First',creditCardPaymentCategory:'Second'});expect(store.getState().user?.user_metadata).toMatchObject({full_name:'First',creditCardPaymentCategory:'Second'});
 });
 it('a queued old operation is discarded after account replacement',async()=>{
  fixture.hold=true;const first=store.getState().updateUserPreferences({full_name:'First A'});await vi.waitFor(()=>expect(fixture.release).not.toBeNull());const second=store.getState().updateUserPreferences({full_name:'Queued A'});
  await Promise.resolve();await Promise.resolve();await supabase.auth.signInWithPassword({email:'native-b@example.invalid',password:'synthetic-only-password'});fixture.hold=false;fixture.release!();await Promise.all([first,second]);
  expect(fixture.calls.filter(c=>c.method==='PUT')).toHaveLength(1);expect(fixture.users.get('native-a').user_metadata.full_name).toBe('First A');expect(store.getState().user?.id).toBe('native-b');
 });
 it('offline failure preserves the existing optimistic behavior without a financial request',async()=>{
  const silent=vi.spyOn(console,'error').mockImplementation(()=>{});fixture.offline=true;await store.getState().updateUserPreferences({full_name:'Offline A'});expect(store.getState().user?.user_metadata.full_name).toBe('Offline A');expect(fixture.users.get('native-a').user_metadata.full_name).toBeUndefined();expect(fixture.calls.every(c=>c.path.startsWith('/auth/'))).toBe(true);silent.mockRestore();
 });
 it('theme confirmation remains isolated while profile and TOKEN_REFRESHED occur',async()=>{
  await store.getState().updateUserPreferences({appearance_theme:'light'});await store.getState().updateUserPreferences({full_name:'Updated A'});fixture.stale=true;await supabase.auth.refreshSession();expect(store.getState().user?.user_metadata.appearance_theme).toBe('light');
 });

});
