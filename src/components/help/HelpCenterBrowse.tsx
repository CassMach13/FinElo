import React, { useMemo, useRef, useState } from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { useAppStore } from '../../hooks/useAppStore';
import CreditCardHelpGuide from './CreditCardHelpGuide';
import {
  HELP_SEARCH_SUGGESTIONS,
  HELP_SECTIONS,
  HELP_TOPICS,
  filterHelpTopics,
  getSectionMeta,
  groupTopicsBySection,
  topicMatchesQuery,
  type HelpSectionId,
  type HelpTopic,
} from '../../data/helpCenterContent';

interface HelpCenterBrowseProps {
  onOpenSupport: () => void;
}

const GUIDE_SEARCH_HINT = {
  title: 'Guia cartão de crédito',
  answer:
    'tutorial passo a passo importação extrato lançamento manual misto fatura competência histórico pagar conferir banco',
  keywords: ['guia', 'tutorial', 'cartão', 'crédito', 'fatura', 'manual', 'importar', 'misto'],
  section: 'transactions' as HelpSectionId,
};

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const q = query.trim();
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-cyan-500/25 text-cyan-100 rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function TopicCard({
  topic,
  query,
  expanded,
  onToggle,
  onAction,
}: {
  topic: HelpTopic;
  query: string;
  expanded: boolean;
  onToggle: () => void;
  onAction: (topic: HelpTopic) => void;
}) {
  const section = getSectionMeta(topic.section);

  return (
    <div
      className={`rounded-xl border transition-colors ${
        expanded ? 'border-cyan-500/35 bg-cyan-950/15' : 'border-white/10 bg-white/[0.02] hover:border-white/20'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-start gap-3"
      >
        <span className="text-cyan-400 text-lg leading-none mt-0.5 shrink-0">{expanded ? '−' : '+'}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 bg-slate-800/80 px-2 py-0.5 rounded">
              {section.shortLabel}
            </span>
            {topic.featured ? (
              <span className="text-[10px] font-bold uppercase text-cyan-400/90">Destaque</span>
            ) : null}
          </div>
          <h3 className="font-semibold text-slate-200 text-sm leading-snug">
            {highlightMatch(topic.title, query)}
          </h3>
        </div>
      </button>
      {expanded ? (
        <div className="px-4 pb-4 pt-0 ml-8 space-y-3">
          <p className="text-sm text-slate-400 leading-relaxed">{topic.answer}</p>
          {topic.action && topic.action !== 'none' ? (
            <Button
              type="button"
              variant="outline"
              className="text-xs"
              onClick={() => onAction(topic)}
            >
              {topic.action === 'guides'
                ? 'Ver guia completo'
                : topic.action === 'navigate'
                  ? `Ir para ${section.label}`
                  : 'Abrir chamado'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CreditCardGuidePanel({
  expanded,
  onToggle,
  guideRef,
}: {
  expanded: boolean;
  onToggle: () => void;
  guideRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      id="help-credit-card-guide"
      ref={guideRef}
      className={`rounded-xl border transition-colors ${
        expanded ? 'border-cyan-500/35 bg-cyan-950/10' : 'border-cyan-500/25 bg-gradient-to-br from-cyan-950/25 to-slate-900/40'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-4 flex items-start gap-3"
      >
        <span className="text-cyan-400 text-lg leading-none mt-0.5 shrink-0">{expanded ? '−' : '+'}</span>
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-cyan-400/90">Guia completo</span>
          <h3 className="font-bold text-slate-100 text-base mt-1">Cartão de crédito no FinElo</h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Importação, lançamento manual ou misto — passo a passo de conferência, pagamento e correção de faturas.
          </p>
        </div>
      </button>
      {expanded ? (
        <div className="px-4 pb-4 border-t border-white/10">
          <CreditCardHelpGuide embedded />
        </div>
      ) : null}
    </div>
  );
}

const HelpCenterBrowse: React.FC<HelpCenterBrowseProps> = ({ onOpenSupport }) => {
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const guideRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [sectionFilter, setSectionFilter] = useState<HelpSectionId | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [guideExpanded, setGuideExpanded] = useState(false);

  const filteredTopics = useMemo(
    () => filterHelpTopics(HELP_TOPICS, query, sectionFilter),
    [query, sectionFilter]
  );

  const grouped = useMemo(() => groupTopicsBySection(filteredTopics), [filteredTopics]);
  const isSearching = query.trim().length > 0;
  const resultCount = filteredTopics.length;

  const guideMatchesSearch = useMemo(
    () => isSearching && topicMatchesQuery(GUIDE_SEARCH_HINT as HelpTopic, query),
    [isSearching, query]
  );

  const showGuideBlock =
    guideMatchesSearch ||
    (!isSearching && (sectionFilter === 'all' || sectionFilter === 'transactions'));

  const openGuide = () => {
    setGuideExpanded(true);
    if (!isSearching && sectionFilter !== 'transactions' && sectionFilter !== 'all') {
      setSectionFilter('transactions');
    }
    window.setTimeout(() => {
      guideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  };

  const handleTopicAction = (topic: HelpTopic) => {
    if (topic.action === 'guides') {
      openGuide();
      return;
    }
    if (topic.action === 'support') {
      onOpenSupport();
      return;
    }
    if (topic.action === 'navigate' && topic.navigateTo) {
      setCurrentView(topic.navigateTo);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <Card className="border-cyan-500/20 bg-slate-900/40 p-4 sm:p-5">
        <label htmlFor="help-search-input" className="block text-sm font-medium text-slate-300 mb-2">
          Buscar na Central de Ajuda
        </label>
        <div className="relative">
          <Input
            id="help-search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ex.: fatura, importar, categoria, pagamento…"
            className="pr-10"
            autoComplete="off"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs font-bold"
              aria-label="Limpar busca"
            >
              Limpar
            </button>
          ) : (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" aria-hidden>
              ⌕
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Digite uma ou mais palavras. Ex.: &quot;cartão fatura&quot; encontra tópicos que mencionam ambas.
        </p>
        {!isSearching ? (
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="text-[10px] text-slate-500 uppercase font-bold w-full">Sugestões:</span>
            {HELP_SEARCH_SUGGESTIONS.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => setQuery(term)}
                className="text-xs px-2.5 py-1 rounded-full border border-slate-600/80 text-slate-400 hover:border-cyan-500/50 hover:text-cyan-300 transition-colors"
              >
                {term}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-cyan-400/90 mt-3">
            {resultCount === 0
              ? 'Nenhum tópico encontrado. Tente outra palavra ou abra um chamado.'
              : `${resultCount} tópico${resultCount === 1 ? '' : 's'} encontrado${resultCount === 1 ? '' : 's'}`}
          </p>
        )}
      </Card>

      {!isSearching ? (
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-2">
            Filtrar por área do sistema
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSectionFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                sectionFilter === 'all'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'bg-slate-800/60 text-slate-400 border border-transparent hover:text-white'
              }`}
            >
              Todos
            </button>
            {HELP_SECTIONS.map((sec) => (
              <button
                key={sec.id}
                type="button"
                onClick={() => setSectionFilter(sec.id)}
                title={sec.description}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  sectionFilter === sec.id
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-800/60 text-slate-400 border border-transparent hover:text-white'
                }`}
              >
                {sec.shortLabel}
              </button>
            ))}
          </div>
          {sectionFilter !== 'all' ? (
            <p className="text-xs text-slate-500 mt-2">{getSectionMeta(sectionFilter).description}</p>
          ) : null}
        </div>
      ) : null}

      {resultCount === 0 ? (
        <Card className="text-center py-10">
          <p className="text-slate-400 mb-4">Não achamos tópicos com essa busca.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => setQuery('')}>
              Limpar busca
            </Button>
            <Button variant="primary" onClick={onOpenSupport}>
              Falar com suporte
            </Button>
          </div>
        </Card>
      ) : isSearching ? (
        <div className="space-y-2">
          {guideMatchesSearch ? (
            <CreditCardGuidePanel
              expanded={guideExpanded}
              onToggle={() => setGuideExpanded((v) => !v)}
              guideRef={guideRef}
            />
          ) : null}
          {filteredTopics.map((topic) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              query={query}
              expanded={expandedId === topic.id}
              onToggle={() => toggleExpand(topic.id)}
              onAction={handleTopicAction}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ section, topics }) => (
            <section key={section.id} id={`help-section-${section.id}`}>
              <div className="flex items-center justify-between gap-3 mb-3 border-b border-white/10 pb-2">
                <div>
                  <h2 className="text-lg font-bold text-slate-200">{section.label}</h2>
                  <p className="text-xs text-slate-500">{section.description}</p>
                </div>
                {section.appView ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="text-[10px] shrink-0"
                    onClick={() => setCurrentView(section.appView!)}
                  >
                    Abrir {section.shortLabel}
                  </Button>
                ) : null}
              </div>
              <div className="space-y-2">
                {section.id === 'transactions' && showGuideBlock ? (
                  <CreditCardGuidePanel
                    expanded={guideExpanded}
                    onToggle={() => setGuideExpanded((v) => !v)}
                    guideRef={guideRef}
                  />
                ) : null}
                {topics.map((topic) => (
                  <TopicCard
                    key={topic.id}
                    topic={topic}
                    query={query}
                    expanded={expandedId === topic.id}
                    onToggle={() => toggleExpand(topic.id)}
                    onAction={handleTopicAction}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="bg-gradient-to-r from-purple-900/20 to-cyan-900/20 p-6 rounded-2xl border border-white/5 text-center">
        <h3 className="font-bold text-xl mb-2">Não encontrou o que procura?</h3>
        <p className="text-slate-400 mb-4 text-sm">
          Expanda o guia de cartão em Transações ou fale com nossa equipe.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={openGuide}>
            Guia de cartão
          </Button>
          <Button variant="primary" onClick={onOpenSupport}>
            Falar com suporte
          </Button>
        </div>
      </div>
    </div>
  );
};

export default HelpCenterBrowse;
