
import { createClient } from '@supabase/supabase-js';

// Credentials extracted from src/supabaseClient.ts pattern
const supabaseUrl = 'https://xotxxxohcmivyzswyjtm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdHh4eG9oY21pdnl6c3d5anRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MDA5ODEsImV4cCI6MjA3OTQ3Njk4MX0.U6RYQEsN-j8ALpM4jP1NcGYJPRYzXRJDFPaa_8LogLE';

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnoseCardCredits() {
    console.log('--- Diagnóstico de Créditos no Cartão XP ---');

    // 1. Get ALL accounts from 'contas' table (verified table name)
    const { data: accounts, error: errAcc } = await supabase
        .from('contas')
        .select('*');

    if (errAcc) {
        console.error('Erro ao buscar contas:', errAcc);
        return;
    }

    if (!accounts || accounts.length === 0) {
        console.error('Nenhuma conta encontrada no sistema.');
        return;
    }

    // Debug: List all accounts
    console.log('Contas Encontradas:');
    accounts.forEach(a => console.log(`- ${a.Nome_Conta} (ID: ${a.id})`));

    // Find Cartão XP
    const account = accounts.find(a =>
        a.Nome_Conta.toUpperCase().includes('CART') && a.Nome_Conta.toUpperCase().includes('XP')
    );

    if (!account) {
        console.error('Conta "Cartão XP" não identificada automaticamente.');
        return;
    }

    console.log(`\nConta Selecionada: ${account.Nome_Conta} (ID: ${account.id})`);
    console.log(`Saldo Inicial Configurado: R$ ${account.Saldo_Inicial}`);

    // 2. Get all Income (Renda) transactions for this account
    // Note: 'transactions' table usually uses 'ID_Conta' or 'id_conta'? 
    // Based on diagnose_xp.ts, it uses 'ID_Conta' and 'Valor' and 'Data'.
    const { data: credits, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('ID_Conta', account.id)
        .gt('Valor', 0) // Positive values only (Income)
        .order('Data', { ascending: true });

    if (error) {
        console.error('Erro ao buscar transações:', error);
        return;
    }

    console.log(`\nEncontrados ${credits.length} créditos (Renda/Pagamentos):`);
    let totalCredits = 0;

    credits.forEach(t => {
        console.log(`${t.Data} | ${t.Descricao_Original.padEnd(50)} | ${t.Nome_Fantasia.padEnd(30)} | R$ ${t.Valor.toFixed(2)}`);
        totalCredits += t.Valor;
    });

    console.log('------------------------------------------------');
    console.log(`Total de Créditos (Soma): R$ ${totalCredits.toFixed(2)}`);
}

diagnoseCardCredits();
