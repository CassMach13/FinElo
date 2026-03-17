import React, { useState, useRef } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import { Investment } from '../../types';
import { xpInvestmentParser } from '../../services/parsers/xpInvestmentParser';
import { investmentService } from '../../services/investmentService';

interface InvestmentImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    referenceMonth: Date;
    onImportSuccess: () => void;
}

const InvestmentImportModal: React.FC<InvestmentImportModalProps> = ({
    isOpen,
    onClose,
    referenceMonth,
    onImportSuccess
}) => {
    const { user } = useAppStore();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [selectedInstitution, setSelectedInstitution] = useState('XP Investimentos');
    const [file, setFile] = useState<File | null>(null);
    const [parsedInvestments, setParsedInvestments] = useState<Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] | null>(null);

    const [isParsing, setIsParsing] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        setFile(selectedFile);
        setError(null);
        setParsedInvestments(null);
        setIsParsing(true);

        try {
            const buffer = await selectedFile.arrayBuffer();

            // Determine the reference month string
            const year = referenceMonth.getFullYear();
            const monthNum = String(referenceMonth.getMonth() + 1).padStart(2, '0');
            const refString = `${year}-${monthNum}-01`;

            let parsed: Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [];

            if (selectedInstitution === 'XP Investimentos') {
                parsed = await xpInvestmentParser.parseExcel(buffer, refString);
            } else {
                throw new Error('Instituição ainda não suportada para importação automática.');
            }

            if (parsed.length === 0) {
                throw new Error('Nenhum investimento encontrado. Verifique se a planilha está no formato correto da corretora.');
            }

            // Atribui o nome do arquivo a cada registro
            const parsedWithFile = parsed.map(inv => ({
                ...inv,
                source_file: selectedFile.name
            }));

            setParsedInvestments(parsedWithFile);
        } catch (err: any) {
            setError(err.message || 'Erro ao processar o arquivo.');
            setFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
        } finally {
            setIsParsing(false);
        }
    };

    const handleImport = async () => {
        if (!user || !parsedInvestments || parsedInvestments.length === 0) return;

        setIsImporting(true);
        setError(null);

        try {
            // 1. Prepare data with user_id
            const finalData = parsedInvestments.map(inv => ({
                ...inv,
                user_id: user.id
            }));

            const refString = parsedInvestments[0].reference_month;

            // 2. Check if this exact file was already imported
            const fileName = parsedInvestments[0].source_file;
            if (fileName) {
                const isDuplicate = await investmentService.checkIfFileAlreadyImported(user.id, selectedInstitution, refString, fileName);
                if (isDuplicate) {
                    throw new Error(`O arquivo "${fileName}" já foi importado para ${selectedInstitution} neste mês.`);
                }
            }

            // 3. Insert new data (APPEND instead of replace)
            await investmentService.importInvestmentsBatch(finalData as any);

            onImportSuccess();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Erro ao salvar os investimentos no banco de dados.');
        } finally {
            setIsImporting(false);
        }
    };

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    };

    const totalValue = parsedInvestments ? parsedInvestments.reduce((sum, inv) => sum + inv.balance, 0) : 0;

    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const monthStr = `${monthNames[referenceMonth.getMonth()]} de ${referenceMonth.getFullYear()}`;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-secondary rounded-2xl w-full max-w-2xl shadow-xl border border-slate-700/50 flex flex-col max-h-[90vh]">
                <div className="p-6 pb-4 border-b border-slate-700/50 flex justify-between items-center shrink-0 bg-slate-800/30">
                    <div>
                        <h2 className="text-xl font-bold text-white">Importar Planilha de Investimentos</h2>
                        <p className="text-sm text-gray-400 mt-1">Carregar dados para {monthStr}</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors" disabled={isImporting || isParsing}>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6 flex-1">
                    {!parsedInvestments ? (
                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Corretora/Banco</label>
                                <select
                                    value={selectedInstitution}
                                    onChange={(e) => setSelectedInstitution(e.target.value)}
                                    className="w-full bg-primary border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-highlight focus:ring-1 focus:ring-highlight appearance-none"
                                    disabled={isParsing}
                                >
                                    <option value="XP Investimentos">XP Investimentos (.xlsx)</option>
                                    <option value="other" disabled>Outras corretoras (Em breve)</option>
                                </select>
                            </div>

                            <div
                                className="border-2 border-dashed border-slate-600 rounded-xl p-8 hover:border-highlight/50 hover:bg-slate-800/30 transition-all text-center cursor-pointer group"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileChange}
                                    accept=".xlsx"
                                    className="hidden"
                                />
                                <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-primary transition-colors border border-slate-700/50">
                                    <svg className="w-8 h-8 text-highlight" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                    </svg>
                                </div>
                                <p className="text-white font-medium mb-1">Clique para selecionar ou arraste o arquivo MENSAL da {selectedInstitution}</p>
                                <p className="text-gray-400 text-sm">Formato suportado: .xlsx (Excel)</p>

                                {isParsing && (
                                    <div className="mt-4 flex items-center justify-center gap-2 text-highlight">
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-highlight"></div>
                                        <span className="text-sm font-medium">Lendo planilha...</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="bg-highlight/10 border border-highlight/20 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
                                <div>
                                    <h3 className="text-white font-bold text-lg">Pronto para importar!</h3>
                                    <p className="text-highlight text-sm">Encontramos {parsedInvestments.length} posições de {selectedInstitution}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-gray-400 text-xs uppercase tracking-wider font-bold">Total Encontrado</p>
                                    <p className="text-2xl font-bold text-white">{formatCurrency(totalValue)}</p>
                                </div>
                            </div>

                            <div className="bg-primary rounded-xl border border-slate-700/50 overflow-hidden">
                                <div className="max-h-[250px] overflow-auto">
                                    <table className="min-w-[600px] sm:min-w-full text-left text-sm">
                                        <thead className="bg-slate-800/80 sticky top-0 z-10 backdrop-blur-sm">
                                            <tr>
                                                <th className="px-4 py-2 font-medium text-gray-400">Ativo</th>
                                                <th className="px-4 py-2 font-medium text-gray-400">Rentabilidade</th>
                                                <th className="px-4 py-2 font-medium text-gray-400">Vencimento</th>
                                                <th className="px-4 py-2 font-medium text-gray-400 text-right">Saldo</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-700/50">
                                            {parsedInvestments.map((inv, idx) => (
                                                <tr key={idx} className="hover:bg-slate-800/30">
                                                    <td className="px-4 py-3 text-white">
                                                        <div className="flex flex-col gap-0.5">
                                                            <span className="font-medium line-clamp-1">{inv.product_name || inv.product_type}</span>
                                                            <span className="text-xs text-gray-400">{inv.product_type}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-300">{inv.yield_rate || '-'}</td>
                                                    <td className="px-4 py-3 text-gray-300">
                                                        {inv.maturity_date ? new Date(inv.maturity_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-white text-right font-medium">
                                                        <div className="flex flex-col items-end gap-0.5">
                                                            <span>{formatCurrency(inv.balance)}</span>
                                                            {inv.invested_principal && (
                                                                <span className="text-xs text-gray-500 font-normal">P: {formatCurrency(inv.invested_principal)}</span>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="flex flex-col gap-3">
                                <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded-lg text-sm text-blue-400 flex gap-3">
                                    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    <p>O Total Encontrado listado acima confere 100% de precisão matemática ao somar cada ativo individualmente. Devido ao arredondamento da própria corretora, a soma do app pode diferir em até 2 centavos da soma impressa no cabeçalho do seu PDF/Excel.</p>
                                </div>
                                <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg text-sm text-amber-500 flex gap-3">
                                    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                    <p>Estes investimentos serão <strong>adicionados</strong> à sua carteira de {selectedInstitution} em {monthStr}. Um arquivo com o mesmo nome não pode ser importado duas vezes no mesmo mês.</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {error && (
                    <div className="mx-6 mb-2 p-4 bg-red-600/90 backdrop-blur-md text-white rounded-xl flex items-start gap-3 shadow-[0_4px_20px_rgba(220,38,38,0.4)] animate-fade-in shrink-0 border border-red-500/30">
                        <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <div className="flex flex-col">
                            <span className="font-bold text-xs uppercase tracking-wider mb-0.5">⚠️ Importação Bloqueada</span>
                            <span className="text-sm font-medium">{error}</span>
                        </div>
                    </div>
                )}

                <div className="p-6 border-t border-slate-700/50 flex justify-between gap-3 bg-slate-800/30 shrink-0">
                    <button
                        type="button"
                        onClick={() => {
                            if (parsedInvestments) {
                                setParsedInvestments(null);
                                setFile(null);
                                if (fileInputRef.current) fileInputRef.current.value = '';
                            } else {
                                onClose();
                            }
                        }}
                        disabled={isImporting || isParsing}
                        className="px-4 py-2 rounded-lg font-medium text-gray-400 hover:text-white transition-colors"
                    >
                        {parsedInvestments ? 'Voltar e escolher outro arquivo' : 'Cancelar'}
                    </button>

                    {parsedInvestments && (
                        <button
                            onClick={handleImport}
                            disabled={isImporting}
                            className="px-6 py-2 rounded-lg font-medium bg-highlight hover:bg-highlight-hover text-white transition-colors disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-highlight/20"
                        >
                            {isImporting ? (
                                <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                    <span>Salvando...</span>
                                </>
                            ) : (
                                <>
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                                    <span>Confirmar Importação</span>
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InvestmentImportModal;
