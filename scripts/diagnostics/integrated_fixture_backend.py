"""Synthetic HTTP transport for the installed SDK. Not a Supabase service/RLS proof.
Only the test runner calls this module; no credentials or real endpoints are used.
"""
import base64,json,time,subprocess,copy,functools
from pathlib import Path
from urllib.parse import urlparse,parse_qs

A='10000000-0000-4000-8000-000000000001';B='10000000-0000-4000-8000-000000000002';ADMIN='10000000-0000-4000-8000-000000000003'
@functools.lru_cache(maxsize=1)
def fixture():
 code="import{readFileSync}from'node:fs';import{transform}from'esbuild';async function load(p){const{code}=await transform(readFileSync(p,'utf8'),{loader:'ts',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))}const m=await load('scripts/diagnostics/remaining-fixtures.ts'),i=await load('scripts/diagnostics/investment-fixtures.ts');const f=m.createRemainingFixture(),invest=i.createInvestmentFixture();console.log(JSON.stringify({...f,investmentFixture:invest}));"
 return json.loads(subprocess.check_output(['node','--input-type=module','-e',code],text=True,encoding='utf8'))
def safe(v):
 if isinstance(v,dict):return{k:safe(x)for k,x in v.items()if not any(t in k.lower()for t in['token','password','secret','authorization','apikey'])}
 if isinstance(v,list):return[safe(x)for x in v]
 return v
def jwt(actor):
 enc=lambda x:base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip('=')
 return enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'sub':actor,'aud':'authenticated','exp':int(time.time())+3600})+'.synthetic-signature'
def token_actor(token):
 try:return json.loads(base64.urlsafe_b64decode(token.split('.')[1]+'==='))['sub']
 except(Exception):return None

class Backend:
 def __init__(self,seed=None,preference=None):
  f=copy.deepcopy(seed or fixture());self.calls=[];self.writes=[];self.held=set();self.waiting=[];self.fail=set();self.stale=False;self.offline=False;self.rewrite_documents=True
  if seed is None:
   # Navigation uses a consistent schedule with no financing payments. The old
   # inconsistent 4C seed remains available explicitly for the legacy-risk probe.
   for asset in f['assets']:asset.update(remaining_balance=30000,paid_installments=0)
  self.users={}
  for actor,label in[(A,'a'),(B,'b'),(ADMIN,'admin')]:
   meta={'full_name':f'Pessoa_{label.upper()}_QA','terms_accepted_version':'v_2026_03_17_consumer_rights','onboarding_v1_dismissed_at':'2026-01-01T12:00:00Z'}
   if preference is not None:meta['appearance_theme']=preference
   self.users[actor]={'id':actor,'aud':'authenticated','role':'authenticated','email':f'qa-{label}@example.invalid'if actor!=ADMIN else'cassiomq@gmail.com','created_at':'2026-01-01T12:00:00Z','email_confirmed_at':'2026-01-01T12:00:00Z','identities':[],'app_metadata':{'appearance_pilot':actor!=B,'credit_card_engine_disabled':True,'card_v2_disabled':True,'atomic_imports_enabled':False,'dashboard_owner_scope_disabled':True,'investment_portfolios_disabled':True},'user_metadata':meta}
  self.db={'financial_goals':f['goals'],'contas':f['accounts'],'transactions':f['transactions'],'categories':f['categories'],'budgets':f['budgets'],'budget_months':[],'mapping_rules':f['mappingRules'],'import_configs':f['importConfigs'],'import_logs':[],'assets':f['assets'],'family_members':[],'support_tickets':f['tickets'],'support_messages':[m for t in f['tickets']for m in t['messages']],'subscriptions':[{'id':'synthetic-sub-'+a,'user_id':a,'status':'active','tier':'wealth','plan_type':'annual','plan':'wealth_annual','family_slots':5,'unlimited_sync':True}for a in self.users],'investments':[],'investment_portfolios':[],'investment_holdings':[],'economic_events':[],'credit_cards':[],'credit_card_statements':[],'credit_card_statement_entries':[],'credit_card_reprocess_jobs':[],'product_events':[]}
  inv=f.get('investmentFixture',{});self.db['investments']=inv.get('positions',[]);self.db['investment_portfolios']=inv.get('portfolios',[]);self.db['investment_holdings']=inv.get('holdings',[])
 def release(self,key):
  self.held.discard(key)
  waiting=self.waiting;self.waiting=[]
  for k,route,fn in waiting:
   if k==key:fn(route)
   else:self.waiting.append((k,route,fn))
 def hold_or(self,key,route,fn):
  if key in self.held:self.waiting.append((key,route,fn))
  else:fn(route)
 def fulfill(self,route,value,status=200,headers=None):
  route.fulfill(status=status,content_type='application/json',headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS',**(headers or{})},body=json.dumps(value,ensure_ascii=False))
 def route(self,route):
  req=route.request;url=urlparse(req.url)
  if url.hostname in['127.0.0.1','localhost']:
   if self.rewrite_documents and req.resource_type=='document'and url.path in['/app','/login','/pricing','/update-password']:
    # Ask Vite for its transformed entry, including the React Refresh preamble.
    # Returning raw source HTML on /app would break a real reload in development.
    response=route.fetch(url=f'{url.scheme}://{url.netloc}/scripts/diagnostics/integrated-preview.html'+('?' + url.query if url.query else''))
    return route.fulfill(response=response)
   if '/_vercel/'in url.path:return route.fulfill(status=200,content_type='application/javascript',body='')
   return route.continue_()
  if url.hostname!='integrated-fixture.invalid':return route.abort()
  if self.offline:return route.abort('internetdisconnected')
  if req.method=='OPTIONS':return self.fulfill(route,{})
  body=req.post_data_json if req.post_data else{};body=body or{};headers=req.all_headers();actor=token_actor(headers.get('authorization','').replace('Bearer ',''));query={k:v[-1]for k,v in parse_qs(url.query).items()}
  if url.path=='/auth/v1/token':
   actor=body.get('refresh_token','').replace('synthetic-refresh-','')if query.get('grant_type')=='refresh_token'else {'qa-a@example.invalid':A,'qa-b@example.invalid':B,'qa-admin@example.invalid':ADMIN}.get(body.get('email'))
  self.calls.append({'method':req.method,'path':url.path,'actor':actor,'query':safe(query),'body':safe(body)})
  if url.path.startswith('/auth/v1/'):
   if url.path.endswith('/logout'):return self.fulfill(route,{})
   if actor not in self.users:return self.fulfill(route,{'msg':'Synthetic authentication required','code':'bad_jwt'},401)
   key=('appearance:'if'appearance_theme'in body.get('data',{})else'profile:')+actor
   def auth_result(r):
    if key in self.fail:return self.fulfill(r,{'msg':'Synthetic offline failure','code':'fixture_unavailable'},503)
    if req.method=='PUT':
     self.users[actor]['user_metadata'].update(body['data']);self.writes.append({'kind':'auth','actor':actor,'data':safe(body['data'])})
    user=copy.deepcopy(self.users[actor])
    if self.stale and url.path.endswith('/token'):user['user_metadata']['appearance_theme']='dark'
    value={'access_token':jwt(actor),'refresh_token':'synthetic-refresh-'+actor,'expires_in':3600,'expires_at':int(time.time())+3600,'token_type':'bearer','user':user}if url.path.endswith('/token')else user
    self.fulfill(r,value)
   return self.hold_or(key,route,auth_result)if req.method=='PUT'else auth_result(route)
  if actor not in self.users:return self.fulfill(route,{'message':'Synthetic authentication required'},401)
  name=url.path.split('/')[-1]
  if'/rpc/'in url.path:
   value={'total_users':3,'premium_users':3,'wealth_users':3,'total_revenue':0,'crm_users':[]}if name=='get_admin_metrics'else 13 if'founder'in name else True if'touch'in name or'event'in name or'milestone'in name else[]
   return self.hold_or('rpc:'+name,route,lambda r:self.fulfill(r,value))
  if url.path.startswith('/functions/')or url.path.startswith('/storage/'):
   return self.fulfill(route,{'message':'Remote operation excluded from local navigation QA'},403)
  if name not in self.db:return self.fulfill(route,{'message':'Unknown synthetic table: '+name},403)
  rows=[r for r in self.db[name]if not r.get('user_id')or r['user_id']==actor or name=='support_tickets'and actor==ADMIN]
  def match(row):
   for k,v in query.items():
    if k in['select','order','limit','offset']:continue
    actual=str(row.get(k,''))
    if v.startswith('eq.')and actual!=v[3:]:return False
    if v.startswith('neq.')and actual==v[4:]:return False
    if v.startswith('ilike.')and actual.lower()!=v[6:].lower():return False
    if v.startswith('in.(')and actual not in v[4:-1].replace('"','').split(','):return False
   return True
  rows=copy.deepcopy([r for r in rows if match(r)])
  for part in reversed(query.get('order','').split(',')):
   key=part.split('.')[0]
   if key:rows.sort(key=lambda r:str(r.get(key,'')),reverse='.desc'in part)
  rows=rows[int(query.get('offset',0)):int(query.get('offset',0))+int(query.get('limit',len(rows)))]
  if name=='support_tickets':
   for r in rows:r['messages']=[m for m in self.db['support_messages']if m['ticket_id']==r['id']]
  if req.method=='GET':
   if 'read:'+name in self.fail:return self.fulfill(route,{'message':'Synthetic read failure'},503)
   return self.hold_or('read:'+name,route,lambda r:self.fulfill(r,(rows[0]if rows else None)if'vnd.pgrst.object'in headers.get('accept','')else rows,headers={'content-range':f'0-{max(0,len(rows)-1)}/{len(rows)}'}))
  self.writes.append({'kind':'data','table':name,'actor':actor,'body':safe(body)})
  # Financial mutations are forbidden in this integration transport, not simulated as successful.
  if name!='product_events':return self.fulfill(route,{'message':'Financial writes excluded from navigation QA'},403)
  return self.fulfill(route,[])
