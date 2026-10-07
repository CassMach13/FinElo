type Row = Record<string, any>;

/**
 * Banco em memória mínimo (transactions + economic_events) com a superfície do PostgREST que a feature usa:
 * select/insert/update/delete + eq/is/in/order/range + maybeSingle/single. Emula ON DELETE SET NULL
 * (economic_event_id) ao apagar um evento. Não emula RLS: a autorização é testada no service/domínio.
 */
export function createFakeDb() {
  const state = {
    user: { id: 'user-a' } as { id: string } | null,
    tables: { transactions: [] as Row[], economic_events: [] as Row[] } as Record<string, Row[]>,
    seq: 0,
    log: [] as Array<{ table: string; op: string; payload?: unknown; filters?: Array<[string, string, unknown]> }>,
    failUpdate: false,
    failEventInsert: false,
    failEventDelete: false,
    /** roda logo ANTES do UPDATE de transactions (simula concorrência). */
    beforeUpdate: null as null | (() => void),
  };

  class Query {
    private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    private payload: any;
    private filters: Array<[string, string, unknown]> = [];
    private single: 'none' | 'maybe' | 'one' = 'none';
    private lo = 0;
    private hi = Infinity;

    constructor(private table: string) {}

    select() {
      if (this.op === 'select') this.op = 'select';
      return this;
    }
    insert(p: any) {
      this.op = 'insert';
      this.payload = p;
      return this;
    }
    update(p: any) {
      this.op = 'update';
      this.payload = p;
      return this;
    }
    delete() {
      this.op = 'delete';
      return this;
    }
    eq(c: string, v: unknown) {
      this.filters.push([c, 'eq', v]);
      return this;
    }
    is(c: string, v: unknown) {
      this.filters.push([c, 'is', v]);
      return this;
    }
    in(c: string, v: unknown[]) {
      this.filters.push([c, 'in', v]);
      return this;
    }
    order() {
      return this;
    }
    range(a: number, b: number) {
      this.lo = a;
      this.hi = b;
      return this;
    }
    maybeSingle() {
      this.single = 'maybe';
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(this.run()).then(resolve, reject);
    }
    // `.single()` após insert().select()
    singleRow() {
      this.single = 'one';
      return this;
    }

    private match(r: Row) {
      return this.filters.every(([c, k, v]) => {
        if (k === 'eq') return r[c] === v;
        if (k === 'is') return v === null ? r[c] == null : r[c] === v;
        if (k === 'in') return (v as unknown[]).includes(r[c]);
        return true;
      });
    }

    private run() {
      const rows = state.tables[this.table];
      state.log.push({ table: this.table, op: this.op, payload: this.payload, filters: [...this.filters] });
      const out = (data: Row[]) => {
        if (this.single === 'maybe') return { data: data[0] ?? null, error: null };
        if (this.single === 'one') return data[0] ? { data: data[0], error: null } : { data: null, error: { message: 'no rows' } };
        return { data, error: null };
      };
      if (this.op === 'select') return out(rows.filter((r) => this.match(r)).slice(this.lo, Number.isFinite(this.hi) ? this.hi + 1 : undefined).map((r) => ({ ...r })));
      if (this.op === 'insert') {
        if (this.table === 'economic_events' && state.failEventInsert) return { data: null, error: { message: 'boom' } };
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p: Row) => ({
          id: `ev${(state.seq += 1)}`, counterparty_account_id: null, created_at: 't', ...p,
        }));
        rows.push(...list);
        return out(list.map((r) => ({ ...r })));
      }
      if (this.op === 'update') {
        if (this.table === 'transactions') state.beforeUpdate?.();
        if (state.failUpdate) return { data: null, error: { message: 'boom' } };
        const hit = rows.filter((r) => this.match(r));
        hit.forEach((r) => Object.assign(r, this.payload));
        return out(hit.map((r) => ({ ...r })));
      }
      // delete
      if (this.table === 'economic_events' && state.failEventDelete) return { data: null, error: { message: 'boom' } };
      const hit = rows.filter((r) => this.match(r));
      state.tables[this.table] = rows.filter((r) => !hit.includes(r));
      if (this.table === 'economic_events') {
        hit.forEach((e) => state.tables.transactions.forEach((t) => { if (t.economic_event_id === e.id) t.economic_event_id = null; }));
      }
      return { data: hit, error: null };
    }
  }

  const supabase = {
    from: (table: string) => {
      const q = new Query(table);
      // economic_events insert(...).select(COLS).single()
      (q as any).single = () => q.singleRow();
      return q;
    },
    auth: { getUser: async () => ({ data: { user: state.user } }), signOut: async () => ({ error: null }) },
  };

  return { state, supabase };
}
