import React, { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { formatCurrency } from '../../utils/formatters';
import {
  podePreSugerir,
  type SugestaoDeParcela,
} from '../../domain/installments/installmentSuggestions';

/**
 * Última parada antes da importação, e SÓ quando há algo a perguntar.
 *
 * Sem candidato nenhum o modal não aparece e a importação segue como sempre
 * seguiu. Com candidatos, nada é gravado enquanto o usuário não confirmar.
 *
 * O que a escolha altera é apenas descrição e categoria. Valor, data,
 * parcela, competência, conta e origem vêm do arquivo e continuam vindo do
 * arquivo — a sugestão não encosta neles.
 */

/** Escolha por parcela: `indice` do lote → id da irmã, ou null para «não aplicar». */
export type EscolhasDeParcela = Map<number, string | null>;

interface InstallmentSuggestionModalProps {
  sugestoes: SugestaoDeParcela[];
  onConfirm: (escolhas: EscolhasDeParcela) => void;
  onCancel: () => void;
}

const formatarData = (data: Date): string =>
  Number.isNaN(data.getTime()) ? '—' : data.toLocaleDateString('pt-BR');

const escolhaInicial = (sugestoes: SugestaoDeParcela[]): EscolhasDeParcela => {
  const inicial: EscolhasDeParcela = new Map();
  for (const sugestao of sugestoes) {
    // Candidato único vem pré-marcado (o usuário ainda pode desmarcar).
    // Dois ou mais começam SEM escolha: preferir um seria decidir por ele.
    inicial.set(sugestao.indice, podePreSugerir(sugestao) ? sugestao.candidatos[0].idTransacao : null);
  }
  return inicial;
};

const InstallmentSuggestionModal: React.FC<InstallmentSuggestionModalProps> = ({
  sugestoes,
  onConfirm,
  onCancel,
}) => {
  const [escolhas, setEscolhas] = useState<EscolhasDeParcela>(() => escolhaInicial(sugestoes));

  const escolher = (indice: number, idTransacao: string | null) => {
    setEscolhas((anterior) => new Map(anterior).set(indice, idTransacao));
  };

  const aplicadas = Array.from(escolhas.values()).filter(Boolean).length;

  return (
    <Modal
      isOpen={true}
      onClose={onCancel}
      title="Parcelas reconhecidas de compras anteriores"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>Cancelar importação</Button>
          <Button onClick={() => onConfirm(escolhas)}>
            {aplicadas > 0 ? `Importar aplicando ${aplicadas}` : 'Importar sem aplicar'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-gray-300 text-sm">
          {sugestoes.length === 1
            ? 'Uma parcela do arquivo parece continuar uma compra que você já classificou.'
            : `${sugestoes.length} parcelas do arquivo parecem continuar compras que você já classificou.`}{' '}
          Só a <strong className="text-white">descrição</strong> e a{' '}
          <strong className="text-white">categoria</strong> são copiadas — valor, data e parcela
          vêm do arquivo.
        </p>

        {sugestoes.map((sugestao) => {
          const escolhido = escolhas.get(sugestao.indice) ?? null;
          const ambigua = sugestao.candidatos.length > 1;

          return (
            <div key={sugestao.indice} className="border border-slate-700 rounded-md p-3 bg-slate-900/50">
              <div className="flex justify-between items-baseline gap-3 mb-1">
                <span className="text-white text-sm font-medium truncate">
                  {sugestao.descricaoImportada || 'Lançamento sem descrição'}
                </span>
                <span className="text-gray-400 text-xs whitespace-nowrap">
                  {sugestao.parcelaAtual}/{sugestao.totalParcelas} · {formatCurrency(sugestao.valor)} ·{' '}
                  {formatarData(sugestao.data)}
                </span>
              </div>

              {ambigua && (
                <p className="text-xs text-yellow-400 mb-2">
                  Mais de uma compra anterior bate com esta parcela. Escolha qual delas é, ou deixe
                  como está.
                </p>
              )}

              <div className="space-y-1">
                {sugestao.candidatos.map((candidato) => (
                  <label
                    key={candidato.idTransacao}
                    className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-slate-800/60"
                  >
                    <input
                      type="radio"
                      name={`sugestao-${sugestao.indice}`}
                      className="mt-1 text-highlight focus:ring-highlight"
                      checked={escolhido === candidato.idTransacao}
                      onChange={() => escolher(sugestao.indice, candidato.idTransacao)}
                    />
                    <span className="text-sm">
                      <span className="text-white">{candidato.nomeFantasia || 'Sem descrição'}</span>
                      <span className="text-gray-400"> · {candidato.categoria || 'Sem categoria'}</span>
                      <span className="block text-xs text-gray-500">
                        parcela {candidato.parcelaAtual}/{candidato.totalParcelas} ·{' '}
                        {formatCurrency(candidato.valor)} · {formatarData(candidato.data)}
                        {candidato.confianca === 'centavo' && ' · difere em R$ 0,01'}
                      </span>
                    </span>
                  </label>
                ))}

                <label className="flex items-center gap-2 cursor-pointer p-2 rounded hover:bg-slate-800/60">
                  <input
                    type="radio"
                    name={`sugestao-${sugestao.indice}`}
                    className="text-highlight focus:ring-highlight"
                    checked={escolhido === null}
                    onChange={() => escolher(sugestao.indice, null)}
                  />
                  <span className="text-sm text-gray-400">
                    Nenhuma — importar como veio no arquivo
                  </span>
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

export default InstallmentSuggestionModal;
