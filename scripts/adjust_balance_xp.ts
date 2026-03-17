
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xotxxxohcmivyzswyjtm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdHh4eG9oY21pdnl6c3d5anRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MDA5ODEsImV4cCI6MjA3OTQ3Njk4MX0.U6RYQEsN-j8ALpM4jP1NcGYJPRYzXRJDFPaa_8LogLE';

const supabase = createClient(supabaseUrl, supabaseKey);

async function adjustBalance() {
    console.log('--- Ajustando Saldo Inicial: Cartão XP ---');

    // Use exact same select as data_cleaning.ts or list_accounts.ts
    const { data: accounts, error: errAcc } = await supabase
        .from('contas')
        .select('*');

    if (errAcc) {
        console.error('Erro ao buscar contas:', errAcc);
        return;
    }

    console.log(`Contas encontradas: ${accounts?.length}`);

    const account = accounts?.find(a =>
        a.Nome_Conta.trim() === 'Cartão XP' ||
        a.Nome_Conta.includes('Cartão XP')
    );

    if (!account) {
        console.error('Cartão XP não encontrado. IDs disponíveis:', accounts?.map(a => `${a.Nome_Conta} (${a.id})`));
        return;
    }

    const currentInitial = account.Saldo_Inicial;
    const adjustment = 1083.50;
    const newInitial = currentInitial - adjustment;

    console.log(`Conta: ${account.Nome_Conta} (${account.id})`);
    console.log(`Saldo Inicial Atual: ${currentInitial}`);
    console.log(`Novo Saldo Inicial Alvo: ${newInitial.toFixed(2)}`);

    // Update
    const { error } = await supabase
        .from('contas')
        .update({ Saldo_Inicial: newInitial })
        .eq('id', account.id);

    if (error) {
        console.error('Erro ao atualizar:', error);
    } else {
        console.log('✅ Saldo Inicial atualizado com sucesso!');
    }
}

adjustBalance();
