import { Transaction, Category, Account, Budget, MappingRule } from '../types';
import { appAlert } from '../hooks/useDialogStore';
import { useAppStore } from '../hooks/useAppStore';
import { v4 as uuidv4 } from 'uuid';

export const loadDemoData = async (): Promise<void> => {
    try {
        const response = await fetch('/demo.csv');
        if (!response.ok) throw new Error('Falha ao carregar arquivo de demo');

        const text = await response.text();
        const lines = text.split('\n');

        // Ignora cabeçalho
        const dataLines = lines.slice(1).filter(line => line.trim().length > 0);

        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); // 0-indexed

        const transactions: Transaction[] = dataLines.map((line, index) => {
            const cols = line.split(';');
            if (cols.length < 3) return null;

            // Format: Data;Descricao;Valor;Documento
            // Ex: 01/12/2024;PAGAMENTO SALARIO;5000,00;1001

            const dateStr = cols[0];
            const desc = cols[1];
            const valueStr = cols[2];

            // Parse Value (BRL: 5.000,00 or -1.234,56)
            // Remove points, replace comma with dot
            const cleanValue = valueStr.replace(/\./g, '').replace(',', '.');
            const value = parseFloat(cleanValue);

            // Parse Date
            const [d, m, y] = dateStr.split('/');

            // Logic to move date to current month/year
            // We maintain the Day, but force Month and Year to current
            // If the day > days in current month (e.g. 31st Feb), JS handles it by rolling over, which is acceptable for demo

            // Adjust day if needed to ensure ordering roughly matches demo
            // Or just use the day as is.
            const day = parseInt(d);

            const newDate = new Date(currentYear, currentMonth, day);

            // Determine Type
            const type = value >= 0 ? 'Renda' : 'Despesa';

            // Determine Category (Simple mapping based on known demo data)
            let category = 'Outros';
            const upperDesc = desc.toUpperCase();

            if (upperDesc.includes('SALARIO') || upperDesc.includes('PIX RECEBIDA')) category = 'Salário';
            else if (upperDesc.includes('ALUGUEL')) category = 'Moradia';
            else if (upperDesc.includes('SUPERMERCADO') || upperDesc.includes('IFOOD')) category = 'Alimentação';
            else if (upperDesc.includes('COMBUSTIVEL') || upperDesc.includes('UBER')) category = 'Transporte';
            else if (upperDesc.includes('NETFLIX') || upperDesc.includes('SPOTIFY') || upperDesc.includes('CINEMARK')) category = 'Lazer';
            else if (upperDesc.includes('FARMACIA')) category = 'Saúde';
            else if (upperDesc.includes('PRESENTES')) category = 'Presentes';
            else if (upperDesc.includes('CARTAO')) category = 'Pagamentos';

            return {
                ID_Transacao: uuidv4(), // Generate temp ID, real one comes from DB usually but store handles adds
                Data: newDate,
                Data_Pagamento: newDate,
                Descricao_Original: desc + ' (Demo)',
                Nome_Fantasia: desc,
                Valor: value,
                Tipo: type,
                Categoria: category,
                Parcela_Atual: 0,
                Total_Parcelas: 0,
                Fonte: 'Demo',
                Origem: 'demo.csv',
                Portador: 'Banco Demo'
            } as Transaction;
        }).filter(t => t !== null) as Transaction[];

        console.log(`[Demo] 0 loaded ${transactions.length} transactions.`);

        // Create a dummy config for demo data
        const demoConfig: any = {
            Nome_Fonte: 'Demo Data',
            Tipo_Fonte: 'Conta',
            ID_Conta_Associada: null // Or fetch a default account if needed, but null should be fine if store handles it
        };

        // Add to Store (and Supabase via Store action)
        await useAppStore.getState().addMultipleTransactions(transactions, demoConfig, 'demo.csv');

        // Force refresh just in case
        useAppStore.getState().fetchAllData();

        await appAlert('Dados de demonstração carregados com sucesso! 🚀', 'Sucesso', 'success');

    } catch (error) {
        console.error('Error loading demo data:', error);
        await appAlert('Erro ao carregar dados de demonstração.', 'Erro', 'danger');
    }
};
