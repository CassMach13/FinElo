import React, { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { PluggyTransactionDraft, PluggyConnection, PluggyConfidence } from '../../types';
import { fetchTransactionsForReview, confirmReviewedTransactions, updatePluggyConnectionAccount } from '../../services/openFinanceService';
import { useAppStore } from '../../hooks/useAppStore';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    connection: PluggyConnection;
    onSuccess: (inserted: number, merged: number) => void;
}

type Step = 'period' | 'review' | 'done';

type PeriodPreset = '7' | '15' | '30' | '90' | 'custom';

const CONFIDENCE_BADGE: Record<PluggyConfidence, { label: string; color: string; dot: string }> = {
    alta: { label: 'Auto', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', dot: '🟢' },
    media: { label: 'Sugerido', color: 'bg-yellow-500/20  text-yellow-400  border-yellow-500/30', dot: '🟡' },
    nova: { label: 'Novo', color: 'bg-red-500/20     text-red-400     border-red-500/30', dot: '🔴' },
};

const OpenFinanceReviewModal: React.FC<Props> = ({ isOpen, onClose, connection, onSuccess }) => {
    const { user, categories } = useAppStore();

    const [step, setStep] = useState<Step>('period');
    const [preset, setPreset] = useState<PeriodPreset>('30');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState(new Date().toISOString().split('T')[0]);
    const [selectedAccount, setSelectedAccount] = useState<string>(connection.ID_Conta_Associada || '');
    const [drafts, setDrafts] = useState<PluggyTransactionDraft[]>([]);
    const [isFetching, setIsFetching] = useState(false);
    const [isConfirming, setIsConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ inserted: number; merged: number } | null>(null);

    const getDateRange = () => {
        const to = new Date().toISOString().split('T')[0];
        if (preset === 'custom') return { from: customFrom, to: customTo };
        const from = new Date();
        from.setDate(from.getDate() - Number(preset));
        return { from: from.toISOString().split('T')[0], to };
    };

    const handleFetch = async () => {
        setIsFetching(true);
        setError(null);
        try {
            const { from, to } = getDateRange();
            const data = await fetchTransactionsForReview(connection.item_id, from, to);
            setDrafts(data);
            setStep('review');
        } catch (err: any) {
            // Detecta conexão antiga do Pluggy (não é um link Belvo válido)
            if (err.message?.includes('conexao_pluggy_legada') || err.message?.includes('Reconecte')) {
                setError('⚠️ Esta conexão foi criada com o sistema anterior. Feche este painel e clique em "+ Conectar Novo Banco" para reconectar via Open Finance.');
            } else {
                setError(err.message || 'Erro ao buscar transações. Tente novamente.');
            }
        } finally {
            setIsFetching(false);
        }
    };

    const handleConfirm = async () => {
        if (!user?.id || !selectedAccount) return;
        setIsConfirming(true);
        setError(null);
        try {
            // Se o usuário selecionou uma conta diferente da que estava salva/nula, salva no banco para lembrar a escolha
            if (connection.ID_Conta_Associada !== selectedAccount) {
                await updatePluggyConnectionAccount(connection.id, selectedAccount).catch(console.error); // Fallback passivo caso dê erro de SQL
            }

            const res = await confirmReviewedTransactions(user.id, drafts, selectedAccount);
            setResult(res);
            setStep('done');
            onSuccess(res.inserted, res.merged);
        } catch (err: any) {
            setError(err.message || 'Erro ao salvar transações');
        } finally {
            setIsConfirming(false);
        }
    };

    const toggleAll = (val: boolean) =>
        setDrafts(prev => prev.map(d => ({ ...d, selecionada: val })));

    const updateDraft = (idx: number, field: keyof PluggyTransactionDraft, value: any) =>
        setDrafts(prev => prev.map((d, i) => i === idx ? { ...d, [field]: value } : d));

    const selectedCount = drafts.filter(d => d.selecionada).length;
    const autoCount = drafts.filter(d => d.confianca === 'alta').length;

    const catOptions = [...new Set(categories.map(c => c.Nome_Categoria))].sort();

    const handleClose = () => {
        setStep('period');
        setDrafts([]);
        setError(null);
        setResult(null);
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title={`🏦 ${connection.bank_name} — Sincronizar Transações`}
            className="max-w-4xl"
        >
            <div className="flex flex-col gap-6 w-full">

                {/* ── STEP 1: Period Selection ─────────────────────────── */}
                {step === 'period' && (
                    <div className="flex flex-col gap-6">

                        {/* Account Selection */}
                        <div className="bg-slate-800/50 border border-slate-700 p-4 rounded-xl">
                            <label className="text-sm text-gray-300 font-medium mb-2 block">
                                Qual conta no FinElo receberá as transações deste banco? <span className="text-red-400">*</span>
                            </label>
                            <select
                                value={selectedAccount}
                                onChange={e => setSelectedAccount(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-600 text-white rounded-lg px-3 py-2.5 outline-none focus:border-indigo-500 transition-colors"
                            >
                                <option value="" disabled>Selecione uma conta...</option>
                                {useAppStore.getState().accounts.map(acc => (
                                    <option key={acc.id} value={acc.id}>{acc.Nome_Conta}</option>
                                ))}
                            </select>
                            <p className="text-xs text-gray-500 mt-2">Isso garante que o saldo seja abatido da conta correta.</p>
                        </div>

                        {/* Period Selection */}
                        <div className="flex flex-col gap-3">
                            <label className="text-sm text-gray-300 font-medium">Selecione o período que deseja sincronizar:</label>

                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                {([['7', 'Última semana'], ['15', 'Últimas 2 semanas'], ['30', 'Último mês'], ['90', 'Últimos 3 meses']] as const).map(([val, label]) => (
                                    <button
                                        key={val}
                                        onClick={() => setPreset(val)}
                                        className={`p-3 rounded-xl border text-sm font-medium transition-all ${preset === val
                                            ? 'bg-indigo-600 border-indigo-500 text-white'
                                            : 'bg-slate-800 border-slate-700 text-gray-300 hover:border-indigo-500 hover:text-white'
                                            }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            <button
                                onClick={() => setPreset('custom')}
                                className={`p-3 rounded-xl border text-sm font-medium transition-all text-left ${preset === 'custom'
                                    ? 'bg-indigo-600 border-indigo-500 text-white'
                                    : 'bg-slate-800 border-slate-700 text-gray-300 hover:border-indigo-500 hover:text-white'
                                    }`}
                            >
                                📅 Período personalizado
                            </button>

                            {preset === 'custom' && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs text-gray-400 mb-1 block">De</label>
                                        <input
                                            type="date"
                                            value={customFrom}
                                            onChange={e => setCustomFrom(e.target.value)}
                                            className="w-full bg-slate-800 border border-slate-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400 mb-1 block">Até</label>
                                        <input
                                            type="date"
                                            value={customTo}
                                            onChange={e => setCustomTo(e.target.value)}
                                            className="w-full bg-slate-800 border border-slate-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                                        />
                                    </div>
                                </div>
                            )}

                            {error && <p className="text-red-400 text-sm bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}

                            <div className="flex gap-3 justify-end pt-4 border-t border-slate-700/50">
                                <Button variant="secondary" onClick={handleClose}>Cancelar</Button>
                                <Button
                                    onClick={handleFetch}
                                    disabled={isFetching || !selectedAccount || (preset === 'custom' && !customFrom)}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white border-none disabled:opacity-50"
                                >
                                    {isFetching ? 'Buscando...' : 'Buscar Transações →'}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── STEP 2: Review ───────────────────────────────────── */}
                {step === 'review' && (
                    <div className="flex flex-col gap-4">
                        {/* Summary bar */}
                        <div className="flex items-center justify-between bg-slate-800/60 rounded-xl px-4 py-3 border border-slate-700/50">
                            <div className="flex items-center gap-4 text-sm">
                                <span className="text-white font-semibold">{drafts.length} transações encontradas</span>
                                <span className="text-emerald-400">🟢 {autoCount} auto-categorizadas</span>
                                <span className="text-yellow-400">🟡 {drafts.filter(d => d.confianca === 'media').length} sugeridas</span>
                                <span className="text-red-400">🔴 {drafts.filter(d => d.confianca === 'nova').length} novas</span>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => toggleAll(true)} className="text-xs text-indigo-400 hover:text-indigo-300">Selecionar todas</button>
                                <span className="text-slate-600">|</span>
                                <button onClick={() => toggleAll(false)} className="text-xs text-gray-400 hover:text-gray-300">Limpar</button>
                            </div>
                        </div>

                        {drafts.length === 0 ? (
                            <div className="text-center py-10 text-gray-400">
                                <p className="text-2xl mb-2">✅</p>
                                <p>Nenhuma transação nova encontrada neste período.</p>
                                <p className="text-xs mt-1">Tudo já está sincronizado!</p>
                            </div>
                        ) : (
                            <div className="overflow-auto max-h-[50vh]">
                                <table className="min-w-[800px] sm:min-w-full text-sm">
                                    <thead>
                                        <tr className="text-xs text-gray-500 border-b border-slate-700/50">
                                            <th className="pb-2 text-left w-6">
                                                <input type="checkbox" checked={selectedCount === drafts.length} onChange={e => toggleAll(e.target.checked)} className="rounded" />
                                            </th>
                                            <th className="pb-2 text-left">Data</th>
                                            <th className="pb-2 text-left">Descrição</th>
                                            <th className="pb-2 text-left">Tipo</th>
                                            <th className="pb-2 text-left">Categoria</th>
                                            <th className="pb-2 text-right">Valor</th>
                                            <th className="pb-2 text-center">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700/30">
                                        {drafts.map((d, idx) => {
                                            const badge = CONFIDENCE_BADGE[d.confianca];
                                            return (
                                                <tr key={d.pluggy_id} className={`transition-colors ${d.selecionada ? '' : 'opacity-40'}`}>
                                                    <td className="py-2 pr-2">
                                                        <input type="checkbox" checked={d.selecionada} onChange={e => updateDraft(idx, 'selecionada', e.target.checked)} className="rounded" />
                                                    </td>
                                                    <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">
                                                        {new Date(`${d.data}T00:00:00`).toLocaleDateString('pt-BR')}
                                                    </td>
                                                    <td className="py-2 pr-3 text-gray-200 max-w-[180px]">
                                                        <span className="block truncate" title={d.descricao}>{d.descricao}</span>
                                                        {d.id_match_manual && (
                                                            <span className="text-xs text-blue-400">🔗 Merge com lançamento manual</span>
                                                        )}
                                                    </td>
                                                    <td className="py-2 pr-3">
                                                        <select
                                                            value={d.tipo}
                                                            onChange={e => updateDraft(idx, 'tipo', e.target.value)}
                                                            className="bg-slate-700 border border-slate-600 text-xs rounded px-2 py-1 text-white focus:outline-none focus:border-indigo-500"
                                                        >
                                                            <option value="Despesa">Despesa</option>
                                                            <option value="Renda">Renda</option>
                                                        </select>
                                                    </td>
                                                    <td className="py-2 pr-3">
                                                        <select
                                                            value={d.categoria}
                                                            onChange={e => updateDraft(idx, 'categoria', e.target.value)}
                                                            className="bg-slate-700 border border-slate-600 text-xs rounded px-2 py-1 text-white focus:outline-none focus:border-indigo-500 max-w-[130px]"
                                                        >
                                                            {catOptions.map(c => <option key={c} value={c}>{c}</option>)}
                                                        </select>
                                                    </td>
                                                    <td className={`py-2 pr-3 text-right font-medium whitespace-nowrap ${d.tipo === 'Despesa' ? 'text-red-400' : 'text-emerald-400'}`}>
                                                        {d.tipo === 'Despesa' ? '-' : '+'}R$ {d.valor.toFixed(2).replace('.', ',')}
                                                    </td>
                                                    <td className="py-2 text-center">
                                                        <span className={`text-xs px-2 py-0.5 rounded-full border ${badge.color}`}>
                                                            {badge.dot} {badge.label}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {error && <p className="text-red-400 text-sm bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}

                        <div className="flex gap-3 justify-between items-center pt-2 border-t border-slate-700/50">
                            <button onClick={() => setStep('period')} className="text-sm text-gray-400 hover:text-white transition-colors">← Voltar</button>
                            <div className="flex gap-3">
                                <Button variant="secondary" onClick={handleClose}>Cancelar</Button>
                                {drafts.length > 0 && (
                                    <Button
                                        onClick={handleConfirm}
                                        disabled={isConfirming || selectedCount === 0}
                                        className="bg-emerald-600 hover:bg-emerald-500 text-white border-none"
                                    >
                                        {isConfirming ? 'Salvando...' : `✅ Confirmar ${selectedCount} transaç${selectedCount === 1 ? 'ão' : 'ões'}`}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── STEP 3: Done ─────────────────────────────────────── */}
                {step === 'done' && result && (
                    <div className="flex flex-col items-center gap-4 py-4 text-center">
                        <div className="text-5xl">🎉</div>
                        <h3 className="text-white text-lg font-semibold">Sincronização concluída!</h3>
                        <div className="flex gap-6 text-sm">
                            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-5 py-3">
                                <p className="text-emerald-400 text-2xl font-bold">{result.inserted}</p>
                                <p className="text-gray-400">novas transações</p>
                            </div>
                            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-5 py-3">
                                <p className="text-blue-400 text-2xl font-bold">{result.merged}</p>
                                <p className="text-gray-400">mergeadas com manuais</p>
                            </div>
                        </div>
                        <p className="text-xs text-gray-500 max-w-xs">
                            As categorias que você ajustou foram aprendidas — próximas sincronizações serão mais automáticas! 🧠
                        </p>
                        <Button onClick={handleClose} className="bg-indigo-600 hover:bg-indigo-500 text-white border-none mt-2">
                            Ver no Dashboard →
                        </Button>
                    </div>
                )}

            </div>
        </Modal>
    );
};

export default OpenFinanceReviewModal;
