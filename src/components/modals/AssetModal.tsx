
import React, { useState } from 'react';
import { Asset } from '../../types';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';

interface AssetModalProps {
    asset?: Asset | null;
    onClose: () => void;
    onSave: (asset: Omit<Asset, 'id' | 'user_id' | 'updated_at'>) => void;
}

type DebtMode = 'none' | 'financing' | 'consortium';

const AssetModal: React.FC<AssetModalProps> = ({ asset, onClose, onSave }) => {
    const [name, setName] = useState(asset?.name || '');
    const [type, setType] = useState<Asset['type']>(asset?.type || 'other');
    const [value, setValue] = useState(asset?.value.toString() || '');
    const [description, setDescription] = useState(asset?.description || '');
    const [acquisitionDate, setAcquisitionDate] = useState(asset?.acquisition_date || '');

    // Determine initial debt mode
    const getInitialMode = (): DebtMode => {
        if (asset?.financing_type === 'consortium') return 'consortium';
        if (asset?.financing_type === 'financing' || asset?.is_financed) return 'financing';
        return 'none';
    };

    const [debtMode, setDebtMode] = useState<DebtMode>(getInitialMode());

    // Shared financing fields
    const [financedAmount, setFinancedAmount] = useState(asset?.financed_amount?.toString() || '');
    const [remainingBalance, setRemainingBalance] = useState(asset?.remaining_balance?.toString() || '');
    const [installmentValue, setInstallmentValue] = useState(asset?.installment_value?.toString() || '');
    const [totalInstallments, setTotalInstallments] = useState(asset?.total_installments?.toString() || '');
    const [paidInstallments, setPaidInstallments] = useState(asset?.paid_installments?.toString() || '');

    // Rate fields
    const [monthlyInterestRate, setMonthlyInterestRate] = useState(asset?.monthly_interest_rate?.toString() || '');
    const [consortiumAdminRate, setConsortiumAdminRate] = useState(asset?.consortium_admin_rate?.toString() || '');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || !value) return;

        const isFinanced = debtMode !== 'none';

        onSave({
            name,
            type,
            value: parseFloat(value),
            description,
            acquisition_date: acquisitionDate || undefined,
            is_financed: isFinanced,
            financing_type: isFinanced ? debtMode : undefined,
            financed_amount: isFinanced ? parseFloat(financedAmount) || undefined : undefined,
            remaining_balance: isFinanced ? parseFloat(remainingBalance) || undefined : undefined,
            installment_value: isFinanced ? parseFloat(installmentValue) || undefined : undefined,
            total_installments: isFinanced ? parseInt(totalInstallments) || undefined : undefined,
            paid_installments: isFinanced ? parseInt(paidInstallments) || undefined : undefined,
            monthly_interest_rate: debtMode === 'financing' ? (monthlyInterestRate !== '' ? parseFloat(monthlyInterestRate) : undefined) : undefined,
            consortium_admin_rate: debtMode === 'consortium' ? (consortiumAdminRate !== '' ? parseFloat(consortiumAdminRate) : undefined) : undefined,
        });
    };

    const debtModeOptions: { value: DebtMode; label: string; icon: string; desc: string }[] = [
        { value: 'none', label: 'Quitado', icon: '✅', desc: 'Bem pago integralmente' },
        { value: 'financing', label: 'Financiamento', icon: '🏦', desc: 'Banco / crédito com juros' },
        { value: 'consortium', label: 'Consórcio', icon: '🔄', desc: 'Grupo com taxa administrativa' },
    ];

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={asset ? 'Editar Ativo' : 'Novo Ativo de Patrimônio'}
            footer={
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                    <Button type="submit" form="asset-form">Salvar</Button>
                </div>
            }
        >
            <form id="asset-form" onSubmit={handleSubmit} className="space-y-4">
                <Input
                    label="Nome do Bem / Ativo"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Jeep Renegade, Apartamento Centro..."
                    required
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select
                        label="Tipo"
                        value={type}
                        onChange={(e) => setType(e.target.value as Asset['type'])}
                    >
                        <option value="car">Veículo / Carro</option>
                        <option value="property">Imóvel / Terreno</option>
                        <option value="other">Outros (Arte, Máquinas, etc.)</option>
                    </Select>

                    <Input
                        label="Valor de Mercado (R$)"
                        type="number"
                        step="0.01"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder="0,00"
                        required
                    />
                </div>

                <Input
                    label="Data de Aquisição (Opcional)"
                    type="date"
                    value={acquisitionDate}
                    onChange={(e) => setAcquisitionDate(e.target.value)}
                />

                <Input
                    label="Observações / Detalhes (Opcional)"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Ex: Placa, Endereço, Kilometragem..."
                />

                {/* Debt Mode Selector */}
                <div className="space-y-3 pt-4 border-t border-slate-700/50">
                    <p className="text-sm font-semibold text-slate-300">Situação de Pagamento</p>
                    <div className="grid grid-cols-3 gap-2">
                        {debtModeOptions.map(opt => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setDebtMode(opt.value)}
                                className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all text-center cursor-pointer
                                    ${debtMode === opt.value
                                        ? 'border-highlight bg-highlight/10 text-white'
                                        : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-500'
                                    }`}
                            >
                                <span className="text-xl">{opt.icon}</span>
                                <span className="text-xs font-bold">{opt.label}</span>
                                <span className="text-[10px] text-slate-500 leading-tight">{opt.desc}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Shared fields for financing and consortium */}
                {debtMode !== 'none' && (
                    <div className="space-y-4 p-4 bg-slate-800/30 rounded-xl border border-slate-700/50 animate-fade-in">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Input
                                label="Saldo Devedor Atual (R$)"
                                type="number"
                                step="0.01"
                                value={remainingBalance}
                                onChange={(e) => setRemainingBalance(e.target.value)}
                                placeholder="Quanto falta pagar?"
                            />
                            <Input
                                label="Valor Original Financiado (R$)"
                                type="number"
                                step="0.01"
                                value={financedAmount}
                                onChange={(e) => setFinancedAmount(e.target.value)}
                                placeholder="Total contratado"
                            />
                            <Input
                                label="Valor da Parcela (R$)"
                                type="number"
                                step="0.01"
                                value={installmentValue}
                                onChange={(e) => setInstallmentValue(e.target.value)}
                                placeholder="Mensalidade"
                            />
                            <div className="grid grid-cols-2 gap-2">
                                <Input
                                    label="Pagas"
                                    type="number"
                                    value={paidInstallments}
                                    onChange={(e) => setPaidInstallments(e.target.value)}
                                    placeholder="0"
                                />
                                <Input
                                    label="Total"
                                    type="number"
                                    value={totalInstallments}
                                    onChange={(e) => setTotalInstallments(e.target.value)}
                                    placeholder="0"
                                />
                            </div>
                        </div>

                        {/* Rate fields specific to each mode */}
                        {debtMode === 'financing' && (
                            <div className="p-3 bg-blue-900/20 border border-blue-700/30 rounded-xl">
                                <Input
                                    label="Taxa de Juros Mensal (%)"
                                    type="number"
                                    step="0.01"
                                    value={monthlyInterestRate}
                                    onChange={(e) => setMonthlyInterestRate(e.target.value)}
                                    placeholder="Ex: 0.89 para 0,89% ao mês"
                                />
                                <p className="text-xs text-blue-300/70 mt-2">
                                    💡 Usado para calcular o custo exato dos juros pagos vs. principal quitado (Tabela Price).
                                </p>
                            </div>
                        )}

                        {debtMode === 'consortium' && (
                            <div className="p-3 bg-purple-900/20 border border-purple-700/30 rounded-xl">
                                <Input
                                    label="Taxa Administrativa Total (%)"
                                    type="number"
                                    step="0.01"
                                    value={consortiumAdminRate}
                                    onChange={(e) => setConsortiumAdminRate(e.target.value)}
                                    placeholder="Ex: 20 para 20% do valor total"
                                />
                                <p className="text-xs text-purple-300/70 mt-2">
                                    💡 A taxa adm. é distribuída ao longo das parcelas para mostrar o custo real do consórcio.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                <div className="p-3 bg-amber-900/20 border border-amber-700/30 rounded text-amber-200 text-xs">
                    <strong>Dica:</strong> Para carros e imóveis, use o valor de mercado atual (ex: Tabela FIPE) para um patrimônio mais preciso.
                </div>
            </form>
        </Modal>
    );
};

export default AssetModal;
