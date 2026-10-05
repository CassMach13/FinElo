import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportLog, Transaction } from '../src/types';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), getUser: vi.fn(), alert: vi.fn() }));
vi.mock('../src/supabaseClient', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from, auth: { getUser: mocks.getUser } } }));
vi.mock('../src/hooks/useDialogStore', () => ({ appAlert: mocks.alert }));
import { useAppStore } from '../src/hooks/useAppStore';
import { maintainImportBatch } from '../src/services/importHistoryService';

const user = { id:'u',user_metadata:{credit_card_engine_disabled:true,card_v2_disabled:true,card_v2_shadow_disabled:true},app_metadata:{} };
const log = (id:string): ImportLog => ({id,user_id:'u',file_name:'same.csv',import_date:'2026-08-01',total_transactions:1,imported_count:1,ignored_count:0,ignored_details:[],imported_details:[]});
const tx = (id:string,logId:string): Transaction => ({ID_Transacao:id,user_id:'u',import_log_id:logId,Origem:'same.csv',ID_Conta:'a',Data:new Date('2026-08-01'),Nome_Fantasia:'Fixture',Valor:-10,Fonte:'XP'} as Transaction);

beforeEach(() => {
  vi.clearAllMocks(); useAppStore.setState(useAppStore.getInitialState(),true);
  mocks.getUser.mockResolvedValue({data:{user}});
  mocks.from.mockImplementation(() => { throw new Error('Unexpected filename/table mutation'); });
  useAppStore.setState({user,transactions:[tx('ta','la'),tx('tb','lb')],importLogs:[log('la'),log('lb')],
    atomicImportEnabled:false,accounts:[],fetchImportLogs:vi.fn(),fetchAllData:vi.fn()} as never);
});

describe('new imports — fingerprint independent of rollout', () => {
  function server(feature: 'enabled'|'disabled'|'error' = 'disabled') {
    const batches=new Map<string, {transactions:Transaction[];import_log:ImportLog}>();
    mocks.rpc.mockImplementation(async (name:string, args:Record<string,unknown>) => {
      if (name==='get_atomic_import_feature_state') return feature==='error'
        ? {data:null,error:{message:'feature unavailable'}}
        : {data:feature,error:null};
      const key=args.p_fingerprint as string;
      expect(key).toMatch(/^[a-f0-9]{64}$/);
      const prior=batches.get(key);
      if (prior) return {data:{...prior,duplicate:true},error:null};
      const id=`new-${batches.size}`;
      const result={transactions:[{...tx(id,id),ID_Conta:args.p_account_id as string}],import_log:log(id)};
      batches.set(key,result);
      return {data:{...result,duplicate:false},error:null};
    });
    return batches;
  }
  it.each(['disabled','error'] as const)('%s feature never permits duplicate content or renamed content', async feature => {
    const batches=server(feature);
    const rows=[tx('parsed','spoof')];
    await useAppStore.getState().addMultipleTransactions(rows,{ID_Conta_Associada:'a'} as never,'same.csv');
    const before=useAppStore.getState().transactions;
    for (const name of ['same.csv','renamed.csv'])
      await expect(useAppStore.getState().addMultipleTransactions(rows,{ID_Conta_Associada:'a'} as never,name)).rejects.toThrow('Renomear');
    expect(batches.size).toBe(1);
    expect(useAppStore.getState().transactions).toEqual(before);
    expect(mocks.rpc.mock.calls.filter(c=>c[0]!=='get_atomic_import_feature_state').map(c=>c[0]))
      .toEqual(Array(3).fill('import_transactions_scoped'));
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('disabled accepts two different contents with the same filename', async () => {
    const batches=server();
    for (const value of [-10,-20])
      await useAppStore.getState().addMultipleTransactions([{...tx('parsed','spoof'),Valor:value}],{ID_Conta_Associada:'a'} as never,'same.csv');
    expect(batches.size).toBe(2);
    expect(useAppStore.getState().transactions.slice(-2).map(t=>t.import_log_id)).toEqual(['new-0','new-1']);
  });
  it('disabled allows the same content in two different accounts', async () => {
    const batches=server();
    for (const account of ['a','b'])
      await useAppStore.getState().addMultipleTransactions([tx('parsed','spoof')],{ID_Conta_Associada:account} as never,'same.csv');
    expect(batches.size).toBe(2);
  });
  it('enabled keeps its atomic RPC and duplicate response contract', async () => {
    const batches=server('enabled');
    const rows=[tx('parsed','spoof')];
    await useAppStore.getState().addMultipleTransactions(rows,{ID_Conta_Associada:'a'} as never,'same.csv');
    await expect(useAppStore.getState().addMultipleTransactions(rows,{ID_Conta_Associada:'a'} as never,'renamed.csv')).rejects.toThrow('Renomear');
    expect(batches.size).toBe(1);
    expect(mocks.rpc.mock.calls.filter(c=>c[0]!=='get_atomic_import_feature_state').map(c=>c[0]))
      .toEqual(['import_transactions_atomic','import_transactions_atomic']);
  });
  it('disabled forwards the existing supplied file fingerprint unchanged', async () => {
    server();
    const fingerprint='a'.repeat(64);
    await useAppStore.getState().addMultipleTransactions([tx('parsed','spoof')],{} as never,'same.csv',[],{batchFingerprint:fingerprint});
    expect(mocks.rpc).toHaveBeenCalledWith('import_transactions_scoped',expect.objectContaining({p_fingerprint:fingerprint}));
  });
  it('disabled rejects malformed fingerprint before the import RPC', async () => {
    server();
    await expect(useAppStore.getState().addMultipleTransactions([tx('parsed','spoof')],{} as never,'same.csv',[],{batchFingerprint:'invalid'})).rejects.toThrow('inválida');
    expect(mocks.rpc.mock.calls.map(c=>c[0])).toEqual(['get_atomic_import_feature_state']);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('import history store — no filename fallback', () => {
  it('reassign uses owned server RPC even when atomic feature is disabled; local B is unchanged', async () => {
    mocks.rpc.mockResolvedValue({data:{updated_count:1,active_transaction_ids:['ta'],imported_details:[]},error:null});
    await useAppStore.getState().reassignTransactionsAccountByImportLog('la','destination');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('reassign_import_batch_atomic',{p_import_log_id:'la',p_account_id:'destination'});
    expect(useAppStore.getState().transactions.map(t=>t.ID_Conta)).toEqual(['destination','a']);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('delete uses exact returned identities, does not remove B or issue broad derived cleanup', async () => {
    mocks.rpc.mockResolvedValue({data:{deleted_count:1,deleted_transactions:[tx('ta','la')],affected_statement_ids:[]},error:null});
    await useAppStore.getState().deleteImportLog('la','same.csv');
    expect(mocks.rpc).toHaveBeenCalledWith('delete_import_batch_atomic',{p_import_log_id:'la'});
    expect(useAppStore.getState().transactions.map(t=>t.ID_Transacao)).toEqual(['tb']);
    expect(useAppStore.getState().importLogs.map(l=>l.id)).toEqual(['lb']);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('rehydrate sends concrete log id, never scans or writes by normalized origin', async () => {
    mocks.rpc.mockResolvedValue({data:{updated_count:1},error:null});
    expect((await useAppStore.getState().repairImportLogsImportedDetailsFromLedger('la')).updated).toBe(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('rehydrate_import_batch_atomic',{p_import_log_id:'la'});
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('unsafe legacy log is blocked and has no client fallback mutation', async () => {
    const before=useAppStore.getState().transactions;
    mocks.rpc.mockResolvedValue({data:null,error:{code:'P0001',message:'unsafe identity'}});
    await useAppStore.getState().deleteImportLog('la','same.csv');
    await useAppStore.getState().reassignTransactionsAccountByImportLog('la','destination');
    await useAppStore.getState().repairImportLogsImportedDetailsFromLedger('la');
    expect(useAppStore.getState().transactions).toEqual(before);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.alert.mock.calls[0][0]).toContain('Nenhuma alteração');
  });
  it('deprecated origin-only correction is inert', async () => {
    expect(await useAppStore.getState().reassignTransactionsAccountByOrigin('same.csv','destination')).toEqual({updated:0});
    await useAppStore.getState().deleteTransactionsByOrigin('same.csv');
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('new imports always request a persisted batch even when flag disabled and filename already exists', async () => {
    mocks.rpc.mockImplementation(async (name:string) => name==='get_atomic_import_feature_state'
      ? {data:'disabled',error:null}
      : {data:{transactions:[tx('new','new-log')],import_log:log('new-log')},error:null});
    const config={ID_Conta_Associada:'a'};
    await useAppStore.getState().addMultipleTransactions([tx('parsed','spoof')],config as never,'same.csv');
    expect(mocks.rpc.mock.calls.map(c=>c[0])).toEqual(['get_atomic_import_feature_state','import_transactions_scoped']);
    expect(useAppStore.getState().transactions.at(-1)?.import_log_id).toBe('new-log');
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('missing RPC never silently falls back to the old insert path', async () => {
    mocks.rpc.mockResolvedValue({data:null,error:{message:'missing function'}});
    await expect(useAppStore.getState().addMultipleTransactions([tx('parsed','spoof')],{} as never,'same.csv')).rejects.toThrow('sem gravações parciais');
    expect(mocks.from).not.toHaveBeenCalled(); expect(useAppStore.getState().transactions).toHaveLength(2);
  });
  it('malformed server reply is not treated as a maintenance success', async () => {
    mocks.rpc.mockResolvedValue({data:null,error:null});
    await expect(maintainImportBatch({rpc:mocks.rpc} as never,'la','delete')).rejects.toThrow('confirmação');
  });
});
