import React, { useState } from 'react';
import '../appearance/financial.css';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { formatCurrency } from '../../utils/formatters';
import {
  escolhasIniciaisDeParcela,
  evidenciasDoCandidato,
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

const InstallmentSuggestionModal: React.FC<InstallmentSuggestionModalProps> = ({
  sugestoes,
  onConfirm,
  onCancel,
}) => {
  const [escolhas, setEscolhas] = useState<EscolhasDeParcela>(() => escolhasIniciaisDeParcela(sugestoes));

  const escolher = (indice: number, idTransacao: string | null) => {
    setEscolhas((anterior) => new Map(anterior).set(indice, idTransacao));
  };

  const desmarcarTodas = () => {
    setEscolhas(new Map(sugestoes.map((s) => [s.indice, null])));
  };

  const aplicadas = Array.from(escolhas.values()).filter(Boolean).length;
  const pendentes = sugestoes.filter((s) => (escolhas.get(s.indice) ?? null) === null).length;

  return (
    <Modal manageFocus
      isOpen={true}
      onClose={onCancel}
      title="Parcelas de compras que você já classificou"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>Cancelar importação</Button>
          <Button onClick={() => onConfirm(escolhas)}>
            {aplicadas > 0 ? `Importar aplicando ${aplicadas}` : 'Importar sem aplicar'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <p data-finance="muted" className="text-gray-300 text-sm">
            {sugestoes.length === 1
              ? 'Uma parcela do arquivo tem sugestão de classificação.'
              : `${sugestoes.length} parcelas do arquivo têm sugestões de classificação.`}{' '}
            Só o <strong data-finance="content" className="text-white">nome</strong> e a{' '}
            <strong data-finance="content" className="text-white">categoria</strong> são copiadas — valor, data e parcela
            vêm do arquivo.
          </p>
          {aplicadas > 0 && (
            <button
              data-finance="link"
              type="button"
              onClick={desmarcarTodas}
              className="text-xs text-highlight hover:text-sky-400 whitespace-nowrap"
            >
              Desmarcar todas
            </button>
          )}
        </div>

        {pendentes > 0 && aplicadas > 0 && (
          <p data-finance="muted" className="text-xs text-gray-400">
            {pendentes === 1 ? '1 parcela precisa' : `${pendentes} parcelas precisam`} da sua escolha;
            sem escolha, {pendentes === 1 ? 'ela entra' : 'elas entram'} como veio no arquivo.
          </p>
        )}

        {sugestoes.map((sugestao) => {
          const escolhido = escolhas.get(sugestao.indice) ?? null;
          const ambigua = sugestao.candidatos.length > 1;

          return (
            <div data-finance="inset divider" key={sugestao.indice} className="border border-slate-700 rounded-md p-3 bg-slate-900/50">
              <div className="flex justify-between items-baseline gap-3 mb-1">
                <span data-finance="content" className="text-white text-sm font-medium truncate">
                  {sugestao.descricaoImportada || 'Lançamento sem descrição'}
                </span>
                <span data-finance="muted" className="text-gray-400 text-xs whitespace-nowrap">
                  {sugestao.parcelaAtual}/{sugestao.totalParcelas} · {formatCurrency(sugestao.valor)} ·{' '}
                  {formatarData(sugestao.data)}
                </span>
              </div>

              {ambigua && (
                <p data-finance="warning" className="text-xs text-yellow-400 mb-2">
                  Mais de uma compra anterior bate com esta parcela. Escolha qual delas é, ou deixe
                  como está.
                </p>
              )}
              <div className="space-y-1">
                {sugestao.candidatos.map((candidato) => (
                  <label
                    data-finance={escolhido === candidato.idTransacao ? 'hover selected' : 'hover'}
                    key={candidato.idTransacao}
                    className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-slate-800/60"
                  >
                    <input
                      data-finance="choice"
                      type="radio"
                      name={`sugestao-${sugestao.indice}`}
                      className="mt-1 text-highlight focus:ring-highlight"
                      checked={escolhido === candidato.idTransacao}
                      onChange={() => escolher(sugestao.indice, candidato.idTransacao)}
                    />
                    <span className="text-sm min-w-0">
                      <span data-finance="content" className="text-white">{candidato.nomeFantasia || 'Sem descrição'}</span>
                      <span data-finance="muted" className="text-gray-400"> · {candidato.categoria || 'Sem categoria'}</span>
                      <span data-finance="muted" className="block text-xs text-gray-500">
                        {[
                          `${formatCurrency(candidato.valor)} em ${formatarData(candidato.data)}`,
                          ...evidenciasDoCandidato(candidato),
                        ].join(' · ')}
                      </span>
                    </span>
                  </label>
                ))}

                <label data-finance={escolhido === null ? 'hover selected' : 'hover'} className="flex items-center gap-2 cursor-pointer p-2 rounded hover:bg-slate-800/60">
                  <input
                    data-finance="choice"
                    type="radio"
                    name={`sugestao-${sugestao.indice}`}
                    className="text-highlight focus:ring-highlight"
                    checked={escolhido === null}
                    onChange={() => escolher(sugestao.indice, null)}
                  />
                  <span data-finance="muted" className="text-sm text-gray-400">
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
