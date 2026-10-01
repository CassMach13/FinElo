import React from 'react';
import Button from '../ui/Button';

/**
 * Momento de sucesso da importação. Mostra só o que o resultado da importação já devolve
 * (quantas entraram e quantas já existiam); nada de valores nem de consulta extra.
 */
export interface ImportSuccessPanelProps {
  imported: number;
  ignored: number;
  onReviewTransactions: () => void;
  onViewDashboard: () => void;
  onImportAnother: () => void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const ImportSuccessPanel: React.FC<ImportSuccessPanelProps> = ({
  imported,
  ignored,
  onReviewTransactions,
  onViewDashboard,
  onImportAnother,
}) => (
  <section
    role="status"
    aria-labelledby="import-success-title"
    className="rounded-xl border border-green-700/60 bg-green-900/20 p-5 space-y-4"
  >
    <div>
      <h3 id="import-success-title" className="text-lg font-bold text-green-200">
        ✅ Importação concluída
      </h3>
      <p className="text-sm text-green-100/90 mt-1">
        {plural(imported, 'transação adicionada', 'transações adicionadas')}.
        {ignored > 0
          ? ` ${plural(ignored, 'já existia e foi ignorada', 'já existiam e foram ignoradas')}.`
          : ''}
      </p>
      <p className="text-xs text-green-100/70 mt-1">
        Dê uma olhada rápida nas categorias para os números ficarem certos.
      </p>
    </div>
    <div className="flex flex-col sm:flex-row gap-2">
      <Button onClick={onReviewTransactions} className="sm:w-auto w-full">
        Conferir transações
      </Button>
      <Button variant="secondary" onClick={onViewDashboard} className="sm:w-auto w-full">
        Ver minha Dashboard
      </Button>
      <Button variant="secondary" onClick={onImportAnother} className="sm:w-auto w-full">
        Importar outro arquivo
      </Button>
    </div>
  </section>
);

export default ImportSuccessPanel;
