import { driver, DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

export interface TourConfig {
    steps: DriveStep[];
}

export const tourStepsByView: Record<string, DriveStep[]> = {
    dashboard: [
        {
            element: '#nav-dashboard',
            popover: {
                title: 'Bem-vindo ao FinElo! 👋',
                description: 'Este é o seu centro de controle. Diga adeus às planilhas manuais e veja suas finanças com clareza.',
                side: 'right',
                align: 'start',
            }
        },
        {
            element: '#dashboard-header',
            popover: {
                title: 'Domine o Tempo',
                description: 'Alterne entre visualizações (Mês, Ano, Trimestre) para entender seus hábitos de curto e longo prazo.',
                side: 'bottom'
            }
        },
        {
            element: '#dashboard-kpis',
            popover: {
                title: 'Saúde em Números',
                description: 'Receitas, Despesas e o mais importante: Quanto você está economizando (Taxa de Poupança).',
                side: 'bottom'
            }
        },
        {
            element: '#dashboard-charts-main',
            popover: {
                title: 'Evolução Visual',
                description: 'Acompanhe se seu patrimônio está crescendo ou se as despesas estão subindo mais que a renda.',
                side: 'top'
            }
        },
        {
            element: '#nav-import',
            popover: {
                title: '🚀 Comece por Aqui!',
                description: 'A mágica acontece na Importação. Clique aqui para enviar seu extrato bancário e ver tudo isso ser preenchido automaticamente.',
                side: 'right'
            }
        }
    ],
    transactions: [
        {
            element: '#nav-transactions',
            popover: {
                title: 'Área de Transações',
                description: 'Gerencie todos os seus lançamentos financeiros aqui.',
                side: 'right'
            }
        },
        {
            element: '#transactions-actions',
            popover: {
                title: 'Ações Rápidas',
                description: 'Adicione transações manualmente ou exporte seus dados para Excel/CSV para análises externas.',
                side: 'bottom'
            }
        },
        {
            element: '#transactions-filters',
            popover: {
                title: 'Filtros Poderosos',
                description: 'Encontre exatamente o que precisa filtrando por data, conta, categoria, tipo ou texto. Os filtros afetam a tabela e os saldos abaixo.',
                side: 'bottom'
            }
        },
        {
            element: '#transactions-balances',
            popover: {
                title: 'Saldos Bancários em Tempo Real',
                description: 'Veja o saldo atualizado de cada conta. O valor considera todas as receitas e despesas registradas até hoje.',
                side: 'bottom'
            }
        },
        {
            element: '#transactions-table',
            popover: {
                title: 'Extrato Detalhado',
                description: 'Sua lista completa de transações. Você pode editar valores clicando diretamente neles, ordenar colunas ou excluir lançamentos.',
                side: 'top'
            }
        }
    ],
    import: [
        {
            element: '#nav-import',
            popover: {
                title: 'Importação de Extratos',
                description: 'A maneira mais rápida de alimentar o sistema.',
                side: 'right'
            }
        },
        {
            element: '#import-form',
            popover: {
                title: 'Upload de Arquivo',
                description: 'Selecione o banco (Fonte) e envie seu arquivo OFX ou CSV. O sistema usará suas regras para categorizar tudo.',
                side: 'bottom'
            }
        }
    ],
    settings: [
        {
            element: '#nav-settings',
            popover: {
                title: 'Configurações do Sistema',
                description: 'Configure o comportamento de toda a plataforma.',
                side: 'right'
            }
        },
        {
            element: '#settings-categories',
            popover: {
                title: 'Gerenciar Categorias',
                description: 'Organize seus gastos. Defina se uma categoria é de Investimento para que ela apareça nos gráficos corretos (como o de Patrimônio) e não polua seu fluxo de caixa operacional.',
                side: 'top'
            }
        },
        {
            element: '#settings-budgets',
            popover: {
                title: 'Definir Orçamentos',
                description: 'Aqui você planeja seu ano. Estabeleça limites de gastos para cada categoria. Você pode navegar entre os anos para manter um histórico ou planejar o futuro.',
                side: 'top'
            }
        },
        {
            element: '#settings-rules',
            popover: {
                title: 'Regras de Mapeamento',
                description: 'Automatize a categorização! Diga ao sistema que "UBER" sempre deve ir para "Transporte". Use os botões abaixo para "Re-aplicar" regras em transações antigas ou "Verificar Duplicatas" para manter a ordem.',
                side: 'top'
            }
        },
        {
            element: '[data-tour="settings-accounts"]',
            popover: {
                title: 'Gerenciar Contas',
                description: 'Aqui você visualiza todas as contas cadastradas. É possível ajustar o Saldo Inicial para corrigir eventuais diferenças ou excluir contas antigas (e suas transações) para manter tudo limpo.',
                side: 'top'
            }
        },
        {
            element: '#settings-configs',
            popover: {
                title: 'Fontes de Importação',
                description: 'Cadastre seus bancos e cartões aqui. Defina padrões para facilitar a leitura dos extratos (CSV/OFX).',
                side: 'top'
            }
        },
        {
            element: '#settings-logs',
            popover: {
                title: 'Histórico de Importações',
                description: 'Controle total sobre seus dados. Veja o que foi importado, exclua lotes inteiros se necessário, ou use "Sincronizar Histórico Antigo" para recuperar registros de importações passadas.',
                side: 'top'
            }
        }
    ],
    help: [
        {
            element: '#nav-help',
            popover: {
                title: 'Central de Ajuda',
                description: 'Precisa de suporte? Aqui é o lugar.',
                side: 'right'
            }
        },
        {
            element: '#help-tab-faq',
            popover: {
                title: 'Perguntas Frequentes',
                description: 'Tire suas dúvidas instantaneamente navegando pelas perguntas mais comuns da comunidade.',
                side: 'bottom'
            }
        },
        {
            element: '#help-tab-new',
            popover: {
                title: 'Abrir Novo Chamado',
                description: 'Encontrou um erro ou tem uma sugestão? Envie um ticket diretamente para nossa equipe.',
                side: 'bottom'
            }
        },
        {
            element: '#help-tab-history',
            popover: {
                title: 'Acompanhar Chamados',
                description: 'Veja o status e as respostas dos seus tickets abertos anteriormente.',
                side: 'bottom'
            }
        }
    ],
    admin: []
};

export const startTour = (currentView: string, onComplete?: () => void) => {
    const steps = tourStepsByView[currentView] || [];
    console.log(`[Tour] Starting tour for "${currentView}". Steps: ${steps.length}`);

    if (steps.length === 0) {
        alert("Não há tutorial específico para esta tela ainda.");
        return;
    }

    const driverObj = driver({
        showProgress: true,
        steps: steps,
        nextBtnText: 'Próximo',
        prevBtnText: 'Anterior',
        doneBtnText: 'Entendi',
        onDestroyStarted: () => {
            if (!driverObj.hasNextStep() || confirm("Fechar o tutorial?")) {
                driverObj.destroy();
                onComplete?.();
            }
        },
    });

    driverObj.drive();
};

export const autoStartTour = (currentView: string) => {
    const TOUR_KEY = `hasSeenTour_${currentView}`;
    const hasSeen = localStorage.getItem(TOUR_KEY);

    if (!hasSeen) {
        // Pequeno delay para garantir que a UI carregou
        setTimeout(() => {
            startTour(currentView, () => {
                localStorage.setItem(TOUR_KEY, 'true');
            });
        }, 1500);
    }
};
