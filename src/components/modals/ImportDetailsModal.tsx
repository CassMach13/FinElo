import React, { useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { formatCurrency } from '../../utils/formatters';
import { importDetailTransactionId } from '../../utils/importLogHealth';

interface ImportDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    ignoredDetails: any[];
    importedDetails: any[];
    fileName: string;
    ledgerTransactionIds?: string[];
}

const formatImportDetailDatePtBr = (raw: unknown): string => {
    if (raw == null || raw === '') return '-';
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
        const d = new Date(`${raw.slice(0, 10)}T12:00:00`);
        return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('pt-BR');
    }
    const d = new Date(raw as string | number | Date);
    return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('pt-BR');
};

const parseImportDetailValor = (item: Record<string, unknown>): number | null => {
    const raw = item.Valor ?? item.valor;
    if (raw === null || raw === undefined || raw === '') return null;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
};

const IgnoredDetailsModal: React.FC<ImportDetailsModalProps> = ({
    isOpen,
    onClose,
    ignoredDetails,
    importedDetails,
    fileName,
    ledgerTransactionIds = [],
}) => {
    const [activeTab, setActiveTab] = useState<'imported' | 'ignored'>(importedDetails.length > 0 ? 'imported' : 'ignored');
    const ledgerIdSet = useMemo(() => new Set(ledgerTransactionIds), [ledgerTransactionIds]);
    const importedAudit = useMemo(() => {
        let active = 0;
        let deleted = 0;
        let untraceable = 0;
        importedDetails.forEach((item) => {
            const id = importDetailTransactionId(item);
            if (!id) untraceable += 1;
            else if (ledgerIdSet.has(id)) active += 1;
            else deleted += 1;
        });
        return { active, deleted, untraceable };
    }, [importedDetails, ledgerIdSet]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Detalhes da Importação - ${fileName}`}
            className="max-w-4xl" // Wider modal for table
            footer={
                <div className="flex justify-end">
                    <Button onClick={onClose}>Fechar</Button>
                </div>
            }
        >
            <div className="flex border-b border-slate-700 mb-4">
                <button
                    className={`py-2 px-4 transition-colors font-medium text-sm focus:outline-none ${activeTab === 'imported'
                        ? 'border-b-2 border-accent text-accent'
                        : 'text-gray-400 hover:text-gray-300'
                        }`}
                    onClick={() => setActiveTab('imported')}
                >
                    Importadas no lote ({importedDetails?.length || 0})
                </button>
                <button
                    className={`py-2 px-4 transition-colors font-medium text-sm focus:outline-none ${activeTab === 'ignored'
                        ? 'border-b-2 border-danger text-danger'
                        : 'text-gray-400 hover:text-gray-300'
                        }`}
                    onClick={() => setActiveTab('ignored')}
                >
                    Ignoradas ({ignoredDetails?.length || 0})
                </button>
            </div>

            <div className="overflow-auto max-h-[60vh]">
                {activeTab === 'imported' && (
                    importedDetails && importedDetails.length > 0 ? (
                        <div className="space-y-3">
                        <div className="rounded-lg border border-slate-700 bg-slate-800/70 px-4 py-3 text-xs text-gray-300">
                            <div className="flex flex-wrap gap-x-5 gap-y-1 font-semibold">
                                <span className="text-emerald-300">Ativas no ledger: {importedAudit.active}</span>
                                <span className="text-red-300">Excluídas depois da importação: {importedAudit.deleted}</span>
                                {importedAudit.untraceable > 0 && (
                                    <span className="text-amber-300">Sem ID para auditoria: {importedAudit.untraceable}</span>
                                )}
                            </div>
                            <p className="mt-1 text-slate-400">
                                O histórico original do lote é preservado. O status compara cada ID importado com o ledger atual.
                            </p>
                        </div>
                        <table className="min-w-[800px] sm:min-w-full divide-y divide-slate-700">
                            <thead className="bg-slate-800 sticky top-0 z-10">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Data</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Original</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Nome Registrado</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Valor</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Categoria / Motivo</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Status atual</th>
                                </tr>
                            </thead>
                            <tbody className="bg-slate-900 divide-y divide-slate-700">
                                {importedDetails.map((item, index) => {
                                    const transactionId = importDetailTransactionId(item);
                                    const status = !transactionId
                                        ? 'untraceable'
                                        : ledgerIdSet.has(transactionId)
                                            ? 'active'
                                            : 'deleted';
                                    return (
                                    <tr key={transactionId || index} className={status === 'deleted' ? 'bg-red-950/20' : ''}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                            {formatImportDetailDatePtBr(item.Data)}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-300 break-words max-w-xs opacity-75">
                                            {item.Descricao_Original || item.Descricao || '-'}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-white font-medium break-words max-w-xs">
                                            {item.Nome_Fantasia || '-'}
                                        </td>
                                        <td className={`px-6 py-4 whitespace-nowrap text-sm font-semibold ${(() => {
                                            const v = parseImportDetailValor(item as Record<string, unknown>);
                                            if (v === null) return 'text-gray-500';
                                            return v < 0 ? 'text-red-400' : 'text-green-400';
                                        })()}`}>
                                            {(() => {
                                                const v = parseImportDetailValor(item as Record<string, unknown>);
                                                return v === null
                                                    ? '-'
                                                    : formatCurrency(Number(v) || 0);
                                            })()}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-accent font-medium">
                                            {item.Categoria || 'Sucesso'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold">
                                            {status === 'active' && (
                                                <span className="inline-flex rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-emerald-300">Ativa</span>
                                            )}
                                            {status === 'deleted' && (
                                                <span className="inline-flex rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-red-300">Excluída</span>
                                            )}
                                            {status === 'untraceable' && (
                                                <span className="inline-flex rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-300">Sem ID legado</span>
                                            )}
                                        </td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        </div>
                    ) : (
                        <p className="text-center text-gray-400 py-8">Nenhuma transação nova importada.</p>
                    )
                )}

                {activeTab === 'ignored' && (
                    ignoredDetails && ignoredDetails.length > 0 ? (
                        <table className="min-w-[800px] sm:min-w-full divide-y divide-slate-700">
                            <thead className="bg-slate-800 sticky top-0 z-10">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Data</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Original</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Nome Sugerido</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Valor</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Motivo</th>
                                </tr>
                            </thead>
                            <tbody className="bg-slate-900 divide-y divide-slate-700">
                                {ignoredDetails.map((item, index) => (
                                    <tr key={index}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                            {formatImportDetailDatePtBr(item.Data)}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-300 break-words max-w-xs opacity-75">
                                            {item.Descricao || item.RawRow || item.Descricao_Original || '-'}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-300 break-words max-w-xs">
                                            {item.Nome_Fantasia || '-'}
                                        </td>
                                        <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${(() => {
                                            const v = parseImportDetailValor(item as Record<string, unknown>);
                                            if (v === null) return 'text-gray-500';
                                            return v < 0 ? 'text-red-400' : 'text-green-400';
                                        })()}`}>
                                            {(() => {
                                                const v = parseImportDetailValor(item as Record<string, unknown>);
                                                return v === null
                                                    ? '-'
                                                    : formatCurrency(Number(v) || 0);
                                            })()}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-danger font-medium whitespace-nowrap">
                                            {item.Motivo || 'Desconhecido'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <p className="text-center text-gray-400 py-8">Nenhum detalhe de itens ignorados.</p>
                    )
                )}
            </div>
        </Modal>
    );
};

export default IgnoredDetailsModal;
