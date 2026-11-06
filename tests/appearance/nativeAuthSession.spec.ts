import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({users:new Map<string,any>(),stale:false,offline:false,hold:false,release:null as null|(()=>void),calls:[] as any[]}));
vi.mock('../../src/supabaseClient',async()=>{
 const {createClient}=await import('@supabase/supabase-js');
 const account=(token:string)=>{try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).sub}catch{return null}};
 const transport=async(input:any,init:any={})=>{
  const url=new URL(String(input)),headers=new Headers(init.headers),method=init.method??'GET';
  const body=typeof init.body==='string'?JSON.parse(init.body):{};
  const actor=url.pathname.endsWith('/token')?body.refresh_token?.replace('synthetic-refresh-',''):account((headers.get('authorization')??'').replace('Bearer ',''));
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
 return{supabase,persistAppearanceTheme:async(token:string,theme:string)=>{
  const response=await transport('https://auth-fixture.invalid/auth/v1/user',{method:'PUT',headers:{authorization:'Bearer '+token},body:JSON.stringify({data:{appearance_theme:theme}})});
  if(!response.ok)throw new Error('Synthetic preference failure');
 }};
});
import {supabase} from '../../src/supabaseClient';
import {useAppStore as store} from '../../src/hooks/useAppStore';
const user=(id:string)=>({id,aud:'authenticated',email:id+'@example.invalid',created_at:'2026-01-01T12:00:00Z',app_metadata:{appearance_pilot:true},user_metadata:{appearance_theme:'dark'}});
function jwt(id:string){const e=(v:any)=>Buffer.from(JSON.stringify(v)).toString('base64url');return e({alg:'HS256',typ:'JWT'})+'.'+e({sub:id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'})+'.synthetic-signature'}
async function login(id:string){const{data,error}=await supabase.auth.setSession({access_token:jwt(id),refresh_token:'synthetic-refresh-'+id});expect(error).toBeNull();store.getState().setUser(data.user)}
let subscription:{unsubscribe:()=>void};
beforeEach(async()=>{
 fixture.stale=false;fixture.offline=false;fixture.hold=false;fixture.release=null;fixture.calls=[];fixture.users=new Map([['native-a',user('native-a')],['native-b',user('native-b')]]);
 vi.stubEnv('MODE','staging');vi.stubEnv('VITE_APPEARANCE_PILOT','true');store.getState().setUser(null);await login('native-a');
 subscription=supabase.auth.onAuthStateChange((event,session)=>{if(event!=='INITIAL_SESSION')store.getState().setUser(session?.user??null)}).data.subscription;
});
afterEach(()=>{subscription.unsubscribe();store.getState().setUser(null);vi.unstubAllEnvs()});
describe('SDK Auth instalado com transporte fechado e sessões sintéticas',()=>{
 it('TOKEN_REFRESHED e USER_UPDATED desatualizados não sobrescrevem Claro confirmado',async()=>{
  await store.getState().updateUserPreferences({appearance_theme:'light'});
  // The direct captured-bearer write deliberately leaves the real SDK cache stale.
  expect((await supabase.auth.getSession()).data.session?.user.user_metadata.appearance_theme).toBe('dark');
  fixture.stale=true;await supabase.auth.refreshSession();expect(store.getState().user?.user_metadata.appearance_theme).toBe('light');
  await supabase.auth.updateUser({data:{full_name:'Synthetic profile'}});expect(store.getState().user?.user_metadata.appearance_theme).toBe('light');
  fixture.stale=false;await store.getState().syncAppearancePreferences();expect(store.getState().user?.user_metadata.appearance_theme).toBe('light');
  expect(fixture.calls.every(c=>c.path.startsWith('/auth/'))).toBe(true);
 });
 it('escrita pendente usa o bearer de A e não restaura A após SIGNED_IN de B',async()=>{
  fixture.hold=true;const pending=store.getState().updateUserPreferences({appearance_theme:'light'});
  await vi.waitFor(()=>expect(fixture.release).not.toBeNull());await login('native-b');fixture.release!();await pending;
  expect(fixture.users.get('native-a').user_metadata.appearance_theme).toBe('light');expect(fixture.users.get('native-b').user_metadata.appearance_theme).toBe('dark');expect(store.getState().user?.id).toBe('native-b');
 });
 it('logout e login novamente obtêm a escolha correta por conta',async()=>{
  await store.getState().updateUserPreferences({appearance_theme:'light'});await supabase.auth.signOut({scope:'local'});expect(store.getState().user).toBeNull();await login('native-b');expect(store.getState().user?.user_metadata.appearance_theme).toBe('dark');await login('native-a');expect(store.getState().user?.user_metadata.appearance_theme).toBe('light');
 });
 it('falha offline preserva confirmação; reconexão reconcilia sem ler finanças',async()=>{
  await store.getState().updateUserPreferences({appearance_theme:'light'});fixture.offline=true;await store.getState().syncAppearancePreferences();expect(store.getState().user?.user_metadata.appearance_theme).toBe('light');fixture.offline=false;await store.getState().syncAppearancePreferences();expect(store.getState().user?.user_metadata.appearance_theme).toBe('light');expect(fixture.calls.some(c=>c.path.includes('/rest/'))).toBe(false);
 });
 it('duas gravações concorrentes mantêm uma operação por conta',async()=>{
  fixture.hold=true;const first=store.getState().updateUserPreferences({appearance_theme:'light'});await vi.waitFor(()=>expect(fixture.release).not.toBeNull());await expect(store.getState().updateUserPreferences({appearance_theme:'dark'})).rejects.toThrow('já está sendo salva');fixture.release!();await first;expect(fixture.calls.filter(c=>c.method==='PUT')).toHaveLength(1);expect(store.getState().user?.user_metadata.appearance_theme).toBe('light');
 });
});
