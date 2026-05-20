import React, { useState } from 'react';
import Card from '../ui/Card';

type ScenarioId = 'import' | 'manual' | 'mixed';

interface ScenarioSection {
  id: ScenarioId;
  title: string;
  subtitle: string;
  badge: string;
  setup: string[];
  daily: string[];
  verify: string[];
  fix: string[];
  avoid: string[];
}

const SCENARIOS: ScenarioSection[] = [
  {
    id: 'import',
    title: 'Só importo extrato (CSV / Excel / OFX)',
    subtitle: 'O banco envia o arquivo da fatura e eu importo na aba Importar.',
    badge: 'Importação',
    setup: [
      'Em Configurações → Contas, crie o cartão como Cartão de Crédito com limite, dia de fechamento e dia de vencimento.',
      'Na aba Importar, envie o arquivo do banco e escolha a conta do cartão correta.',
      'Na revisão da importação, confira competência (mês da fatura) e vencimento antes de confirmar.',
    ],
    daily: [
      'Importe cada fatura fechada assim que o banco liberar o extrato.',
      'Pagamentos que aparecem no CSV (ex.: “pagamento válido”) o sistema trata automaticamente na competência anterior, como no padrão XP.',
      'Use Transações → botão PAGAR só se quiser registrar um pagamento extra que não veio no arquivo.',
    ],
    verify: [
      'Em Transações, no card do cartão, veja Fatura atual e Uso do limite.',
      'Toque em HISTÓRICO para ver cada competência: total da fatura, pagamentos e saldo em aberto.',
      'Compare o total da competência com o PDF/ app do banco da mesma fatura fechada.',
      'Se um mês tiver alerta em Configurações → Histórico de importações, leia a coluna Alertas.',
    ],
    fix: [
      'Valor diferente do banco: abra HISTÓRICO → Ajustar competências por arquivo e confira se o mês (MM/AAAA) está certo.',
      'Conta errada na importação: Configurações → Histórico de importações → Corrigir Conta na linha do arquivo.',
      'JSON do histórico desatualizado: Configurações → Reidratar histórico de importações (não apaga lançamentos).',
      'Centavos em aberto que você já pagou: no HISTÓRICO, use Sim, está pago na competência (sincroniza entre dispositivos).',
    ],
    avoid: [
      'Não lançar a mesma compra manualmente e no CSV (duplicidade).',
      'Não misturar ajustes de importação com lançamentos duplicados no mesmo mês.',
    ],
  },
  {
    id: 'manual',
    title: 'Só lanço na mão (sem importar arquivo)',
    subtitle: 'Registro compras e pagamentos direto em Transações.',
    badge: 'Manual',
    setup: [
      'Crie o cartão em Configurações → Contas: tipo Cartão de Crédito, limite, dia de fechamento e dia de vencimento.',
      'Defina categorias que você usa no dia a dia (alimentação, transporte, etc.).',
    ],
    daily: [
      'Cada compra: Adicionar lançamento → Tipo Despesa → conta do cartão → data real da compra → valor.',
      'Estorno ou crédito na fatura: Tipo Renda na mesma conta do cartão (reduz a fatura).',
      'Ao pagar no banco: use o botão PAGAR no card do cartão ou lance Renda com nome/categoria Pagamento de Fatura.',
    ],
    verify: [
      'No card do cartão, anote Fatura atual.',
      'Filtre Transações pela conta do cartão e pelo mês que quer conferir.',
      'Some despesas e subtraia estornos (Renda que não seja pagamento de fatura).',
      'Compare com o total de compras da fatura no app do banco (não confunda com limite disponível).',
    ],
    fix: [
      'Fatura maior que o banco: procure lançamento duplicado ou parcela repetida e edite/exclua.',
      'Fatura menor: falta lançamento — adicione a Despesa com data correta.',
      'Pagamento não abateu: deve ser Renda (Pagamento de Fatura), não Despesa — use PAGAR ou corrija o tipo.',
      'Mês errado: corrija a data do lançamento (compras manuais entram no mês da data).',
      'Limite estranho: confira se o limite do cartão está preenchido na edição da conta.',
    ],
    avoid: [
      'O botão HISTÓRICO é focado em quem importa extrato — para só manual, confie em Fatura atual + lista filtrada.',
      'Não use Reidratar histórico em Configurações (é para alinhar arquivos importados).',
    ],
  },
  {
    id: 'mixed',
    title: 'Importo e também lanço na mão',
    subtitle: 'Extrato do banco + ajustes, esquecimentos ou lançamentos avulsos.',
    badge: 'Misto',
    setup: [
      'Configure o cartão com fechamento, vencimento e limite.',
      'Importe a fatura fechada sempre que o banco liberar o arquivo.',
      'Use lançamento manual só para o que não veio no extrato (ou correções pontuais).',
    ],
    daily: [
      'Prioridade: o extrato importado é a base da fatura do mês.',
      'Manual: Despesa no cartão para compra esquecida; Renda para estorno; PAGAR ou Renda para pagamento.',
      'Nunca duplique: se a compra já está no CSV, não lance de novo na mão.',
    ],
    verify: [
      'HISTÓRICO: competências vindas do import (totais por mês).',
      'Transações filtradas: veja se há lançamentos manual além do que o banco já trouxe.',
      'Fatura atual no card deve refletir import + manuais do ciclo vigente.',
      'Compare a competência do HISTÓRICO com o PDF do banco; manuais extras explicam diferenças pequenas.',
    ],
    fix: [
      'Duplicidade (import + manual): exclua o manual duplicado.',
      'Competência errada no import: Transações → Ajustar competências por arquivo.',
      'Conta errada no arquivo: Configurações → Corrigir Conta.',
      'Compra só no manual: deixe; não importe de novo o mesmo período sem revisar duplicatas.',
      'Saldo residual após conferir tudo: HISTÓRICO → Sim, está pago.',
    ],
    avoid: [
      'Não importar e lançar tudo manualmente o mesmo mês — escolha uma fonte principal por fatura.',
      'Evite duplicar compras entre extrato e lançamento manual.',
    ],
  },
];

const COMMON_TABLE: { problem: string; check: string; action: string }[] = [
  {
    problem: 'Total da fatura diferente do banco',
    check: 'Mesma competência (mês da fatura) e mesma conta?',
    action: 'Import: ajuste competência. Manual: filtre o mês e revise lançamentos. Misto: procure duplicata.',
  },
  {
    problem: 'Pagamento não reduz o em aberto',
    check: 'É Renda / Pagamento de Fatura?',
    action: 'Use PAGAR no card ou corrija o tipo do lançamento.',
  },
  {
    problem: 'Limite usado incorreto',
    check: 'Limite cadastrado? Lançamentos em outra conta?',
    action: 'Edite a conta do cartão e mova lançamentos para o cartão certo.',
  },
  {
    problem: 'Histórico vazio',
    check: 'Você importa arquivos?',
    action: 'Só manual: use Fatura atual + filtros. Import: importe ao menos uma fatura com competência.',
  },
  {
    problem: 'Centavos em aberto',
    check: 'Já pagou no banco (ajuste/arredondamento)?',
    action: 'HISTÓRICO → Sim, está pago (salva na nuvem).',
  },
];

function AccordionSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex justify-between items-center gap-3 px-4 py-3 text-left bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
      >
        <span className="font-semibold text-slate-200 text-sm">{title}</span>
        <span className="text-cyan-400 text-lg leading-none shrink-0">{open ? '−' : '+'}</span>
      </button>
      {open ? <div className="px-4 pb-4 pt-1 text-sm text-slate-400 space-y-2">{children}</div> : null}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc list-inside space-y-1.5 marker:text-cyan-500/80">
      {items.map((item) => (
        <li key={item} className="leading-relaxed">
          {item}
        </li>
      ))}
    </ul>
  );
}

interface CreditCardHelpGuideProps {
  /** Quando embutido na Central de Ajuda, omite o cabeçalho duplicado. */
  embedded?: boolean;
}

const CreditCardHelpGuide: React.FC<CreditCardHelpGuideProps> = ({ embedded = false }) => {
  const [activeScenario, setActiveScenario] = useState<ScenarioId>('import');

  const scenario = SCENARIOS.find((s) => s.id === activeScenario)!;

  return (
    <div className={`space-y-6 ${embedded ? 'pt-2' : 'max-w-4xl'}`}>
      {!embedded ? (
        <Card className="border-cyan-500/20 bg-gradient-to-br from-cyan-950/30 to-slate-900/50">
          <h2 className="text-xl font-bold text-white mb-2">Cartão de crédito no FinElo</h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            Este guia explica como conferir faturas, registrar pagamentos e corrigir diferenças. Escolha abaixo o
            jeito que você usa o app — as telas e atalhos mudam um pouco em cada caso.
          </p>
          <p className="text-slate-500 text-xs mt-3">
            Tudo fica em <strong className="text-slate-400">Transações</strong> (card do cartão: Fatura atual,
            HISTÓRICO, PAGAR). Ajustes de importação ficam em{' '}
            <strong className="text-slate-400">Configurações → Histórico de importações</strong>.
          </p>
        </Card>
      ) : (
        <p className="text-slate-500 text-xs leading-relaxed">
          Escolha como você usa o cartão. Telas principais: <strong className="text-slate-400">Transações</strong>{' '}
          (Fatura atual, HISTÓRICO, PAGAR) e{' '}
          <strong className="text-slate-400">Configurações → Histórico de importações</strong> para ajustes de arquivo.
        </p>
      )}

      <div>
        <p className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-3">Como você usa o cartão?</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveScenario(s.id)}
              className={`text-left p-4 rounded-xl border transition-all ${
                activeScenario === s.id
                  ? 'border-cyan-500/50 bg-cyan-500/10 ring-1 ring-cyan-500/30'
                  : 'border-white/10 bg-white/[0.02] hover:border-white/20'
              }`}
            >
              <span
                className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${
                  activeScenario === s.id ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-700 text-slate-400'
                }`}
              >
                {s.badge}
              </span>
              <p className="font-semibold text-slate-200 text-sm mt-2">{s.title}</p>
              <p className="text-xs text-slate-500 mt-1 leading-snug">{s.subtitle}</p>
            </button>
          ))}
        </div>
      </div>

      <Card>
        <h3 className="text-lg font-bold text-white mb-1">{scenario.title}</h3>
        <p className="text-sm text-slate-500 mb-4">{scenario.subtitle}</p>

        <div className="space-y-3">
          <AccordionSection title="1. Configuração inicial" defaultOpen>
            <BulletList items={scenario.setup} />
          </AccordionSection>
          <AccordionSection title="2. Rotina do dia a dia">
            <BulletList items={scenario.daily} />
          </AccordionSection>
          <AccordionSection title="3. Como conferir se está batendo com o banco" defaultOpen>
            <BulletList items={scenario.verify} />
          </AccordionSection>
          <AccordionSection title="4. Se algo não bater — o que fazer">
            <BulletList items={scenario.fix} />
          </AccordionSection>
          <AccordionSection title="5. O que evitar">
            <BulletList items={scenario.avoid} />
          </AccordionSection>
        </div>
      </Card>

      <Card>
        <h3 className="text-lg font-bold text-white mb-3">Problemas comuns (todos os perfis)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-white/10 text-slate-500 text-xs uppercase">
                <th className="py-2 pr-3 font-semibold">Situação</th>
                <th className="py-2 pr-3 font-semibold">Conferir</th>
                <th className="py-2 font-semibold">Ação</th>
              </tr>
            </thead>
            <tbody className="text-slate-400">
              {COMMON_TABLE.map((row) => (
                <tr key={row.problem} className="border-b border-white/5">
                  <td className="py-3 pr-3 text-slate-300 font-medium align-top">{row.problem}</td>
                  <td className="py-3 pr-3 align-top">{row.check}</td>
                  <td className="py-3 align-top">{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="bg-slate-800/40">
        <h3 className="font-bold text-slate-200 mb-2">Glossário rápido</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-cyan-400/90 font-semibold">Competência</dt>
            <dd className="text-slate-500">Mês da fatura (ex.: compras de março → fatura 03/2025 ou vencimento em abril).</dd>
          </div>
          <div>
            <dt className="text-cyan-400/90 font-semibold">Fatura atual</dt>
            <dd className="text-slate-500">Total de compras do ciclo vigente no card do cartão em Transações.</dd>
          </div>
          <div>
            <dt className="text-cyan-400/90 font-semibold">Saldo em aberto</dt>
            <dd className="text-slate-500">Quanto ainda falta pagar naquela competência (após pagamentos).</dd>
          </div>
          <div>
            <dt className="text-cyan-400/90 font-semibold">Sim, está pago</dt>
            <dd className="text-slate-500">
              Confirma centavos ou ajustes já quitados no banco; salvo na nuvem para todos os aparelhos.
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
};

export default CreditCardHelpGuide;
