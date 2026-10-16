import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({from:vi.fn(),positions:vi.fn()}));
vi.mock('../../src/supabaseClient',()=>({supabase:{from:mocks.from}}));
vi.mock('../../src/services/investmentService',()=>({investmentService:{getLatestPositionsByOwner:mocks.positions}}));
import { readCurrentNetWorthSources, createCurrentNetWorthLoader, currentNetWorthStateFor, type CurrentNetWorthRequest, type CurrentNetWorthSources, type CurrentNetWorthLoadState } from '../../src/services/currentNetWorthSources';
import { readCurrentCardEconomicInputs } from '../../src/services/currentCardEconomicInputs';
import { listCompetencePaymentConfirmationsReadOnly } from '../../src/services/competenceInvoiceUserConfirmations';
import { isNetWorthComponentsV2Enabled } from '../../src/services/featureFlagService';
const bank={id:'bank',user_id:'a',Nome_Conta:'Banco',Tipo_Conta:'Conta Corrente',Saldo_Inicial:201.43,Data_Saldo_Inicial:'2025-01-01'} as any;
const card={...bank,id:'card',Tipo_Conta:'Cartão de Crédito'};
const request=(scope='self'):CurrentNetWorthRequest=>({sessionUserId:'a',scopeKey:scope,asOf:'2026-10-15',accounts:[bank,card],ownerIds:['a']});
let tables:Record<string,any[]>,calls:any[],failure:string|null;
const local={getItem:vi.fn(),setItem:vi.fn(),removeItem:vi.fn()};
beforeEach(()=>{
  calls=[];failure=null;
  tables={contas:[bank,card],transactions:[],assets:[],import_logs:[],credit_card_competence_payment_confirmations:[],credit_card_reconciliation_resolutions:[]};
  local.getItem.mockReturnValue(null);local.setItem.mockClear();local.removeItem.mockClear();
  vi.stubGlobal('localStorage',local);
  mocks.positions.mockReset().mockResolvedValue([{ownerUserId:'a',monthKey:null,balances:[]}]);
  mocks.from.mockReset().mockImplementation((table:string)=>{
    const filters:Array<{column:string;ids:string[]}>=[];
    const query:any={
      select:vi.fn(()=>query),
      in:vi.fn((column:string,ids:string[])=>{filters.push({column,ids});calls.push({table,column,ids});return query;}),
      order:vi.fn(()=>query),
      range:vi.fn(async(from:number,to:number)=>{
        calls.push({table,from,to});
        const rows=(tables[table]||[]).filter(r=>filters.every(f=>f.ids.includes(r[f.column])));
        return {data:rows.slice(from,to+1),error:table===failure?{message:'synthetic read failure'}:null};
      }),
    };return query;
  });
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const confirmation=(amount=100)=>({user_id:'a',account_id:'card',reference_month:'2026-09',settled_amount:amount,confirmed_at:'2026-10-12T12:00:00Z'});
describe('leituras patrimoniais sem migração ou persistência',()=>{
  it('não toca no banco com lista vazia de cartões',async()=>{
    expect(await readCurrentCardEconomicInputs([])).toEqual({confirmations:[],resolutions:{}});
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('preserva confirmação local legada sem upsert nem alteração de storage',async()=>{
    local.getItem.mockReturnValue(JSON.stringify([{userId:'a',accountId:'card',referenceMonth:'2026-09',settledAmount:100,confirmedAt:'2026-10-12T12:00:00Z'}]));
    const rows=await listCompetencePaymentConfirmationsReadOnly([card]);
    expect(rows[0]).toMatchObject({source:'legacy_local',settledAmount:100});
    expect(local.setItem).not.toHaveBeenCalled();expect(local.removeItem).not.toHaveBeenCalled();
  });
  it('confirmação do banco prevalece sobre a mesma chave local, sem somar duas vezes',async()=>{
    local.getItem.mockReturnValue(JSON.stringify([{userId:'a',accountId:'card',referenceMonth:'2026-09',settledAmount:100,confirmedAt:'2026-10-12T12:00:00Z'}]));
    tables.credit_card_competence_payment_confirmations=[confirmation(150)];
    const rows=await listCompetencePaymentConfirmationsReadOnly([card]);
    expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({source:'database',settledAmount:150});
  });
  it('filtra confirmações por conta e dono, e aceita cartões de familiar autorizado',async()=>{
    const relative={...card,id:'relative',user_id:'b'};
    tables.credit_card_competence_payment_confirmations=[confirmation(),{...confirmation(),account_id:'relative',user_id:'b'},{...confirmation(),account_id:'outside',user_id:'c'},{...confirmation(),user_id:'wrong'}];
    expect(await listCompetencePaymentConfirmationsReadOnly([card,relative])).toHaveLength(2);
  });
  it('reversões como objeto ou array são excluídas; origem do total oficial é preservada',async()=>{
    const base={account_id:'card',reference_month:'2026-09',resolution:'economic_credit',resolved_amount:22,authoritative_total:null,authoritative_source:null};
    tables.credit_card_reconciliation_resolutions=[
      {...base,credit_card_reconciliation_resolution_reversals:[{id:'reverse'}]},
      {...base,credit_card_reconciliation_resolution_reversals:{id:'reverse'}},
      {...base,resolution:'authoritative_total',authoritative_total:300,authoritative_source:'bank_app',credit_card_reconciliation_resolution_reversals:[]},
    ];
    const data=await readCurrentCardEconomicInputs([card]);
    expect(data.resolutions.card['2026-09']).toEqual([{kind:'authoritative_total',resolvedAmountCents:2200,authoritativeStatementTotalCents:30000,authoritativeSource:'bank_app'}]);
  });
  it('pagina confirmações sem truncar a lista no limite padrão',async()=>{
    tables.credit_card_competence_payment_confirmations=Array.from({length:1001},(_,i)=>({...confirmation(),reference_month:'synthetic-'+i}));
    expect(await listCompetencePaymentConfirmationsReadOnly([card])).toHaveLength(1001);
    expect(calls).toContainEqual({table:'credit_card_competence_payment_confirmations',from:1000,to:1999});
  });
  it('falha em uma página não publica um conjunto parcial',async()=>{
    failure='credit_card_competence_payment_confirmations';
    await expect(readCurrentCardEconomicInputs([card])).rejects.toThrow();
  });
  it('snapshot atual lê contas e transações pelo ID, sem filtro pelo autor do movimento',async()=>{
    tables.transactions=[{ID_Transacao:'shared',ID_Conta:'bank',user_id:'b'},{ID_Transacao:'outside',ID_Conta:'outside',user_id:'a'}];
    const snapshot=await readCurrentNetWorthSources(request());
    expect(snapshot.transactions.map(t=>t.ID_Transacao)).toEqual(['shared']);
    expect(calls).toContainEqual({table:'transactions',column:'ID_Conta',ids:['bank','card']});
    expect(calls.filter(c=>c.table==='transactions'&&c.column==='user_id')).toHaveLength(0);
  });
  it('posição de investimento ausente ou inválida não é resumida como zero',async()=>{
    mocks.positions.mockResolvedValueOnce([]); await expect(readCurrentNetWorthSources(request())).rejects.toThrow('Incomplete investment');
    mocks.positions.mockResolvedValueOnce([{ownerUserId:'a',monthKey:'2026-10-01',balances:['invalid']}]); await expect(readCurrentNetWorthSources(request())).rejects.toThrow('Incomplete investment');
  });
  it('a remoção de acesso a conta durante a carga não vira saldo zero',async()=>{
    tables.contas=[bank];
    await expect(readCurrentNetWorthSources(request())).rejects.toThrow('scope changed');
  });
  it('qualquer fonte essencial com erro invalida todo o snapshot',async()=>{
    failure='import_logs';
    await expect(readCurrentNetWorthSources(request())).rejects.toThrow('synthetic read failure');
  });
  it('investimentos são buscados até hoje, sem data selecionada de comparação',async()=>{
    await readCurrentNetWorthSources(request());
    expect(mocks.positions.mock.calls[0][0].getDate()).toBe(15);
    expect(mocks.positions.mock.calls[0][0].toISOString().slice(0,10)).toBe('2026-10-15');
    expect(mocks.positions.mock.calls[0][1]).toEqual(['a']);
  });
});
const deferred=<T,>()=>{let resolve!:(v:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
describe('carga por sessão e escopo',()=>{
  it('descarta conclusão antiga quando uma visão mais recente já concluiu',async()=>{
    const a=deferred<CurrentNetWorthSources>(),b=deferred<CurrentNetWorthSources>(),states:CurrentNetWorthLoadState[]=[];
    const read=vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise),loader=createCurrentNetWorthLoader(read,s=>states.push(s));
    const reqA=request(),reqB={...request('family'),sessionUserId:'b'};
    const first=loader.load(reqA),second=loader.load(reqB);
    b.resolve({} as CurrentNetWorthSources);await second;a.resolve({} as CurrentNetWorthSources);await first;
    expect(states.filter(s=>s.status==='ready')).toHaveLength(1);expect(states.at(-1)?.request).toBe(reqB);
    expect(currentNetWorthStateFor(states.at(-1)!,reqA).sources).toBeNull();
  });
  it('desabilitar/desmontar invalida resposta pendente',async()=>{
    const pending=deferred<CurrentNetWorthSources>(),publish=vi.fn(),loader=createCurrentNetWorthLoader(()=>pending.promise,publish);
    const done=loader.load(request());loader.invalidate();pending.resolve({} as CurrentNetWorthSources);await done;
    expect(publish).toHaveBeenCalledTimes(1);expect(currentNetWorthStateFor(publish.mock.calls[0][0],null).status).toBe('idle');
  });
  it('erro não reutiliza total anterior e pode ser recuperado por nova leitura',async()=>{
    const read=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({}),states:CurrentNetWorthLoadState[]=[],loader=createCurrentNetWorthLoader(read,s=>states.push(s)),req=request();
    await loader.load(req);expect(states.at(-1)).toMatchObject({status:'error',sources:null});
    await loader.load(req);expect(states.at(-1)?.status).toBe('ready');
  });
});
describe('feature flag net_worth_components_v2_enabled',()=>{
  it('desligada por padrão, sem opt-in por email ou user_metadata',()=>{
    vi.stubEnv('VITE_NET_WORTH_COMPONENTS_V2_ENABLED','false');
    expect(isNetWorthComponentsV2Enabled({id:'a',email:'pilot@test',user_metadata:{net_worth_components_v2_enabled:true}} as any)).toBe(false);
  });
  it('opt-in administrativo habilita e rollback explícito prevalece',()=>{
    const user={id:'a',app_metadata:{net_worth_components_v2_enabled:true}} as any;
    expect(isNetWorthComponentsV2Enabled(user)).toBe(true);
    expect(isNetWorthComponentsV2Enabled({...user,app_metadata:{...user.app_metadata,net_worth_components_v2_disabled:true}})).toBe(false);
  });
  it('flag de ambiente não habilita produção; opt-out false também vence o ambiente',()=>{
    vi.stubEnv('VITE_NET_WORTH_COMPONENTS_V2_ENABLED','true');vi.stubEnv('VITE_SUPABASE_URL','https://xotxxxohcmivyzswyjtm.supabase.co');
    expect(isNetWorthComponentsV2Enabled({id:'a'} as any)).toBe(false);
    vi.stubEnv('VITE_SUPABASE_URL','http://127.0.0.1:54321');
    expect(isNetWorthComponentsV2Enabled({id:'a'} as any)).toBe(true);
    expect(isNetWorthComponentsV2Enabled({id:'a',app_metadata:{net_worth_components_v2_enabled:false}} as any)).toBe(false);
    expect(isNetWorthComponentsV2Enabled(null)).toBe(false);
  });
});
