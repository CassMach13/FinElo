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
    // Modo de entrada: 'current' para Saldo Atual, 'initial' para Saldo Inicial
    const [balanceMode, setBalanceMode] = useState<'current' | 'initial'>('current');

    const [formState, setFormState] = useState({
        Nome_Conta: account?.Nome_Conta || '',
        Tipo_Conta: account?.Tipo_Conta || 'Conta Corrente',
        bank_id: account?.bank_id || '',
        // Campos separados para cada modo
        saldoAtual: account?.Saldo_Inicial || 0, // Assume saldo inicial como atual ao editar
        saldoInicial: account?.Saldo_Inicial || 0,
        dataSaldoInicial: account ? new Date(account.Data_Saldo_Inicial).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
    };

    // A lógica inteligente acontece aqui!
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        let finalAccountData: Omit<Account, 'id' | 'user_id'>;

        if (balanceMode === 'initial' || account) {
            // Modo Simples: O usuário informou o saldo inicial diretamente.
            // OU estamos no modo de edição. Em ambos os casos, usamos os valores do formulário diretamente.
            const dataSaldo = formState.dataSaldoInicial ? new Date(formState.dataSaldoInicial) : new Date();
            // Ajuste para garantir que a data UTC não mude o dia.
            const dataSaldoAjustada = new Date(dataSaldo.getUTCFullYear(), dataSaldo.getUTCMonth(), dataSaldo.getUTCDate());

            finalAccountData = {
                Nome_Conta: formState.Nome_Conta,
                Tipo_Conta: formState.Tipo_Conta as Account['Tipo_Conta'],
                bank_id: formState.bank_id,
                Saldo_Inicial: parseFloat(String(formState.saldoInicial)),
                Data_Saldo_Inicial: dataSaldoAjustada,
            };
        } else {
            // Modo Inteligente (CORRIGIDO): O usuário informou o saldo atual.
            // O "Saldo Inicial" é simplesmente o saldo atual informado, e a data é hoje.
            // Não fazemos mais nenhum cálculo complexo com transações existentes.
            finalAccountData = {
                Nome_Conta: formState.Nome_Conta,
                Tipo_Conta: formState.Tipo_Conta as Account['Tipo_Conta'],
                bank_id: formState.bank_id,
                Saldo_Inicial: parseFloat(String(formState.saldoAtual)),
                Data_Saldo_Inicial: new Date(), // A data de referência é sempre hoje.
            };
        }

        onSave(finalAccountData);
    };

    // Efeito para desativar o modo inteligente se estivermos editando uma conta
    useEffect(() => {
        if (account) {
            setBalanceMode('initial');
        }
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

                {balanceMode === 'current' && !account ? ( // Só mostra o modo inteligente na CRIAÇÃO
                    <div>
                        <Input label={`Qual o saldo desta conta hoje (${new Date().toLocaleDateString('pt-BR')})?`} name="saldoAtual" type="number" step="0.01" value={formState.saldoAtual} onChange={handleChange} required />
                        <button type="button" onClick={() => setBalanceMode('initial')} className="text-xs text-cyan-400 hover:underline mt-2">Ou informar um saldo inicial em outra data</button>
                    </div>
                ) : (
                    <div>
                        <Input label={account ? "Corrigir Saldo Inicial" : "Saldo Inicial"} name="saldoInicial" type="number" step="0.01" value={formState.saldoInicial} onChange={handleChange} required />
                        <Input label="Data do Saldo Inicial" name="dataSaldoInicial" type="date" value={formState.dataSaldoInicial} onChange={handleChange} required className="mt-4" />
                        {!account && <button type="button" onClick={() => setBalanceMode('current')} className="text-xs text-cyan-400 hover:underline mt-2">Voltar para informar o saldo atual</button>}
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
