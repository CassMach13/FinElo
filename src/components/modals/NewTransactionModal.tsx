import React, { useState, useEffect } from 'react';
import { Transaction, Account, Category, Asset } from '../../types';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';

interface NewTransactionModalProps {
    onClose: () => void;
    onSave: (transactions: Omit<Transaction, 'ID_Transacao' | 'Origem'>[]) => void;
    accounts: Account[];
    categories: Category[];
    assets: Asset[];
    onOpenCreateAccount: () => void;
    onOpenCreateCategory: () => void;
    lastCreatedAccount: string | null;
    lastCreatedCategory: string | null;
    transaction?: Transaction | null;
}

const NewTransactionModal: React.FC<NewTransactionModalProps> = ({
    onClose,
    onSave,
    accounts,
    categories,
    assets,
    onOpenCreateAccount,
    onOpenCreateCategory,
    lastCreatedAccount,
    lastCreatedCategory,
    transaction: initialTransaction
}) => {
    const getTodayString = () => {
        const today = new Date();
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    };

    const [errors, setErrors] = useState<Record<string, string>>({});

    // Base State
    const [transaction, setTransaction] = useState({
        Data: getTodayString(),
        Data_Pagamento: '',
        ID_Conta: '',
        Nome_Fantasia: '',
        Categoria: '',
        Valor: '',
        Tipo: '' as 'Renda' | 'Despesa',
        Descricao_Original: 'Lançamento Manual',
        linked_asset_id: '',
    });

    // Recurrence State
    const [isRecurrent, setIsRecurrent] = useState(false);
    const [recurrenceType, setRecurrenceType] = useState<'installments' | 'fixed'>('installments');
    const [recurrenceCount, setRecurrenceCount] = useState<string>('2'); // Number of installments or months

    // Helper for type-specific labels
    const isInstallment = isRecurrent && recurrenceType === 'installments';
    const isFixed = isRecurrent && recurrenceType === 'fixed';

    // Auto-select newly created items
    useEffect(() => {
        if (lastCreatedAccount) {
            setTransaction(prev => ({ ...prev, ID_Conta: lastCreatedAccount }));
        }
    }, [lastCreatedAccount]);

    useEffect(() => {
        if (lastCreatedCategory) {
            setTransaction(prev => ({ ...prev, Categoria: lastCreatedCategory }));
        }
    }, [lastCreatedCategory]);

    useEffect(() => {
        if (initialTransaction) {
            setTransaction({
                Data: initialTransaction.Data ? (typeof initialTransaction.Data === 'string' ? initialTransaction.Data.split('T')[0] : initialTransaction.Data.toISOString().split('T')[0]) : getTodayString(),
                Data_Pagamento: initialTransaction.Data_Pagamento ? (typeof initialTransaction.Data_Pagamento === 'string' ? initialTransaction.Data_Pagamento.split('T')[0] : initialTransaction.Data_Pagamento.toISOString().split('T')[0]) : '',
                ID_Conta: initialTransaction.ID_Conta || '',
                Nome_Fantasia: initialTransaction.Nome_Fantasia || '',
                Categoria: initialTransaction.Categoria || '',
                Valor: Math.abs(initialTransaction.Valor).toString(),
                Tipo: initialTransaction.Tipo as 'Renda' | 'Despesa',
                Descricao_Original: initialTransaction.Descricao_Original || '',
                linked_asset_id: initialTransaction.linked_asset_id || '',
            });
            setIsRecurrent(false); // No editing recurrences yet
        } else {
            setTransaction({
                Data: getTodayString(),
                Data_Pagamento: '',
                ID_Conta: '',
                Nome_Fantasia: '',
                Categoria: '',
                Valor: '',
                Tipo: '' as 'Renda' | 'Despesa',
                Descricao_Original: 'Lançamento Manual',
                linked_asset_id: '',
            });
        }
    }, [initialTransaction]);

    const validate = () => {
        const newErrors: Record<string, string> = {};
        if (!transaction.Data) newErrors.Data = 'A data é obrigatória.';
        if (!transaction.ID_Conta) newErrors.ID_Conta = 'A conta é obrigatória.';
        if (!transaction.Nome_Fantasia.trim()) newErrors.Nome_Fantasia = 'A descrição é obrigatória.';
        if (!transaction.Categoria) newErrors.Categoria = 'A categoria é obrigatória.';
        if (!transaction.Valor.trim() || isNaN(parseFloat(transaction.Valor))) newErrors.Valor = 'O valor é obrigatório.';
        if (!transaction.Tipo) newErrors.Tipo = 'O tipo é obrigatório.';

        if (isRecurrent) {
            const count = parseInt(recurrenceCount);
            if (isNaN(count) || count < 2) {
                newErrors.Recurrence = 'Informe um número válido maior que 1 para a repetição.';
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!validate()) return;

        const valorBase = parseFloat(transaction.Valor);
        const loopCount = isRecurrent ? parseInt(recurrenceCount) : 1;

        // Logic change: If Installment, input is TOTAL value, so we divide.
        // If Fixed/Normal, input is MONTHLY value.
        let valorParcela = valorBase;
        if (isInstallment) {
            valorParcela = valorBase / loopCount;
        }

        const finalValue = transaction.Tipo === 'Despesa' ? -Math.abs(valorParcela) : Math.abs(valorParcela);
        const baseDate = new Date(transaction.Data);

        // We'll generate an array of transactions to save
        const transactionsToSave: Omit<Transaction, 'ID_Transacao' | 'Origem'>[] = [];

        for (let i = 0; i < loopCount; i++) {
            // Calculate Date: Add 'i' months to base date
            const currentTxDate = new Date(baseDate);
            currentTxDate.setMonth(baseDate.getMonth() + i);

            // Calculate Payment Date (same offset)
            let currentPaymentDate: Date | undefined = undefined;
            if (transaction.Data_Pagamento) {
                const basePayDate = new Date(transaction.Data_Pagamento);
                currentPaymentDate = new Date(basePayDate);
                currentPaymentDate.setMonth(basePayDate.getMonth() + i);
            }

            // Logic for fields
            let description = transaction.Nome_Fantasia;
            let parcelaAtual: number | null = null;
            let totalParcelas: number | null = null;

            if (isInstallment) {
                description = `${transaction.Nome_Fantasia} (${i + 1}/${loopCount})`;
                parcelaAtual = i + 1;
                totalParcelas = loopCount;
            }

            transactionsToSave.push({
                Data: currentTxDate,
                ID_Conta: transaction.ID_Conta,
                Data_Pagamento: currentPaymentDate,
                Nome_Fantasia: description,
                Categoria: transaction.Categoria,
                Tipo: transaction.Tipo,
                Valor: finalValue,
                Parcela_Atual: parcelaAtual,
                Total_Parcelas: totalParcelas,
                Fonte: 'Manual',
                Descricao_Original: description,
                linked_asset_id: transaction.linked_asset_id || undefined,
            });
        }

        onSave(transactionsToSave);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setTransaction(prev => ({ ...prev, [name]: value }));
    };

    const getDynamicLabel = () => {
        if (isInstallment) return "Valor TOTAL da Compra (R$)";
        if (isFixed) return "Valor Mensal (R$)";
        return "Valor (R$)";
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={initialTransaction ? "Editar Lançamento" : "Adicionar Lançamento"}
            footer={<div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button type="submit" form="new-transaction-form">
                    {isRecurrent ? `Gerar ${recurrenceCount || '?'} Lançamentos` : 'Salvar'}
                </Button>
            </div>}
        >
            <form id="new-transaction-form" onSubmit={handleSubmit} className="space-y-4">
                {/* Row 1: Dates */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                        label="Data de Competência"
                        name="Data"
                        type="date"
                        value={transaction.Data}
                        onChange={handleChange}
                        error={errors.Data}
                        title="Data referente à compra ou fato gerador"
                    />
                    <Input
                        label="Data do Pagamento"
                        name="Data_Pagamento"
                        type="date"
                        value={transaction.Data_Pagamento}
                        onChange={handleChange}
                        placeholder="Opcional"
                    />
                </div>

                {/* Row 2: Account */}
                <div className="flex items-end gap-2">
                    <div className="flex-grow">
                        <Select label="Conta" name="ID_Conta" value={transaction.ID_Conta} onChange={handleChange} error={errors.ID_Conta}>
                            <option value="" disabled>Selecione uma conta...</option>
                            {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.Nome_Conta}</option>)}
                        </Select>
                    </div>
                    <Button type="button" onClick={onOpenCreateAccount} className="mb-px h-[42px]" variant="secondary" title="Criar Nova Conta">+</Button>
                </div>

                {/* Row 3: Description */}
                <Input label="Descrição" name="Nome_Fantasia" value={transaction.Nome_Fantasia} onChange={handleChange} error={errors.Nome_Fantasia} placeholder="Ex: Mercado, Aluguel..." />

                {/* Row 4: Type & Category */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select label="Tipo" name="Tipo" value={transaction.Tipo} onChange={handleChange} error={errors.Tipo}>
                        <option value="" disabled>Selecione...</option>
                        <option value="Despesa">Despesa (Saída)</option>
                        <option value="Renda">Renda (Entrada)</option>
                    </Select>
                    <div className="flex items-end gap-2">
                        <div className="flex-grow">
                            <Select 
                                label="Categoria" 
                                name="Categoria" 
                                value={transaction.Categoria} 
                                onChange={(e) => {
                                    if (e.target.value === 'ADD_NEW_CATEGORY') {
                                        onOpenCreateCategory();
                                    } else {
                                        handleChange(e);
                                    }
                                }} 
                                error={errors.Categoria}
                            >
                                <option value="">Selecione...</option>
                                {categories
                                    .filter(c => transaction.Tipo ? (c.Tipo === 'Ambos' || c.Tipo === transaction.Tipo) : true)
                                    .filter(c => c.Nome_Categoria !== "" && c.Nome_Categoria !== "-")
                                    .sort((a, b) => a.Nome_Categoria.localeCompare(b.Nome_Categoria))
                                    .map(c => <option key={c.id} value={c.Nome_Categoria}>{c.Nome_Categoria}</option>)}
                                <option value="ADD_NEW_CATEGORY" className="text-highlight font-bold">+ Adicionar Categoria</option>
                            </Select>
                        </div>
                        <Button type="button" onClick={onOpenCreateCategory} className="mb-px h-[42px]" variant="secondary" title="Criar Nova Categoria">+</Button>
                    </div>
                </div>

                {/* Row 5: Value */}
                <div className="space-y-1">
                    <Input
                        label={getDynamicLabel()}
                        name="Valor"
                        type="number"
                        step="0.01"
                        value={transaction.Valor}
                        onChange={handleChange}
                        error={errors.Valor}
                        placeholder="0,00"
                    />
                    {isInstallment && transaction.Valor && !isNaN(parseFloat(transaction.Valor)) && (
                        <p className="text-xs text-accent text-right">
                            Isso resultará em {recurrenceCount} parcelas de <strong>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseFloat(transaction.Valor) / parseFloat(recurrenceCount))}</strong>
                        </p>
                    )}
                </div>

                {/* Row 6: Link to Asset (Only for Expenses) */}
                {transaction.Tipo === 'Despesa' && assets.length > 0 && (
                    <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50 space-y-2">
                        <Select 
                            label="Vincular a um Patrimônio / Financiamento" 
                            name="linked_asset_id" 
                            value={transaction.linked_asset_id} 
                            onChange={handleChange}
                        >
                            <option value="">-</option>
                            {assets
                                .filter(a => a.is_financed)
                                .map(a => (
                                    <option key={a.id} value={a.id}>
                                        {a.name} (Saldo: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(a.remaining_balance || 0)})
                                    </option>
                                ))
                            }
                        </Select>
                        <p className="text-[10px] text-gray-500 italic">
                            * Ao vincular, o valor será abatido automaticamente do saldo devedor do bem.
                        </p>
                    </div>
                )}

                {/* RECURRENCE SECTION (Professional Look) */}
                <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                    <div className="flex items-center gap-2 mb-3">
                        <input
                            type="checkbox"
                            id="isRecurrent"
                            checked={isRecurrent}
                            onChange={e => setIsRecurrent(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-highlight focus:ring-accent"
                        />
                        <label htmlFor="isRecurrent" className="text-sm font-medium text-gray-200 cursor-pointer select-none">
                            Repetir este lançamento?
                        </label>
                    </div>

                    {isRecurrent && (
                        <div className="pl-6 space-y-3 animate-fadeIn">
                            <div className="flex gap-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="recurrenceType"
                                        value="installments"
                                        checked={recurrenceType === 'installments'}
                                        onChange={() => setRecurrenceType('installments')}
                                        className="text-highlight focus:ring-accent bg-gray-700 border-gray-600"
                                    />
                                    <span className="text-sm text-gray-300">Parcelado (Compra 10x)</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="recurrenceType"
                                        value="fixed"
                                        checked={recurrenceType === 'fixed'}
                                        onChange={() => setRecurrenceType('fixed')}
                                        className="text-highlight focus:ring-accent bg-gray-700 border-gray-600"
                                    />
                                    <span className="text-sm text-gray-300">Fixo Mensal (Recorrente)</span>
                                </label>
                            </div>

                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-400">
                                    {isInstallment ? 'Número de parcelas:' : 'Repetir por quantos meses?'}
                                </span>
                                <Input
                                    type="number"
                                    value={recurrenceCount}
                                    onChange={e => setRecurrenceCount(e.target.value)}
                                    min="2"
                                    max="360"
                                    className="w-24 !mb-0"
                                    error={errors.Recurrence}
                                />
                                {isFixed && <span className="text-xs text-gray-500">(Use um número alto para "indefinido")</span>}
                            </div>

                            <div className="text-xs text-accent bg-accent/10 p-2 rounded border border-accent/20">
                                {isInstallment
                                    ? `O valor total será dividido em ${recurrenceCount}x. Ex: "TV (1/${recurrenceCount})", "TV (2/${recurrenceCount})"...`
                                    : `O lançamento será clonado ${recurrenceCount || 0} vezes para os próximos meses.`
                                }
                            </div>
                        </div>
                    )}
                </div>

            </form>
        </Modal>
    );
}

export default NewTransactionModal;
