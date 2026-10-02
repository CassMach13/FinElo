import React from 'react';
import type { HelpArticle, HelpBlock, HelpImage } from '../../data/helpCenterContent';

/** Só `**negrito**`, para destacar os nomes exatos da interface. Nada além disso. */
export function renderEmphasis(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  if (parts.length === 1) return text;
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <strong key={index} className="font-semibold text-slate-200">
        {part}
      </strong>
    ) : (
      <React.Fragment key={index}>{part}</React.Fragment>
    )
  );
}

/** Inline e responsiva; clicar abre o arquivo inteiro numa aba nova, em tamanho real. */
export function HelpScreenshot({ image }: { image: HelpImage }) {
  return (
    // Nunca maior que o arquivo: janelas pequenas não ficam esticadas e borradas.
    <figure className="mt-2" style={{ maxWidth: image.width }}>
      <a
        href={image.src}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        title="Abrir imagem em tamanho real"
      >
        <img
          src={image.src}
          alt={image.alt}
          width={image.width}
          height={image.height}
          loading="lazy"
          decoding="async"
          className="block w-full max-w-full h-auto rounded-lg border border-white/10 bg-slate-900"
        />
      </a>
      {image.caption ? (
        <figcaption className="text-xs text-slate-500 mt-1.5">{image.caption}</figcaption>
      ) : null}
    </figure>
  );
}

const Block: React.FC<{ block: HelpBlock }> = ({ block }) => {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">{block.title}</h4>
      <ul className="space-y-1.5 list-disc pl-4 marker:text-slate-600">
        {block.items.map((item, index) => (
          <li key={index} className="text-sm text-slate-400 leading-relaxed">
            {renderEmphasis(item)}
          </li>
        ))}
      </ul>
    </div>
  );
};

const HelpArticleContent: React.FC<{ article: HelpArticle }> = ({ article }) => (
  <div className="space-y-4">
    {article.before?.map((block) => <Block key={block.title} block={block} />)}

    {article.steps && article.steps.length > 0 ? (
      <ol className="space-y-4">
        {article.steps.map((step, index) => (
          <li key={step.title}>
            <div className="flex gap-3">
              <span
                aria-hidden
                className="shrink-0 w-6 h-6 rounded-full bg-cyan-500/15 text-cyan-300 text-xs font-bold flex items-center justify-center mt-0.5"
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-semibold text-slate-200">{step.title}</h4>
                {step.text ? (
                  <p className="text-sm text-slate-400 leading-relaxed mt-0.5">{renderEmphasis(step.text)}</p>
                ) : null}
              </div>
            </div>
            {/* No celular a imagem usa a largura toda; o recuo do número só a partir de sm. */}
            {step.image ? (
              <div className="sm:pl-9">
                <HelpScreenshot image={step.image} />
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    ) : null}

    {article.result ? (
      <div className="rounded-lg border border-green-700/40 bg-green-900/10 p-3">
        <h4 className="text-xs font-bold uppercase tracking-wide text-green-300/90 mb-1">Pronto</h4>
        <p className="text-sm text-slate-300 leading-relaxed">{renderEmphasis(article.result)}</p>
        {article.resultImage ? <HelpScreenshot image={article.resultImage} /> : null}
      </div>
    ) : null}

    {article.after?.map((block) => <Block key={block.title} block={block} />)}
  </div>
);

export default HelpArticleContent;
