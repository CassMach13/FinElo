import React, { useState, useEffect } from 'react';
import { Investment } from '../../types';

interface InvestmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (investment: Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<void>;
    initialData?: Investment | null;
    referenceMonth: Date;
}

function toInputDate(iso?: string): string {
    if (!iso) return '';
    return iso.slice(0, 10);
}

function emptyOptional(value: string): string | undefined {
    const t = value.trim();
    return t ? t : undefined;
}

function parseOptionalNumber(value: string): number | undefined {
    const t = value.trim();
    if (!t) return undefined;
    const num = parseFloat(t.replace(',', '.'));
    return isNaN(num) ? undefined : num;
}

const InvestmentModal: React.FC<InvestmentModalProps> = ({
    isOpen,
    onClose,
    onSave,
    initialData,
    referenceMonth,
}) => {
    const [institution, setInstitution] = useState('');
    const [productType, setProductType] = useState('');
    const [productName, setProductName] = useState('');
    const [balance, setBalance] = useState('');
    const [investedPrincipal, setInvestedPrincipal] = useState('');
    const [applicationDate, setApplicationDate] = useState('');
    const [maturityDate, setMaturityDate] = useState('');
    const [yieldRate, setYieldRate] = useState('');
    const [monthlyYieldRate, setMonthlyYieldRate] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (initialData) {
            setInstitution(initialData.institution);
            setProductType(initialData.product_type);
            setProductName(initialData.product_name || '');
            setBalance(String(initialData.balance));
            setInvestedPrincipal(
                initialData.invested_principal != null ? String(initialData.invested_principal) : ''
            );
            setApplicationDate(toInputDate(initialData.application_date));
            setMaturityDate(toInputDate(initialData.maturity_date));
            setYieldRate(initialData.yield_rate || '');
            setMonthlyYieldRate(initialData.monthly_yield_rate || '');
        } else {
            setInstitution('');
            setProductType('');
            setProductName('');
            setBalance('');
            setInvestedPrincipal('');
            setApplicationDate('');
            setMaturityDate('');
            setYieldRate('');
            setMonthlyYieldRate('');
        }
        setError(null);
    }, [initialData, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const numBalance = parseFloat(balance.replace(',', '.'));
        if (isNaN(numBalance) || numBalance <= 0) {
            setError('Informe um saldo atual válido (maior que zero).');
            return;
        }

        if (!institution.trim() || !productType.trim()) {
            setError('Instituição e tipo de produto são obrigatórios.');
            return;
        }

        const principal = parseOptionalNumber(investedPrincipal);
        if (investedPrincipal.trim() && principal === undefined) {
            setError('Valor aplicado inválido.');
            return;
        }

        setIsSubmitting(true);
        try {
            const year = referenceMonth.getFullYear();
            const monthNum = String(referenceMonth.getMonth() + 1).padStart(2, '0');
            const refString = `${year}-${monthNum}-01`;

            const payload: Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
                institution: institution.trim(),
                product_type: productType.trim(),
                balance: numBalance,
                reference_month: refString,
            };

            const name = emptyOptional(productName);
            if (name) payload.product_name = name;
            if (principal !== undefined) payload.invested_principal = principal;
            if (applicationDate) payload.application_date = applicationDate;
            if (maturityDate) payload.maturity_date = maturityDate;
            const y = emptyOptional(yieldRate);
            if (y) payload.yield_rate = y;
            const my = emptyOptional(monthlyYieldRate);
            if (my) payload.monthly_yield_rate = my;

            await onSave(payload);
            onClose();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Erro ao salvar investimento.';
            setError(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const title = initialData ? 'Editar Investimento' : 'Adicionar Investimento';

    const fieldClass =
        'w-full bg-primary border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-highlight focus:ring-1 focus:ring-highlight';

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-secondary rounded-2xl w-full max-w-lg shadow-xl border border-slate-700/50 flex flex-col max-h-[90vh]">
                <div className="p-6 pb-4 border-b border-slate-700/50 flex justify-between items-center shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-white">{title}</h2>
                        <p className="text-xs text-gray-500 mt-1">
                            Campos opcionais ajudam a estimar rendimento e conferir prazos.
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors shrink-0"
                        disabled={isSubmitting}
                        type="button"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <fieldset className="space-y-3">
                        <legend className="text-xs font-bold uppercase tracking-wider text-gray-500">Identificação</legend>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">Instituição *</label>
                            <input
                                type="text"
                                value={institution}
                                onChange={(e) => setInstitution(e.target.value)}
                                placeholder="Ex: XP, BTG, Nubank"
                                className={fieldClass}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">Tipo de produto *</label>
                            <input
                                type="text"
                                value={productType}
                                onChange={(e) => setProductType(e.target.value)}
                                placeholder="Ex: CDB, Renda Fixa, Ações"
                                className={fieldClass}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">Nome do ativo</label>
                            <input
                                type="text"
                                value={productName}
                                onChange={(e) => setProductName(e.target.value)}
                                placeholder="Ex: CDB Banco XYZ 120% CDI"
                                className={fieldClass}
                            />
                        </div>
                    </fieldset>

                    <fieldset className="space-y-3">
                        <legend className="text-xs font-bold uppercase tracking-wider text-gray-500">Valores</legend>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">Saldo atual (posição) *</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <span className="text-gray-400">R$</span>
                                </div>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={balance}
                                    onChange={(e) => setBalance(e.target.value)}
                                    placeholder="0,00"
                                    className={`${fieldClass} pl-10`}
                                    required
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">Valor aplicado (principal)</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <span className="text-gray-400">R$</span>
                                </div>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={investedPrincipal}
                                    onChange={(e) => setInvestedPrincipal(e.target.value)}
                                    placeholder="Quanto você investiu no início"
                                    className={`${fieldClass} pl-10`}
                                />
                            </div>
                            <p className="text-[11px] text-gray-500 mt-1">
                                Se preenchido, a diferença para o saldo atual indica ganho acumulado na posição.
                            </p>
                        </div>
                    </fieldset>

                    <fieldset className="space-y-3">
                        <legend className="text-xs font-bold uppercase tracking-wider text-gray-500">Datas</legend>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Data da aplicação</label>
                                <input
                                    type="date"
                                    value={applicationDate}
                                    onChange={(e) => setApplicationDate(e.target.value)}
                                    className={fieldClass}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Vencimento</label>
                                <input
                                    type="date"
                                    value={maturityDate}
                                    onChange={(e) => setMaturityDate(e.target.value)}
                                    className={fieldClass}
                                />
                            </div>
                        </div>
                    </fieldset>

                    <fieldset className="space-y-3">
                        <legend className="text-xs font-bold uppercase tracking-wider text-gray-500">Rentabilidade</legend>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">Índice / taxa do produto</label>
                            <input
                                type="text"
                                value={yieldRate}
                                onChange={(e) => setYieldRate(e.target.value)}
                                placeholder="Ex: 100% CDI, IPCA + 6%, 12% a.a."
                                className={fieldClass}
                            />
                            <p className="text-[11px] text-gray-500 mt-1">Como o produto rende no contrato (igual à planilha da corretora).</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">Rendimento mensal esperado</label>
                            <input
                                type="text"
                                value={monthlyYieldRate}
                                onChange={(e) => setMonthlyYieldRate(e.target.value)}
                                placeholder="Ex: 0,9%, R$ 320 ou 1,1% a.m."
                                className={fieldClass}
                            />
                            <p className="text-[11px] text-gray-500 mt-1">
                                Use se já souber quanto recebe por mês — ajuda a projetar a carteira manualmente.
                            </p>
                        </div>
                    </fieldset>

                    <div className="pt-2 flex justify-end gap-3">
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
