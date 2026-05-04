import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import { Account } from '../../types';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { NATIVE_BANK_CONFIGS } from '../../services/parsers/nativeBankParsers';


interface AccountModalProps {
    account: Account | null;
    onClose: () => void;
    onSave: (account: Omit<Account, 'id' | 'user_id'>) => void;
}

const AccountModal: React.FC<AccountModalProps> = ({ account, onClose, onSave }) => {
    const { transactions } = useAppStore();
    const [balanceMode, setBalanceMode] = useState<'current' | 'initial'>('current');

    const [formState, setFormState] = useState({
        Nome_Conta: account?.Nome_Conta || '',
        Tipo_Conta: account?.Tipo_Conta || 'Conta Corrente',
        bank_id: account?.bank_id || '',
        saldoAtual: account?.Saldo_Inicial || 0,
        saldoInicial: account?.Saldo_Inicial || 0,
        dataSaldoInicial: account ? new Date(account.Data_Saldo_Inicial).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        // Campos de Cartão de Crédito
        limite_credito: account?.limite_credito ?? '',
        dia_vencimento: account?.dia_vencimento ?? '',
        dia_fechamento: account?.dia_fechamento ?? '',
    });

    const isCartaoCredito = formState.Tipo_Conta === 'Cartão de Crédito';

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        let finalAccountData: Omit<Account, 'id' | 'user_id'>;

        const creditCardFields = isCartaoCredito ? {
            limite_credito: formState.limite_credito !== '' ? parseFloat(String(formState.limite_credito)) : undefined,
            dia_vencimento: formState.dia_vencimento !== '' ? parseInt(String(formState.dia_vencimento)) : undefined,
            dia_fechamento: formState.dia_fechamento !== '' ? parseInt(String(formState.dia_fechamento)) : undefined,
        } : { limite_credito: undefined, dia_vencimento: undefined, dia_fechamento: undefined };

        if (balanceMode === 'initial' || account) {
            const dataSaldo = formState.dataSaldoInicial ? new Date(formState.dataSaldoInicial) : new Date();
            const dataSaldoAjustada = new Date(dataSaldo.getUTCFullYear(), dataSaldo.getUTCMonth(), dataSaldo.getUTCDate());

            finalAccountData = {
                Nome_Conta: formState.Nome_Conta,
                Tipo_Conta: formState.Tipo_Conta as Account['Tipo_Conta'],
                bank_id: formState.bank_id,
                Saldo_Inicial: parseFloat(String(formState.saldoInicial)),
                Data_Saldo_Inicial: dataSaldoAjustada,
                ...creditCardFields,
            };
        } else {
            finalAccountData = {
                Nome_Conta: formState.Nome_Conta,
                Tipo_Conta: formState.Tipo_Conta as Account['Tipo_Conta'],
                bank_id: formState.bank_id,
                Saldo_Inicial: parseFloat(String(formState.saldoAtual)),
                Data_Saldo_Inicial: new Date(),
                ...creditCardFields,
            };
        }

        onSave(finalAccountData);
    };

    useEffect(() => {
        if (account) setBalanceMode('initial');
    }, [account]);


    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={account ? 'Editar Conta' : 'Nova Conta'}
            footer={
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                    <Button type="submit" form="account-form">Salvar</Button>
                </div>
            }
        >
            <form id="account-form" onSubmit={handleSubmit} className="space-y-4">
                <Input label="Nome da Conta" name="Nome_Conta" value={formState.Nome_Conta} onChange={handleChange} required autoFocus />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select label="Tipo da Conta" name="Tipo_Conta" value={formState.Tipo_Conta} onChange={handleChange} required>
                        <option value="Conta Corrente">Conta Corrente</option>
                        <option value="Poupança">Poupança</option>
                        <option value="Investimento">Investimento</option>
                        <option value="Cartão de Crédito">Cartão de Crédito</option>
                        <option value="Cartão Alimentação">Cartão Alimentação</option>
                        <option value="Outro">Outro</option>
                    </Select>

                    <Select label="Banco/Instituição" name="bank_id" value={formState.bank_id} onChange={handleChange}>
                        <option value="">Nenhum / Outro</option>
                        {NATIVE_BANK_CONFIGS
                            .filter(bank => bank.isSupported)
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map(bank => (
                                <option key={bank.id} value={bank.id}>{bank.name}</option>
                            ))
                        }
                    </Select>
                </div>

                {/* Campos exclusivos de Cartão de Crédito */}
                {isCartaoCredito && (
                    <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4 space-y-3">
                        <p className="text-indigo-300 text-sm font-semibold flex items-center gap-2">
                            💳 Configurações do Cartão de Crédito
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <Input
                                label="Limite Total (R$)"
                                name="limite_credito"
                                type="number"
                                step="0.01"
                                min="0"
                                value={String(formState.limite_credito)}
                                onChange={handleChange}
                                placeholder="Ex: 10000"
                            />
                            <div>
                                <Input
                                    label="Fechamento (dia do mês)"
                                    name="dia_fechamento"
                                    type="number"
                                    min="1"
                                    max="31"
                                    value={String(formState.dia_fechamento)}
                                    onChange={handleChange}
                                    placeholder="Opcional"
                                />
                                <p className="text-[10px] text-amber-400/70 mt-1">
                                    ⚠️ Alguns cartões variam. Se for o seu caso, deixe em branco.
                                </p>
                            </div>
                            <Input
                                label="Vencimento (dia do mês)"
                                name="dia_vencimento"
                                type="number"
                                min="1"
                                max="31"
                                value={String(formState.dia_vencimento)}
                                onChange={handleChange}
                                placeholder="Ex: 10"
                            />
                        </div>
                        <p className="text-indigo-200/60 text-xs">
                            Sem data de fechamento, o FinElo usa o 1º do mês como início do ciclo. Com ela configurada, a fatura atual é calculada com mais precisão.
                        </p>
                    </div>
                )}

                {balanceMode === 'current' && !account ? (
                    <div>
                        <Input
                            label={isCartaoCredito
                                ? `Quanto do limite já foi utilizado até hoje (${new Date().toLocaleDateString('pt-BR')})?`
                                : `Qual o saldo desta conta hoje (${new Date().toLocaleDateString('pt-BR')})?`}
                            name="saldoAtual"
                            type="number"
                            step="0.01"
                            value={formState.saldoAtual}
                            onChange={handleChange}
                            required
                        />
                        <button type="button" onClick={() => setBalanceMode('initial')} className="text-xs text-cyan-400 hover:underline mt-2">Ou informar um saldo/gasto inicial em outra data</button>
                    </div>
                ) : (
                    <div>
                        <Input 
                            label={isCartaoCredito ? (account ? "Corrigir Limite Utilizado Inicial" : "Quanto do limite já estava utilizado na data inicial?") : (account ? "Corrigir Saldo Inicial" : "Saldo Inicial")} 
                            name="saldoInicial" 
                            type="number" 
                            step="0.01" 
                            value={formState.saldoInicial} 
                            onChange={handleChange} 
                            required 
                        />
                        <Input label="Data do Saldo/Gasto Inicial" name="dataSaldoInicial" type="date" value={formState.dataSaldoInicial} onChange={handleChange} required className="mt-4" />
                        {!account && <button type="button" onClick={() => setBalanceMode('current')} className="text-xs text-cyan-400 hover:underline mt-2">Voltar para informar o limite utilizado hoje</button>}
                    </div>
                )}
                
                <div className="mt-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex gap-3 items-start">
                    <span className="text-xl leading-none">💡</span>
                    <div>
                        <p className="text-amber-300 font-semibold text-sm mb-0.5">Dica de Ouro para Conciliação</p>
                        <p className="text-amber-200/80 text-xs leading-relaxed mt-1">
                            Se você planeja importar faturas ou extratos passados, é <strong>altamente recomendável</strong> que a Data do Saldo Inicial seja programada para o <strong>dia anterior</strong> à primeira transação que você pretende importar.
                        </p>
                    </div>
                </div>
            </form>
        </Modal>
    );
};

export default AccountModal;
