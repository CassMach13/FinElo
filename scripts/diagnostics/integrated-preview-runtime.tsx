import React,{useSyncExternalStore}from'react';
import{createRoot}from'react-dom/client';
import '../../src/index.css';
import '../../src/components/appearance/appearance.css';
import '../../src/components/appearance/financial.css';
import{createRemainingFixture}from'./remaining-fixtures';
import{isAppearancePilotEnabled,resolveAppearanceTheme,isAppearanceTheme,SYSTEM_DARK_QUERY}from'../../src/domain/appearance/theme';

const q=new URLSearchParams(location.search),baseline=q.get('baseline');
const prefix=baseline==='main'||baseline==='reviewed'?`/scripts/diagnostics/theme-integrated-${baseline}-baseline/src`:'/src';
const load=(p:string)=>(window as any).__integratedModule(location.origin+prefix+p);
const{useAppStore}=baseline==='main'||baseline==='reviewed'?await load('/hooks/useAppStore.ts'):await import('../../src/hooks/useAppStore');
const{supabase}=baseline==='main'||baseline==='reviewed'?await load('/supabaseClient.ts'):await import('../../src/supabaseClient');
const{default:App}=await load('/App.tsx');
let commits=0,calculations=0;const trace:any[]=[];
const balances=useAppStore.getState().getAccountsWithCalculatedBalance;
useAppStore.setState({getAccountsWithCalculatedBalance:(...args:any[])=>{calculations++;return balances(...args)}});
const read=()=>window.matchMedia(SYSTEM_DARK_QUERY).matches;
const subscribe=(cb:()=>void)=>{const m=window.matchMedia(SYSTEM_DARK_QUERY);m.addEventListener('change',cb);return()=>m.removeEventListener('change',cb)};
const none=()=>()=>{};
function QaEnvelope({children}:{children:React.ReactNode}){
 const user=useAppStore((s:any)=>s.user),eligible=isAppearancePilotEnabled(user),preference=isAppearanceTheme(user?.user_metadata.appearance_theme)?user.user_metadata.appearance_theme:'dark';
 const system=useSyncExternalStore(eligible&&preference==='system'?subscribe:none,read,()=>true);
 const theme=eligible?resolveAppearanceTheme(preference,system):'dark';
 return <div data-finelo-theme={theme} data-qa-eligible={String(eligible)} style={{display:'contents'}}>{children}</div>;
}
function snapshot(){const s=useAppStore.getState();return{actor:s.user?.id??null,view:s.currentView,user:s.user?{id:s.user.id,user_metadata:s.user.user_metadata,app_metadata:s.user.app_metadata}:null,accounts:s.accounts,transactions:s.transactions,economicEvents:s.economicEvents,categories:s.categories,assets:s.assets,goals:s.goals,budgets:s.budgets,supportTickets:s.supportTickets,adminMetrics:s.adminMetrics,isPremium:s.isPremium,isWealth:s.isWealth,initialDataLoadStatus:s.initialDataLoadStatus}}
function visible(){return{actor:useAppStore.getState().user?.id??null,text:document.querySelector('#root')?.textContent??'',fields:[...document.querySelectorAll<HTMLInputElement>('input,textarea')].filter(e=>e.getClientRects().length).map(e=>e.type==='password'||/pin|senha|password/i.test(e.id+e.name)?'<redacted>':e.value)}}
(window as any).__integratedQa={snapshot,trace:()=>trace,profile:()=>({commits,calculations}),fixture:createRemainingFixture,login:async(actor='a')=>{const{data,error}=await supabase.auth.signInWithPassword({email:`qa-${actor}@example.invalid`,password:'synthetic-qa-password'});if(error)throw error;return data.user?.id},logout:()=>supabase.auth.signOut(),refresh:()=>supabase.auth.refreshSession().then(({error}:any)=>{if(error)throw error}),metadata:(data:any)=>useAppStore.getState().updateUserPreferences(data),theme:(theme:string)=>useAppStore.getState().updateUserPreferences({appearance_theme:theme}),sdkActor:async()=>{const{data:{session}}=await supabase.auth.getSession();return session?.user.id??null},sdkName:async()=>{const{data:{session}}=await supabase.auth.getSession();return session?.user.user_metadata.full_name??null},navigate:(view:string)=>useAppStore.getState().setCurrentView(view)};
// Official SDK login, with the test runner fulfilling its HTTP requests. No SDK API is replaced.
if(q.has('login')&&q.get('login')!=='none'&&!(await supabase.auth.getSession()).data.session)await(window as any).__integratedQa.login(q.get('login')!);
history.replaceState(null,'','/app?view='+(q.get('view')??'dashboard'));
const root=createRoot(document.getElementById('root')!);
root.render(<QaEnvelope><React.Profiler id="integrated-local-qa" onRender={()=>{commits++;trace.push(visible())}}><App/></React.Profiler></QaEnvelope>);
