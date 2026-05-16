import React, { useState } from 'react';
import { ShieldCheckIcon } from '../ui/icons';
import { useAppStore } from './../../hooks/useAppStore';
import { appAlert, appConfirm } from '../../hooks/useDialogStore';
import { supabase } from '../../supabaseClient';

import { processStatementFile, parsePreview, parseContent, convertExcelToCSV } from './../../services/parserService';
import { NATIVE_BANK_CONFIGS, NativeBankConfig, detectBankFromContent, parseNativeBankCSV } from '../../services/parsers/nativeBankParsers';
import Card from './../ui/Card';
import Button from './../ui/Button';
import Modal from './../ui/Modal';
import Input from './../ui/Input';
import Select from './../ui/Select';
import AccountModal from './AccountModal';
import { TourButton } from '../TourButton';
import { getBelvoWidgetToken, savePluggyConnection, loadPluggyConnections, deletePluggyConnection } from '../../services/openFinanceService';
import OpenFinanceReviewModal from '../modals/OpenFinanceReviewModal';
import { PluggyConnection, ImportConfig, Account, CardImportCycleInput } from '../../types';
import SaveConfigModal from '../modals/SaveConfigModal';

// --- BankCard: reusable card with favorite star toggle ---
interface BankCardProps {
  bank: { id: string; name: string; description: string; brandColor: string; brandColorSecondary: string; logoText: string; logoUrl?: string };
  isSelected: boolean;
  isFavorite: boolean;
  onSelect: () => void;
  onToggleFavorite: (e: React.MouseEvent) => void;
}

const BankCard: React.FC<BankCardProps> = ({ bank, isSelected, isFavorite, onSelect, onToggleFavorite }) => (
  <div
    role="button"
    tabIndex={0}
    aria-pressed={isSelected}
    onClick={onSelect}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect();
      }
    }}
    className={`group relative flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-200 ${
      isSelected
        ? 'border-green-500/60 bg-slate-800 ring-2 ring-green-500/30'
        : isFavorite
          ? 'border-yellow-500/30 bg-slate-800/70 hover:border-yellow-400/50 hover:bg-slate-800'
          : 'border-slate-700 hover:border-slate-500 bg-slate-800/50 hover:bg-slate-800'
    } cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-highlight`}
  >
    {/* Logo */}
    <div
      className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg text-white transition-transform group-hover:scale-105"
      style={{ background: `linear-gradient(135deg, ${bank.brandColor}, ${bank.brandColorSecondary})` }}
    >
      {bank.logoUrl ? (
        <img src={bank.logoUrl} alt={bank.name} className="w-full h-full object-contain p-1 rounded-xl" />
      ) : bank.logoText.length <= 2 ? (
        <span className="uppercase font-black text-sm">{bank.logoText}</span>
      ) : (
        <span className="text-[8px] font-bold uppercase tracking-tight text-center leading-tight px-0.5">{bank.logoText}</span>
      )}
    </div>

    {/* Name + description */}
    <div className="text-center">
      <p className="text-white font-semibold text-xs leading-tight">{bank.name}</p>
      <p className="text-gray-400 text-[10px] mt-0.5 leading-tight">{bank.description}</p>
    </div>

    {/* ✓ Auto badge – top right */}
    <span className="absolute top-2 right-2 text-[9px] font-bold text-green-400 bg-green-400/10 border border-green-400/20 rounded-full px-1.5 py-0.5">
      ✓ Auto
    </span>

    {/* ⭐ Favorite toggle – top left */}
    <button
      type="button"
      onClick={onToggleFavorite}
      title={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
      className={`absolute top-1.5 left-1.5 text-base leading-none transition-all duration-150
        ${isFavorite
          ? 'opacity-100 scale-110 drop-shadow-[0_0_4px_rgba(250,204,21,0.7)]'
          : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:scale-110 grayscale'
        }`}
    >
      ⭐
    </button>
  </div>
);

const ImportView: React.FC = () => {
  const { user, importConfigs, transactions, mappingRules, addMultipleTransactions, importLogs, isPremium, unlimitedSync, accounts, addAccount, setCurrentView, updateUserPreferences } = useAppStore();

  const isAdmin = user?.email?.toLowerCase().trim() === 'cassiomq@gmail.com';
  const hasUnlimitedAccess = unlimitedSync || isAdmin;

  const [selectedConfigSource, setSelectedConfigSource] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [paymentDateModalOpen, setPaymentDateModalOpen] = useState(false);
  const [saveConfigModalOpen, setSaveConfigModalOpen] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Step management: 'bank-select' → choose bank or go manual; 'upload' → manual file pick; 'mapping' → map columns
  const [step, setStep] = useState<'bank-select' | 'upload' | 'mapping'>('bank-select');
  const [selectedNativeBank, setSelectedNativeBank] = useState<NativeBankConfig | null>(null);
  const [detectedNativeBank, setDetectedNativeBank] = useState<NativeBankConfig | null>(null);
  const [nativeDueDate, setNativeDueDate] = useState('');
  const [nativeReferenceMode, setNativeReferenceMode] = useState<'auto' | 'manual'>('auto');
  const [nativeReferenceMonth, setNativeReferenceMonth] = useState('');
  const [selectedNativeAccountId, setSelectedNativeAccountId] = useState('');
  const [isAccountModalOpen, setAccountModalOpen] = useState(false);

  // --- Favorites: Synced via user_metadata & auto-computed from accounts ---
  const explFavs: string[] = user?.user_metadata?.favoriteBankIds || [];
  const explUnfavs: string[] = user?.user_metadata?.unfavoritedBankIds || [];

  const userBankIdsFromAccounts = React.useMemo(() => {
    return Array.from(new Set(accounts.map(acc => acc.bank_id).filter(Boolean) as string[]));
  }, [accounts]);

  const sortedBanks = [...NATIVE_BANK_CONFIGS].filter(b => b.isSupported).sort((a, b) => a.name.localeCompare(b.name));
  
  const favoriteBanks = sortedBanks.filter(b => {
    if (explFavs.includes(b.id)) return true;
    if (userBankIdsFromAccounts.includes(b.id) && !explUnfavs.includes(b.id)) return true;
    return false;
  });
  
  const otherBanks = sortedBanks.filter(b => !favoriteBanks.some(fav => fav.id === b.id));

  const [showAllBanks, setShowAllBanks] = useState(() => favoriteBanks.length === 0);

  // Sync initial state if favoriteBanks changes and showAllBanks wasn't configured manually
  React.useEffect(() => {
    if (favoriteBanks.length === 0) setShowAllBanks(true);
  }, [favoriteBanks.length]);

  const toggleFavorite = (bankId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // don't trigger bank selection
    
    const isCurrentlyFav = favoriteBanks.some(b => b.id === bankId);
    const isFromAccounts = userBankIdsFromAccounts.includes(bankId);
    
    let newFavs = [...explFavs];
    let newUnfavs = [...explUnfavs];
    
    if (isCurrentlyFav) {
      // Make it UNFAVORITE
      newFavs = newFavs.filter(id => id !== bankId);
      if (isFromAccounts && !newUnfavs.includes(bankId)) {
        newUnfavs.push(bankId);
      }
    } else {
      // Make it FAVORITE
      if (!newFavs.includes(bankId)) {
        newFavs.push(bankId);
      }
      newUnfavs = newUnfavs.filter(id => id !== bankId);
    }
    
    updateUserPreferences({
      favoriteBankIds: newFavs,
      unfavoritedBankIds: newUnfavs
    });
  };


  // Belvo Widget State
  const [isBelvoLoading, setIsBelvoLoading] = useState(false);
  const [pluggyConnections, setPluggyConnections] = useState<PluggyConnection[]>([]);
  const [reviewConnection, setReviewConnection] = useState<PluggyConnection | null>(null);
  const [isLoadingConnections, setIsLoadingConnections] = useState(false);
  const [belvoError, setBelvoError] = useState<string | null>(null);
  const [showPaywallModal, setShowPaywallModal] = useState<'basic' | 'extra_bank' | null>(null);

  // Modal de CPF/Nome para Open Finance (contorna bug do Widget)
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [consentCpf, setConsentCpf] = useState('');
  const [consentName, setConsentName] = useState('');
  const [consentInstitution, setConsentInstitution] = useState('ofmockbank_br_retail');


  // Load existing connections on mount
  React.useEffect(() => {
    if (!user?.id) return;
    setIsLoadingConnections(true);
    loadPluggyConnections(user.id)
      .then(setPluggyConnections)
      .catch(console.error)
      .finally(() => setIsLoadingConnections(false));
  }, [user?.id]);

  const handlePluggySuccess = async (itemData: any) => {
    try {
      if (user?.id && itemData.item?.id) {
        const bankName = itemData.item.connector?.name || 'Banco Conectado';
        setNotification({ type: 'success', message: `${bankName} conectado com sucesso!` });
        await savePluggyConnection(user.id, itemData.item.id, bankName);
        // Reload connections list and open review modal for the newly connected bank
        const conns = await loadPluggyConnections(user.id);
        setPluggyConnections(conns);
        const newConn = conns.find(c => c.item_id === itemData.item.id);
        if (newConn) setReviewConnection(newConn);
      }
    } catch (error) {
      setNotification({ type: 'error', message: 'Erro ao salvar conexão com o banco.' });
    }
  };

  const handleOpenFinanceConnect = () => {
    if (!isPremium) { setShowPaywallModal('basic'); return; }
    if (!hasUnlimitedAccess && pluggyConnections.length >= 1) { setShowPaywallModal('extra_bank'); return; }
    setShowConsentModal(true);
  };

  // Chamado quando o usuário confirma CPF e Nome no modal
  const handleConsentSubmit = async (isRetail: boolean = false) => {
    const cleanCpf = consentCpf.replace(/\D/g, '');
    if (!isRetail && cleanCpf.length !== 11) {
      setNotification({ type: 'error', message: 'CPF inválido. Digite os 11 dígitos.' });
      return;
    }
    if (!isRetail && !consentName.trim()) {
      setNotification({ type: 'error', message: 'Nome completo é obrigatório.' });
      return;
    }

    const handleAction = async (isRetail: boolean = false) => {
      setIsBelvoLoading(true);
      setBelvoError(null);
      setNotification(null);

      // BYPASS DE DESENVOLVEDOR: Pula a Belvo completamente no Modo Teste
      if (isRetail) {
        setTimeout(async () => {
          setIsBelvoLoading(false);
          setShowConsentModal(false);
          setNotification({ type: 'success', message: 'Conexão simulada com sucesso (Bypass)!' });
          // Simula o callback de sucesso da Belvo chamando a função que salva o banco
          await handlePluggySuccess({ 
            item: { 
              id: `mock-belvo-${Date.now()}`, 
              connector: { name: 'Banco Simulado (Teste)' } 
            } 
          });
        }, 1000);
        return;
      }

      try {
        const cleanCpf = consentCpf.replace(/\D/g, '');
        
        // 1. Gera o token de acesso (OFDA)
        const tokenRes = await fetch('/api/belvo-consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userDocument: cleanCpf,
            userName: consentName.trim(),
            externalId: user?.id,
            isRetail: false
          }),
        });

        const tokenData = await tokenRes.json();

        if (!tokenRes.ok) {
          const detail = tokenData.details?.message || tokenData.error || 'Erro ao gerar token';
          throw new Error(detail);
        }

        const { accessToken } = tokenData;

        // 2. Abre o Hosted Widget da Belvo diretamente via URL
        const belvoUrl = `https://widget.belvo.io/?access_token=${accessToken}&locale=pt&access_mode=single&external_id=${user?.id}`;
        
        window.open(belvoUrl, '_blank');
        setShowConsentModal(false);
        setIsBelvoLoading(false);
        setNotification({ type: 'success', message: 'Janela de conexão aberta! Siga as instruções no banco e volte aqui.' });

      } catch (error: any) {
        const technicalMsg = error.message || 'Falha ao iniciar Open Finance';
        setBelvoError(technicalMsg);
        setNotification({ type: 'error', message: technicalMsg });
        setIsBelvoLoading(false);
      }
    };

    handleAction(isRetail);
  };

  // Injeta o script do Belvo Widget via CDN (apenas uma vez)
  function loadBelvoScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.getElementById('belvo-widget-script')) {
        resolve(); return;
      }
      const script = document.createElement('script');
      script.id = 'belvo-widget-script';
      script.src = 'https://cdn.belvo.io/belvo-widget-1-stable.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Falha ao carregar Belvo Widget'));
      document.head.appendChild(script);
    });
  }

  const [previewData, setPreviewData] = useState<string[][]>([]);
  const [fileContent, setFileContent] = useState<string>('');
  const [mapping, setMapping] = useState({
    hasHeader: true,
    skipLines: 0,
    dateColumnIndex: -1,
    amountColumnIndex: -1,
    installmentsColumnIndex: -1,
    descriptionColumnIndicies: [] as number[],
    ignoredIndices: new Set<number>()
  });

  const [tempSourceType, setTempSourceType] = useState<ImportConfig['Tipo_Fonte']>('Conta');
  const [tempDueDate, setTempDueDate] = useState('');
  const [tempReferenceMode, setTempReferenceMode] = useState<'auto' | 'manual'>('auto');
  const [tempReferenceMonth, setTempReferenceMonth] = useState('');
  const [invertValues, setInvertValues] = useState(false);

  // Check Monthly Limit
  const importsThisMonth = React.useMemo(() => {
    const now = new Date();
    return importLogs.filter(log => {
      const logDate = new Date(log.import_date || new Date());
      return logDate.getMonth() === now.getMonth() && logDate.getFullYear() === now.getFullYear();
    }).length;
  }, [importLogs]);

  const hasReachedLimit = !isPremium && importsThisMonth >= 1;

  // Apply saved config to mapping state
  React.useEffect(() => {
    if (!selectedConfigSource) return;
    const config = importConfigs.find(c => c.Nome_Fonte === selectedConfigSource);
    if (config) {
      setTempSourceType(config.Tipo_Fonte as any || 'Conta');
      const rawIndices = config.Ignorar_Indices || [];
      const isCartao = config.Tipo_Fonte === 'Cartao' || config.Tipo_Fonte === 'Cartão de Crédito';
      let shouldInvert = isCartao;
      if (rawIndices.includes(-1)) shouldInvert = true;
      if (rawIndices.includes(-2)) shouldInvert = false;
      setInvertValues(shouldInvert);

      setMapping(prev => {
        const newMapping = {
          ...prev,
          hasHeader: config.Tem_Cabecalho,
          skipLines: config.Linhas_Ignorar_Inicio,
          descriptionColumnIndicies: [] as number[],
          dateColumnIndex: config.Coluna_Data ? parseInt(config.Coluna_Data) : -1,
          amountColumnIndex: config.Coluna_Valor ? parseInt(config.Coluna_Valor) : -1,
          installmentsColumnIndex: config.Coluna_Parcelas ? parseInt(config.Coluna_Parcelas) : -1,
          ignoredIndices: new Set(config.Ignorar_Indices ? config.Ignorar_Indices.filter((i: number) => i >= 0) : []),
        };
        const descIndices: number[] = [];
        const tryParseIndex = (val: string | undefined): number | null => {
          if (!val) return null;
          const parsed = parseInt(val);
          return isNaN(parsed) ? null : parsed;
        };
        const d1 = tryParseIndex(config.Coluna_Descricao_1);
        if (d1 !== null) descIndices.push(d1);
        const d2 = tryParseIndex(config.Coluna_Descricao_2);
        if (d2 !== null) descIndices.push(d2);
        if (descIndices.length > 0) newMapping.descriptionColumnIndicies = descIndices;
        return newMapping;
      });
    }
  }, [selectedConfigSource, importConfigs]);

  const toggleIgnoreRow = (index: number) => {
    setMapping(prev => {
      const newSet = new Set(prev.ignoredIndices);
      if (newSet.has(index)) newSet.delete(index);
      else newSet.add(index);
      return { ...prev, ignoredIndices: newSet };
    });
  };

  // ─── Native Bank Import ───────────────────────────────────────────────────

  const handleNativeBankSelect = (bank: NativeBankConfig) => {
    setSelectedNativeBank(bank);
    setDetectedNativeBank(null);
    setFile(null);
    setNotification(null);
    setNativeDueDate('');
    setNativeReferenceMode('auto');
    setNativeReferenceMonth('');
  };

  const buildCardCycleInput = (
    sourceType: ImportConfig['Tipo_Fonte'] | 'Cartao' | 'Conta',
    dueDate: string,
    referenceMode: 'auto' | 'manual',
    referenceMonth: string
  ): CardImportCycleInput | undefined => {
    const isCard = sourceType === 'Cartao' || sourceType === 'Cartão de Crédito';
    if (!isCard) return undefined;
    return {
      mode: referenceMode,
      dueDate: dueDate || null,
      referenceLabel: referenceMode === 'manual' ? (referenceMonth || null) : null,
    };
  };

  const getDistinctCompetenciesFromTransactions = (txs: Array<{ Data?: string | Date }>): string[] => {
    const keys = new Set<string>();
    txs.forEach((tx) => {
      if (!tx.Data) return;
      const date = new Date(tx.Data);
      if (Number.isNaN(date.getTime())) return;
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      keys.add(`${y}-${m}`);
    });
    return Array.from(keys).sort();
  };

  const handleNativeBankFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !selectedNativeBank) return;
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setNotification(null);
    setIsLoading(true);
    try {
        const fileName = selectedFile.name.toLowerCase();
        let content = '';

        if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            content = await convertExcelToCSV(selectedFile);
        } else {
            content = await new Promise<string>((res, rej) => {
                const reader = new FileReader();
                reader.onload = (event) => res(event.target?.result as string);
                reader.onerror = () => rej(new Error('Erro ao ler arquivo.'));
                reader.readAsText(selectedFile);
            });
        }
        
        setFileContent(content);
        const autoDetected = detectBankFromContent(content);
        if (autoDetected && autoDetected.id !== selectedNativeBank.id) {
          const isItauFallback = autoDetected.id.includes('banco-itau') && selectedNativeBank.id.includes('banco-itau');
          if (isItauFallback) {
            setDetectedNativeBank(null);
          } else {
            setDetectedNativeBank(autoDetected);
          }
        } else {
          setDetectedNativeBank(null);
        }
        if (selectedNativeBank.sourceType === 'Cartao') {
          if (nativeReferenceMode === 'manual' && !nativeReferenceMonth) {
            await appAlert("No modo manual, informe a competência da fatura (AAAA-MM).", "Aviso", "warning");
            setIsLoading(false);
            return;
          }
          // The due date is already captured in `nativeDueDate` within the Native Bank Modal.
          // Parse it from YYYY-MM-DD to a Date object, defaulting to today if somehow missing.
          let paymentDate = new Date();
          if (nativeDueDate) {
            const [year, month, day] = nativeDueDate.split('-');
            paymentDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
          }
          const cardCycle = buildCardCycleInput(
            selectedNativeBank.sourceType,
            nativeDueDate,
            nativeReferenceMode,
            nativeReferenceMonth
          );
          await processNativeBankFile(content, selectedNativeBank, selectedFile, paymentDate, cardCycle);
        } else {
          await processNativeBankFile(content, selectedNativeBank, selectedFile, undefined, undefined);
        }
        setIsLoading(false);
    } catch (error) {
      console.error(error);
      setNotification({ type: 'error', message: 'Erro ao ler arquivo.' });
      setIsLoading(false);
    }
  };

  const processNativeBankFile = async (
    content: string,
    bankCfg: NativeBankConfig,
    selectedFile: File,
    paymentDate?: Date,
    cardCycle?: CardImportCycleInput
  ) => {
    setIsLoading(true);
    setNotification(null);
    try {
      const result = parseNativeBankCSV(content, bankCfg, transactions, mappingRules, paymentDate, selectedFile.name);
      if (bankCfg.sourceType === 'Cartao' && cardCycle?.mode !== 'manual') {
        const competencies = getDistinctCompetenciesFromTransactions(result.newTransactions);
        if (competencies.length > 1) {
          const proceedAuto = await appConfirm(
            `Detectamos lançamentos de múltiplas competências (${competencies.join(', ')}) no mesmo arquivo. Deseja continuar no modo automático mesmo assim?`,
            'Possível Ambiguidade de Competência',
            'Continuar automático',
            'warning'
          );
          if (!proceedAuto) {
            setNotification({
              type: 'error',
              message: 'Importação pausada. Defina a competência manualmente para garantir precisão da fatura.',
            });
            return;
          }
        }
      }
      if (result.newTransactions.length > 0 || result.ignoredCount > 0) {
        const fakeConfig = {
          id: bankCfg.id,
          Nome_Fonte: bankCfg.name,
          Tipo_Fonte: bankCfg.sourceType,
          Tem_Cabecalho: bankCfg.hasHeader,
          Linhas_Ignorar_Inicio: bankCfg.skipLines,
          ID_Conta_Associada: selectedNativeAccountId || null
        };
        const importResult = await addMultipleTransactions(
          result.newTransactions,
          fakeConfig as any,
          selectedFile.name,
          result.ignoredItems,
          { cardCycle }
        );
        setNotification({
          type: 'success',
          message: `✅ Importação concluída! ${importResult.imported} novas transações, ${importResult.ignored} ignoradas.`,
        });
      } else {
        setNotification({
          type: 'error',
          message: `Nenhuma transação encontrada. Verifique se o arquivo está no formato correto para ${bankCfg.name}.`,
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro desconhecido';
      setNotification({ type: 'error', message: `Falha na importação: ${msg}` });
    } finally {
      setIsLoading(false);
      const input = document.getElementById('native-file-upload') as HTMLInputElement;
      if (input) input.value = '';
    }
  };

  // ─── Manual / Smart Import ────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setNotification(null);
      try {
        setIsLoading(true);
        setMapping(prev => ({ ...prev, skipLines: 0, ignoredIndices: new Set() }));
        const { previewRows, fullContent } = await parsePreview(selectedFile);
        setPreviewData(previewRows);
        setFileContent(fullContent);
        setStep('mapping');
        const headerKeywords = ['data', 'date', 'valor', 'value', 'amount', 'desc', 'hist'];
        const firstRows = previewRows.slice(0, 5);
        if (firstRows.some(row => row.some(cell => headerKeywords.some(kw => cell.toLowerCase().includes(kw))))) {
          setMapping(prev => ({ ...prev, hasHeader: true }));
        }
      } catch (error) {
        console.error(error);
        setNotification({ type: 'error', message: 'Erro ao ler arquivo para pré-visualização.' });
      } finally {
        setIsLoading(false);
      }
    }
  };

  const getCellColor = (val: string, colIndex: number) => {
    if (mapping.amountColumnIndex !== colIndex) {
      if (mapping.dateColumnIndex === colIndex) return 'text-blue-300 bg-blue-900/10';
      if (mapping.installmentsColumnIndex === colIndex) return 'text-orange-300 bg-orange-900/10';
      if (mapping.descriptionColumnIndicies.includes(colIndex)) return 'text-white';
      return '';
    }
    const cleanStr = val.replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.');
    const num = parseFloat(cleanStr);
    if (isNaN(num)) return 'text-gray-400 bg-green-900/10';
    if (invertValues) {
      if (num > 0) return 'text-red-400 bg-red-900/10 font-medium';
      if (num < 0) return 'text-green-400 bg-green-900/10 font-medium';
    } else {
      if (num > 0) return 'text-green-400 bg-green-900/10 font-medium';
      if (num < 0) return 'text-red-400 bg-red-900/10 font-medium';
    }
    return 'text-gray-300 bg-green-900/10';
  };

  const toggleDescriptionColumn = (index: number) => {
    setMapping(prev => {
      const exists = prev.descriptionColumnIndicies.includes(index);
      if (exists) return { ...prev, descriptionColumnIndicies: prev.descriptionColumnIndicies.filter(i => i !== index) };
      return { ...prev, descriptionColumnIndicies: [...prev.descriptionColumnIndicies, index] };
    });
  };

  const handleSmartImport = async () => {
    if (hasReachedLimit) {
      await appAlert("Você atingiu o limite de 1 importação gratuita por mês. Assine o Premium para importações ilimitadas!", "Aviso", "warning");
      return;
    }
    if (mapping.dateColumnIndex === -1 || mapping.amountColumnIndex === -1) {
      setNotification({ type: 'error', message: 'Por favor, indique quais colunas correspondem a Data e Valor.' });
      return;
    }
    let dueDateToUse: Date | undefined = undefined;
    if (tempSourceType === 'Cartao' || tempSourceType === 'Cartão de Crédito') {
      if (!tempDueDate) {
        appAlert("Para importação de cartão de crédito, a Data de Vencimento é obrigatória. Ela será usada como data de pagamento.", "Aviso", "warning");
        return;
      }
      dueDateToUse = new Date(tempDueDate);
      if (isNaN(dueDateToUse.getTime())) {
        appAlert("Data de vencimento inválida.", "Erro", "danger");
        return;
      }
      if (tempReferenceMode === 'manual' && !tempReferenceMonth) {
        await appAlert("Para modo manual, informe a competência da fatura (AAAA-MM).", "Aviso", "warning");
        return;
      }
    }
    const cardCycle = buildCardCycleInput(
      tempSourceType,
      tempDueDate,
      tempReferenceMode,
      tempReferenceMonth
    );
    await processFile(dueDateToUse, cardCycle);
  };

  const processFile = async (paymentDate?: Date, cardCycle?: CardImportCycleInput) => {
    setIsLoading(true);
    setNotification(null);
    try {
      const config = importConfigs.find(c => c.Nome_Fonte === selectedConfigSource) || null;
      const manualMappingConfig: {
        hasHeader: boolean;
        dateColumnIndex: number;
        descriptionColumnIndicies: number[];
        amountColumnIndex: number;
        installmentsColumnIndex?: number;
        skipLines: number;
        ignoredIndices?: number[];
        fileContent: string;
        sourceType?: 'Conta' | 'Cartao';
        invertValues?: boolean;
      } = {
        hasHeader: mapping.hasHeader,
        dateColumnIndex: mapping.dateColumnIndex,
        descriptionColumnIndicies: mapping.descriptionColumnIndicies,
        amountColumnIndex: mapping.amountColumnIndex,
        installmentsColumnIndex: mapping.installmentsColumnIndex,
        skipLines: mapping.skipLines,
        ignoredIndices: Array.from(mapping.ignoredIndices),
        fileContent: fileContent,
        sourceType: tempSourceType,
        invertValues: invertValues
      };
      const result = await processStatementFile(file!, null, transactions, mappingRules, paymentDate, manualMappingConfig);
      if ((tempSourceType === 'Cartao' || tempSourceType === 'Cartão de Crédito') && cardCycle?.mode !== 'manual') {
        const competencies = getDistinctCompetenciesFromTransactions(result.newTransactions);
        if (competencies.length > 1) {
          const proceedAuto = await appConfirm(
            `Detectamos lançamentos de múltiplas competências (${competencies.join(', ')}) no mesmo arquivo. Deseja continuar no modo automático mesmo assim?`,
            'Possível Ambiguidade de Competência',
            'Continuar automático',
            'warning'
          );
          if (!proceedAuto) {
            setNotification({
              type: 'error',
              message: 'Importação pausada. Defina a competência manualmente para garantir precisão da fatura.',
            });
            return;
          }
        }
      }
      if (result.newTransactions.length > 0 || result.ignoredCount > 0) {
        const sourceName = selectedConfigSource || "Importação Inteligente";
        const effectiveConfig = config || {
          id: 'smart-import',
          Nome_Fonte: sourceName,
          Tipo_Fonte: tempSourceType,
          Tem_Cabecalho: mapping.hasHeader,
          Linhas_Ignorar_Inicio: mapping.skipLines
        };
        const importResult = await addMultipleTransactions(
          result.newTransactions,
          effectiveConfig as any,
          file!.name,
          result.ignoredItems,
          { cardCycle }
        );
        setNotification({
          type: 'success',
          message: `Importação concluída! ${importResult.imported} novas, ${importResult.ignored} ignoradas.`,
        });
        setStep('bank-select');
        setSaveConfigModalOpen(true);
      } else {
        setNotification({
          type: 'success',
          message: `Nenhuma transação encontrada no arquivo. Verifique o mapeamento das colunas.`,
        });
      }
    } catch (error) {
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Ocorreu um erro desconhecido.';
      setNotification({ type: 'error', message: `Falha na importação: ${errorMessage}` });
    } finally {
      setIsLoading(false);
      setFile(null);
      const fileInput = document.getElementById('file-upload') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    }
  };

  // Check if user has manual configs matching a native bank (migration notice)
  const hasMigrationNotice = importConfigs.some(cfg => {
    const name = cfg.Nome_Fonte?.toLowerCase() || '';
    return NATIVE_BANK_CONFIGS.some(nb => nb.isSupported && (name.includes(nb.name.toLowerCase()) || name.includes(nb.id.replace('-', ' '))));
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-3xl font-bold text-light">Importar Extrato</h1>
        <TourButton currentView="import" />
      </div>

      {!isPremium && (
        <div className="bg-slate-800 p-3 rounded-lg flex justify-between items-center text-sm mb-4 border border-slate-700">
          <span className="text-gray-300">
            Uso mensal gratuito: <strong className={hasReachedLimit ? "text-red-400" : "text-green-400"}>{importsThisMonth}/1</strong> importações.
          </span>
          {!hasReachedLimit ? (
            <span className="text-xs text-blue-400">Você tem 1 importação grátis restante.</span>
          ) : (
            <span className="text-xs text-red-400 font-bold">Limite atingido.</span>
          )}
        </div>
      )}

      {hasReachedLimit ? (
        <Card className="border border-red-500/30 bg-red-500/10 text-center py-10">
          <div className="mb-4 text-4xl">🚫</div>
          <h3 className="text-xl font-bold text-white mb-2">Limite Gratuito Atingido</h3>
          <p className="text-gray-300 mb-6 max-w-md mx-auto">
            Você já realizou sua importação gratuita este mês. Para continuar organizando suas finanças com agilidade, faça o upgrade.
          </p>
          <Button onClick={() => window.location.hash = '#pricing'} className="animate-pulse bg-gradient-to-r from-highlight to-blue-600 border-none">
            Liberar Importações Ilimitadas
          </Button>
        </Card>
      ) : (
        <>
          {/* ── STEP: BANK SELECTION ─────────────────────────────────────────── */}
          {step === 'bank-select' && (
            <>
              {hasMigrationNotice && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
                  <span className="text-2xl">💡</span>
                  <div>
                    <p className="text-amber-300 font-semibold text-sm">Novidade: Importação Automática Disponível!</p>
                    <p className="text-amber-200/80 text-xs mt-1">
                      Alguns dos seus bancos agora têm importação nativa — selecione o banco abaixo para importar sem mapear colunas!
                    </p>
                  </div>
                </div>
              )}

              <Card>
                <div className="space-y-6">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-1">Selecione o Banco ou Cartão</h2>
                    <p className="text-sm text-gray-400">Escolha a fonte do seu extrato para uma importação automática, sem configurações manuais.</p>
                  </div>

                  <div className="space-y-5">
                    {/* --- FAVORITES SECTION --- */}
                    {favoriteBanks.length > 0 && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-yellow-400/80 mb-3 flex items-center gap-1.5">
                          <span>⭐</span> Meus Bancos
                          <span className="text-slate-600 font-normal normal-case tracking-normal ml-1">(favoritos)</span>
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                          {favoriteBanks.map(bank => (
                            <BankCard
                              key={bank.id}
                              bank={bank}
                              isSelected={selectedNativeBank?.id === bank.id}
                              isFavorite={true}
                              onSelect={() => handleNativeBankSelect(bank)}
                              onToggleFavorite={(e) => toggleFavorite(bank.id, e)}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* --- ALL BANKS SECTION (collapsible when favorites exist) --- */}
                    <div>
                      {favoriteBanks.length > 0 ? (
                        <button
                          onClick={() => setShowAllBanks(v => !v)}
                          className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-white transition-colors mb-3 group"
                        >
                          <span className={`transition-transform duration-200 ${showAllBanks ? 'rotate-90' : ''}`}>▶</span>
                          Todos os Bancos
                          <span className="text-slate-600 font-normal normal-case tracking-normal">({sortedBanks.length} disponíveis)</span>
                        </button>
                      ) : (
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">✅ Importação Automática Disponível</p>
                          <p className="text-[10px] text-slate-600 italic">Clique em ⭐ para favoritar seus bancos</p>
                        </div>
                      )}

                      {(showAllBanks || favoriteBanks.length === 0) && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                          {otherBanks.map(bank => (
                            <BankCard
                              key={bank.id}
                              bank={bank}
                              isSelected={selectedNativeBank?.id === bank.id}
                              isFavorite={false}
                              onSelect={() => handleNativeBankSelect(bank)}
                              onToggleFavorite={(e) => toggleFavorite(bank.id, e)}
                            />
                          ))}

                          {/* Manual Mapping Option — always at the end */}
                          <button
                            onClick={() => { setSelectedNativeBank(null); setStep('upload'); }}
                            className="group relative flex flex-col items-center gap-2 p-3 rounded-xl border border-slate-700 border-dashed hover:border-highlight bg-slate-800/20 hover:bg-slate-800/50 transition-all duration-200"
                          >
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg text-slate-400 bg-slate-800 transition-transform group-hover:scale-105 border border-slate-700 group-hover:text-highlight">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                              </svg>
                            </div>
                            <div className="text-center">
                              <p className="text-white font-semibold text-xs leading-tight">Mapeamento</p>
                              <p className="text-gray-400 text-[10px] mt-0.5 leading-tight">Configuração Manual</p>
                            </div>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ─── OPEN FINANCE (BELVO) ─────────────────────────────────────────── */}
                  <div className="border border-indigo-500/30 bg-gradient-to-r from-indigo-900/40 to-slate-900/40 rounded-xl p-5 mt-4 relative overflow-hidden group">
                    <div className="absolute inset-0 bg-indigo-500/10 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out"></div>
                    <div className="relative z-10">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-bold text-white">🌐 Conexão Automática (Open Finance)</h3>
                          <span className="bg-indigo-500 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded-full">BETA</span>
                        </div>
                        <div className="flex flex-col gap-2 w-full sm:w-auto">
                          <Button
                            onClick={handleOpenFinanceConnect}
                            disabled={isBelvoLoading}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white border-none whitespace-nowrap shadow-lg shadow-indigo-500/20 text-sm w-full"
                          >
                            {isBelvoLoading ? 'Iniciando...' : '+ Conectar Novo Banco'}
                          </Button>
                          <a 
                            href="https://dashboard.belvo.com/my-portal/" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-[10px] text-gray-500 hover:text-indigo-400 text-center flex items-center justify-center gap-1"
                          >
                            Meu Portal Belvo (Gerenciar Consentimentos)
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        </div>
                      </div>
                      <p className="text-sm text-gray-400 mb-4">
                        Conecte Nubank, Itaú, Bradesco e mais de 100 instituições. Selecione o período e revise antes de salvar.
                      </p>

                      {/* Technical Error Box (Request ID) */}
                      {belvoError && (
                        <div className="bg-red-500/20 border border-red-500/40 p-3 rounded-lg mb-4 text-[11px] text-red-300">
                          <p className="font-bold mb-1 flex items-center gap-1">❌ Detalhes para Suporte:</p>
                          <code className="block bg-black/40 p-2 rounded mb-2 break-all">{belvoError}</code>
                          <button 
                            onClick={() => {
                              const match = belvoError.match(/"request_id":\s*"([^"]+)"/);
                              const id = match ? match[1] : belvoError;
                              navigator.clipboard.writeText(id);
                            }}
                            className="bg-red-500/30 hover:bg-red-500/50 px-2 py-1 rounded text-[10px] uppercase font-bold transition-colors"
                          >
                            Copiar Request ID
                          </button>
                        </div>
                      )}

                      {isLoadingConnections ? (
                        <p className="text-xs text-gray-500 animate-pulse">Carregando conexões...</p>
                      ) : pluggyConnections.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">Bancos Conectados</p>
                          {pluggyConnections.map(conn => (
                            <div key={conn.id} className="flex items-center justify-between bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 group">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-sm">🏦</div>
                                <div>
                                  <p className="text-white text-sm font-medium">{conn.bank_name}</p>
                                  <p className="text-gray-500 text-xs">Conectado em {new Date(conn.created_at).toLocaleDateString('pt-BR')}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  onClick={() => setReviewConnection(conn)}
                                  className="bg-emerald-600/80 hover:bg-emerald-500 text-white border-none text-xs py-1.5 px-3"
                                >
                                  🔄 Sincronizar
                                </Button>
                                <button
                                  onClick={async () => {
                                    if (!(await appConfirm(`Remover a conexão com ${conn.bank_name}? Suas transações já importadas não serão afetadas.`, "Remover Conexão", "Remover", "danger"))) return;
                                    await deletePluggyConnection(conn.id);
                                    setPluggyConnections(prev => prev.filter(c => c.id !== conn.id));
                                    setNotification({ type: 'success', message: `Conexão com ${conn.bank_name} removida.` });
                                  }}
                                  title="Remover conexão"
                                  className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500 italic">Nenhum banco conectado ainda. Clique em "+ Conectar Novo Banco" para começar.</p>
                      )}
                    </div>
                  </div>

                  {/* Belvo Widget Mount Point */}
                  <div id="belvo"></div>

                  <div className="border-t border-slate-700/50 pt-5 mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">

                    <div>
                      <p className="text-white font-semibold text-sm">🏦 Meu banco não está na lista</p>
                      <p className="text-gray-400 text-xs mt-0.5">Fale com o suporte ou crie um mapeamento manual clicando na grade acima.</p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <a
                        href="mailto:suporte@finelo.com.br?subject=Solicitação de Integração Nativa&body=Olá! Gostaria de solicitar a integração nativa para o banco: [NOME DO BANCO]"
                        className="text-xs font-semibold px-4 py-2 rounded-lg bg-slate-800 text-white hover:bg-slate-700 transition"
                      >
                        📬 Solicitar Integração
                      </a>
                    </div>
                  </div>

                  {/* ── PAYWALL MODAL ─────────────────────────────────────── */}
                  <Modal
                    isOpen={showPaywallModal !== null}
                    onClose={() => setShowPaywallModal(null)}
                    title={showPaywallModal === 'basic' ? "🎯 Recurso Premium" : "🌟 Conexão Extra"}
                  >
                    <div className="flex flex-col items-center justify-center p-4 text-center">
                      <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center text-3xl mb-4 border border-indigo-500/30">
                        {showPaywallModal === 'basic' ? '💎' : '🏦'}
                      </div>

                      {showPaywallModal === 'basic' ? (
                        <>
                          <h3 className="text-xl font-bold text-white mb-2">Open Finance é Premium!</h3>
                          <p className="text-gray-300 text-sm mb-6 leading-relaxed">
                            A sincronização automática via Open Finance consome recursos avançados do sistema e está disponível exclusivamente para assinantes <strong>PRO</strong> ou <strong>Wealth</strong>.
                          </p>
                          <div className="flex flex-col gap-3 w-full">
                            <Button className="w-full bg-indigo-600 hover:bg-indigo-500 text-white border-none py-3" onClick={() => setCurrentView('pricing')}>
                              Ver Planos e Fazer Upgrade
                            </Button>
                            <Button variant="secondary" className="w-full py-3" onClick={() => setShowPaywallModal(null)}>
                              Continuar no Plano Grátis
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <h3 className="text-xl font-bold text-white mb-2">Limite de Bancos Atingido</h3>
                          <p className="text-gray-300 text-sm mb-4 leading-relaxed">
                            Seu plano pago inclui <strong>1 conexão gratuita</strong>.
                          </p>
                          <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700/50 mb-6 text-sm">
                            <p className="text-gray-400 mb-2">Para adicionar o <strong>2º banco</strong>, o custo adicional de infraestrutura é de:</p>
                            <p className="text-2xl font-bold text-white mb-1"><span className="text-sm font-normal text-gray-500 mr-1">R$</span>3,00<span className="text-xs font-normal text-gray-500 ml-1">/mês</span></p>
                            <p className="text-xs text-indigo-400 font-medium">Cobrado separadamente na sua fatura.</p>
                          </div>
                          <div className="flex flex-col gap-3 w-full">
                            <Button
                              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white border-none py-3 font-semibold"
                              onClick={() => window.open('https://buy.stripe.com/test_XYZ_REPLACE_ME', '_blank')} // Awaiting real link from user
                            >
                              Adicionar Banco (+ R$ 3,00)
                            </Button>
                            <Button variant="secondary" className="w-full py-3" onClick={() => setShowPaywallModal(null)}>
                              Cancelar
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  </Modal>

                </div>
              </Card>
            </>
          )}

          {
            selectedNativeBank && (
              <Modal
                isOpen={true}
                onClose={() => {
                  setSelectedNativeBank(null);
                  setDetectedNativeBank(null);
                  setFile(null);
                  setNotification(null);
                  setNativeDueDate('');
                  setNativeReferenceMode('auto');
                  setNativeReferenceMonth('');
                }}
                title="Importação Automática"
                className="max-w-xl"
                footer={null}
              >
                <div className="flex flex-col gap-5">
                  <div className="flex items-center gap-4 bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center shadow-lg text-white flex-shrink-0"
                      style={{ background: `linear-gradient(135deg, ${selectedNativeBank.brandColor}, ${selectedNativeBank.brandColorSecondary})` }}
                    >
                      {selectedNativeBank.logoUrl ? (
                        <img src={selectedNativeBank.logoUrl} alt={selectedNativeBank.name} className="w-full h-full object-contain p-1 rounded-xl" />
                      ) : (
                        selectedNativeBank.logoText.length <= 2
                          ? <span className="uppercase font-black text-sm">{selectedNativeBank.logoText}</span>
                          : <span className="text-[9px] font-bold uppercase tracking-tight text-center leading-tight px-0.5">{selectedNativeBank.logoText}</span>
                      )}
                    </div>
                    <div>
                      <h3 className="text-white font-bold">{selectedNativeBank.name}</h3>
                      <p className="text-gray-400 text-sm">{selectedNativeBank.description}</p>
                    </div>
                  </div>

                  {detectedNativeBank && detectedNativeBank.id !== selectedNativeBank.id && (
                    <div className="mb-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm">
                      <p className="text-amber-300">⚠️ O arquivo parece ser do <strong>{detectedNativeBank.name}</strong>, não do {selectedNativeBank.name}. Verifique se selecionou o banco correto.</p>
                    </div>
                  )}

                  {selectedNativeBank.sourceType === 'Cartao' && (
                    <div className="mb-2 bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                      <label className="block text-sm font-medium text-blue-300 mb-1">📅 Vencimento da Fatura *</label>
                      <input
                        type="date"
                        value={nativeDueDate}
                        onChange={e => setNativeDueDate(e.target.value)}
                        className="w-full sm:w-1/2 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                      />
                      <p className="text-xs text-blue-400 mt-1">Necessário para registrar a data de pagamento correta das despesas.</p>
                      <div className="mt-3 pt-3 border-t border-blue-500/20">
                        <p className="text-xs text-blue-300 font-semibold mb-2">Competência da fatura</p>
                        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                          <label className="flex items-center gap-2 text-xs text-gray-300">
                            <input
                              type="radio"
                              name="nativeReferenceMode"
                              checked={nativeReferenceMode === 'auto'}
                              onChange={() => setNativeReferenceMode('auto')}
                              className="text-highlight focus:ring-highlight bg-slate-700 border-slate-600"
                            />
                            Automática (pela compra mais recente)
                          </label>
                          <label className="flex items-center gap-2 text-xs text-gray-300">
                            <input
                              type="radio"
                              name="nativeReferenceMode"
                              checked={nativeReferenceMode === 'manual'}
                              onChange={() => setNativeReferenceMode('manual')}
                              className="text-highlight focus:ring-highlight bg-slate-700 border-slate-600"
                            />
                            Definir manualmente
                          </label>
                        </div>
                        {nativeReferenceMode === 'manual' && (
                          <div className="mt-2">
                            <Input
                              label="Competência (AAAA-MM)"
                              type="month"
                              value={nativeReferenceMonth}
                              onChange={(e) => setNativeReferenceMonth(e.target.value)}
                            />
                            <p className="text-[11px] text-blue-400 mt-1">
                              Recomendado para arquivos antigos, garantindo precisão da fatura no histórico.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mb-2 bg-slate-800/50 border border-slate-700 rounded-lg p-3">
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-sm font-medium text-gray-300">💰 Conta de Destino *</label>
                      <button
                        onClick={() => setAccountModalOpen(true)}
                        className="text-xs text-highlight hover:underline"
                      >
                        + Nova Conta
                      </button>
                    </div>
                    <select
                      value={selectedNativeAccountId}
                      onChange={e => setSelectedNativeAccountId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-highlight focus:ring-1 focus:ring-highlight"
                    >
                      <option value="">Selecione a conta para este extrato</option>
                      {accounts
                        .filter(acc => selectedNativeBank.sourceType === 'Cartao' ? acc.Tipo_Conta === 'Cartão de Crédito' : acc.Tipo_Conta !== 'Cartão de Crédito')
                        .map(acc => (
                          <option key={acc.id} value={acc.id}>{acc.Nome_Conta}</option>
                        ))
                      }
                      {/* Fallback if no specific type accounts exist */}
                      {accounts.filter(acc => selectedNativeBank.sourceType === 'Cartao' ? acc.Tipo_Conta === 'Cartão de Crédito' : acc.Tipo_Conta !== 'Cartão de Crédito').length === 0 &&
                        accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.Nome_Conta}</option>)
                      }
                    </select>
                    <p className="text-xs text-gray-500 mt-1">As transações serão vinculadas a esta conta.</p>
                  </div>

                  <label
                    htmlFor="native-file-upload"
                    className={`flex flex-col items-center justify-center w-full border-2 border-dashed rounded-xl p-8 cursor-pointer transition-all ${isLoading
                      ? 'border-slate-700 bg-slate-800/30 cursor-not-allowed'
                      : (selectedNativeBank.sourceType === 'Cartao' &&
                          (!nativeDueDate || (nativeReferenceMode === 'manual' && !nativeReferenceMonth))) || !selectedNativeAccountId
                        ? 'border-slate-700 bg-slate-800/20 cursor-not-allowed opacity-50'
                        : 'border-slate-600 hover:border-green-500/50 hover:bg-slate-800/50 bg-slate-900/30'
                      }`}
                  >
                    <input
                      id="native-file-upload"
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      className="hidden"
                      onChange={handleNativeBankFileChange}
                      disabled={
                        isLoading ||
                        (selectedNativeBank.sourceType === 'Cartao' &&
                          (!nativeDueDate || (nativeReferenceMode === 'manual' && !nativeReferenceMonth)))
                      }
                    />
                    {isLoading ? (
                      <div className="flex items-center gap-3 text-highlight">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-highlight"></div>
                        <span className="font-medium">Importando automaticamente...</span>
                      </div>
                    ) : (
                      <>
                        <div
                          className="w-16 h-16 rounded-full flex items-center justify-center mb-4 border"
                          style={{ backgroundColor: `${selectedNativeBank.brandColor}15`, borderColor: `${selectedNativeBank.brandColor}30` }}
                        >
                          <svg className="w-7 h-7" style={{ color: selectedNativeBank.brandColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                        </div>
                        <p className="text-white font-semibold mb-1 text-center">
                          {selectedNativeBank.sourceType === 'Cartao' && !nativeDueDate
                            ? 'Informe a data de vencimento acima'
                            : selectedNativeBank.sourceType === 'Cartao' && nativeReferenceMode === 'manual' && !nativeReferenceMonth
                              ? 'Informe a competência (AAAA-MM)'
                            : !selectedNativeAccountId
                              ? 'Selecione a conta de destino para habilitar'
                              : `Clique para enviar o extrato`}
                        </p>
                        <p className="text-gray-400 text-sm text-center">Formato: .csv, .xlsx ou .xls — O sistema lê tudo automaticamente ✨</p>
                      </>
                    )}
                  </label>

                  {isAccountModalOpen && (
                    <AccountModal
                      account={null}
                      onClose={() => setAccountModalOpen(false)}
                      onSave={async (accountData) => {
                        const newAccount = await addAccount(accountData);
                        if (newAccount) {
                          setSelectedNativeAccountId(newAccount.id);
                        }
                        setAccountModalOpen(false);
                      }}
                    />
                  )}

                  {notification && (
                    <div className={`p-3 rounded-lg text-sm text-center ${notification.type === 'success' ? 'bg-green-800/50 text-green-200 border border-green-700' : 'bg-red-800/50 text-red-200 border border-red-700'
                      }`}>
                      {notification.message}
                    </div>
                  )}
                </div>
              </Modal>
            )
          }
        </>
      )
      }

      {/* ── STEPS: MANUAL UPLOAD + MAPPING ───────────────────────────────── */}
      {
        (step === 'upload' || step === 'mapping') && (
          <Card>
            {step === 'upload' ? (
              <div id="import-form" className="space-y-4 max-w-lg mx-auto">
                <div className="bg-blue-900/20 border border-blue-500/30 p-4 rounded-md mb-4">
                  <h4 className="text-blue-200 font-bold flex items-center gap-2">
                    ✨ Importação Inteligente Manual
                  </h4>
                  <p className="text-sm text-blue-300 mt-1">
                    Importe <strong>qualquer planilha</strong> sem precisar pré-configurar. Basta carregar o arquivo e identificar as colunas.
                  </p>
                </div>
                <div className="flex justify-between items-center">
                  <button onClick={() => { setStep('bank-select'); setSelectedNativeBank(null); }} className="text-sm text-highlight hover:text-sky-400 flex items-center gap-1">
                    ← Voltar à seleção de banco
                  </button>
                </div>
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label htmlFor="source-select" className="block text-sm font-medium text-gray-300">
                      Fonte do Arquivo (Opcional)
                    </label>
                    {selectedConfigSource && importConfigs.find(c => c.Nome_Fonte === selectedConfigSource) && (
                      <button
                        onClick={async () => {
                          const config = importConfigs.find(c => c.Nome_Fonte === selectedConfigSource);
                          if (config && confirm(`Tem certeza que deseja excluir a configuração "${config.Nome_Fonte}"?`)) {
                            const { error } = await supabase.from('import_configs').delete().eq('id', config.id);
                            if (error) await appAlert("Erro ao excluir: " + error.message, "Erro", "danger");
                            else { await appAlert("Excluído com sucesso.", "Sucesso", "success"); setSelectedConfigSource(''); window.location.reload(); }
                          }
                        }}
                        className="text-xs text-red-400 hover:text-red-300 hover:underline"
                      >
                        Excluir esta configuração
                      </button>
                    )}
                  </div>
                  <Select id="source-select" value={selectedConfigSource} onChange={(e) => setSelectedConfigSource(e.target.value)} disabled={isLoading}>
                    <option value="">Selecione ou use Importação Inteligente</option>
                    {importConfigs.map(config => (
                      <option key={config.id} value={config.Nome_Fonte}>{config.Nome_Fonte}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label htmlFor="file-upload" className="block text-sm font-medium text-gray-300 mb-1">Arquivo (.csv, .xlsx, .xls)</label>
                  <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-slate-600 border-dashed rounded-md hover:border-highlight transition-colors">
                    <div className="space-y-1 text-center">
                      <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
                        <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div className="flex text-sm text-gray-400 justify-center">
                        <label htmlFor="file-upload" className="relative cursor-pointer bg-secondary rounded-md font-medium text-highlight hover:text-sky-400 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-offset-primary focus-within:ring-highlight p-1">
                          Adicionar Arquivo
                          <input id="file-upload" type="file" className="hidden" accept=".ofx,.csv,.xlsx,.xls" onChange={handleFileChange} disabled={isLoading} />
                        </label>
                      </div>
                      <p className="text-xs text-gray-500">CSV, Excel ou OFX</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-6 animate-fadeIn">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-lg font-bold text-white">Mapeamento de Colunas</h3>
                    <p className="text-sm text-gray-400">Identifique onde começam os dados e quais colunas importar.</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => { setStep('upload'); setFile(null); }}>Cancelar</Button>
                </div>

                <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
                  <h4 className="text-sm font-medium text-gray-300">1. Detalhes da Fonte</h4>
                  <div className="flex flex-col sm:flex-row gap-6">
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="sourceType"
                          value="Conta Corrente"
                          checked={tempSourceType === 'Conta' || tempSourceType === 'Conta Corrente'}
                          onChange={() => {
                            setTempSourceType('Conta Corrente');
                            setInvertValues(false);
                            setTempDueDate('');
                            setTempReferenceMode('auto');
                            setTempReferenceMonth('');
                          }}
                          className="text-highlight focus:ring-highlight bg-slate-700 border-slate-600"
                        />
                        <span className="text-gray-300 text-sm">Conta Corrente</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="sourceType"
                          value="Cartão de Crédito"
                          checked={tempSourceType === 'Cartao' || tempSourceType === 'Cartão de Crédito'}
                          onChange={() => {
                            setTempSourceType('Cartão de Crédito');
                            setInvertValues(true);
                          }}
                          className="text-highlight focus:ring-highlight bg-slate-700 border-slate-600"
                        />
                        <span className="text-gray-300 text-sm">Cartão de Crédito</span>
                      </label>
                    </div>
                    {tempSourceType === 'Cartao' && (
                      <div className="animate-fadeIn">
                        <Input label="Vencimento da Fatura *" type="date" value={tempDueDate} onChange={e => setTempDueDate(e.target.value)} className="w-full sm:w-auto text-sm py-1" />
                        <p className="text-xs text-blue-400 mt-1">Essa data será usada como <strong>Data de Pagamento</strong>.</p>
                        <div className="mt-3 space-y-2">
                          <p className="text-xs text-gray-300 font-medium">Competência da fatura</p>
                          <div className="flex flex-col sm:flex-row gap-3">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="tempReferenceMode"
                                checked={tempReferenceMode === 'auto'}
                                onChange={() => setTempReferenceMode('auto')}
                                className="text-highlight focus:ring-highlight bg-slate-700 border-slate-600"
                              />
                              <span className="text-xs text-gray-300">Automática (compra mais recente)</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="tempReferenceMode"
                                checked={tempReferenceMode === 'manual'}
                                onChange={() => setTempReferenceMode('manual')}
                                className="text-highlight focus:ring-highlight bg-slate-700 border-slate-600"
                              />
                              <span className="text-xs text-gray-300">Definir manualmente</span>
                            </label>
                          </div>
                          {tempReferenceMode === 'manual' && (
                            <Input
                              label="Competência (AAAA-MM) *"
                              type="month"
                              value={tempReferenceMonth}
                              onChange={e => setTempReferenceMonth(e.target.value)}
                              className="w-full sm:w-auto text-sm py-1"
                            />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-700">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={invertValues} onChange={(e) => setInvertValues(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-highlight focus:ring-highlight" />
                      <div className="flex flex-col">
                        <span className="text-sm text-gray-300 font-medium">Inverter Valores (Positivo ↔ Negativo)</span>
                        <span className="text-xs text-gray-500">Marque se os gastos aparecem como positivos (em verde) e deveriam ser despesas.</span>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="bg-slate-900 rounded-lg p-4 border border-slate-700">
                  <h4 className="text-sm font-medium text-gray-300 mb-2">2. Onde começam os dados reais?</h4>
                  <p className="text-xs text-gray-500 mb-3">
                    Arquivos de bancos geralmente têm linhas de "cabeçalho" (saldo, conta, datas) que atrapalham.<br />
                    <span className="text-highlight">Clique na linha</span> abaixo que contém os títulos das colunas (Ex: Data, Histórico, Valor).
                  </p>
                  <div className="max-h-40 overflow-y-auto font-mono text-xs bg-black/30 rounded border border-slate-800">
                    {fileContent.split('\n').slice(0, 15).map((line, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          const skip = idx;
                          setMapping(prev => ({ ...prev, skipLines: skip }));
                          parseContent(fileContent, skip).then(({ previewRows }) => setPreviewData(previewRows));
                        }}
                        className={`flex cursor-pointer hover:bg-white/5 p-1 ${mapping.skipLines === idx ? 'bg-highlight/20 text-highlight font-bold' : (idx < mapping.skipLines ? 'text-gray-600 line-through' : 'text-gray-300')}`}
                      >
                        <span className="w-8 text-gray-600 select-none text-right mr-3">{idx + 1}</span>
                        <span className="whitespace-pre-wrap">{line}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-right">
                    <span className="text-xs text-gray-400">Linhas ignoradas: <strong>{mapping.skipLines}</strong></span>
                  </div>
                </div>

                <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                  <h4 className="text-sm font-medium text-gray-300 mb-2">3. Identifique as Colunas</h4>
                  <div className="flex gap-4 items-center mb-4">
                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={mapping.hasHeader} onChange={e => setMapping(prev => ({ ...prev, hasHeader: e.target.checked }))} className="rounded border-slate-600 bg-slate-700 text-highlight focus:ring-highlight" />
                      A primeira linha visível é o cabeçalho
                    </label>
                  </div>
                  {previewData.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">Nenhum dado detectado. Tente ajustar a linha de início acima.</div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-600 rounded-lg">
                      <table className="min-w-[1000px] sm:min-w-full text-sm text-left text-gray-400">
                        <thead className="text-xs uppercase bg-slate-900 text-gray-400">
                          <tr>
                            <th className="px-4 py-3 border-b border-slate-700 w-10 text-center"><span title="Ignorar Linha">🚫</span></th>
                            {previewData[0]?.map((_, colIndex) => (
                              <th key={colIndex} className="px-4 py-3 min-w-[150px] border-b border-slate-700">
                                <div className="flex flex-col gap-2">
                                  <span className="text-gray-500 font-mono text-[10px]">COLUNA {colIndex + 1}</span>
                                  <select
                                    className={`bg-slate-700 border-slate-600 rounded text-xs p-1 focus:ring-highlight focus:border-highlight ${mapping.dateColumnIndex === colIndex ? 'border-blue-500 ring-1 ring-blue-500' : mapping.amountColumnIndex === colIndex ? 'border-green-500 ring-1 ring-green-500' : ''}`}
                                    value={
                                      mapping.dateColumnIndex === colIndex ? 'date' :
                                        mapping.amountColumnIndex === colIndex ? 'amount' :
                                          mapping.installmentsColumnIndex === colIndex ? 'installments' :
                                            mapping.descriptionColumnIndicies.includes(colIndex) ? 'desc' : ''
                                    }
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setMapping(prev => {
                                        const newMap = { ...prev };
                                        if (prev.dateColumnIndex === colIndex) newMap.dateColumnIndex = -1;
                                        if (prev.amountColumnIndex === colIndex) newMap.amountColumnIndex = -1;
                                        if (prev.installmentsColumnIndex === colIndex) newMap.installmentsColumnIndex = -1;
                                        newMap.descriptionColumnIndicies = newMap.descriptionColumnIndicies.filter(i => i !== colIndex);
                                        if (val === 'date') newMap.dateColumnIndex = colIndex;
                                        if (val === 'amount') newMap.amountColumnIndex = colIndex;
                                        if (val === 'installments') newMap.installmentsColumnIndex = colIndex;
                                        if (val === 'desc' && !newMap.descriptionColumnIndicies.includes(colIndex)) newMap.descriptionColumnIndicies.push(colIndex);
                                        return newMap;
                                      });
                                    }}
                                  >
                                    <option value="">Ignorar</option>
                                    <option value="date">📅 Data</option>
                                    <option value="amount">💰 Valor</option>
                                    <option value="desc">📝 Descrição</option>
                                    <option value="installments">🔢 Parcela</option>
                                  </select>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.slice(mapping.hasHeader ? 1 : 0).map((row, rowIndex) => {
                            const actualIndex = rowIndex + (mapping.hasHeader ? 1 : 0);
                            const isIgnored = mapping.ignoredIndices.has(actualIndex);
                            return (
                              <tr key={rowIndex} className={`border-b border-slate-700 hover:bg-slate-700/50 ${isIgnored ? 'opacity-40 bg-red-900/10' : ''}`}>
                                <td className="px-4 py-2 text-center">
                                  <input type="checkbox" checked={isIgnored} onChange={() => toggleIgnoreRow(actualIndex)} className="rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-red-500" title="Ignorar esta linha" />
                                </td>
                                {row.map((cell, cellIndex) => (
                                  <td key={cellIndex} className={`px-4 py-2 ${isIgnored ? 'line-through text-gray-500' : getCellColor(cell, cellIndex)}`}>{cell}</td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 justify-end">
                  <Button variant="secondary" onClick={() => { setStep('upload'); setFile(null); }}>Voltar</Button>
                  <Button onClick={handleSmartImport} disabled={isLoading} className="w-full sm:w-auto">
                    {isLoading ? 'Importando...' : 'Confirmar e Importar'}
                  </Button>
                </div>
              </div>
            )}

            {notification && step === 'mapping' && (
              <div className={`mt-4 p-3 rounded-md text-sm text-center ${notification.type === 'success' ? 'bg-green-800 text-green-100' : 'bg-red-800 text-red-100'}`}>
                {notification.message}
              </div>
            )}
          </Card>
        )
      }

      {/* External Modals rendered within ImportView scope */}
      {
        paymentDateModalOpen && (
          <PaymentDateModal
            onClose={() => setPaymentDateModalOpen(false)}
            onConfirm={async (date) => {
              setPaymentDateModalOpen(false);
              if (selectedNativeBank && fileContent && file) {
                const cardCycle = buildCardCycleInput(
                  selectedNativeBank.sourceType,
                  nativeDueDate,
                  nativeReferenceMode,
                  nativeReferenceMonth
                );
                await processNativeBankFile(fileContent, selectedNativeBank, file, date, cardCycle);
              } else {
                const cardCycle = buildCardCycleInput(
                  tempSourceType,
                  tempDueDate,
                  tempReferenceMode,
                  tempReferenceMonth
                );
                await processFile(date, cardCycle);
              }
            }}
          />
        )
      }

      {
        saveConfigModalOpen && (
          <SaveConfigModal
            onClose={() => setSaveConfigModalOpen(false)}
            existingConfigs={importConfigs}
            initialName={file?.name.split('.')[0] || ''}
            onSave={async (name, isNew, existingId) => {
              setSaveConfigModalOpen(false);
              const user = (await supabase.auth.getUser()).data.user;
              if (!user) return;
              const payload = {
                Nome_Fonte: name,
                Tipo_Fonte: tempSourceType,
                Tem_Cabecalho: mapping.hasHeader,
                Linhas_Ignorar_Inicio: mapping.skipLines,
                Coluna_Data: String(mapping.dateColumnIndex),
                Coluna_Valor: String(mapping.amountColumnIndex),
                Coluna_Parcelas: String(mapping.installmentsColumnIndex),
                Ignorar_Indices: Array.from(mapping.ignoredIndices),
                Coluna_Descricao_1: mapping.descriptionColumnIndicies[0] !== undefined ? String(mapping.descriptionColumnIndicies[0]) : null,
                Coluna_Descricao_2: mapping.descriptionColumnIndicies[1] !== undefined ? String(mapping.descriptionColumnIndicies[1]) : null,
              };
              const defaultInvert = tempSourceType === 'Cartao';
              if (invertValues !== defaultInvert) {
                if (invertValues) payload.Ignorar_Indices.push(-1);
                else payload.Ignorar_Indices.push(-2);
              }
              if (isNew) {
                const { error } = await supabase.from('import_configs').insert([{ ...payload, user_id: user.id }]).select();
                if (error) await appAlert("Erro ao criar: " + error.message, "Erro", "danger");
                else { await appAlert("Configuração criada com sucesso!", "Sucesso", "success"); await useAppStore.getState().fetchImportConfigs(); }
              } else if (existingId) {
                const { error } = await supabase.from('import_configs').update(payload).eq('id', existingId);
                if (error) await appAlert("Erro ao atualizar: " + error.message, "Erro", "danger");
                else { await appAlert("Configuração atualizada com sucesso!", "Sucesso", "success"); await useAppStore.getState().fetchImportConfigs(); }
              }
            }}
          />
        )
      }

      {/* Open Finance Review Modal */}
      {
        reviewConnection && (
          <OpenFinanceReviewModal
            isOpen={!!reviewConnection}
            onClose={() => setReviewConnection(null)}
            connection={reviewConnection}
            onSuccess={(inserted, merged) => {
              setReviewConnection(null);
              setNotification({ type: 'success', message: `✅ ${inserted} transações importadas, ${merged} mergeadas com lançamentos manuais!` });
            }}
          />
        )
      }
      {/* Modal de Consentimento Open Finance */}
      {showConsentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-xl">🔐</div>
              <div>
                <h3 className="text-white font-bold text-lg">Conectar via Open Finance</h3>
                <p className="text-gray-400 text-xs">Seus dados são enviados com criptografia</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 font-medium mb-1.5">Banco / Instituição</label>
                <select
                  value={consentInstitution}
                  onChange={e => setConsentInstitution(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                >
                  <option value="ofmockbank_br_retail">Mock Bank (Sandbox)</option>
                  <option value="bradesco_br_retail">Bradesco</option>
                  <option value="itau_br_retail">Itaú</option>
                  <option value="nubank_br_retail">Nubank</option>
                  <option value="bb_br_retail">Banco do Brasil</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-300 font-medium mb-1.5">Nome completo (como no banco)</label>
                <input
                  type="text"
                  value={consentName}
                  onChange={e => setConsentName(e.target.value)}
                  placeholder="Ex: João da Silva"
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 placeholder-gray-600"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-300 font-medium mb-1.5">CPF (apenas números)</label>
                <input
                  type="text"
                  value={consentCpf}
                  onChange={e => setConsentCpf(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder="00000000000"
                  maxLength={11}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 placeholder-gray-600 font-mono tracking-widest"
                />
                <p className="text-xs text-gray-500 mt-1">Digite apenas os 11 dígitos do CPF, sem pontos ou traços.</p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 mt-6">
                <button
                  onClick={() => handleConsentSubmit(false)}
                  disabled={isBelvoLoading || !consentName || !consentCpf}
                  className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-3 rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-200"
                >
                  {isBelvoLoading ? (
                    <svg className="w-5 h-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  ) : (
                    <ShieldCheckIcon className="w-5 h-5" />
                  )}
                  Importar via Open Finance
                </button>
              </div>

              {/* Modo Teste (apenas para Admin) */}
              {user?.email === 'cassiomq@gmail.com' && (
                  <div className="mt-8 pt-6 border-t border-slate-700/30 flex flex-col items-center gap-2">
                      <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Ambiente de Desenvolvimento</p>
                      <Button 
                          variant="outline" 
                          onClick={() => handleConsentSubmit(true)}
                          className="border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 text-xs py-1 h-auto"
                      >
                          🧪 Conexão Padrão (Teste)
                      </Button>
                      <p className="text-[9px] text-gray-600 max-w-[200px] text-center">Use este botão para simular uma conexão de sucesso sem precisar abrir a Belvo real.</p>
                  </div>
              )}
              <p className="mt-4 text-[10px] text-gray-500 text-center leading-tight">
                🔒 Seus dados são usados exclusivamente para criar o consentimento de acesso junto ao banco. Nunca armazenamos o CPF.
              </p>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowConsentModal(false)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-600 text-gray-300 text-sm hover:bg-slate-800 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleConsentSubmit}
                disabled={consentCpf.length !== 11 || !consentName.trim()}
                className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continuar →
              </button>
            </div>
          </div>
        </div>
      )}
    </div >
  );
};

interface PaymentDateModalProps {
  onClose: () => void;
  onConfirm: (date: Date) => void;
}

const PaymentDateModal: React.FC<PaymentDateModalProps> = ({ onClose, onConfirm }) => {
  const [date, setDate] = useState('');
  const handleConfirm = () => { if (date) onConfirm(new Date(date)); };
  return (
    <Modal isOpen={true} onClose={onClose} title="Data de Vencimento da Fatura" footer={
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={handleConfirm} disabled={!date}>Confirmar e Importar</Button>
      </div>
    }>
      <p className="text-gray-300 mb-4">Para faturas de cartão de crédito, por favor, informe a data de vencimento para registrar os pagamentos corretamente.</p>
      <Input label="Data de Vencimento" type="date" value={date} onChange={e => setDate(e.target.value)} autoFocus />
    </Modal>
  );
};

export default ImportView;

