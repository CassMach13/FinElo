import React from 'react';
import Button from '../ui/Button';
import type { FirstStepId, FirstStepStatus, FirstStepsPhase } from '../../domain/onboarding/firstSteps';

/**
 * Bloco "Primeiros passos" da Dashboard. Só apresentação: o estado vem de `getFirstStepsState`
 * (derivado dos dados reais) e cada ação é uma prop, o que também deixa um ponto único para
 * medir o funil depois sem refatorar.
 */
export interface FirstStepsCardProps {
  phase: FirstStepsPhase;
  steps: { id: FirstStepId; status: FirstStepStatus }[];
  uncategorizedCount: number;
  onImport: () => void;
  onManual: () => void;
  onHowToDownload: () => void;
  onReview: () => void;
  onViewMonth: () => void;
  onDismiss: () => void;
}

const STEP_COPY: Record<FirstStepId, { title: string; description: string }> = {
  bring: { title: 'Traga seus dados', description: 'Importe o extrato do seu banco ou cartão.' },
  review: { title: 'Confira o que entrou', description: 'Uma olhada rápida nas categorias deixa os números certos.' },
  view: { title: 'Veja seu mês', description: 'Entradas, saídas e onde você mais gastou.' },
};

const HEADLINE: Record<FirstStepsPhase, { title: string; subtitle: string }> = {
  start: {
    title: 'Vamos começar sua organização financeira',
    subtitle: 'Traga seus dados para o FinElo e veja sua visão financeira ganhar forma.',
  },
  review: {
    title: 'Seus dados já estão aqui',
    subtitle: 'Falta só conferir o que entrou para os números ficarem certos.',
  },
  view: {
    title: 'Seu mês está no FinElo',
    subtitle: 'Veja logo abaixo as entradas, as saídas e onde você mais gastou.',
  },
};

/** O estado nunca depende só de cor: cada passo traz também uma palavra. */
const STATUS_LABEL: Record<FirstStepStatus, string> = {
  done: 'Concluído',
  active: 'Agora',
  upcoming: 'Depois',
};

const linkClass =
  'text-sm font-medium text-accent hover:text-accent/80 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded';

const FirstStepsCard: React.FC<FirstStepsCardProps> = ({
  phase,
  steps,
  uncategorizedCount,
  onImport,
  onManual,
  onHowToDownload,
  onReview,
  onViewMonth,
  onDismiss,
}) => {
  const headline = HEADLINE[phase];

  return (
    <section
      id="dashboard-first-steps"
      aria-labelledby="first-steps-title"
      className="bg-gradient-to-r from-secondary to-primary/50 rounded-xl p-6 border border-accent/20 shadow-lg mb-6 space-y-5"
    >
      <div>
        <h2 id="first-steps-title" className="text-xl font-bold text-light">
          {headline.title}
        </h2>
        <p className="text-gray-400 text-sm mt-1">{headline.subtitle}</p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => {
          const copy = STEP_COPY[step.id];
          const isActive = step.status === 'active';
          return (
            <li
              key={step.id}
              aria-current={isActive ? 'step' : undefined}
              className={`rounded-lg border p-3 ${
                isActive ? 'border-accent/60 bg-accent/10' : 'border-white/10 bg-black/10'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-light">
                  {index + 1}. {copy.title}
                </span>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wide ${
                    step.status === 'done' ? 'text-success' : isActive ? 'text-accent' : 'text-gray-500'
                  }`}
                >
                  {step.status === 'done' ? '✓ ' : ''}
                  {STATUS_LABEL[step.status]}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-1">{copy.description}</p>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {phase === 'start' && (
          <>
            <Button onClick={onImport} className="sm:w-auto w-full">
              Importar meu extrato
            </Button>
            <Button variant="secondary" onClick={onManual} className="sm:w-auto w-full">
              Prefiro lançar manualmente
            </Button>
          </>
        )}
        {phase === 'review' && (
          <>
            <Button onClick={onReview} className="sm:w-auto w-full">
              Conferir transações
              {uncategorizedCount > 0 ? ` (${uncategorizedCount} sem categoria)` : ''}
            </Button>
            <Button variant="secondary" onClick={onImport} className="sm:w-auto w-full">
              Importar outro arquivo
            </Button>
          </>
        )}
        {phase === 'view' && (
          <>
            <Button onClick={onViewMonth} className="sm:w-auto w-full">
              Ver meu mês
            </Button>
            <Button variant="secondary" onClick={onDismiss} className="sm:w-auto w-full">
              Concluir primeiros passos
            </Button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {phase === 'start' && (
          <button type="button" onClick={onHowToDownload} className={linkClass}>
            Não sabe como baixar seu extrato?
          </button>
        )}
        {phase !== 'view' && (
          <button type="button" onClick={onDismiss} className={`${linkClass} text-gray-400`}>
            Agora não
          </button>
        )}
      </div>
    </section>
  );
};

export default FirstStepsCard;
