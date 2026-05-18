import React, { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

interface ImportDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    ignoredDetails: any[];
    importedDetails: any[];
    fileName: string;
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

const IgnoredDetailsModal: React.FC<ImportDetailsModalProps> = ({ isOpen, onClose, ignoredDetails, importedDetails, fileName }) => {
    const [activeTab, setActiveTab] = useState<'imported' | 'ignored'>(importedDetails.length > 0 ? 'imported' : 'ignored');

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
                    Recém-Importadas ({importedDetails?.length || 0})
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
                        <table className="min-w-[800px] sm:min-w-full divide-y divide-slate-700">
                            <thead className="bg-slate-800 sticky top-0 z-10">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Data</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Original</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Nome Registrado</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Valor</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Categoria / Motivo</th>
                                </tr>
                            </thead>
                            <tbody className="bg-slate-900 divide-y divide-slate-700">
                                {importedDetails.map((item, index) => (
                                    <tr key={index}>
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
                                                    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
                                            })()}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-accent font-medium">
                                            {item.Categoria || 'Sucesso'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
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
                                                    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
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
