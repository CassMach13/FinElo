import React, { useState, useEffect } from 'react';
import { Investment } from '../../types';

interface InvestmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (investment: Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<void>;
    initialData?: Investment | null;
    referenceMonth: Date;
}

const InvestmentModal: React.FC<InvestmentModalProps> = ({
    isOpen,
    onClose,
    onSave,
    initialData,
    referenceMonth
}) => {
    const [institution, setInstitution] = useState('');
    const [productType, setProductType] = useState('');
    const [balance, setBalance] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (initialData) {
            setInstitution(initialData.institution);
            setProductType(initialData.product_type);
            setBalance(initialData.balance.toString());
        } else {
            setInstitution('');
            setProductType('');
            setBalance('');
        }
        setError(null);
    }, [initialData, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const numBalance = parseFloat(balance);
        if (isNaN(numBalance)) {
            setError('Por favor, insira um valor válido para o saldo.');
            return;
        }

        if (!institution.trim() || !productType.trim()) {
            setError('Por favor, preencha todos os campos.');
            return;
        }

        setIsSubmitting(true);
        try {
            // Determine reference month string
            const year = referenceMonth.getFullYear();
            const monthNum = String(referenceMonth.getMonth() + 1).padStart(2, '0');
            const refString = `${year}-${monthNum}-01`;

            await onSave({
                institution: institution.trim(),
                product_type: productType.trim(),
                balance: numBalance,
                reference_month: refString,
            });
            onClose();
        } catch (err: any) {
            setError(err.message || 'Erro ao salvar investimento.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const title = initialData ? 'Editar Investimento' : 'Adicionar Investimento';

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-secondary rounded-2xl w-full max-w-md shadow-xl border border-slate-700/50 flex flex-col max-h-[90vh]">
                <div className="p-6 pb-4 border-b border-slate-700/50 flex justify-between items-center shrink-0">
                    <h2 className="text-xl font-bold text-white">{title}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors" disabled={isSubmitting}>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-sm mb-4">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Instituição</label>
                        <input
                            type="text"
                            value={institution}
                            onChange={(e) => setInstitution(e.target.value)}
                            placeholder="Ex: XP, BTG, Nubank, Banco do Brasil"
                            className="w-full bg-primary border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-highlight focus:ring-1 focus:ring-highlight"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Tipo de Produto</label>
                        <input
                            type="text"
                            value={productType}
                            onChange={(e) => setProductType(e.target.value)}
                            placeholder="Ex: CDB, Ações, Fundo Imobiliário"
                            className="w-full bg-primary border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-highlight focus:ring-1 focus:ring-highlight"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Saldo Atual</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <span className="text-gray-400">R$</span>
                            </div>
                            <input
                                type="number"
                                step="0.01"
                                value={balance}
                                onChange={(e) => setBalance(e.target.value)}
                                placeholder="0,00"
                                className="w-full bg-primary border border-slate-600 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-highlight focus:ring-1 focus:ring-highlight"
                                required
                            />
                        </div>
                    </div>

                    <div className="pt-4 flex justify-end gap-3 mt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSubmitting}
                            className="px-4 py-2 rounded-lg font-medium text-gray-400 hover:text-white transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="px-6 py-2 rounded-lg font-medium bg-highlight hover:bg-highlight-hover text-white transition-colors disabled:opacity-50"
                        >
                            {isSubmitting ? 'Salvando...' : 'Salvar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default InvestmentModal;
