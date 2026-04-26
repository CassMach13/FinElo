import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: Supabase credentials not found in .env.local');
    process.exit(1);
}

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
