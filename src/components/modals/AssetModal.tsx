
import React, { useState, useEffect } from 'react';
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

const AssetModal: React.FC<AssetModalProps> = ({ asset, onClose, onSave }) => {
    const [name, setName] = useState(asset?.name || '');
    const [type, setType] = useState<Asset['type']>(asset?.type || 'other');
    const [value, setValue] = useState(asset?.value.toString() || '');
    const [description, setDescription] = useState(asset?.description || '');
    const [acquisitionDate, setAcquisitionDate] = useState(asset?.acquisition_date || '');

    // Financing states
    const [isFinanced, setIsFinanced] = useState(asset?.is_financed || false);
    const [financedAmount, setFinancedAmount] = useState(asset?.financed_amount?.toString() || '');
    const [remainingBalance, setRemainingBalance] = useState(asset?.remaining_balance?.toString() || '');
    const [installmentValue, setInstallmentValue] = useState(asset?.installment_value?.toString() || '');
    const [totalInstallments, setTotalInstallments] = useState(asset?.total_installments?.toString() || '');
    const [paidInstallments, setPaidInstallments] = useState(asset?.paid_installments?.toString() || '');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || !value) return;

        onSave({
            name,
            type,
            value: parseFloat(value),
            description,
            acquisition_date: acquisitionDate || undefined,
            is_financed: isFinanced,
            financed_amount: isFinanced ? parseFloat(financedAmount) || undefined : undefined,
            remaining_balance: isFinanced ? parseFloat(remainingBalance) || undefined : undefined,
            installment_value: isFinanced ? parseFloat(installmentValue) || undefined : undefined,
            total_installments: isFinanced ? parseInt(totalInstallments) || undefined : undefined,
            paid_installments: isFinanced ? parseInt(paidInstallments) || undefined : undefined,
        });
    };

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
                        label="Valor (R$)"
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

                <div className="space-y-4 pt-4 border-t border-slate-700/50">
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="is_financed"
                            checked={isFinanced}
                            onChange={(e) => setIsFinanced(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-700 text-highlight focus:ring-highlight bg-slate-800"
                        />
                        <label htmlFor="is_financed" className="text-sm font-medium text-slate-300 cursor-pointer">
                            Este bem possui financiamento ou dívida ativa?
                        </label>
                    </div>

                    {isFinanced && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-slate-800/30 rounded-xl border border-slate-700/50 animate-fade-in">
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
                            />
                            <Input
                                label="Valor da Parcela (R$)"
                                type="number"
                                step="0.01"
                                value={installmentValue}
                                onChange={(e) => setInstallmentValue(e.target.value)}
                            />
                             <div className="grid grid-cols-2 gap-2">
                                <Input
                                    label="Quitadas"
                                    type="number"
                                    value={paidInstallments}
                                    onChange={(e) => setPaidInstallments(e.target.value)}
                                />
                                <Input
                                    label="Total"
                                    type="number"
                                    value={totalInstallments}
                                    onChange={(e) => setTotalInstallments(e.target.value)}
                                />
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-3 bg-amber-900/20 border border-amber-700/30 rounded text-amber-200 text-xs">
                    <strong>Dica:</strong> Para carros e imóveis, tente usar o valor de mercado atual (ex: Tabela FIPE) para um patrimônio mais preciso.
                </div>
            </form>
        </Modal>
    );
};

export default AssetModal;
