
import { createClient } from '@supabase/supabase-js';

// Credentials extracted from src/supabaseClient.ts pattern
const supabaseUrl = 'https://xotxxxohcmivyzswyjtm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdHh4eG9oY21pdnl6c3d5anRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MDA5ODEsImV4cCI6MjA3OTQ3Njk4MX0.U6RYQEsN-j8ALpM4jP1NcGYJPRYzXRJDFPaa_8LogLE';

const supabase = createClient(supabaseUrl, supabaseKey);

async function auditCardMonthly() {
    console.log('--- Auditoria Mensal: Cartão XP ---');

    // 1. Get ALL accounts from 'contas' table (verified table name)
    const { data: accounts, error: errAcc } = await supabase
        .from('contas')
        .select('*');

    if (errAcc) {
        console.error('Erro geral ao buscar contas:', errAcc);
        return;
    }

    // Debug
    console.log('Contas encontradas:', accounts?.map(a => a.Nome_Conta));

    const account = accounts?.find(a =>
        (a.Nome_Conta.toUpperCase().includes('XP') && a.Nome_Conta.toUpperCase().includes('CART')) ||
        a.Nome_Conta.toUpperCase() === 'CARTÃO XP'
    );

    if (!account) {
        console.error('Conta "Cartão XP" não identificada nas opções.');
        return;
    }
    console.log(`Conta: ${account.Nome_Conta} (Saldo Inicial: ${account.Saldo_Inicial})\n`);

    // 2. Fetch All Transactions
    const { data: transactions, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('ID_Conta', account.id)
        .order('Data', { ascending: true });

    if (error) {
        console.error('Erro:', error);
        return;
    }

    // 3. Group by Month
    const monthlyStats: Record<string, { income: number, expense: number, transactions: number }> = {};

    transactions.forEach(t => {
        const date = t.Data; // YYYY-MM-DD
        const monthKey = date.substring(0, 7); // YYYY-MM

        if (!monthlyStats[monthKey]) {
            monthlyStats[monthKey] = { income: 0, expense: 0, transactions: 0 };
        }

        monthlyStats[monthKey].transactions++;
        if (t.Valor > 0) {
            monthlyStats[monthKey].income += t.Valor;
        } else {
            monthlyStats[monthKey].expense += t.Valor;
        }
    });

    // 4. Report
    let runningBalance = account.Saldo_Inicial;
    console.log('MÊS     | ENTRADAS (Pagamentos) | SAÍDAS (Compras) | NET (Sobra/Falta) | SALDO ACUMULADO');
    console.log('--------|-----------------------|------------------|-------------------|----------------');
    console.log(`INÍCIO  | -                     | -                | -                 | R$ ${runningBalance.toFixed(2)}`);

    Object.keys(monthlyStats).sort().forEach(month => {
        const stats = monthlyStats[month];
        const net = stats.income + stats.expense; // Expense is negative
        runningBalance += net;

        console.log(`${month} | R$ ${stats.income.toFixed(2).padStart(10)}     | R$ ${stats.expense.toFixed(2).padStart(9)}     | R$ ${net.toFixed(2).padStart(10)}     | R$ ${runningBalance.toFixed(2)}`);
    });

    console.log('\n--- VEREDITO ---');
    console.log(`Saldo Final Calculado: R$ ${runningBalance.toFixed(2)}`);
}

auditCardMonthly();
