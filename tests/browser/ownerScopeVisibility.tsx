/** Fixture exclusivamente local. Não autentica, não usa dados reais e não monta as telas financeiras. */
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { DashboardOwnerSelectorView } from '../../src/components/dashboard/DashboardOwnerSelector';
import { OwnerSelectorView } from '../../src/components/investments/InvestmentOwnerSelector';
import { discoverOwnerContext, selfOwnerDiscovery, type OwnerDiscoveryResult } from '../../src/services/investmentOwnerDiscovery';
import { useOwnerDiscovery } from '../../src/hooks/useOwnerDiscovery';
import { SELF_SCOPE, FAMILY_SCOPE } from '../../src/domain/dashboard/dashboardOwnerScope';

const link = { id: 'local-only', owner_id: 'ana', owner_email: 'ana@example.test', member_email: 'me@example.test', status: 'accepted' } as const;
const session = { userId: 'me', email: 'me@example.test' };
const makeContext = (links: any[], owners: string[], nicknames = {}) => discoverOwnerContext({
  listFamilyLinks: async () => links,
  findVisibleInvestmentOwner: async (excluded) => owners.find((id) => !excluded.includes(id)) ?? null,
}, session, nicknames);
const cases: Array<{ name: string; context: OwnerDiscoveryResult }> = [
  { name: 'Sem familiares', context: await makeContext([], []) },
  { name: 'Familiar aceito sem dados', context: await makeContext([link], []) },
  { name: 'Familiar aceito com dados', context: await makeContext([link], ['ana'], { 'ana@example.test': 'Ione' }) },
  { name: 'Vínculo pendente', context: await makeContext([{ ...link, status: 'pending' }], []) },
  { name: 'Apelido longo', context: await makeContext([link], ['ana'], { 'ana@example.test': 'Familiar com apelido muito longo para conferir o espaço disponível no celular' }) },
  { name: 'Identidade não resolvida', context: await makeContext([{ ...link, owner_email: '' }], ['ana']) },
  { name: 'Carregando', context: selfOwnerDiscovery('me', 'loading') },
  { name: 'Falha na consulta', context: selfOwnerDiscovery('me', 'error') },
];

function ScopeCase({ name, context, index }: typeof cases[number] & { index: number }) {
  const [dash, setDash] = useState(SELF_SCOPE);
  const [investment, setInvestment] = useState('me');
  return (
    <section data-scope-case={index} style={{ minWidth: 0, padding: 20, border: '1px solid #475569', borderRadius: 12 }}>
      <h2 style={{ color: '#fff', marginBottom: 16, fontWeight: 600 }}>{name}</h2>
      <div data-dashboard-case="" style={{ minWidth: 0, marginBottom: 24 }}>
        <h3 style={{ color: '#cbd5e1', marginBottom: 8 }}>Dashboard</h3>
        <DashboardOwnerSelectorView options={context.options} value={dash} onChange={setDash} context={context} />
      </div>
      <div data-investment-case="" style={{ minWidth: 0 }}>
        <h3 style={{ color: '#cbd5e1', marginBottom: 8 }}>Investimentos</h3>
        <OwnerSelectorView options={context.options} value={investment} onChange={setInvestment} context={context} />
      </div>
    </section>
  );
}

function SessionProbe() {
  const [id, setId] = useState<string | null>('me');
  const [hold, setHold] = useState(false);
  const deps = useMemo(() => ({
    listFamilyLinks: async () => {
      if (hold) await new Promise<void>(() => {}); // resposta retida localmente, nunca consulta rede
      return [link];
    },
    findVisibleInvestmentOwner: async (excluded: string[]) => excluded.includes('ana') ? null : 'ana',
  }), [hold]);
  const context = useOwnerDiscovery(id ? { id, email: `${id}@example.test` } : null, deps);
  return (
    <section style={{ padding: 20, border: '1px solid #475569', borderRadius: 12, marginTop: 24 }}>
      <h2 style={{ color: '#fff', marginBottom: 12 }}>Troca de sessão local</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={() => { setHold(false); setId('other'); }}>Sessão B</button>
        <button onClick={() => { setHold(true); setId('me'); }}>Voltar a A com resposta retida</button>
        <button onClick={() => setId(null)}>Logout local</button>
      </div>
      <output data-session-probe="">{JSON.stringify({ id, status: context.status, owners: context.options.map((o) => o.userId), family: context.linkedFamilyCount })}</output>
    </section>
  );
}

function Fixture() {
  const [caseIndex, setCaseIndex] = useState(0);
  const [results, setResults] = useState<any>(null);
  useEffect(() => {
    setResults(null);
    const check = () => requestAnimationFrame(() => {
      const sections = [...document.querySelectorAll<HTMLElement>('[data-scope-case]')];
      const checks = sections.map((section) => {
        const i = caseIndex;
        const selects = [...section.querySelectorAll<HTMLSelectElement>('select')];
        return {
          case: cases[i].name,
          scopeVisible: section.textContent?.includes('Visão:') && section.textContent?.includes('Você'),
          safeOptions: (cases[i].context.options.length > 1) === (selects.length === 2),
          dashboardConsolidated: !!section.querySelector(`[data-dashboard-case] option[value="${FAMILY_SCOPE}"]`) === (cases[i].context.options.length > 1),
          noInvestmentConsolidated: !section.querySelector(`[data-investment-case] option[value="${FAMILY_SCOPE}"]`),
          defaultSelf: selects.every((s) => s.selectedOptions[0]?.text === 'Você'),
          labels: selects.every((s) => !!s.labels?.length && !!s.getAttribute('aria-describedby')),
          touchTargets: selects.every((s) => s.getBoundingClientRect().height >= 44),
          noOverflow: section.scrollWidth <= section.clientWidth + 1 && selects.every((s) => s.getBoundingClientRect().right <= section.getBoundingClientRect().right),
        };
      });
      setResults({ caseIndex, width: window.innerWidth, pageFits: document.documentElement.scrollWidth <= window.innerWidth, checks, pass: checks.every((c) => Object.entries(c).filter(([k]) => k !== 'case').every(([,v]) => v)) });
    });
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [caseIndex]);
  return (
    <main style={{ maxWidth: 960, padding: 20, margin: '0 auto', color: '#e2e8f0' }}>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>FinElo — teste local de escopo</h1>
      <p style={{ marginBottom: 16 }}>Fixtures sintéticas locais, sem acesso a produção ou staging.</p>
      <label htmlFor="fixture-case">Cenário local</label>
      <select id="fixture-case" value={caseIndex} onChange={(e) => setCaseIndex(Number(e.target.value))} style={{ display: 'block', color: '#fff', background: '#1e293b', marginBottom: 20, maxWidth: '100%', minHeight: 44 }}>
        {cases.map((c, index) => <option key={c.name} value={index}>{c.name}</option>)}
      </select>
      <output data-browser-results="" data-case={results?.caseIndex} style={{ display: 'block', marginBottom: 20, overflowWrap: 'anywhere', fontSize: 12 }}>{results ? JSON.stringify(results) : 'Executando verificações…'}</output>
      <ScopeCase key={caseIndex} {...cases[caseIndex]} index={caseIndex} />
      <SessionProbe />
    </main>
  );
}
document.body.style.background = '#0f172a';
createRoot(document.getElementById('root')!).render(<Fixture />);
