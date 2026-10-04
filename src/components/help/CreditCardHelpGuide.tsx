import React, { useState } from 'react';
import Card from '../ui/Card';
import { HelpScreenshot, renderEmphasis } from './HelpArticleContent';
import { CARD_USAGE_PROFILES, CARD_SHARED_CONCEPTS, getProfileHelpReferences, getProfileHelpImage } from '../../data/creditCardUsageGuide';
import type { CardUsageProfile, CardUsageProfileId } from '../../data/creditCardUsageGuide';

export function CreditCardProfileContent({ profile }: { profile: CardUsageProfile }) {
  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h3 className="text-lg font-bold text-white">{profile.title}</h3>
        <p className="text-sm text-slate-300 leading-relaxed mt-2">{profile.forWhom}</p>
      </div>
      <section>
        <h4 className="font-semibold text-slate-200 mb-2">Como funciona</h4>
        <p className="text-sm text-slate-300 leading-relaxed">{renderEmphasis(profile.how)}</p>
      </section>
      <section>
        <h4 className="font-semibold text-slate-200 mb-2">Rotina recomendada</h4>
        <ul className="list-disc pl-5 space-y-2 text-sm text-slate-300 leading-relaxed marker:text-cyan-400">
          {profile.routine.map((item) => <li key={item}>{renderEmphasis(item)}</li>)}
        </ul>
      </section>
      <section className="border-t border-white/10 pt-4">
        <h4 className="font-semibold text-amber-200 mb-2">Atenção principal</h4>
        <p className="text-sm text-slate-300 leading-relaxed">{renderEmphasis(profile.attention)}</p>
      </section>
      <HelpScreenshot image={getProfileHelpImage(profile)} />
      <section className="border-t border-white/10 pt-4">
        <h4 className="font-semibold text-slate-200 mb-2">Para ver o passo a passo</h4>
        <p className="text-xs text-slate-400 mb-2">Procure estes títulos nos Tópicos da Central de Ajuda:</p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-300">
          {getProfileHelpReferences(profile).map((topic) => <li key={topic.id}>{topic.title}</li>)}
        </ul>
      </section>
    </div>
  );
}

interface CreditCardHelpGuideProps {
  /** Quando embutido na Central de Ajuda, omite o cabeçalho duplicado. */
  embedded?: boolean;
}

const CreditCardHelpGuide: React.FC<CreditCardHelpGuideProps> = ({ embedded = false }) => {
  const [activeProfile, setActiveProfile] = useState<CardUsageProfileId>('import');
  const profile = CARD_USAGE_PROFILES.find((item) => item.id === activeProfile)!;

  return (
    <div className={`min-w-0 space-y-6 ${embedded ? 'pt-2' : 'max-w-4xl'}`}>
      <div>
        {!embedded && <h2 className="text-xl font-bold text-white mb-2">Cartão de crédito no FinElo</h2>}
        <p className="text-sm text-slate-300 leading-relaxed">Há três formas de usar o cartão no FinElo.</p>
        <p className="text-sm text-slate-400 leading-relaxed mt-1">
          Escolha a rotina que se parece com a sua. Todas usam o mesmo cartão em Transações, com Histórico e Pagar.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" aria-label="Perfis de uso do cartão">
        {CARD_USAGE_PROFILES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={activeProfile === item.id}
            aria-controls="card-usage-profile"
            onClick={() => setActiveProfile(item.id)}
            className={`min-w-0 text-left p-4 rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
              activeProfile === item.id
                ? 'border-cyan-500/50 bg-cyan-500/10'
                : 'border-white/10 bg-white/[0.02] hover:border-white/20'
            }`}
          >
            <span className={`block font-semibold text-sm ${activeProfile === item.id ? 'text-cyan-200' : 'text-slate-200'}`}>
              {item.label}
            </span>
            <span className="block text-xs text-slate-300 mt-1 leading-relaxed">{item.choice}</span>
          </button>
        ))}
      </div>

      <div id="card-usage-profile">
        <Card><CreditCardProfileContent profile={profile} /></Card>
      </div>

      <section aria-labelledby="card-shared-concepts" className="border-t border-white/10 pt-6">
        <h3 id="card-shared-concepts" className="text-lg font-bold text-white mb-4">O que vale para os três perfis</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5 text-sm">
          {CARD_SHARED_CONCEPTS.map((concept) => (
            <div key={concept.title} className="min-w-0">
              <dt className="font-semibold text-slate-200 mb-1">{concept.title}</dt>
              <dd className="text-slate-300 leading-relaxed">{renderEmphasis(concept.text)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="card-profile-choice" className="border-t border-white/10 pt-6">
        <h3 id="card-profile-choice" className="text-lg font-bold text-white mb-3">Qual perfil escolher?</h3>
        <dl className="space-y-4 text-sm">
          {CARD_USAGE_PROFILES.map((item) => (
            <div key={item.id} className="min-w-0 sm:flex sm:gap-4">
              <dt className="font-semibold text-slate-200 sm:w-32 sm:shrink-0">{item.label}</dt>
              <dd className="text-slate-300 leading-relaxed mt-1 sm:mt-0">{item.choice}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-slate-400 leading-relaxed mt-4">
          Nenhum perfil é melhor que outro. Escolha pelo jeito como você reúne suas compras e confere a fatura.
        </p>
      </section>
    </div>
  );
};

export default CreditCardHelpGuide;
